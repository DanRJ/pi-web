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
      <aside class="extension-card select-card" aria-label=${request.title}>
        <strong class="select-title">${request.title}</strong>
        <div class="select-options">${request.options.map((option) => html`<button type="button" ?disabled=${submitted} @click=${() => { void this.respond({ id: request.id, value: option }); }}>${option}</button>`)}</div>
        <div class="select-footer">${this.cancelButton(request, submitted)}</div>
      </aside>`;
    if (request.method === "confirm") return html`
      <aside class="extension-card" aria-label=${request.title}>
        <strong>${request.title}</strong><span>${request.message}</span>
        <div class="choices extension-actions primary-actions"><button type="button" ?disabled=${submitted} @click=${() => { void this.respond({ id: request.id, confirmed: true }); }}>Confirm</button><button type="button" ?disabled=${submitted} @click=${() => { void this.respond({ id: request.id, confirmed: false }); }}>Decline</button>${this.cancelButton(request, submitted)}</div>
      </aside>`;
    const value = request.method === "editor" ? request.prefill ?? "" : "";
    return html`
      <form class="extension-card" aria-label=${request.title} @submit=${(event: SubmitEvent) => { this.submitText(event, request); }}>
        <label><strong>${request.title}</strong><textarea name="value" .value=${value} placeholder=${request.method === "input" ? request.placeholder ?? "" : ""} rows=${request.method === "editor" ? 6 : 2} ?disabled=${submitted}></textarea></label>
        <div class="choices extension-actions primary-actions"><button type="submit" ?disabled=${submitted}>${submitted ? "Submitted" : "Submit"}</button>${this.cancelButton(request, submitted)}</div>
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
    :host { display: grid; gap: var(--pi-space-2, 0.5rem); font: 0.875rem var(--pi-body-font-family, system-ui, sans-serif); }
    .extension-card { display: grid; gap: var(--pi-space-2, 0.5rem); margin: var(--pi-space-2, 0.5rem) 0; padding: var(--pi-space-3, 0.75rem); border: var(--pi-divider-width, 1px) solid var(--pi-border); border-left: var(--pi-accent-rule-width, 0.25rem) solid var(--pi-accent); border-radius: var(--pi-radius-control, 0.5rem); background: var(--pi-surface); color: var(--pi-text); }
    .extension-card strong { font-family: var(--pi-heading-font-family, inherit); font-weight: var(--pi-heading-font-weight, 700); }
    .extension-card span { color: var(--pi-muted); }
    .choices { display: flex; flex-wrap: wrap; align-items: center; gap: var(--pi-space-2, 0.5rem); }
    .extension-actions { width: 100%; }
    .select-card { box-sizing: border-box; width: 100%; max-width: 50rem; gap: 0; padding: 0; border: 1px solid color-mix(in srgb, var(--pi-accent) 55%, var(--pi-border)); background: transparent; }
    .select-title { padding: var(--pi-space-4, 1rem); border-bottom: 1px solid color-mix(in srgb, var(--pi-accent) 55%, var(--pi-border)); }
    .select-options { display: grid; gap: var(--pi-space-3, 0.75rem); padding: var(--pi-space-4, 1rem); }
    .select-options button { box-sizing: border-box; width: 100%; min-height: 3rem; padding: var(--pi-space-3, 0.75rem) var(--pi-space-4, 1rem); border: 1px solid var(--pi-border); background: var(--pi-surface); text-align: left; white-space: normal; }
    .select-footer { display: flex; justify-content: flex-end; padding: var(--pi-space-3, 0.75rem) var(--pi-space-4, 1rem); border-top: 1px solid var(--pi-border); }
    .select-footer button.quiet { min-height: 2.5rem; margin: 0; padding: 0.625rem 0.75rem; border: 1px solid transparent; border-radius: 0; background: transparent; color: var(--pi-accent); font-size: 0.875rem; }
    .select-footer button.quiet:not(:disabled):hover, .select-footer button.quiet:focus-visible { border-color: color-mix(in srgb, var(--pi-accent) 55%, var(--pi-border)); background: var(--pi-selection-bg); }
    button { min-height: 2.25rem; border: var(--pi-divider-width, 1px) solid var(--pi-border); border-radius: var(--pi-radius-control, 0.375rem); background: var(--pi-bg); color: var(--pi-text); padding: 0.35rem 0.6rem; cursor: pointer; font: 600 0.8125rem var(--pi-control-font-family, system-ui, sans-serif); }
    .select-options button:not(:disabled):hover, .select-options button:focus-visible { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    button:focus-visible, textarea:focus-visible { outline: var(--pi-focus-ring-width, 2px) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset, 2px); }
    button.quiet { margin-left: auto; color: var(--pi-muted); }
    textarea { box-sizing: border-box; width: 100%; margin-top: var(--pi-space-2, 0.5rem); border: var(--pi-divider-width, 1px) solid var(--pi-border); border-radius: var(--pi-radius-control, 0.375rem); background: var(--pi-code-background, var(--pi-bg)); color: var(--pi-text); font: inherit; padding: var(--pi-space-2, 0.5rem); resize: vertical; }
    .settled { border-left-color: var(--pi-muted); color: var(--pi-muted); }
    .notification.warning { border-left-color: var(--pi-warning, #b7791f); }
    .notification.error { border-left-color: var(--pi-danger); }
    @media (max-width: 47.9375rem) {
      /* Extension cards stay in the transcript flow; these are visual-only
         Modernist touch targets and do not change reconciliation ownership. */
      :host-context(:root[data-pi-web-theme^="themes:modernist-"]) button { min-height: 2.75rem; }
      :host-context(:root[data-pi-web-theme^="themes:modernist-"]) textarea { min-height: 5.5rem; }
    }
    @media (max-width: 24.375rem) { .extension-actions.primary-actions { flex-wrap: nowrap; } }
  `;
}
