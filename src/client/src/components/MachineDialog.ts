import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { Machine } from "../api";

export interface MachineDialogSubmit {
  name: string;
  baseUrl: string;
  token?: string;
}

@customElement("machine-dialog")
export class MachineDialog extends LitElement {
  /** Undefined adds a remote; a remote value edits it. Local is deliberately rejected. */
  @property({ attribute: false }) machine: Machine | undefined;
  @property({ attribute: false }) onSubmit?: (input: MachineDialogSubmit) => void | Promise<void>;
  @property({ attribute: false }) onCancel?: () => void;
  @property() error = "";

  @state() private url = "";
  @state() private name = "";
  @state() private token = "";
  @state() private tokenEdited = false;
  @state() private submitting = false;
  @query("input[name='baseUrl']") private urlInput?: HTMLInputElement;
  @query("input[name='name']") private nameInput?: HTMLInputElement;

  private nameEdited = false;
  private previousSuggestedName = "";

  override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("machine")) return;
    const machine = this.machine;
    this.url = machine?.baseUrl ?? "";
    this.name = machine?.name ?? "";
    this.token = ""; // A stored bearer token is never sent back to the browser.
    this.tokenEdited = false;
    this.nameEdited = machine !== undefined;
    this.previousSuggestedName = machine === undefined ? "" : suggestedMachineNameFromUrl(machine.baseUrl ?? "");
  }

  override firstUpdated(): void {
    (this.machine === undefined ? this.urlInput : this.nameInput)?.focus();
  }

  private handleUrlInput(event: InputEvent): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const url = event.target.value;
    const suggestedName = suggestedMachineNameFromUrl(url);
    if (!this.nameEdited || this.name.trim() === "" || this.name === this.previousSuggestedName) this.name = suggestedName;
    this.previousSuggestedName = suggestedName;
    this.url = url;
  }

  private handleNameInput(event: InputEvent): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.nameEdited = true;
    this.name = event.target.value;
  }

  private handleTokenInput(event: InputEvent): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.token = event.target.value;
    this.tokenEdited = true;
  }

  private clearStoredToken(): void {
    this.token = "";
    this.tokenEdited = true;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.onCancel?.();
      return;
    }
    if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.name === "baseUrl" && machineBaseUrlValidationMessage(this.url) === undefined) {
      event.preventDefault();
      void this.updateComplete.then(() => {
        this.nameInput?.focus();
        this.nameInput?.select();
      });
    }
  }

  private handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    void this.submit();
  }

  private async submit(): Promise<void> {
    const input = this.validInput();
    if (input === undefined || this.submitting) return;
    this.submitting = true;
    try {
      await this.onSubmit?.(input);
    } finally {
      if (this.isConnected) this.submitting = false;
    }
  }

  private validInput(): MachineDialogSubmit | undefined {
    if (this.machine?.kind === "local") return undefined;
    const baseUrl = this.url.trim();
    const name = this.name.trim();
    if (baseUrl === "" || name === "" || machineBaseUrlValidationMessage(baseUrl) !== undefined) return undefined;
    const token = this.token.trim();
    return {
      name,
      baseUrl,
      ...(token !== "" ? { token } : this.machine !== undefined && this.tokenEdited ? { token: "" } : {}),
    };
  }

  override render() {
    const isEdit = this.machine !== undefined;
    const localEdit = this.machine?.kind === "local";
    const hasUrl = this.url.trim() !== "";
    const urlError = hasUrl ? machineBaseUrlValidationMessage(this.url) : undefined;
    const canSubmit = this.validInput() !== undefined && !this.submitting;
    return html`
      <div class="backdrop" @click=${() => this.onCancel?.()}>
        <section @click=${(event: Event) => { event.stopPropagation(); }}>
          <form @submit=${(event: SubmitEvent) => { this.handleSubmit(event); }} @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event); }}>
            <header>
              <strong>${isEdit ? "Configure machine" : "Add machine"}</strong>
              <button type="button" @click=${() => { this.onCancel?.(); }} aria-label="Close">×</button>
            </header>
            <div class="body">
              ${this.error === "" ? null : html`<div class="dialog-error" role="alert">${this.error}</div>`}
              ${localEdit ? html`<p class="dialog-error" role="alert">The local gateway is configured in its machine-scoped settings and cannot be edited as a remote connection.</p>` : html`
                <label>
                  Remote PI WEB URL
                  <input name="baseUrl" type="url" .value=${this.url} @input=${(event: InputEvent) => { this.handleUrlInput(event); }} placeholder="http://dev-box.local:8504" autocomplete="url" inputmode="url" autofocus />
                </label>
                <small class=${urlError === undefined ? "hint" : "field-error"}>${urlError ?? "Enter the reachable base URL first, including http:// or https://."}</small>
                ${hasUrl ? html`
                  <label>
                    Machine name
                    <input name="name" type="text" .value=${this.name} @input=${(event: InputEvent) => { this.handleNameInput(event); }} placeholder=${this.previousSuggestedName || "Dev Box"} autocomplete="off" />
                  </label>
                  <small class="hint">${isEdit ? "Update the sidebar label or endpoint without interrupting the selected workspace." : "Suggested from the URL. Edit it to use a friendlier sidebar label."}</small>
                  <label>
                    Bearer token <span class="optional">optional</span>
                    <input name="token" type="password" .value=${this.token} @input=${(event: InputEvent) => { this.handleTokenInput(event); }} placeholder=${isEdit ? "Leave blank to keep the stored token" : "Leave blank if the remote machine does not require one"} autocomplete="off" />
                  </label>
                  ${isEdit ? html`<button class="text-button" type="button" @click=${() => { this.clearStoredToken(); }}>Clear stored token</button>` : null}
                  <small class="hint">${isEdit ? "The stored token is never shown. Enter a replacement, leave this blank to keep it, or clear it explicitly." : "Paste only the token value; PI WEB sends it as an Authorization: Bearer header."}</small>
                ` : html`<p class="hint intro">After you enter a URL, PI WEB will suggest a machine name and let you add an optional bearer token.</p>`}
              `}
            </div>
            <footer>
              <button type="button" @click=${() => { this.onCancel?.(); }}>Cancel</button>
              ${localEdit ? null : html`<button class="primary" type="submit" ?disabled=${!canSubmit}>${this.submitting ? (isEdit ? "Saving…" : "Adding…") : (isEdit ? "Save changes" : "Add machine")}</button>`}
            </footer>
          </form>
        </section>
      </div>
    `;
  }

  static override styles = css`
    :host { position: fixed; inset: 0; z-index: 30; color: var(--pi-text); font: 14px var(--pi-body-font-family, system-ui, sans-serif); }
    .backdrop { display: grid; place-items: start center; width: 100%; height: 100%; padding-top: min(12vh, 90px); box-sizing: border-box; background: var(--pi-overlay); }
    section { width: min(560px, calc(100vw - 40px)); max-height: min(640px, calc(100vh - 40px)); border: var(--pi-divider-width, 1px) solid var(--pi-border); border-radius: var(--pi-radius-control, 12px); background: var(--pi-bg); box-shadow: 0 20px 60px var(--pi-shadow-strong); overflow: hidden; }
    form { display: flex; flex-direction: column; max-height: inherit; min-height: 0; }
    header, footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px; border-bottom: var(--pi-divider-width, 1px) solid var(--pi-border); }
    header strong { font-family: var(--pi-heading-font-family, inherit); font-weight: var(--pi-heading-font-weight, 700); }
    footer { border-top: 1px solid var(--pi-border); border-bottom: 0; justify-content: end; }
    .body { display: grid; gap: 8px; padding: 12px; min-height: 0; overflow: auto; }
    label { display: grid; gap: 6px; color: var(--pi-muted); }
    input { box-sizing: border-box; width: 100%; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control, 8px); background: var(--pi-bg); color: var(--pi-text); padding: 9px; font: var(--pi-control-font-size, 16px) var(--pi-control-monospace-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
    input:focus-visible { outline: var(--pi-focus-ring-width, 2px) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset, 1px); }
    .hint { color: var(--pi-muted); }
    .intro { margin: 4px 0 0; line-height: 1.4; }
    .optional { color: var(--pi-muted); font-weight: 400; }
    .field-error { color: var(--pi-danger); }
    .dialog-error { border: 1px solid var(--pi-danger); border-radius: 8px; background: color-mix(in srgb, var(--pi-danger) 10%, transparent); color: var(--pi-danger); padding: 9px; line-height: 1.35; }
    button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control, 8px); background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; font-family: var(--pi-control-font-family, system-ui, sans-serif); }
    button:focus-visible { outline: var(--pi-focus-ring-width, 2px) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset, 2px); }
    header button { border: 0; background: transparent; color: var(--pi-muted); font-size: 22px; padding: 0 8px; }
    .primary { border-color: var(--pi-success-border); background: var(--pi-success-border); }
    button:disabled { opacity: .5; cursor: not-allowed; }
  `;
}

export function suggestedMachineNameFromUrl(value: string): string {
  const raw = value.trim();
  if (raw === "") return "";
  const parsed = parseUrlForSuggestion(raw) ?? parseUrlForSuggestion(`http://${raw.replace(/^\/+/u, "")}`);
  if (parsed !== undefined && parsed.hostname !== "") return parsed.hostname.replace(/^\[(.*)\]$/u, "$1");
  return fallbackSuggestedName(raw);
}

export function machineBaseUrlValidationMessage(value: string): string | undefined {
  const raw = value.trim();
  if (raw === "") return "Remote PI WEB URL is required.";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Enter a valid URL including http:// or https://.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Use an http:// or https:// URL.";
  if (url.username !== "" || url.password !== "") return "Do not include credentials in the machine URL.";
  if (url.search !== "" || url.hash !== "") return "Do not include a query string or fragment.";
  return undefined;
}

function parseUrlForSuggestion(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function fallbackSuggestedName(value: string): string {
  const withoutProtocol = value.replace(/^[a-z][a-z\d+.-]*:\/\//iu, "");
  const withoutCredentials = withoutProtocol.slice(withoutProtocol.lastIndexOf("@") + 1);
  const host = withoutCredentials.split(/[/?#]/u)[0] ?? "";
  if (host.startsWith("[") && host.includes("]")) return host.slice(1, host.indexOf("]"));
  return host.replace(/:\d+$/u, "");
}
