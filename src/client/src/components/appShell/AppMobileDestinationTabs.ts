import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { MOBILE_DESTINATION_ORDER, type MobileDestination } from "../../appShell/mobileDestination";

@customElement("app-mobile-destination-tabs")
export class AppMobileDestinationTabs extends LitElement {
  @property({ attribute: false }) selected: MobileDestination = "chat";
  @property({ type: Boolean }) toolsAvailable = false;
  @property({ attribute: false }) onSelect?: (destination: MobileDestination) => void;

  override render() {
    return html`
      <nav aria-label="Mobile destinations">
        <div class="destinations">
          ${MOBILE_DESTINATION_ORDER.map((destination) => this.renderDestination(destination))}
        </div>
      </nav>
    `;
  }

  focusSelected(): void {
    this.renderRoot.querySelector<HTMLButtonElement>(`button[data-destination="${this.selected}"]`)?.focus();
  }

  private renderDestination(destination: MobileDestination) {
    const selected = this.selected === destination;
    const disabled = destination === "tools" && !this.toolsAvailable;
    return html`
      <button
        type="button"
        data-destination=${destination}
        aria-current=${selected ? "page" : nothing}
        aria-haspopup=${destination === "settings" ? "dialog" : nothing}
        aria-label=${destinationLabel(destination)}
        ?disabled=${disabled}
        @click=${() => { this.select(destination); }}
        @keydown=${(event: KeyboardEvent) => { this.onKeyDown(event, destination); }}
      >
        ${destinationIcon(destination)}
        <span>${destinationLabel(destination)}</span>
      </button>
    `;
  }

  private select(destination: MobileDestination): void {
    if (destination === "tools" && !this.toolsAvailable) return;
    this.onSelect?.(destination);
  }

  private onKeyDown(event: KeyboardEvent, destination: MobileDestination): void {
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const target = event.key === "Home"
      ? MOBILE_DESTINATION_ORDER[0]
      : event.key === "End"
        ? MOBILE_DESTINATION_ORDER[MOBILE_DESTINATION_ORDER.length - 1]
        : direction === 0 ? undefined : nextDestination(destination, direction, this.toolsAvailable);
    if (target === undefined) return;
    event.preventDefault();
    this.select(target);
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLButtonElement>(`button[data-destination="${target}"]`)?.focus();
    });
  }

  static override styles = css`
    :host { display: block; flex: 0 0 auto; min-width: 0; color: var(--pi-text); background: var(--pi-bg); font-family: var(--pi-control-font-family, system-ui, sans-serif); }
    nav { border-top: var(--pi-divider-width, 2px) solid var(--pi-border); padding: 0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
    .destinations { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); min-height: 3.625rem; }
    button { display: grid; place-content: center; gap: 0.125rem; min-width: 2.75rem; min-height: 2.75rem; border: 0; border-radius: 0; background: transparent; color: var(--pi-muted); padding: 0.25rem; font: 600 0.6875rem/1.1 var(--pi-control-font-family, system-ui, sans-serif); cursor: pointer; }
    button[aria-current="page"] { color: var(--pi-accent); font-weight: 800; }
    button:disabled { color: var(--pi-muted); cursor: not-allowed; opacity: .55; }
    button:focus-visible { outline: var(--pi-focus-ring-width, 2px) solid var(--pi-accent); outline-offset: calc(-1 * var(--pi-focus-ring-offset, 2px)); }
    svg { width: 1.125rem; height: 1.125rem; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    @media (forced-colors: active) { button[aria-current="page"] { outline: 2px solid SelectedItem; outline-offset: -2px; } }
  `;
}

export function nextDestination(destination: MobileDestination, direction: -1 | 1, toolsAvailable: boolean): MobileDestination {
  const available = MOBILE_DESTINATION_ORDER.filter((candidate) => candidate !== "tools" || toolsAvailable);
  const index = available.indexOf(destination);
  return available[(index + direction + available.length) % available.length] ?? "chat";
}

function destinationLabel(destination: MobileDestination): string {
  return destination.charAt(0).toUpperCase() + destination.slice(1);
}

function destinationIcon(destination: MobileDestination) {
  if (destination === "chat") return html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 5h16v11H9l-5 4V5Z"></path><path d="M8 10h8"></path></svg>`;
  if (destination === "sessions") return html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m12 3 9 5-9 5-9-5 9-5Z"></path><path d="m3 13 9 5 9-5"></path><path d="m3 18 9 5 9-5"></path></svg>`;
  if (destination === "tools") return html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m14.7 6.3-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2-2Z"></path></svg>`;
  return html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"></path></svg>`;
}
