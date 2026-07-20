import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

export type ModernistGlobalDestination = "dashboard" | "chat" | "tools" | "settings" | "actions";

interface GlobalDestinationItem {
  id: ModernistGlobalDestination;
  label: string;
}

const GLOBAL_DESTINATIONS: readonly GlobalDestinationItem[] = [
  { id: "dashboard", label: "Dashboard" },
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

  override render() {
    return html`
      <header>
        <strong>PI WEB</strong>
        <nav aria-label="Global destinations">
          ${GLOBAL_DESTINATIONS.map((destination) => this.renderDestination(destination))}
        </nav>
        ${this.activeCount > 0
          ? html`<span class="active-pill" title=${`${String(this.activeCount)} active ${this.activeCount === 1 ? "session" : "sessions"}`}><span class="active-dot" aria-hidden="true"></span>${this.activeCount} active</span>`
          : null}
        <div class="header-actions">
          ${this.onToggleTheme === undefined ? null : html`<button type="button" class="theme-control" aria-label="Toggle light and dark theme" title="Toggle light and dark theme" @click=${() => { this.onToggleTheme?.(); }}>${themeIcon()}</button>`}
          ${this.refreshControl}
        </div>
      </header>
    `;
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
    header { box-sizing: border-box; display: flex; align-items: center; gap: 0.75rem; min-width: 0; height: 56px; padding-inline: 1rem; border-bottom: var(--pi-divider-width, 2px) solid var(--pi-border); }
    strong { flex: 0 0 auto; min-width: 0; font-family: var(--pi-heading-font-family, inherit); font-size: 0.875rem; font-weight: var(--pi-heading-font-weight, 700); letter-spacing: var(--pi-navigation-heading-letter-spacing, 0.04em); white-space: nowrap; }
    nav { flex: 0 1 auto; display: flex; align-self: stretch; min-width: 0; }
    button { min-width: 0; border: 0; border-radius: 0; background: transparent; color: var(--pi-muted); padding: 0 0.75rem; font: 600 0.75rem var(--pi-control-font-family, system-ui, sans-serif); white-space: nowrap; cursor: pointer; }
    button:hover { color: var(--pi-text); background: var(--pi-surface-hover); }
    nav button[aria-current="page"] { box-shadow: inset 0 -0.1875rem 0 var(--pi-accent); color: var(--pi-text); }
    button:focus-visible { outline: var(--pi-focus-ring-width, 2px) solid var(--pi-accent); outline-offset: calc(-1 * var(--pi-focus-ring-offset, 2px)); }
    .active-pill { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.1875rem 0.5rem; border: var(--pi-divider-width, 2px) solid var(--pi-border); color: var(--pi-muted); font: 600 0.6875rem var(--pi-control-font-family, system-ui, sans-serif); letter-spacing: 0.02em; white-space: nowrap; }
    .active-dot { flex: 0 0 auto; width: 0.4375rem; height: 0.4375rem; border-radius: 50%; background: var(--pi-accent); }
    .header-actions { flex: 0 0 auto; margin-left: auto; display: flex; align-items: center; gap: 0.25rem; min-width: 0; }
    .theme-control { display: inline-grid; place-items: center; width: 2.25rem; height: 2.25rem; padding: 0; color: var(--pi-muted); }
    .theme-control svg { width: 1rem; height: 1rem; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  `;
}

function themeIcon() {
  return html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"></path></svg>`;
}
