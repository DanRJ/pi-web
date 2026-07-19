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
  @property({ attribute: false }) onSelect?: (destination: ModernistGlobalDestination) => void;

  override render() {
    return html`
      <header>
        <strong>PI WEB</strong>
        <nav aria-label="Global destinations">
          ${GLOBAL_DESTINATIONS.map((destination) => this.renderDestination(destination))}
        </nav>
        <div class="header-actions">${this.refreshControl}</div>
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
    header { box-sizing: border-box; display: grid; grid-template-columns: minmax(10rem, 1fr) auto minmax(10rem, 1fr); align-items: center; min-width: 0; height: 56px; padding-inline: 1rem; border-bottom: var(--pi-divider-width, 2px) solid var(--pi-border); }
    strong { min-width: 0; font-family: var(--pi-heading-font-family, inherit); font-size: 0.875rem; font-weight: var(--pi-heading-font-weight, 700); letter-spacing: var(--pi-navigation-heading-letter-spacing, 0.04em); white-space: nowrap; }
    nav { display: flex; align-self: stretch; min-width: 0; }
    button { min-width: 0; border: 0; border-radius: 0; background: transparent; color: var(--pi-muted); padding: 0 0.75rem; font: 600 0.75rem var(--pi-control-font-family, system-ui, sans-serif); white-space: nowrap; cursor: pointer; }
    button:hover { color: var(--pi-text); background: var(--pi-surface-hover); }
    button[aria-current="page"] { box-shadow: inset 0 -0.1875rem 0 var(--pi-accent); color: var(--pi-text); }
    button:focus-visible { outline: var(--pi-focus-ring-width, 2px) solid var(--pi-accent); outline-offset: calc(-1 * var(--pi-focus-ring-offset, 2px)); }
    .header-actions { display: flex; justify-content: end; min-width: 0; }
  `;
}
