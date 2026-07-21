import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

export type ModernistGlobalDestination = "dashboard" | "chat" | "tools" | "settings" | "actions";

interface GlobalDestinationItem {
  id: ModernistGlobalDestination;
  label: string;
}

const GLOBAL_DESTINATIONS: readonly GlobalDestinationItem[] = [
  { id: "chat", label: "Chat" },
  { id: "tools", label: "Tools" },
  { id: "settings", label: "Settings" },
  { id: "actions", label: "Actions" },
];

/** Presentational desktop navigation; PiWebApp retains every route and action owner. */
@customElement("modernist-global-header")
export class ModernistGlobalHeader extends LitElement {
  /** Undefined when the sidebar hierarchy, rather than a global destination, owns focus. */
  @property({ attribute: false }) activeDestination?: ModernistGlobalDestination;
  @property({ attribute: false }) refreshControl: unknown;
  /** Count of currently active (running) sessions; the pill hides at zero. */
  @property({ attribute: false }) activeCount = 0;
  @property({ attribute: false }) onSelect?: (destination: ModernistGlobalDestination) => void;
  @property({ attribute: false }) onToggleTheme?: () => void;
  /** Opens the provider login flow (pi `/login`); the account cluster hides when absent. */
  @property({ attribute: false }) onConfigureAuth?: () => void;
  /** Opens the provider logout flow (pi `/logout`). */
  @property({ attribute: false }) onRemoveAuth?: () => void;
  @state() private accountMenuOpen = false;

  private readonly onDocumentClick = (event: MouseEvent) => {
    if (event.composedPath().includes(this)) return;
    this.accountMenuOpen = false;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("click", this.onDocumentClick);
  }

  override disconnectedCallback(): void {
    document.removeEventListener("click", this.onDocumentClick);
    super.disconnectedCallback();
  }

  override render() {
    return html`
      <header>
        <a
          class="brand"
          href="?page=dashboard"
          data-destination="dashboard"
          aria-label="Open dashboard"
          title="Dashboard"
          aria-current=${this.activeDestination === "dashboard" ? "page" : nothing}
          @click=${(event: MouseEvent) => { this.openDashboard(event); }}
        >PI WEB</a>
        <nav aria-label="Global destinations">
          ${GLOBAL_DESTINATIONS.map((destination) => this.renderDestination(destination))}
          ${this.activeCount > 0
            ? html`<span class="active-pill" title=${`${String(this.activeCount)} active ${this.activeCount === 1 ? "session" : "sessions"}`}><span class="active-dot" aria-hidden="true"></span>${this.activeCount} active</span>`
            : null}
        </nav>
        <div class="header-actions">
          ${this.onToggleTheme === undefined ? null : html`<button type="button" class="theme-control" aria-label="Toggle light and dark theme" title="Toggle light and dark theme" @click=${() => { this.onToggleTheme?.(); }}>${themeIcon()}</button>`}
          ${this.refreshControl}
          ${this.renderAccount()}
        </div>
      </header>
    `;
  }

  private openDashboard(event: MouseEvent): void {
    if (this.onSelect === undefined) return;
    if (("button" in event && event.button !== 0) || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    this.onSelect("dashboard");
  }

  private renderAccount() {
    if (this.onConfigureAuth === undefined) return null;
    return html`
      <div class="account">
        <button
          type="button"
          class="account-control"
          aria-label="Account"
          title="Account"
          aria-haspopup="menu"
          aria-expanded=${String(this.accountMenuOpen)}
          @click=${() => { this.accountMenuOpen = !this.accountMenuOpen; }}
          @keydown=${(event: KeyboardEvent) => { this.handleAccountTriggerKeydown(event); }}
        >${accountIcon()}</button>
        ${this.accountMenuOpen ? html`
          <div class="account-menu" role="menu" aria-label="Account" @click=${(event: MouseEvent) => { event.stopPropagation(); }}>
            <button type="button" role="menuitem" data-account-action="login" @click=${() => { this.runAccountAction(this.onConfigureAuth); }}>Configure provider authentication</button>
            <button type="button" role="menuitem" data-account-action="logout" @click=${() => { this.runAccountAction(this.onRemoveAuth); }}>Remove provider authentication</button>
            <div class="account-menu-divider" role="separator"></div>
            <button type="button" role="menuitem" data-account-action="settings" @click=${() => { this.runAccountAction(() => { this.onSelect?.("settings"); }); }}>Settings</button>
          </div>
        ` : null}
      </div>
    `;
  }

  private handleAccountTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && this.accountMenuOpen) {
      event.stopPropagation();
      this.accountMenuOpen = false;
    }
  }

  private runAccountAction(action?: () => void): void {
    this.accountMenuOpen = false;
    action?.();
  }

  private renderDestination(destination: GlobalDestinationItem) {
    const selected = this.activeDestination === destination.id;
    return html`
      <button
        type="button"
        data-destination=${destination.id}
        aria-current=${selected ? "page" : nothing}
        @click=${() => { this.onSelect?.(destination.id); }}
      >${destination.label}</button>
    `;
  }

  static override styles = css`
    :host { display: block; min-width: 0; color: var(--pi-text); background: var(--pi-bg); font-family: var(--pi-control-font-family, system-ui, sans-serif); }
    header { box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 0.75rem; min-width: 0; height: 56px; padding-inline: 1rem; border-bottom: var(--pi-divider-width, 2px) solid var(--pi-border); }
    nav { justify-self: center; display: flex; align-self: stretch; align-items: center; min-width: 0; }
    button { min-width: 0; border: 0; border-radius: 0; background: transparent; color: var(--pi-muted); padding: 0 0.75rem; font: 600 1rem var(--pi-control-font-family, system-ui, sans-serif); white-space: nowrap; cursor: pointer; }
    button:hover { color: var(--pi-text); background: var(--pi-surface-hover); }
    .brand { justify-self: start; align-self: stretch; display: inline-flex; align-items: center; padding: 0; color: var(--pi-text); font-family: var(--pi-heading-font-family, inherit); font-size: 1rem; font-weight: var(--pi-heading-font-weight, 700); letter-spacing: var(--pi-navigation-heading-letter-spacing, 0.04em); text-decoration: none; white-space: nowrap; }
    .brand:hover { color: var(--pi-accent); }
    .brand[aria-current="page"], nav button[aria-current="page"] { box-shadow: inset 0 -0.1875rem 0 var(--pi-accent); color: var(--pi-text); }
    button:focus-visible, .brand:focus-visible { outline: var(--pi-focus-ring-width, 2px) solid var(--pi-accent); outline-offset: calc(-1 * var(--pi-focus-ring-offset, 2px)); }
    .active-pill { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 0.375rem; margin-left: 0.25rem; padding: 0.1875rem 0.5rem; border: var(--pi-divider-width, 2px) solid var(--pi-border); color: var(--pi-muted); font: 600 0.6875rem var(--pi-control-font-family, system-ui, sans-serif); letter-spacing: 0.02em; white-space: nowrap; }
    .active-dot { flex: 0 0 auto; width: 0.4375rem; height: 0.4375rem; border-radius: 50%; background: var(--pi-accent); }
    .header-actions { justify-self: end; display: flex; align-items: center; gap: 0.25rem; min-width: 0; }
    .theme-control, .account-control { display: inline-grid; place-items: center; width: 2.25rem; height: 2.25rem; padding: 0; color: var(--pi-muted); }
    .theme-control svg, .account-control svg { width: 1rem; height: 1rem; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .account { position: relative; flex: 0 0 auto; display: inline-flex; }
    .account-control[aria-expanded="true"] { color: var(--pi-text); background: var(--pi-surface-hover); }
    .account-menu { position: absolute; z-index: 10000; top: calc(100% + 0.25rem); right: 0; box-sizing: border-box; min-width: 15rem; display: flex; flex-direction: column; padding: 0.25rem; border: var(--pi-divider-width, 2px) solid var(--pi-border); background: var(--pi-surface); box-shadow: 0 0.5rem 1.5rem var(--pi-shadow); }
    .account-menu button { width: 100%; height: auto; padding: 0.5rem 0.625rem; text-align: left; color: var(--pi-text); }
    .account-menu button:hover, .account-menu button:focus-visible { color: var(--pi-text); background: var(--pi-surface-hover); }
    .account-menu-divider { margin: 0.25rem 0; border-top: var(--pi-divider-width, 2px) solid var(--pi-border); }
  `;
}

function themeIcon() {
  return html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"></path></svg>`;
}

function accountIcon() {
  return html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 20c0-4 4-6 8-6s8 2 8 6"></path></svg>`;
}
