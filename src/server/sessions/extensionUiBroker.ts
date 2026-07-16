import { randomUUID } from "node:crypto";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type {
  ExtensionUiNotification,
  ExtensionUiRequest,
  ExtensionUiResolution,
  ExtensionUiRespondResponse,
  ExtensionUiResponse,
} from "../../shared/extensionUi.js";

export interface ExtensionUiBrokerEvents {
  request(sessionId: string, request: ExtensionUiRequest): void;
  resolved(sessionId: string, resolution: ExtensionUiResolution): void;
  notify(sessionId: string, notification: ExtensionUiNotification): void;
}

interface PendingRequest {
  sessionId: string;
  request: ExtensionUiRequest;
  resolve: (resolution: ExtensionUiResolution) => void;
  timeout?: ReturnType<typeof setTimeout>;
  abortSignal?: AbortSignal;
  onAbort?: () => void;
}

interface ExtensionUiBrokerOptions {
  events: ExtensionUiBrokerEvents;
  createId?: () => string;
}

type NewExtensionUiRequest =
  | { method: "select"; title: string; options: string[]; timeout?: number }
  | { method: "confirm"; title: string; message: string; timeout?: number }
  | { method: "input"; title: string; placeholder?: string; timeout?: number }
  | { method: "editor"; title: string; prefill?: string };

/**
 * Owns requests made by extension `ctx.ui` calls. Requests are live runtime
 * state, not transcript entries: a page reload can discover them, while a
 * session/runtime shutdown resolves their promises and removes them.
 */
export class ExtensionUiBroker {
  private readonly pending = new Map<string, PendingRequest>();
  // Retain a bounded completion record so duplicate browser submissions are
  // harmless without turning ephemeral interaction state into a transcript.
  private readonly settled = new Map<string, { sessionId: string; resolution: ExtensionUiResolution }>();
  private nextId = 0;
  private readonly idPrefix = `extension-ui-${randomUUID()}`;

  constructor(private readonly options: ExtensionUiBrokerOptions) {}

  pendingForSession(sessionId: string): ExtensionUiRequest[] {
    return [...this.pending.values()]
      .filter((pending) => pending.sessionId === sessionId)
      .map((pending) => pending.request);
  }

  createUiContext(sessionId: string): ExtensionUIContext {
    return {
      select: (title, options, opts) => this.request(sessionId, { method: "select", title, options: [...options], ...(opts?.timeout === undefined ? {} : { timeout: opts.timeout }) }, opts?.signal).then((resolution) => resolution.response !== undefined && "value" in resolution.response ? resolution.response.value : undefined),
      confirm: (title, message, opts) => this.request(sessionId, { method: "confirm", title, message, ...(opts?.timeout === undefined ? {} : { timeout: opts.timeout }) }, opts?.signal).then((resolution) => resolution.response !== undefined && "confirmed" in resolution.response ? resolution.response.confirmed : false),
      input: (title, placeholder, opts) => this.request(sessionId, { method: "input", title, ...(placeholder === undefined ? {} : { placeholder }), ...(opts?.timeout === undefined ? {} : { timeout: opts.timeout }) }, opts?.signal).then((resolution) => resolution.response !== undefined && "value" in resolution.response ? resolution.response.value : undefined),
      editor: (title, prefill) => this.request(sessionId, { method: "editor", title, ...(prefill === undefined ? {} : { prefill }) }).then((resolution) => resolution.response !== undefined && "value" in resolution.response ? resolution.response.value : undefined),
      notify: (message, notifyType = "info") => {
        this.options.events.notify(sessionId, { id: this.createId(), method: "notify", message, notifyType });
      },
      onTerminalInput: () => noop,
      setStatus: () => undefined,
      setWorkingMessage: () => undefined,
      setWorkingVisible: () => undefined,
      setWorkingIndicator: () => undefined,
      setHiddenThinkingLabel: () => undefined,
      setWidget: () => undefined,
      setFooter: () => undefined,
      setHeader: () => undefined,
      setTitle: () => undefined,
      // PI WEB intentionally does not host arbitrary terminal components.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      custom: <T>() => Promise.resolve(undefined as T),
      pasteToEditor: () => undefined,
      setEditorText: () => undefined,
      getEditorText: () => "",
      addAutocompleteProvider: () => undefined,
      setEditorComponent: () => undefined,
      getEditorComponent: () => undefined,
      // Terminal themes are unavailable in the browser adapter.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      get theme() { return undefined as never; },
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "PI WEB does not expose Pi terminal themes." }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => undefined,
    };
  }

  respond(sessionId: string, response: ExtensionUiResponse): ExtensionUiRespondResponse {
    const pending = this.pending.get(response.id);
    if (pending === undefined) {
      const settled = this.settled.get(response.id);
      if (settled !== undefined) return settled.sessionId === sessionId ? { outcome: "already-resolved", resolution: settled.resolution } : { outcome: "wrong-session" };
      return { outcome: "not-found" };
    }
    if (pending.sessionId !== sessionId) return { outcome: "wrong-session" };
    if (!responseMatchesRequest(pending.request, response)) return { outcome: "invalid-response" };
    const resolution: ExtensionUiResolution = {
      id: pending.request.id,
      state: "cancelled" in response ? "cancelled" : "submitted",
      response,
    };
    this.settle(pending, resolution);
    return { outcome: "accepted", resolution };
  }

  cancelSession(sessionId: string, reason: "session-ended" | "runtime-replaced" = "session-ended"): void {
    for (const pending of [...this.pending.values()]) {
      if (pending.sessionId === sessionId) this.settle(pending, { id: pending.request.id, state: "cancelled", reason });
    }
  }

  cancelAll(reason: "session-ended" | "runtime-replaced" = "session-ended"): void {
    for (const pending of [...this.pending.values()]) this.settle(pending, { id: pending.request.id, state: "cancelled", reason });
  }

  private request(
    sessionId: string,
    request: NewExtensionUiRequest,
    signal?: AbortSignal,
  ): Promise<ExtensionUiResolution> {
    const completeRequest: ExtensionUiRequest = { ...request, id: this.createId(), state: "pending" };
    // An SDK operation can supply a signal that is already cancelled. There is
    // no browser interaction to discover in that case, but the caller still
    // needs its normal resolved fallback immediately.
    if (signal?.aborted === true) return Promise.resolve({ id: completeRequest.id, state: "cancelled", reason: "session-ended" });
    return new Promise((resolve) => {
      const pending: PendingRequest = { sessionId, request: completeRequest, resolve };
      this.pending.set(completeRequest.id, pending);
      if (signal !== undefined) {
        pending.abortSignal = signal;
        pending.onAbort = () => {
          this.settle(pending, { id: completeRequest.id, state: "cancelled", reason: "session-ended" });
        };
        signal.addEventListener("abort", pending.onAbort, { once: true });
      }
      if (completeRequest.method !== "editor" && completeRequest.timeout !== undefined) {
        pending.timeout = setTimeout(() => {
          this.settle(pending, { id: completeRequest.id, state: "expired", reason: "timeout" });
        }, completeRequest.timeout);
      }
      this.options.events.request(sessionId, completeRequest);
    });
  }

  private settle(pending: PendingRequest, resolution: ExtensionUiResolution): void {
    if (this.pending.get(pending.request.id) !== pending) return;
    this.pending.delete(pending.request.id);
    if (pending.timeout !== undefined) clearTimeout(pending.timeout);
    if (pending.abortSignal !== undefined && pending.onAbort !== undefined) pending.abortSignal.removeEventListener("abort", pending.onAbort);
    this.settled.set(pending.request.id, { sessionId: pending.sessionId, resolution });
    while (this.settled.size > 256) {
      const oldest = this.settled.keys().next().value;
      if (oldest === undefined) break;
      this.settled.delete(oldest);
    }
    this.options.events.resolved(pending.sessionId, resolution);
    pending.resolve(resolution);
  }

  private createId(): string {
    return this.options.createId?.() ?? `${this.idPrefix}-${String(++this.nextId)}`;
  }
}

const noop = () => undefined;

function responseMatchesRequest(request: ExtensionUiRequest, response: ExtensionUiResponse): boolean {
  if ("cancelled" in response) return true;
  if (request.method === "confirm") return "confirmed" in response;
  if (!("value" in response)) return false;
  return request.method !== "select" || request.options.includes(response.value);
}
