import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ExtensionUiNotification, ExtensionUiRequest, ExtensionUiResolution, ExtensionUiResponse } from "../api";

export type ExtensionUiSubmitResult = "settled" | "retry" | "removed";

@customElement("extension-ui-cards")
export class ExtensionUiCards extends LitElement {
  @property({ attribute: false }) requests: ExtensionUiRequest[] = [];
  @property({ attribute: false }) resolutions: ExtensionUiResolution[] = [];
  @property({ attribute: false }) notifications: ExtensionUiNotification[] = [];
  @property({ attribute: false }) onRespond?: (response: ExtensionUiResponse) => Promise<ExtensionUiSubmitResult> | ExtensionUiSubmitResult;
  @state() private submittedIds = new Set<string>();
  @state() private removedIds = new Set<string>();

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (!changed.has("requests")) return;
    const requestIds = new Set(this.requests.map((request) => request.id));
    this.submittedIds = new Set([...this.submittedIds].filter((id) => requestIds.has(id)));
    this.removedIds = new Set([...this.removedIds].filter((id) => requestIds.has(id)));
  }

  override render() {
    return html`
      ${this.requests.map((request) => this.renderRequest(request))}
      ${this.resolutions.map((resolution) => html`<aside class="extension-card settled" aria-live="polite">Extension interaction ${resolution.state === "expired" ? "expired" : resolution.state === "cancelled" ? "cancelled" : "submitted"}.</aside>`)}
      ${this.notifications.map((notification) => html`<aside class=${`extension-card notification ${notification.notifyType}`} aria-live="polite"><strong>Extension ${notification.notifyType}</strong><span>${notification.message}</span></aside>`)}
    `;
  }

  private renderRequest(request: ExtensionUiRequest) {
    if (this.removedIds.has(request.id)) return nothing;
    const submitted = this.submittedIds.has(request.id);
    if (request.method === "select") return html`
      <aside class="extension-card" aria-label=${request.title}>
        <strong>${request.title}</strong>
        <div class="choices">${request.options.map((option) => html`<button type="button" ?disabled=${submitted} @click=${() => { void this.respond({ id: request.id, value: option }); }}>${option}</button>`)}</div>
        ${this.cancelButton(request, submitted)}
      </aside>`;
    if (request.method === "confirm") return html`
      <aside class="extension-card" aria-label=${request.title}>
        <strong>${request.title}</strong><span>${request.message}</span>
        <div class="choices"><button type="button" ?disabled=${submitted} @click=${() => { void this.respond({ id: request.id, confirmed: true }); }}>Confirm</button><button type="button" ?disabled=${submitted} @click=${() => { void this.respond({ id: request.id, confirmed: false }); }}>Decline</button></div>
        ${this.cancelButton(request, submitted)}
      </aside>`;
    const value = request.method === "editor" ? request.prefill ?? "" : "";
    return html`
      <form class="extension-card" aria-label=${request.title} @submit=${(event: SubmitEvent) => { this.submitText(event, request); }}>
        <label><strong>${request.title}</strong><textarea name="value" .value=${value} placeholder=${request.method === "input" ? request.placeholder ?? "" : ""} rows=${request.method === "editor" ? 6 : 2} ?disabled=${submitted}></textarea></label>
        <div class="choices"><button type="submit" ?disabled=${submitted}>${submitted ? "Submitted" : "Submit"}</button>${this.cancelButton(request, submitted)}</div>
      </form>`;
  }

  private cancelButton(request: ExtensionUiRequest, submitted: boolean) {
    return html`<button type="button" class="quiet" ?disabled=${submitted} @click=${() => { void this.respond({ id: request.id, cancelled: true }); }}>Cancel</button>`;
  }

  private submitText(event: SubmitEvent, request: Extract<ExtensionUiRequest, { method: "input" | "editor" }>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const value = new FormData(form).get("value");
    if (typeof value === "string") void this.respond({ id: request.id, value });
  }

  private async respond(response: ExtensionUiResponse): Promise<void> {
    if (this.submittedIds.has(response.id)) return;
    this.submittedIds = new Set([...this.submittedIds, response.id]);
    let result: ExtensionUiSubmitResult | undefined;
    try {
      result = await this.onRespond?.(response);
    } catch {
      result = "retry";
    }
    if (result === "removed") {
      this.removedIds = new Set([...this.removedIds, response.id]);
      this.submittedIds = new Set([...this.submittedIds].filter((id) => id !== response.id));
    } else if (result === "retry" || result === undefined) {
      this.submittedIds = new Set([...this.submittedIds].filter((id) => id !== response.id));
    }
  }

  static override styles = css`
    :host { display: grid; gap: .5rem; }
    .extension-card { display: grid; gap: .5rem; margin: .5rem 0; padding: .75rem; border: 1px solid var(--pi-border); border-left: .25rem solid var(--pi-accent); border-radius: var(--pi-radius, .5rem); background: var(--pi-surface); color: var(--pi-text); }
    .extension-card span { color: var(--pi-muted); }
    .choices { display: flex; flex-wrap: wrap; gap: .5rem; }
    button { border: 1px solid var(--pi-border); border-radius: .375rem; background: var(--pi-bg); color: var(--pi-text); padding: .35rem .6rem; cursor: pointer; }
    button:focus-visible, textarea:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
    button.quiet { color: var(--pi-muted); }
    textarea { box-sizing: border-box; width: 100%; margin-top: .5rem; border: 1px solid var(--pi-border); border-radius: .375rem; background: var(--pi-bg); color: var(--pi-text); font: inherit; padding: .5rem; resize: vertical; }
    .settled { border-left-color: var(--pi-muted); color: var(--pi-muted); }
    .notification.warning { border-left-color: var(--pi-warning, #b7791f); }
    .notification.error { border-left-color: var(--pi-danger); }
  `;
}
