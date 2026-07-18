import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { ChatDisclosureController } from "../chatDisclosure";
import { presentChatEvents, type ChatEventPresentation, type ChatEventChild } from "../chatEventPresentation";
import { groupChatMessages, summarizeChatGroup, type ChatGroup } from "../chatGroups";
import { writeClipboardText } from "../clipboard";
import { capturePrependScrollAnchor, PREPEND_RESTORE_SETTLE_FRAMES, restorePrependScrollAnchor, type PrependScrollAnchor } from "../chatScrollAnchoring";
import { shouldRequestEarlierMessages } from "../chatHistoryLoading";
import { ChatScrollController, distanceFromScrollBottom, findFirstVisibleArticle, isNearScrollBottom, shouldShowJumpToLatest, type ChatAnchorScrollPosition, type ChatScrollRestoreResult } from "../chatScrollPosition";
import { sessionStatusPresentation } from "../sessionStatusPresentation";
import type { ExtensionUiNotification, ExtensionUiRequest, ExtensionUiResolution, ExtensionUiResponse, QueuedSessionMessage, SessionActivity, SessionStatus } from "../api";
import type { ChatLine, ChatPart } from "./shared";
import { chatStyles } from "./shared";
import "./ConversationMeter";
import "./FormattedText";
import "./ToolExecutionView";
import "./ExtensionUiCards";
import type { ExtensionUiSubmitResult } from "./ExtensionUiCards";

const messageTimestampFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

function clampPercent(value: number): number {
  return clampNumber(value, 0, 100);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function isChatScrollKey(key: string): boolean {
  return key === "ArrowUp" || key === "ArrowDown" || key === "PageUp" || key === "PageDown" || key === "Home" || key === "End" || key === " " || key === "Spacebar";
}

export interface QueuedMessageLane {
  heading: "Steering" | "Follow-ups";
  kind: QueuedSessionMessage["kind"];
  messages: QueuedSessionMessage[];
}

export interface QueuedMessageSection {
  source: "client" | "server";
  heading: string;
  detail: string;
  messages: QueuedSessionMessage[];
  lanes?: QueuedMessageLane[];
}

export function chatQueuedMessageSections(clientQueued: QueuedSessionMessage[], serverQueued: QueuedSessionMessage[], pendingMessageCount = serverQueued.length): QueuedMessageSection[] {
  const serverDetail = pendingMessageCount === serverQueued.length
    ? `${String(serverQueued.length)} pending`
    : `${String(serverQueued.length)} listed; status says ${String(pendingMessageCount)} pending`;
  return [
    clientQueued.length === 0 ? undefined : { source: "client", heading: "Queued until session starts", detail: "Will send once the backend session is ready", messages: clientQueued },
    serverQueued.length === 0 && pendingMessageCount === 0 ? undefined : {
      source: "server",
      heading: "Queued messages",
      detail: serverDetail,
      messages: serverQueued,
      lanes: queuedMessageLanes(serverQueued),
    },
  ].filter((section): section is QueuedMessageSection => section !== undefined);
}

function queuedMessageLanes(messages: QueuedSessionMessage[]): QueuedMessageLane[] {
  const lanes: QueuedMessageLane[] = [
    { heading: "Steering", kind: "steer", messages: messages.filter((message) => message.kind === "steer") },
    { heading: "Follow-ups", kind: "followUp", messages: messages.filter((message) => message.kind === "followUp") },
  ];
  return lanes.filter((lane) => lane.messages.length > 0);
}

export function chatMessageMetadataLabel(message: ChatLine): string {
  const timestamp = message.meta?.timestamp;
  const time = timestamp === undefined ? undefined : formatMessageTimestamp(timestamp);
  const model = chatMessageModelLabel(message);
  const parts = [time, model].filter((part): part is string => part !== undefined && part !== "");
  return parts.length === 0 ? "No Pi message metadata available" : parts.join(" · ");
}

function formatMessageTimestamp(timestamp: string): string | undefined {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return undefined;
  return messageTimestampFormatter.format(date);
}

function chatMessageModelLabel(message: ChatLine): string | undefined {
  const model = message.meta?.model;
  if (model === undefined) return undefined;
  const id = model.responseId ?? model.id;
  if (id === undefined || id === "") return model.provider;
  return model.provider !== undefined && model.provider !== "" ? `${model.provider}/${id}` : id;
}

@customElement("chat-view")
export class ChatView extends LitElement {
  @property({ attribute: false }) messages: ChatLine[] = [];
  @property() sessionId = "";
  @property({ type: Number }) messageStart = 0;
  @property({ type: Number }) messageEnd = 0;
  @property({ type: Number }) messageTotal = 0;
  @property({ type: Boolean }) hasMore = false;
  @property({ type: Boolean }) loadingMore = false;
  @property({ type: Boolean }) isReceivingPartialStream = false;
  @property({ type: Boolean }) isSendingPrompt = false;
  @property({ type: Boolean }) isCompacting = false;
  /** A command or extension card needs an answer before runtime work can continue. */
  @property({ type: Boolean }) waitingForUser = false;
  @property({ type: Number }) pendingMessageCount = 0;
  @property({ attribute: false }) clientQueuedMessages: QueuedSessionMessage[] = [];
  @property({ attribute: false }) extensionUiRequests: ExtensionUiRequest[] = [];
  @property({ attribute: false }) extensionUiResolutions: ExtensionUiResolution[] = [];
  @property({ attribute: false }) extensionUiNotifications: ExtensionUiNotification[] = [];
  @property({ attribute: false }) onExtensionUiRespond?: (response: ExtensionUiResponse) => Promise<ExtensionUiSubmitResult> | ExtensionUiSubmitResult;
  @property({ attribute: false }) status?: SessionStatus;
  @property({ attribute: false }) activity?: SessionActivity;
  @property({ type: Boolean }) canStop = false;
  /** The server's pending count confirms that Stop clears a server queue. */
  @property({ type: Boolean }) clearsServerQueue = false;
  @property({ type: Boolean }) canClearServerQueue = false;
  /** The app shell has confirmed that the mobile IME currently owns the viewport. */
  @property({ type: Boolean }) mobileKeyboardFocusActive = false;
  @property({ attribute: false }) onClearServerQueue?: () => void;
  @property({ attribute: false }) onLoadMore?: () => void;
  @query(".chat") private chat?: HTMLDivElement;
  @state() private pinnedToBottom = true;
  @state() private showJumpToLatest = false;
  @state() private expandedMetaKey: string | undefined;
  @state() private copiedMessageKey: string | undefined;
  @state() private currentConversationIndex: number | undefined;
  private readonly disclosures = new ChatDisclosureController();
  private readonly scrollController = new ChatScrollController();
  private suppressScrollSave = false;
  private suppressLoadMoreRequests = false;
  private loadMoreCheckFrame: number | undefined;
  private scrollToBottomFrame: number | undefined;
  private conversationRailFrame: number | undefined;
  private groupedMessagesInput?: ChatLine[];
  private groupedMessagesStart = 0;
  private groupedMessagesCache: ChatGroup[] = [];
  private readonly messageMetaCache = new WeakMap<ChatLine, string>();
  private readonly messageCopyTextCache = new WeakMap<ChatLine, string>();
  private lastScrollTop = 0;
  private lastClientHeight = 0;
  private touchStartY: number | undefined;
  /** Scroll positions recorded at explicit pointer/keyboard scroll starts. */
  private pointerScrollStart: number | undefined;
  private keyboardScrollStart: number | undefined;
  private followingLatestUntilBottom = false;
  private pendingScrollRestoreSessionId: string | undefined;
  private pendingScrollRestorePosition: ChatAnchorScrollPosition | undefined;
  private restoreScrollFrame: number | undefined;
  private prependRestoreToken = 0;
  @state() private loadMoreRequested = false;
  private readonly onViewportResize = () => {
    if (this.followingLatestUntilBottom) this.continueFollowingLatest();
    else if (this.pinnedToBottom) this.scrollToBottom();
    else this.lastClientHeight = this.chat?.clientHeight ?? 0;
    this.refreshJumpToLatest();
  };
  private readonly onImageLoad = (): void => {
    if (this.followingLatestUntilBottom) this.continueFollowingLatest();
    else if (this.pinnedToBottom) this.scrollToBottom();
    this.refreshJumpToLatest();
  };
  private readonly onPageHide = () => {
    this.saveScrollPosition();
  };
  private readonly handleClearServerQueue = (): void => {
    this.onClearServerQueue?.();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("resize", this.onViewportResize);
    window.addEventListener("pagehide", this.onPageHide);
    window.visualViewport?.addEventListener("resize", this.onViewportResize);
  }

  protected override firstUpdated(): void {
    this.lastClientHeight = this.chat?.clientHeight ?? 0;
    this.refreshJumpToLatest();
  }

  override disconnectedCallback(): void {
    this.saveScrollPosition();
    this.scrollController.dispose();
    this.prependRestoreToken += 1;
    if (this.restoreScrollFrame !== undefined) cancelAnimationFrame(this.restoreScrollFrame);
    if (this.loadMoreCheckFrame !== undefined) cancelAnimationFrame(this.loadMoreCheckFrame);
    if (this.scrollToBottomFrame !== undefined) cancelAnimationFrame(this.scrollToBottomFrame);
    if (this.conversationRailFrame !== undefined) cancelAnimationFrame(this.conversationRailFrame);
    window.removeEventListener("resize", this.onViewportResize);
    window.removeEventListener("pagehide", this.onPageHide);
    window.visualViewport?.removeEventListener("resize", this.onViewportResize);
    super.disconnectedCallback();
  }

  private savePreviousSessionScrollPosition(previousSessionId: unknown): void {
    if (typeof previousSessionId !== "string" || previousSessionId === "" || previousSessionId === this.sessionId) return;
    this.saveScrollPosition(previousSessionId);
  }

  private prepareSessionUiState(): void {
    this.disclosures.syncSession(this.sessionId);
    this.scrollController.clearScheduledSave();
    this.suppressScrollSave = false;
    this.suppressLoadMoreRequests = false;
    this.pendingScrollRestoreSessionId = undefined;
    this.pendingScrollRestorePosition = undefined;
    this.showJumpToLatest = false;
    this.followingLatestUntilBottom = false;
    this.pointerScrollStart = undefined;
    this.keyboardScrollStart = undefined;
    this.prependRestoreToken += 1;
    if (this.restoreScrollFrame !== undefined) {
      cancelAnimationFrame(this.restoreScrollFrame);
      this.restoreScrollFrame = undefined;
    }
  }

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("sessionId")) {
      this.savePreviousSessionScrollPosition(changed.get("sessionId"));
      this.prepareSessionUiState();
    }
    // A smooth Latest transition has an explicit bottom intent. Transcript and
    // layout updates must not replace it with a transient mid-scroll position.
    if (changed.has("messages") && !this.followingLatestUntilBottom) this.pinnedToBottom = this.pinnedToBottom && (this.didChatHeightChange() || this.isNearBottom());
  }

  protected override update(changed: Map<string, unknown>): void {
    const prependAnchor = this.isPrependingMessages(changed) ? this.capturePrependScrollAnchor() : undefined;
    super.update(changed);
    if (prependAnchor !== undefined) this.restorePrependScrollAnchor(prependAnchor);
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (changed.has("loadingMore") && !this.loadingMore) this.loadMoreRequested = false;
    if (changed.has("hasMore") && !this.hasMore) this.loadMoreRequested = false;
    if (changed.has("sessionId")) this.restoreScrollPosition();
    if (!changed.has("sessionId") && changed.has("messages")) {
      if (this.followingLatestUntilBottom) this.continueFollowingLatest();
      else if (this.pinnedToBottom) this.scrollToBottom();
    }
    if (changed.has("messages") || changed.has("messageStart") || changed.has("messageTotal") || changed.has("hasMore") || changed.has("loadingMore")) this.scheduleConversationRailUpdate();
    if (changed.has("messages") || changed.has("messageStart") || changed.has("hasMore") || changed.has("loadingMore")) this.continuePendingScrollRestore();
    if (changed.has("messages") || changed.has("hasMore") || changed.has("loadingMore")) this.requestLoadMoreIfNeeded();
    if (changed.has("messages") || changed.has("messageStart") || changed.has("messageEnd") || changed.has("hasMore") || changed.has("loadingMore") || changed.has("isSendingPrompt") || changed.has("isReceivingPartialStream") || changed.has("isCompacting") || changed.has("status") || changed.has("activity")) this.refreshJumpToLatest();
  }

  override render() {
    const groups = this.groupedMessages();
    const liveStrip = this.renderLiveStrip();
    const hasLiveStrip = liveStrip !== null;
    return html`
      <div class=${this.showJumpToLatest ? "chat-wrap has-jump-to-latest" : "chat-wrap"}>
        ${this.renderConversationRail()}
        <div class=${`chat${hasLiveStrip ? " has-live-strip" : ""}${this.showJumpToLatest ? " has-jump-to-latest" : ""}`} @scroll=${() => { this.onScroll(); }} @wheel=${(event: WheelEvent) => { this.onWheel(event); }} @pointerdown=${(event: PointerEvent) => { this.onPointerDown(event); }} @pointerup=${this.onPointerUp} @pointercancel=${this.onPointerUp} @keydown=${(event: KeyboardEvent) => { this.onKeydown(event); }} @keyup=${(event: KeyboardEvent) => { this.onKeyup(event); }} @touchstart=${(event: TouchEvent) => { this.onTouchStart(event); }} @touchmove=${(event: TouchEvent) => { this.onTouchMove(event); }}>
          ${this.renderHistoryBoundary()}
          ${repeat(
            groups,
            (group) => group.kind === "group" ? this.groupRenderKey(group.startIndex) : this.messageAnchorKey(group.index),
            (group, index) => {
              if (group.kind === "group") return this.renderMessageGroup(group.messages, group.startIndex, group.endIndex, this.isLiveTailGroup(groups, index));
              if (group.kind === "tool-image") return this.renderToolImageOutput(group.message, group.index, group.toolName);
              return this.renderMessage(group.message, group.index);
            },
          )}
          ${this.renderQueuedMessages()}
          <extension-ui-cards .requests=${this.extensionUiRequests} .resolutions=${this.extensionUiResolutions} .notifications=${this.extensionUiNotifications} .onRespond=${this.onExtensionUiRespond}></extension-ui-cards>
          ${this.renderSessionActivity()}
        </div>
        ${liveStrip}
        ${this.renderJumpToLatest()}
      </div>
    `;
  }

  private groupedMessages(): ChatGroup[] {
    if (this.groupedMessagesInput === this.messages && this.groupedMessagesStart === this.messageStart) return this.groupedMessagesCache;
    this.groupedMessagesInput = this.messages;
    this.groupedMessagesStart = this.messageStart;
    this.groupedMessagesCache = groupChatMessages(this.messages, this.messageStart);
    return this.groupedMessagesCache;
  }

  private isLiveTailGroup(groups: ChatGroup[], index: number): boolean {
    return index === groups.length - 1 && this.isSessionLive();
  }

  private isSessionLive(): boolean {
    return this.isSendingPrompt
      || this.status?.isStreaming === true
      || this.isCompacting
      || this.status?.isCompacting === true
      || this.status?.isBashRunning === true
      || this.activity?.phase === "active";
  }

  private renderLiveStrip() {
    const presentation = sessionStatusPresentation({
      status: this.status,
      activity: this.activity,
      waitingForUser: this.waitingForUser,
      isSendingPrompt: this.isSendingPrompt,
    });
    // Waiting is authoritative over stale runtime activity: show the same one
    // state as the shared header presenter rather than conflicting work text.
    if (presentation.kind === "waiting") return html`
      <div class="live-strip active" aria-live="polite"><span class="dot"></span><span class="activity-text">${presentation.label}</span></div>
    `;
    if (this.isReceivingPartialStream) return html`
      <div class="live-strip active" aria-live="polite"><span class="dot"></span><span class="activity-text">Catching up</span></div>
    `;
    if (this.isCompacting && this.status?.isCompacting !== true) return html`
      <div class="live-strip active" aria-live="polite"><span class="dot"></span><span class="activity-text">Compacting</span></div>
    `;
    const showsCurrentWork = this.isSendingPrompt || this.isCompacting || this.status?.isStreaming === true || this.activity?.phase === "active";
    if (presentation.kind === "idle" || (presentation.kind === "working" && !showsCurrentWork)) return null;
    if (presentation.kind === "error" && presentation.detail === undefined) return null;
    const text = presentation.detail === undefined ? presentation.label : `${presentation.label}: ${presentation.detail}`;
    return html`
      <div class=${presentation.kind === "error" ? "live-strip error" : "live-strip active"} aria-live="polite">
        <span class="dot"></span><span class="activity-text">${text}</span>
      </div>
    `;
  }

  private renderJumpToLatest() {
    if (!this.showJumpToLatest) return null;
    return html`
      <button type="button" class="jump-to-latest" aria-label="Jump to latest message" title="Jump to latest message" @pointerdown=${this.preserveComposerFocusOnJumpPointerDown} @click=${this.jumpToLatest}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v13m0 0-5-5m5 5 5-5M5 20h14"></path></svg><span>Latest</span>
      </button>
    `;
  }

  private renderQueuedMessages() {
    const serverQueued = this.status?.queuedMessages ?? [];
    return html`${chatQueuedMessageSections(this.clientQueuedMessages, serverQueued, this.status?.pendingMessageCount ?? 0).map((section) => this.renderQueuedMessageList(section))}`;
  }

  private renderQueuedMessageList(section: QueuedMessageSection) {
    const canClear = section.source === "server" && this.canClearServerQueue && this.onClearServerQueue !== undefined;
    return html`
      <aside class="queued-messages" aria-label=${section.heading} aria-live="polite">
        <div class="queued-header">
          <div class="queued-heading">
            <strong>${section.heading}</strong>
            <small>${section.detail}</small>
          </div>
          ${canClear ? html`
            <button type="button" class="queued-clear-button" title="Clear queued messages without stopping active work" aria-label="Clear queued server messages without stopping active work" @click=${this.handleClearServerQueue}>Clear queue</button>
          ` : null}
        </div>
        ${section.source === "server" ? section.lanes?.map((lane) => this.renderQueuedMessageLane(lane)) : section.messages.map((message, index) => this.renderQueuedMessage(message, index + 1))}
        ${section.source === "server" && section.messages.length === 0 ? html`<small class="queued-unlisted">The runtime has not supplied message text for this queue.</small>` : null}
        ${section.source === "server" && this.canStop && this.clearsServerQueue ? html`<small class="queued-stop-note">Stop clears this queue.</small>` : null}
      </aside>
    `;
  }

  private renderQueuedMessageLane(lane: QueuedMessageLane) {
    return html`
      <section class="queued-lane" aria-label=${lane.heading}>
        <strong class="queued-lane-heading">${lane.heading}</strong>
        ${lane.messages.map((message, index) => this.renderQueuedMessage(message, index + 1))}
      </section>
    `;
  }

  private renderQueuedMessage(message: QueuedSessionMessage, ordinal: number) {
    return html`
      <div class="queued-message">
        <span class="queued-kind">${message.kind === "steer" ? "Steer" : "Follow-up"} ${String(ordinal)}</span>
        <formatted-text .text=${message.text}></formatted-text>
      </div>
    `;
  }

  private renderSessionActivity() {
    // Live state belongs in the compact strip. Keeping it out of the transcript
    // avoids a second Catching up/Compacting card obscuring the latest message.
    return null;
  }


  private renderConversationRail() {
    if (!this.messages.length || this.messageTotal <= 0) return null;
    const total = this.conversationDisplayTotal();
    const position = this.conversationPositionPercent(total);
    const loadedPercent = this.hasMore ? clampPercent((this.messages.length / total) * 100) : 100;
    return html`<conversation-meter .positionPercent=${position} .loadedPercent=${loadedPercent}></conversation-meter>`;
  }

  private conversationDisplayTotal(): number {
    if (!this.hasMore && this.messageStart === 0) return Math.max(1, this.messages.length);
    return Math.max(1, this.messageTotal, this.messageStart + this.messages.length);
  }

  private conversationPositionPercent(total = this.conversationDisplayTotal()): number {
    if (total <= 1) return 100;
    const fallbackIndex = this.pinnedToBottom ? this.messageStart + this.messages.length - 1 : this.messageStart;
    const index = clampNumber(this.currentConversationIndex ?? fallbackIndex, 0, total - 1);
    return clampPercent((index / (total - 1)) * 100);
  }

  private renderHistoryBoundary() {
    const range = this.historyRangeLabel();
    if (this.loadingMore) return html`<div class="history-boundary"><span>Loading earlier messages…</span>${range}</div>`;
    if (this.hasMore) return html`
      <div class="history-boundary">
        <button type="button" class="history-load-button" ?disabled=${this.loadMoreRequested} @click=${() => { this.requestLoadMore(); }}>Load earlier messages</button>
        <span>Scroll up to load earlier messages</span>
        ${range}
      </div>
    `;
    if (this.messages.length) return html`<div class="history-boundary"><span>Beginning of session</span>${range}</div>`;
    return null;
  }

  private historyRangeLabel() {
    if (!this.messages.length || this.messageTotal <= 0) return null;
    const from = this.messageStart + 1;
    const to = this.loadedRawMessageEnd();
    const total = Math.max(this.messageTotal, to);
    return html`<small>Showing messages ${from}–${to} of ${total}</small>`;
  }

  private loadedRawMessageEnd(): number {
    return Math.max(this.messageEnd, this.messageStart + this.messages.length);
  }

  private renderMessage(message: ChatLine, index: number) {
    const toolOnly = this.isToolExecutionOnlyMessage(message);
    return html`
      ${this.renderScrollMarker(this.messageScrollMarkerId(index))}
      <article class=${toolOnly ? "msg tool-execution-shell" : `msg ${message.role}`} data-index=${index} data-scroll-anchor-id=${this.messageAnchorKey(index)}>
        ${toolOnly ? null : this.renderMessageHeader(message, String(index))}
        ${message.parts.map((part) => this.renderPart(part, message))}
      </article>
    `;
  }

  private renderToolImageOutput(message: ChatLine, index: number, toolName?: string) {
    const label = toolName === undefined || toolName === "" ? "tool output" : `${toolName} output`;
    return html`
      ${this.renderScrollMarker(this.messageScrollMarkerId(index))}
      <article class="msg tool-image-output" data-index=${index} data-scroll-anchor-id=${this.messageAnchorKey(index)}>
        ${this.renderMessageHeader(message, String(index), label)}
        ${message.parts.map((part) => this.renderPart(part, message))}
      </article>
    `;
  }

  private isToolExecutionOnlyMessage(message: ChatLine): boolean {
    return message.role === "tool" && message.parts.length > 0 && message.parts.every((part) => part.type === "toolExecution");
  }

  private renderMessageGroup(messages: ChatLine[], startIndex: number, endIndex: number, defaultOpen: boolean) {
    const disclosureKey = this.groupDisclosureKey(startIndex, endIndex, defaultOpen);
    const open = this.disclosures.isOpen(disclosureKey, defaultOpen);
    const presentation = presentChatEvents(messages);
    const live = defaultOpen && (presentation.status === "running" || presentation.status === "pending");
    return html`
      ${this.renderScrollMarker(this.groupScrollMarkerId(endIndex))}
      <details class=${live ? "msg event-group live" : "msg event-group"} data-event-status=${presentation.status} data-index=${startIndex} data-scroll-anchor-id=${this.groupAnchorKey(startIndex)} ?open=${open} @toggle=${(event: Event) => { this.onGroupToggle(disclosureKey, event, defaultOpen); }}>
        <summary>
          <span class="event-icon" aria-hidden="true">${presentation.icon}</span>
          <b class="label">${live ? "live events" : "events"}</b>
          <span class="event-summary">${presentation.text}</span>
          <span class="event-detail">${summarizeChatGroup(messages)}</span>
        </summary>
        ${open ? this.renderMessageGroupBody(messages, startIndex, presentation) : null}
      </details>
    `;
  }

  private renderMessageGroupBody(messages: ChatLine[], startIndex: number, presentation?: ChatEventPresentation) {
    return html`
      <div class="group-body">
        ${this.renderTrackedSubsessionChildren(presentation)}
        ${messages.map((message, offset) => {
          const toolOnly = this.isToolExecutionOnlyMessage(message);
          return html`
            <section class=${toolOnly ? "group-msg tool-execution-shell" : `group-msg ${message.role}`} data-index=${startIndex + offset} data-scroll-anchor-id=${this.eventAnchorKey(startIndex + offset)}>
              ${toolOnly ? null : this.renderMessageHeader(message, `${String(startIndex)}:${String(offset)}`)}
              ${message.parts.map((part) => this.renderPart(part, message))}
            </section>
          `;
        })}
      </div>
    `;
  }

  private renderTrackedSubsessionChildren(presentation: ChatEventPresentation | undefined) {
    const children = presentation?.rows.flatMap((row) => row.children ?? []) ?? [];
    if (children.length === 0) return null;
    return html`<div class="subsession-rows" aria-label="Tracked subsessions">${children.map((child) => this.renderTrackedSubsessionChild(child))}</div>`;
  }

  private renderTrackedSubsessionChild(child: ChatEventChild) {
    return html`<div class="subsession-row"><span class="subsession-status">${child.status}</span><span>${child.sessionId}</span><small>${child.cwd}</small></div>`;
  }

  private renderScrollMarker(markerId: string) {
    return html`<span class="scroll-marker" data-marker-id=${markerId} aria-hidden="true"></span>`;
  }

  private renderMessageHeader(message: ChatLine, key: string, label: string = message.role) {
    const meta = this.messageMetaLabel(message);
    const expanded = this.expandedMetaKey === key;
    return html`
      <div class="msg-header">
        <b class="label">${label}</b>
        <div class="msg-header-trailing">
          ${this.renderMessageActions(message, key)}
          <span class=${expanded ? "msg-meta expanded" : "msg-meta"} role="button" tabindex="0" title=${meta} aria-label=${meta} aria-expanded=${String(expanded)} @click=${() => { this.expandedMetaKey = expanded ? undefined : key; }} @keydown=${(event: KeyboardEvent) => { this.onMetaKeydown(event, key, expanded); }}>${meta}</span>
        </div>
      </div>
    `;
  }

  private renderMessageActions(message: ChatLine, key: string) {
    if (!this.isCopyableMessage(message)) return null;
    const copied = this.copiedMessageKey === key;
    return html`
      <div class="msg-actions" aria-label="Message actions">
        <button type="button" class="msg-action" title=${copied ? "Copied" : "Copy message"} aria-label=${`${copied ? "Copied" : "Copy"} ${message.role} message`} @click=${(event: MouseEvent) => { void this.copyMessage(message, key, event); }}>
          <span aria-hidden="true">${copied ? "✓" : "⧉"}</span>
        </button>
      </div>
    `;
  }

  private onMetaKeydown(event: KeyboardEvent, key: string, expanded: boolean) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    this.expandedMetaKey = expanded ? undefined : key;
  }

  private isCopyableMessage(message: ChatLine): boolean {
    return (message.role === "user" || message.role === "assistant") && this.messageCopyText(message) !== "";
  }

  private messageCopyText(message: ChatLine): string {
    const cached = this.messageCopyTextCache.get(message);
    if (cached !== undefined) return cached;
    const text = message.parts
      .filter((part): part is Extract<ChatPart, { type: "text" }> => part.type === "text")
      .map((part) => part.text.trim())
      .filter((partText) => partText !== "")
      .join("\n\n");
    this.messageCopyTextCache.set(message, text);
    return text;
  }

  private async copyMessage(message: ChatLine, key: string, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    const copied = await writeClipboardText(this.messageCopyText(message));
    if (!copied) return;
    this.copiedMessageKey = key;
    window.setTimeout(() => {
      if (this.copiedMessageKey === key) this.copiedMessageKey = undefined;
    }, 1200);
  }


  private messageMetaLabel(message: ChatLine): string {
    const cached = this.messageMetaCache.get(message);
    if (cached !== undefined) return cached;
    const label = chatMessageMetadataLabel(message);
    this.messageMetaCache.set(message, label);
    return label;
  }

  private renderPart(part: ChatPart, message?: ChatLine) {
    if (part.type === "text" && message?.role === "bash") return html`<pre class="part shell-output">${part.text}</pre>`;
    if (part.type === "text") return html`<formatted-text class="part" .text=${part.text}></formatted-text>`;
    if (part.type === "thinking") return html`<details class="part"><summary>thinking</summary><formatted-text .text=${part.text}></formatted-text></details>`;
    if (part.type === "skillInvocation") return html`
      <details class="part skill-invocation">
        <summary><b>[skill]</b> ${part.name}</summary>
        <small>${part.location}</small>
        <formatted-text .text=${part.content}></formatted-text>
      </details>
    `;
    if (part.type === "skillRead") return html`
      <div class="part skill-read">
        <strong>Loaded ${part.name}</strong>
        <small>read ${part.path}</small>
      </div>
    `;
    if (part.type === "image") return html`<img class="part chat-image" src=${`data:${part.mimeType};base64,${part.data}`} alt="attached image" loading="lazy" @load=${this.onImageLoad} />`;
    if (part.type === "toolCall") return html`<div class="part tool-line">▶ ${part.toolName}<span class="summary">${part.summary}</span></div>`;
    if (part.type === "toolExecution") return html`<tool-execution-view class="part" .execution=${part}></tool-execution-view>`;
    if (part.type === "toolResult") return html`
      <details class="part" ?open=${part.isError}>
        <summary>${part.isError ? "✖" : "✓"} ${part.toolName} result</summary>
        <formatted-text .text=${part.text}></formatted-text>
      </details>
    `;
    return null;
  }

  private onGroupToggle(key: string, event: Event, defaultOpen: boolean) {
    const details = event.currentTarget;
    if (!(details instanceof HTMLDetailsElement)) return;
    if (this.disclosures.applyToggle(key, details.open, defaultOpen)) this.requestUpdate();
  }

  private onScroll() {
    this.cancelLatestFollowForExplicitScrollAway();
    this.requestLoadMoreIfNeeded();
    this.updatePinnedToBottomFromScroll();
    this.refreshJumpToLatest();
    this.scheduleConversationRailUpdate();
    if (!this.suppressScrollSave) this.scheduleScrollPositionSave();
  }

  private onWheel(event: WheelEvent) {
    if (event.deltaY < 0 && this.canScrollUp()) this.cancelLatestFollow();
  }

  private onPointerDown(event: PointerEvent): void {
    if (!event.isPrimary) return;
    this.pointerScrollStart = this.chat?.scrollTop;
  }

  private readonly onPointerUp = (): void => {
    this.pointerScrollStart = undefined;
  };

  private onKeydown(event: KeyboardEvent): void {
    if (!isChatScrollKey(event.key)) return;
    this.keyboardScrollStart = this.chat?.scrollTop;
  }

  private onKeyup(event: KeyboardEvent): void {
    if (isChatScrollKey(event.key)) this.keyboardScrollStart = undefined;
  }

  private cancelLatestFollowForExplicitScrollAway(): void {
    const chat = this.chat;
    if (chat === undefined || !this.followingLatestUntilBottom) return;
    const movedAwayFromPointerStart = this.pointerScrollStart !== undefined && chat.scrollTop < this.pointerScrollStart;
    const movedAwayFromKeyboardStart = this.keyboardScrollStart !== undefined && chat.scrollTop < this.keyboardScrollStart;
    if (!movedAwayFromPointerStart && !movedAwayFromKeyboardStart) return;
    this.cancelLatestFollow();
  }

  private cancelLatestFollow(): void {
    this.followingLatestUntilBottom = false;
    this.pinnedToBottom = false;
    this.pointerScrollStart = undefined;
    this.keyboardScrollStart = undefined;
  }

  private onTouchStart(event: TouchEvent) {
    this.touchStartY = event.touches[0]?.clientY;
  }

  private onTouchMove(event: TouchEvent) {
    const y = event.touches[0]?.clientY;
    if (this.touchStartY !== undefined && y !== undefined && y > this.touchStartY && this.canScrollUp()) this.cancelLatestFollow();
  }

  private updatePinnedToBottomFromScroll() {
    const chat = this.chat;
    if (!chat) return;
    const heightChanged = this.didChatHeightChange();
    const wasPinnedToBottom = this.pinnedToBottom;
    const scrollingUp = chat.scrollTop < this.lastScrollTop;
    if (heightChanged && wasPinnedToBottom) {
      this.lastClientHeight = chat.clientHeight;
      if (this.followingLatestUntilBottom) this.continueFollowingLatest();
      else this.scrollToBottom();
      return;
    }
    if (this.followingLatestUntilBottom) {
      // Do not treat a programmatic smooth-scroll/layout seam as reader intent.
      // Wheel/touch upward intent explicitly cancels this mode instead.
      if (this.isAtBottom()) this.followingLatestUntilBottom = false;
      this.pinnedToBottom = true;
    } else if (this.isAtBottom()) this.pinnedToBottom = true;
    else if (scrollingUp) this.pinnedToBottom = false;
    else this.pinnedToBottom = this.isNearBottom();
    this.lastScrollTop = chat.scrollTop;
    this.lastClientHeight = chat.clientHeight;
  }

  private didChatHeightChange(): boolean {
    const chat = this.chat;
    return chat !== undefined && this.lastClientHeight !== 0 && chat.clientHeight !== this.lastClientHeight;
  }

  private isPrependingMessages(changed: Map<string, unknown>): boolean {
    const oldMessageStart = changed.get("messageStart");
    return typeof oldMessageStart === "number" && this.messageStart < oldMessageStart;
  }

  private requestLoadMoreIfNeeded(): void {
    if (this.loadMoreCheckFrame !== undefined) return;
    this.loadMoreCheckFrame = requestAnimationFrame(() => {
      this.loadMoreCheckFrame = undefined;
      if (this.suppressLoadMoreRequests) return;
      const chat = this.chat;
      if (!chat) return;
      if (shouldRequestEarlierMessages({
        hasMore: this.hasMore,
        loadingMore: this.loadingMore || this.loadMoreRequested,
        canRequest: this.onLoadMore !== undefined,
        scrollTop: chat.scrollTop,
        scrollHeight: chat.scrollHeight,
        clientHeight: chat.clientHeight,
      })) this.requestLoadMore();
    });
  }

  private requestLoadMore(): void {
    if (this.loadMoreRequested) return;
    if (!this.hasMore || this.loadingMore || this.onLoadMore === undefined) return;
    this.loadMoreRequested = true;
    this.onLoadMore();
  }

  private isNearBottom(): boolean {
    const chat = this.chat;
    if (!chat) return true;
    return isNearScrollBottom(chat);
  }

  private isAtBottom(): boolean {
    const chat = this.chat;
    if (!chat) return true;
    return distanceFromScrollBottom(chat) < 2;
  }

  private canScrollUp(): boolean {
    const chat = this.chat;
    return chat !== undefined && chat.scrollTop > 0;
  }

  private refreshJumpToLatest(): void {
    const chat = this.chat;
    if (!chat) {
      this.showJumpToLatest = false;
      return;
    }
    this.showJumpToLatest = shouldShowJumpToLatest(distanceFromScrollBottom(chat), chat.clientHeight, this.showJumpToLatest);
  }

  /**
   * While the app shell confirms that the mobile IME owns the viewport, a
   * button pointer-down normally takes focus from the composer before its
   * click. That collapses the IME and can remove this overlay before the
   * browser dispatches the click. Once Android has dismissed the IME, the
   * composer can remain focused, so preserve focus only for active keyboard
   * focus mode. Native mouse and keyboard behavior remains intact.
   */
  private readonly preserveComposerFocusOnJumpPointerDown = (event: PointerEvent): void => {
    if (this.mobileKeyboardFocusActive && (event.pointerType === "touch" || event.pointerType === "pen")) event.preventDefault();
  };

  private jumpToLatest = (): void => {
    const chat = this.chat;
    if (chat === undefined) return;
    this.scrollController.clearScheduledSave();
    // Persist the explicit intent synchronously; the smooth animation may not
    // finish before a session switch or page lifecycle save.
    this.scrollController.saveBottomPosition(this.sessionId);
    this.pendingScrollRestoreSessionId = undefined;
    this.pendingScrollRestorePosition = undefined;
    this.cancelPrependRestore();
    this.pinnedToBottom = true;
    this.showJumpToLatest = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.followingLatestUntilBottom = !reducedMotion;
    if (typeof chat.scrollTo === "function") chat.scrollTo({ top: chat.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
    else {
      chat.scrollTop = chat.scrollHeight;
      this.followingLatestUntilBottom = false;
    }
    this.lastScrollTop = chat.scrollTop;
    this.lastClientHeight = chat.clientHeight;
  };

  /** Updates the smooth destination when live content grows before it arrives. */
  private continueFollowingLatest(): void {
    const chat = this.chat;
    if (chat === undefined) return;
    if (typeof chat.scrollTo === "function") chat.scrollTo({ top: chat.scrollHeight, behavior: "smooth" });
    else {
      chat.scrollTop = chat.scrollHeight;
      this.followingLatestUntilBottom = false;
    }
  }

  private scrollToBottom() {
    if (this.scrollToBottomFrame !== undefined) return;
    this.scrollToBottomFrame = requestAnimationFrame(() => {
      this.scrollToBottomFrame = undefined;
      const chat = this.chat;
      if (!chat) return;
      this.withSuppressedScrollSave(() => {
        chat.scrollTop = chat.scrollHeight;
        this.lastScrollTop = chat.scrollTop;
        this.lastClientHeight = chat.clientHeight;
        this.refreshJumpToLatest();
      });
    });
  }

  restoreScrollPosition() {
    const sessionId = this.sessionId;
    if (this.restoreScrollFrame !== undefined) cancelAnimationFrame(this.restoreScrollFrame);
    this.restoreScrollFrame = requestAnimationFrame(() => {
      this.restoreScrollFrame = undefined;
      if (this.sessionId !== sessionId) return;
      this.withSuppressedScrollSave(() => {
        const result = this.scrollController.restorePosition(sessionId, this.chat, this.scrollAnchorElements(), { fallbackToBottom: this.shouldFallbackToBottomForMissingAnchor() });
        this.handleScrollRestoreResult(sessionId, result);
      });
    });
  }

  private continuePendingScrollRestore(): void {
    const sessionId = this.pendingScrollRestoreSessionId;
    const position = this.pendingScrollRestorePosition;
    if (sessionId === undefined || position === undefined || sessionId !== this.sessionId || this.restoreScrollFrame !== undefined) return;
    this.restoreScrollFrame = requestAnimationFrame(() => {
      this.restoreScrollFrame = undefined;
      if (this.sessionId !== sessionId) return;
      this.withSuppressedScrollSave(() => {
        const result = this.scrollController.restoreExplicitPosition(position, this.chat, this.scrollAnchorElements(), { fallbackToBottom: this.shouldFallbackToBottomForMissingAnchor() });
        this.handleScrollRestoreResult(sessionId, result);
      });
    });
  }

  private handleScrollRestoreResult(sessionId: string, result: ChatScrollRestoreResult): void {
    this.syncScrollMetrics();
    if (result.status !== "missing") {
      this.updatePinnedToBottomAfterRestore(result.status);
      if (result.status === "restored" || result.status === "bottom") this.cancelPrependRestore();
      this.pendingScrollRestoreSessionId = undefined;
      this.pendingScrollRestorePosition = undefined;
      return;
    }

    this.pinnedToBottom = false;
    this.pendingScrollRestoreSessionId = sessionId;
    this.pendingScrollRestorePosition = result.position;
    const chat = this.chat;
    if (chat === undefined || !this.hasMore || this.loadingMore) return;
    chat.scrollTop = 0;
    this.syncScrollMetrics();
    this.requestLoadMore();
  }

  private shouldFallbackToBottomForMissingAnchor(): boolean {
    // While catching up to a stream, history can temporarily omit the in-flight
    // assistant message that a previous scroll save anchored to. Keep retrying
    // until the final refreshed transcript has a chance to render that anchor.
    return !this.hasMore && !this.isReceivingPartialStream;
  }

  private updatePinnedToBottomAfterRestore(status: Exclude<ChatScrollRestoreResult["status"], "missing">): void {
    if (status === "bottom") this.pinnedToBottom = true;
    else if (status === "restored") this.pinnedToBottom = this.isNearBottom();
  }

  private syncScrollMetrics(): void {
    const chat = this.chat;
    if (chat === undefined) return;
    this.lastScrollTop = chat.scrollTop;
    this.lastClientHeight = chat.clientHeight;
    this.refreshJumpToLatest();
  }

  private cancelPrependRestore(): void {
    this.prependRestoreToken += 1;
    this.suppressLoadMoreRequests = false;
  }

  capturePrependScrollAnchor(): PrependScrollAnchor | undefined {
    const chat = this.chat;
    if (!chat) return undefined;
    return capturePrependScrollAnchor(chat, this.scrollMarkers());
  }

  restorePrependScrollAnchor(anchor: PrependScrollAnchor | undefined): void {
    if (!this.chat || !anchor) return;
    this.suppressLoadMoreRequests = true;
    this.suppressScrollSave = true;
    const token = this.prependRestoreToken + 1;
    this.prependRestoreToken = token;
    let frames = 0;
    const settle = () => {
      const chat = this.chat;
      if (!chat || token !== this.prependRestoreToken) return;
      restorePrependScrollAnchor(chat, anchor, anchor.markerId === undefined ? undefined : this.scrollMarkerAt(anchor.markerId));
      this.lastScrollTop = chat.scrollTop;
      this.refreshJumpToLatest();
      frames += 1;
      // Formatted markdown/code layout can settle after Lit's first render. Re-apply
      // the marker anchor briefly so late height changes above the viewport do not
      // move the user's reading position.
      if (frames < PREPEND_RESTORE_SETTLE_FRAMES) {
        requestAnimationFrame(settle);
        return;
      }
      requestAnimationFrame(() => {
        if (token !== this.prependRestoreToken) return;
        this.suppressScrollSave = false;
        this.suppressLoadMoreRequests = false;
      });
    };
    settle();
  }

  saveScrollPosition(sessionId = this.sessionId) {
    if (!sessionId) return;
    if (this.followingLatestUntilBottom) {
      this.scrollController.saveBottomPosition(sessionId);
      return;
    }
    this.scrollController.savePosition(sessionId, this.chat, this.scrollAnchorElements());
  }

  private scheduleScrollPositionSave() {
    const sessionId = this.sessionId;
    this.scrollController.scheduleSave(sessionId, (scheduledSessionId) => {
      if (this.sessionId === scheduledSessionId) this.saveScrollPosition(scheduledSessionId);
    });
  }

  private scheduleConversationRailUpdate(): void {
    if (this.conversationRailFrame !== undefined) return;
    this.conversationRailFrame = requestAnimationFrame(() => {
      this.conversationRailFrame = undefined;
      this.updateConversationRailPosition();
    });
  }

  private updateConversationRailPosition(): void {
    if (!this.messages.length || this.messageTotal <= 0) {
      this.currentConversationIndex = undefined;
      return;
    }
    const total = this.conversationDisplayTotal();
    const article = this.firstVisibleArticle();
    const index = Number(article?.dataset["index"]);
    if (Number.isFinite(index)) {
      this.currentConversationIndex = clampNumber(index, 0, Math.max(0, total - 1));
      return;
    }
    this.currentConversationIndex = clampNumber(this.pinnedToBottom ? this.messageStart + this.messages.length - 1 : this.messageStart, 0, Math.max(0, total - 1));
  }

  private scrollMarkers(): HTMLElement[] {
    return Array.from(this.renderRoot.querySelectorAll<HTMLElement>(".scroll-marker"));
  }

  private scrollMarkerAt(markerId: string): HTMLElement | undefined {
    return this.scrollMarkers().find((marker) => marker.dataset["markerId"] === markerId);
  }

  private firstVisibleArticle(): HTMLElement | undefined {
    const chat = this.chat;
    if (chat === undefined) return undefined;
    const primaryArticles = Array.from(this.renderRoot.querySelectorAll<HTMLElement>("article.msg"));
    return findFirstVisibleArticle(chat, primaryArticles) ?? findFirstVisibleArticle(chat, this.articles());
  }

  private articles(): HTMLElement[] {
    return Array.from(this.renderRoot.querySelectorAll<HTMLElement>("article.msg, details.msg"));
  }

  private scrollAnchorElements(): HTMLElement[] {
    return Array.from(this.renderRoot.querySelectorAll<HTMLElement>("[data-scroll-anchor-id]"));
  }

  private withSuppressedScrollSave(callback: () => void) {
    this.suppressScrollSave = true;
    callback();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.suppressScrollSave = false;
      });
    });
  }

  private groupDisclosureKey(startIndex: number, endIndex: number, defaultOpen: boolean): string {
    return defaultOpen ? `${this.sessionId}:live:${String(startIndex)}` : `${this.sessionId}:${String(endIndex)}`;
  }

  private messageAnchorKey(index: number): string {
    return `m:${String(index)}`;
  }

  private groupRenderKey(startIndex: number): string {
    return `g:${String(startIndex)}`;
  }

  private groupAnchorKey(startIndex: number): string {
    return `g:${String(startIndex)}`;
  }

  private eventAnchorKey(index: number): string {
    return `e:${String(index)}`;
  }

  private messageScrollMarkerId(index: number): string {
    return `m:${String(index)}`;
  }

  private groupScrollMarkerId(endIndex: number): string {
    return `g:${String(endIndex)}`;
  }

  static override styles = chatStyles;
}
