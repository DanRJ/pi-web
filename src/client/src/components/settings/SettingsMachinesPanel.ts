import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Machine, MachineHealth, MachineRuntime } from "../../api";
import "./SettingsPanelFrame";

@customElement("settings-machines-panel")
export class SettingsMachinesPanel extends LitElement {
  @property({ attribute: false }) machines: readonly Machine[] = [];
  @property({ attribute: false }) selectedMachine: Machine | undefined;
  @property({ attribute: false }) machineStatuses: Record<string, MachineHealth> = {};
  @property({ attribute: false }) machineRuntimes: Record<string, MachineRuntime> = {};
  @property({ attribute: false }) onSelectMachine?: (machine: Machine) => void | Promise<void>;
  @property({ attribute: false }) onAddMachine?: () => void;
  @property({ attribute: false }) onConfigureMachine?: (machine: Machine) => void;
  @property({ attribute: false }) onRemoveMachine?: (machine: Machine) => void | Promise<void>;
  /** Prevent connection replacement while a machine-scoped settings write is pending. */
  @property({ type: Boolean }) configureDisabled = false;

  override render(): TemplateResult {
    return html`
      <settings-panel-frame heading="Machines" .description=${"Choose the machine whose session daemon, packages, plugins, and file settings are shown elsewhere."}>
        <div class="actions"><button type="button" @click=${() => this.onAddMachine?.()}>Add machine</button></div>
        <div class="machine-list">
          ${this.machines.map((machine) => this.renderMachine(machine))}
        </div>
      </settings-panel-frame>
    `;
  }

  private renderMachine(machine: Machine): TemplateResult {
    const selected = machine.id === this.selectedMachine?.id;
    const health = this.machineStatuses[machine.id];
    const runtime = this.machineRuntimes[machine.id];
    const status = machineStatus(machine, health, runtime);
    const version = runtime?.components?.web.runtimeVersion;
    const packageName = runtime?.packageName;
    return html`
      <article class=${`machine-row${selected ? " selected" : ""}`} aria-current=${selected ? "true" : "false"}>
        <button class="machine-select" type="button" aria-label=${`Select ${machine.name} machine settings`} @click=${() => { void this.onSelectMachine?.(machine); }}>
          <span class="machine-name">${machine.name}</span>
          <span class="machine-endpoint">${machine.kind === "local" ? "Local gateway" : machine.baseUrl ?? "Remote endpoint unavailable"}</span>
          <span class=${`machine-status ${status.tone}`}>${status.label}</span>
          ${version === undefined ? null : html`<span class="machine-version">PI WEB ${version}</span>`}
          ${packageName === undefined ? null : html`<span class="machine-package">Package: ${packageName}</span>`}
        </button>
        <div class="machine-actions">
          ${machine.kind === "remote" ? html`
            <button type="button" ?disabled=${this.configureDisabled} @click=${() => { this.onConfigureMachine?.(machine); }}>Configure</button>
            <button class="danger" type="button" @click=${() => { void this.onRemoveMachine?.(machine); }}>Remove</button>
          ` : html`<button type="button" @click=${() => { void this.onSelectMachine?.(machine); }}>Use local settings</button>`}
        </div>
      </article>
    `;
  }

  static override styles = css`
    :host { display: block; }
    button { min-height: 2.75rem; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control, 0px); background: var(--pi-surface); color: var(--pi-text); padding: .5rem .75rem; font: inherit; cursor: pointer; }
    button:focus-visible { outline: var(--pi-focus-ring-width, 2px) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset, 2px); }
    .actions { display: flex; justify-content: flex-end; }
    .machine-list { display: grid; gap: .75rem; }
    .machine-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; border: 1px solid var(--pi-border); background: var(--pi-surface); }
    .machine-row.selected { border-width: var(--pi-divider-width, 2px); border-color: var(--pi-accent); }
    .machine-select { display: grid; min-width: 0; gap: .25rem; border: 0; border-radius: 0; background: transparent; text-align: left; }
    .machine-select:hover { background: var(--pi-surface-hover); }
    .machine-name { font-weight: 700; }
    .machine-endpoint, .machine-version, .machine-package { min-width: 0; color: var(--pi-muted); overflow-wrap: anywhere; }
    .machine-status { display: inline-flex; align-items: center; gap: .35rem; font-size: .8125rem; font-weight: 700; text-transform: capitalize; }
    .machine-status::before { content: ""; width: .5rem; height: .5rem; border: 1px solid currentColor; border-radius: 50%; }
    .machine-status.online { color: var(--pi-success); }
    .machine-status.offline, .machine-status.error { color: var(--pi-danger); }
    .machine-status.unknown { color: var(--pi-muted); }
    .machine-actions { display: flex; align-items: center; gap: .5rem; padding: .5rem; }
    .danger { color: var(--pi-danger); }
    @media (max-width: 767px) { .machine-row { grid-template-columns: minmax(0, 1fr); } .machine-actions { border-top: 1px solid var(--pi-border); } }
  `;
}

export function machineStatus(machine: Machine, health: MachineHealth | undefined, runtime: MachineRuntime | undefined): { label: string; tone: "online" | "offline" | "error" | "unknown" } {
  // Health is the connection result. Do not let an older successful runtime
  // make an explicitly unavailable machine look online.
  if (health !== undefined) {
    if (health.status === "offline") return { label: "offline", tone: "offline" };
    if (health.status === "error" || !health.ok) return { label: "error", tone: "error" };
    return { label: health.status ?? "online", tone: "online" };
  }
  if (runtime?.ok === true) return { label: machine.status ?? "online", tone: "online" };
  if (runtime?.ok === false) return { label: "error", tone: "error" };
  if (machine.status === "offline") return { label: "offline", tone: "offline" };
  if (machine.status === "error") return { label: "error", tone: "error" };
  return { label: machine.status ?? "unknown", tone: "unknown" };
}

declare global { interface HTMLElementTagNameMap { "settings-machines-panel": SettingsMachinesPanel; } }
