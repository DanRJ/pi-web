import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { normalizeSessionName, SESSION_NAME_MAX_LENGTH } from "../../../shared/sessionName";

/** One modal used by the header, navigation list, and federated dashboard. */
@customElement("session-rename-dialog")
export class SessionRenameDialog extends LitElement {
  @property({ type: String }) name = "";
  @property({ type: Boolean }) archived = false;
  @property({ type: Boolean }) saving = false;
  @property({ type: String }) error = "";
  @property({ attribute: false }) onSave?: (name: string | null) => void | Promise<void>;
  @property({ attribute: false }) onCancel?: () => void;
  @query("input") private input?: HTMLInputElement;
  @query("section") private dialog?: HTMLElement;
  @state() private draft = "";
  private initializedName: string | undefined;

  protected override updated(changed: PropertyValues<this>): void {
    if (this.initializedName !== this.name) {
      this.initializedName = this.name;
      this.draft = this.name;
      void this.updateComplete.then(() => {
        this.input?.focus();
        this.input?.select();
      });
      return;
    }
    // Persistence failures (including a stale remote revision) leave the
    // dialog open. Return focus to its field so retrying is keyboard-safe.
    if (changed.has("error") && this.error !== "") void this.updateComplete.then(() => { this.input?.focus(); });
  }

  override render() {
    if (this.archived) return html`
      <div class="scrim"><section role="dialog" aria-modal="true" aria-labelledby="rename-session-title" @keydown=${this.handleKeydown}>
        <h2 id="rename-session-title">Rename session</h2>
        <p role="status">Restore this session before renaming.</p>
        <footer><button type="button" @click=${() => { this.onCancel?.(); }}>Close</button></footer>
      </section></div>`;
    const count = this.draft.length;
    return html`
      <div class="scrim" @mousedown=${() => { if (!this.saving) this.onCancel?.(); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="rename-session-title" @mousedown=${(event: MouseEvent) => { event.stopPropagation(); }} @keydown=${this.handleKeydown}>
          <header><div><p class="eyebrow">SESSION</p><h2 id="rename-session-title">Rename session</h2></div></header>
          <label for="session-rename">Name</label>
          <input id="session-rename" maxlength=${SESSION_NAME_MAX_LENGTH} .value=${this.draft} @input=${this.updateDraft} aria-describedby="rename-count">
          <p id="rename-count" class="count">${count} of ${SESSION_NAME_MAX_LENGTH} characters. Leave blank to use the session fallback title.</p>
          ${this.error === "" ? nothing : html`<p class="error" role="alert">${this.error}</p>`}
          <footer>
            <button type="button" ?disabled=${this.saving} @click=${() => { this.onCancel?.(); }}>Cancel</button>
            <button type="button" ?disabled=${this.saving} @click=${() => { void this.submit(null); }}>Clear</button>
            <button class="save" type="button" ?disabled=${this.saving} @click=${() => { void this.submit(); }}>${this.saving ? "Saving…" : "Save"}</button>
          </footer>
        </section>
      </div>`;
  }

  private updateDraft = (event: Event): void => { this.draft = event.currentTarget instanceof HTMLInputElement ? event.currentTarget.value : ""; };

  private async submit(force?: null): Promise<void> {
    if (this.saving) return;
    try {
      const normalized = force === null ? undefined : normalizeSessionName(this.draft);
      await this.onSave?.(normalized ?? null);
    } catch (error) {
      // The parent normally owns persistence errors; retain a local validation error too.
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && !this.saving) { event.preventDefault(); this.onCancel?.(); return; }
    if (event.key !== "Tab") return;
    const controls = [...(this.dialog?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])") ?? [])];
    if (controls.length === 0) { event.preventDefault(); return; }
    const active = this.shadowRoot?.activeElement;
    const index = active instanceof HTMLElement ? controls.indexOf(active) : -1;
    if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && (index === -1 || index === controls.length - 1)) { event.preventDefault(); controls[0]?.focus(); }
  };

  static override styles = css`
    :host { position: fixed; inset: 0; z-index: 40; color: var(--pi-text); font-family: Archivo, var(--pi-body-font-family, system-ui, sans-serif); }
    .scrim { box-sizing: border-box; position: fixed; inset: 0; display: grid; place-items: center; padding: 1rem; background: color-mix(in srgb, var(--pi-bg) 74%, transparent); }
    section { box-sizing: border-box; width: min(100%, 32rem); border: var(--pi-divider-width, .125rem) solid var(--pi-text); background: var(--pi-bg); padding: 1.25rem; box-shadow: .5rem .5rem 0 var(--pi-text); }
    header { border-bottom: var(--pi-divider-width, .125rem) solid var(--pi-text); padding-bottom: .75rem; } h2, p { margin: 0; } h2 { font-size: 1.5rem; } .eyebrow, label { font-size: .75rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; } .eyebrow { color: var(--pi-muted); }
    label { display: block; margin-top: 1rem; } input { box-sizing: border-box; width: 100%; min-height: 2.75rem; margin-top: .375rem; border: .125rem solid var(--pi-text); border-radius: var(--pi-radius-control, 0); background: var(--pi-bg); color: var(--pi-text); padding: .5rem; font: inherit; }
    .count { margin-top: .5rem; color: var(--pi-muted); font-size: .8125rem; } .error { margin-top: 1rem; border: .125rem solid var(--pi-text); padding: .75rem; } footer { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: .5rem; margin-top: 1.25rem; border-top: .125rem solid var(--pi-border); padding-top: .75rem; }
    button { min-height: 2.75rem; border: .125rem solid var(--pi-text); border-radius: var(--pi-radius-control, 0); background: var(--pi-bg); color: var(--pi-text); padding: .5rem .75rem; font: inherit; font-weight: 700; cursor: pointer; } button:hover:not(:disabled) { background: var(--pi-text); color: var(--pi-bg); } .save { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-bg); } button:disabled { opacity: .6; cursor: wait; } button:focus-visible, input:focus-visible { outline: .1875rem solid var(--pi-accent); outline-offset: .1875rem; }
    @media (max-width: 42rem) { .scrim { align-items: end; padding: 0; } section { width: 100%; border-right: 0; border-bottom: 0; border-left: 0; box-shadow: none; } }
  `;
}
