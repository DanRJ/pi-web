import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Machine, MachineHealth, WorkspaceActivity } from "../api";
import { actionMenuPanelStyle } from "./actionMenu";
import type { KeyboardNavigableSection } from "./navigationFocus";
import { activateSelectableRow, focusSelectedOrFirstSelectableRow, handleSelectableRowKeyboard } from "./selectableRow";
import { listStyles } from "./shared";

@customElement("machine-list")
export class MachineList extends LitElement implements KeyboardNavigableSection {
  @property({ attribute: false }) machines: Machine[] = [];
  @property({ attribute: false }) selected?: Machine;
  @property({ attribute: false }) statuses: Record<string, MachineHealth> = {};
  @property({ attribute: false }) activities: Record<string, Record<string, WorkspaceActivity>> = {};
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) collapsed = false;
  @property({ attribute: false }) onSelect?: (machine: Machine) => void;
  @property({ attribute: false }) onRemove?: (machine: Machine) => void | Promise<void>;
  @property({ attribute: false }) onToggleCollapsed?: () => void;
  @property({ attribute: false }) onFocusNextSection?: () => void | Promise<void>;
  @property({ attribute: false }) onCancelKeyboardNavigation?: () => void | Promise<void>;
  @state() private openMenuMachineId: string | undefined;
  @state() private menuStyle = "";

  private readonly onDocumentClick = (event: MouseEvent) => {
    if (event.composedPath().includes(this)) return;
    this.openMenuMachineId = undefined;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("click", this.onDocumentClick);
  }

  override disconnectedCallback(): void {
    document.removeEventListener("click", this.onDocumentClick);
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("machines") && this.openMenuMachineId !== undefined && !this.machines.some((machine) => machine.id === this.openMenuMachineId)) this.openMenuMachineId = undefined;
    if (changed.has("collapsed") && this.collapsed) this.openMenuMachineId = undefined;
  }

  async focusSelectedOrFirst(): Promise<boolean> {
    await this.updateComplete;
    return focusSelectedOrFirstSelectableRow(this.renderRoot, { fallbackSelector: ".section-toggle" });
  }

  override render() {
    return html`
      <section>
        <h2>${this.renderHeading()}</h2>
        ${this.collapsed ? null : html`
          <div class="list-body">
            ${this.machines.map((machine) => this.renderMachine(machine))}
          </div>
        `}
      </section>
    `;
  }

  private renderMachine(machine: Machine) {
    const status = this.statuses[machine.id]?.status ?? machine.status ?? "unknown";
    const statusLabel = status === "offline" ? "offline" : status === "error" ? "error" : status === "unknown" ? "unknown" : undefined;
    const hasRemoveAction = canRemoveMachine(machine) && this.onRemove !== undefined;
    return html`
      <div
        class=${`action-row machine-row ${this.selected?.id === machine.id ? "selected" : ""} ${hasRemoveAction ? "" : "no-actions"}`}
        tabindex="0"
        title=${machine.baseUrl ?? machine.name}
        @click=${(event: MouseEvent) => { activateSelectableRow(event, () => this.onSelect?.(machine)); }}
        @keydown=${(event: KeyboardEvent) => { this.handleMachineKeydown(event, machine); }}
      >
        <div class="action-main">
          <span class="action-name machine-primary">
            ${machineIcon(machine.kind)}
            <span class="machine-primary-label">${machine.name}</span>
            ${status === "online" ? html`<span class="machine-online" role="img" title="Machine online" aria-label="Online"></span>` : null}
          </span>
          <small>${machine.kind === "local" ? "Local Pi Web" : machine.baseUrl ?? "Remote Pi Web"}${statusLabel === undefined ? "" : ` · ${statusLabel}`}</small>
        </div>
        ${hasRemoveAction ? this.renderMachineMenu(machine) : null}
      </div>
    `;
  }

  private renderMachineMenu(machine: Machine) {
    const open = this.openMenuMachineId === machine.id;
    const menuId = machineMenuId(machine.id);
    return html`
      <div class="action-menu">
        <button
          class="action-menu-toggle"
          title="Machine actions"
          aria-label=${`Actions for ${machine.name}`}
          aria-expanded=${String(open)}
          aria-controls=${menuId}
          @click=${(event: MouseEvent) => { event.stopPropagation(); this.toggleMenu(machine.id, event.currentTarget); }}
        >⋯</button>
        ${open ? html`
          <div class="action-menu-panel machine-menu-panel" id=${menuId} style=${this.menuStyle} @click=${(event: MouseEvent) => { event.stopPropagation(); }}>
            <button class="danger" title=${`Remove ${machine.name}`} @click=${() => { this.removeMachine(machine); }}>Remove</button>
          </div>
        ` : null}
      </div>
    `;
  }

  private renderHeading() {
    if (!this.collapsible) return html`<span>Machines</span>`;
    const selectedSummary = this.selected?.name ?? "No machine selected";
    const selectedTitle = this.selected?.baseUrl ?? selectedSummary;
    return html`<button class="section-toggle" aria-expanded=${String(!this.collapsed)} @click=${() => { this.onToggleCollapsed?.(); }}><span class="section-title"><span class="section-name">${this.collapsed ? "▸" : "▾"} Machines</span>${this.collapsed ? html`<small class="section-selected" title=${selectedTitle}>${selectedSummary}</small>` : null}</span><small class="section-count">${this.machines.length}</small></button>`;
  }

  private toggleMenu(machineId: string, target: EventTarget | null): void {
    if (this.openMenuMachineId === machineId) {
      this.openMenuMachineId = undefined;
      return;
    }
    this.menuStyle = actionMenuPanelStyle(target, { constrainTo: "viewport" });
    this.openMenuMachineId = machineId;
  }

  private removeMachine(machine: Machine): void {
    this.openMenuMachineId = undefined;
    void this.onRemove?.(machine);
  }

  private handleMachineKeydown(event: KeyboardEvent, machine: Machine): void {
    if (event.key === "Escape" && this.openMenuMachineId === machine.id) {
      event.preventDefault();
      event.stopPropagation();
      this.openMenuMachineId = undefined;
      return;
    }
    handleSelectableRowKeyboard(event, {
      activate: () => this.onSelect?.(machine),
      nextSection: this.onFocusNextSection === undefined ? undefined : () => { void this.onFocusNextSection?.(); },
      cancel: this.onCancelKeyboardNavigation === undefined ? undefined : () => { void this.onCancelKeyboardNavigation?.(); },
    });
  }

  static override styles = [
    listStyles,
    css`
      .machine-row.no-actions .action-main { border-radius: 8px; }
      .machine-row.selected .action-main,
      .machine-row.selected .action-menu-toggle,
      .machine-row.selected.no-actions .action-main { border-radius: 0; }
      .machine-row.selected:focus-visible { border-radius: 0; }
      .machine-primary { display: flex; align-items: center; gap: 6px; }
      .machine-primary-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .machine-icon { flex: 0 0 auto; width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .machine-online { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: var(--pi-machine-online, #f97316); }
      .machine-menu-panel button.danger { color: var(--pi-danger); }
      .machine-menu-panel button.danger:hover, .machine-menu-panel button.danger:focus { background: color-mix(in srgb, var(--pi-danger) 14%, transparent); }
    `,
  ];
}

export function canRemoveMachine(machine: Machine): boolean {
  return machine.kind === "remote";
}

function machineMenuId(machineId: string): string {
  return `machine-menu-${machineId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function machineIcon(kind: Machine["kind"]) {
  if (kind === "local") {
    return html`<svg class="machine-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="1"></rect><path d="M8 21h8M12 17v4"></path></svg>`;
  }
  return html`<svg class="machine-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="7" rx="1"></rect><rect x="4" y="14" width="16" height="7" rx="1"></rect><path d="M8 6.5h.01M8 17.5h.01M12 6.5h5M12 17.5h5"></path></svg>`;
}
