import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { api, type FileSuggestion, type SlashCommand } from "../api";
import { inputModeForDraft } from "../inputModes";
import { promptEditorStyles, type CompletionItem } from "./shared";
import "./AutocompleteMenu";

@customElement("prompt-editor")
export class PromptEditor extends LitElement {
  @property({ type: Boolean }) disabled = false;
  @property() sessionId?: string;
  @property() cwd?: string;
  @property({ attribute: false }) onSend?: (text: string) => void;
  @property({ attribute: false }) onStopSession?: () => void;
  @query("textarea") private textarea?: HTMLTextAreaElement;
  @state() private draft = "";
  @state() private completions: CompletionItem[] = [];
  @state() private selectedIndex = 0;
  private requestVersion = 0;

  protected willUpdate(changed: PropertyValues<this>) {
    if (!changed.has("sessionId")) return;
    const previousSessionId = changed.get("sessionId") as string | undefined;
    if (previousSessionId) saveDraft(previousSessionId, this.draft);
    this.draft = this.sessionId ? loadDraft(this.sessionId) : "";
    this.completions = [];
    this.selectedIndex = 0;
  }

  protected updated(changed: PropertyValues) {
    if (changed.has("draft") || changed.has("sessionId")) this.resizeTextarea();
  }

  render() {
    const inputMode = inputModeForDraft(this.draft);
    const shellMode = inputMode.kind === "shell";
    return html`
      <footer class=${shellMode ? "shell-mode" : ""}>
        <div class="editor-wrap">
          <textarea
            .value=${this.draft}
            ?disabled=${this.disabled}
            @input=${(event: Event) => this.updateDraft((event.target as HTMLTextAreaElement).value)}
            @keydown=${(event: KeyboardEvent) => this.handleKeyDown(event)}
            placeholder="Message pi... Use / for commands, @ for files"
          ></textarea>
          ${shellMode ? html`<div class="mode-hint">Shell command${inputMode.excludeFromContext ? " · excluded from context" : ""}</div>` : null}
          <autocomplete-menu .items=${this.completions} .selectedIndex=${this.selectedIndex} .onPick=${(item: CompletionItem) => this.pick(item)}></autocomplete-menu>
        </div>
        <button ?disabled=${this.disabled} @click=${this.send}>Send</button>
        <button ?disabled=${this.disabled} title="Stop only this Pi session from continuing" @click=${() => this.onStopSession?.()}>Stop session</button>
      </footer>
    `;
  }

  focusInput() {
    this.textarea?.focus();
  }

  private resizeTextarea() {
    const textarea = this.textarea;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  private updateDraft(value: string) {
    this.draft = value;
    if (this.sessionId) saveDraft(this.sessionId, this.draft);
    void this.refreshCompletions();
  }

  private async refreshCompletions() {
    const trigger = this.currentTrigger();
    const version = ++this.requestVersion;
    this.selectedIndex = 0;
    if (!trigger) {
      this.completions = [];
      return;
    }
    if (trigger.kind === "command" && this.sessionId) {
      const commands = await api.commands(this.sessionId).catch(() => [] as SlashCommand[]);
      if (version !== this.requestVersion) return;
      this.completions = commands
        .filter((command) => command.name.toLowerCase().includes(trigger.query.toLowerCase()))
        .slice(0, 12)
        .map((command) => ({ kind: "command", replaceFrom: trigger.from, replaceTo: this.draft.length, insertText: `/${command.name}`, detail: command.source, description: command.description }));
    } else if (trigger.kind === "file" && this.cwd) {
      const files = await api.files(this.cwd, trigger.query, trigger.fileKind).catch(() => [] as FileSuggestion[]);
      if (version !== this.requestVersion) return;
      this.completions = files
        .slice(0, 12)
        .map((file) => ({ kind: "file", replaceFrom: trigger.from, replaceTo: this.draft.length, insertText: `@${file.path}`, detail: file.kind }));
    }
  }

  private currentTrigger(): { kind: "command" | "file"; query: string; from: number; fileKind?: FileSuggestion["kind"] } | undefined {
    const beforeCursor = this.draft;
    if (beforeCursor.endsWith("@ ")) return { kind: "file", query: "", from: beforeCursor.length - 2, fileKind: "untracked" };

    const tokenStart = Math.max(beforeCursor.lastIndexOf(" "), beforeCursor.lastIndexOf("\n")) + 1;
    const token = beforeCursor.slice(tokenStart);
    if (token.startsWith("/")) return { kind: "command", query: token.slice(1), from: tokenStart };
    if (token.startsWith("@")) return { kind: "file", query: token.slice(1), from: tokenStart };
    return undefined;
  }

  private handleKeyDown(event: KeyboardEvent) {
    if (this.completions.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.selectedIndex = (this.selectedIndex + 1) % this.completions.length;
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        this.selectedIndex = (this.selectedIndex - 1 + this.completions.length) % this.completions.length;
        return;
      }
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        this.pick(this.completions[this.selectedIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.completions = [];
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  private pick(item: CompletionItem) {
    this.draft = `${this.draft.slice(0, item.replaceFrom)}${item.insertText} ${this.draft.slice(item.replaceTo)}`;
    if (this.sessionId) saveDraft(this.sessionId, this.draft);
    this.completions = [];
  }

  private send() {
    const text = this.draft.trim();
    if (!text || this.disabled) return;
    this.draft = "";
    if (this.sessionId) clearDraft(this.sessionId);
    this.completions = [];
    this.onSend?.(text);
  }

  static styles = promptEditorStyles;
}

const draftStoragePrefix = "pi-web:prompt-draft:";

function draftStorageKey(sessionId: string): string {
  return `${draftStoragePrefix}${sessionId}`;
}

function loadDraft(sessionId: string): string {
  try {
    return localStorage.getItem(draftStorageKey(sessionId)) ?? "";
  } catch {
    return "";
  }
}

function saveDraft(sessionId: string, draft: string): void {
  try {
    if (draft) localStorage.setItem(draftStorageKey(sessionId), draft);
    else localStorage.removeItem(draftStorageKey(sessionId));
  } catch {
    // Ignore localStorage quota/privacy errors.
  }
}

function clearDraft(sessionId: string): void {
  try {
    localStorage.removeItem(draftStorageKey(sessionId));
  } catch {
    // Ignore localStorage quota/privacy errors.
  }
}
