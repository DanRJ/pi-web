import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type { Project, Workspace } from "../api";
import type { FederatedSessionDashboardResponse, LocalSessionDashboardSessionSummary, SessionDashboardMachineOutcome } from "../../../shared/sessionDashboard";
import { PI_WEB_CAPABILITIES } from "../../../shared/capabilities";
import "./DashboardNewSessionChooser";
import type { DashboardNewSessionChooser } from "./DashboardNewSessionChooser";

export type DashboardFilter = "all" | "attention";

@customElement("session-dashboard")
export class SessionDashboard extends LitElement {
  @property({ attribute: false }) dashboard: FederatedSessionDashboardResponse | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ type: String }) error: string | undefined;
  @property({ type: String }) selectionError = "";
  @property({ attribute: false }) hrefForSession: (session: LocalSessionDashboardSessionSummary, machineId: string) => string = () => "#";
  @property({ attribute: false }) onOpenSession?: (session: LocalSessionDashboardSessionSummary, machineId: string) => void | Promise<void>;
  @property({ attribute: false }) onRenameSession?: (session: LocalSessionDashboardSessionSummary, machineId: string, opener: HTMLElement) => void;
  @property({ attribute: false }) projects: Project[] = [];
  @property({ type: String }) selectedProjectId: string | undefined;
  @property({ type: String }) selectedWorkspaceId: string | undefined;
  @property({ attribute: false }) loadWorkspaces: (project: Project) => Promise<Workspace[]> = () => Promise.resolve([]);
  @property({ attribute: false }) onStartNewSession?: (workspace: Workspace) => Promise<void>;
  @property({ attribute: false }) onRetry?: () => void | Promise<void>;
  @query("dashboard-new-session-chooser") private newSessionChooser?: DashboardNewSessionChooser;
  @state() private filter: DashboardFilter = "all";
  @state() private now = Date.now();
  private timer: number | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.timer = window.setInterval(() => { this.now = Date.now(); }, 60_000);
  }

  override disconnectedCallback(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    super.disconnectedCallback();
  }

  override render() {
    const available = this.dashboard?.machines.filter((outcome): outcome is Extract<SessionDashboardMachineOutcome, { outcome: "available" }> => outcome.outcome === "available") ?? [];
    const cards = available.flatMap((outcome) => outcome.sessions.map((session) => ({ machineId: outcome.machine.id, machineName: outcome.machine.name, canRename: outcome.capabilities?.includes(PI_WEB_CAPABILITIES.sessionsRename) === true, session })));
    const visible = this.filter === "attention" ? cards.filter(({ session }) => session.needsAttention) : cards;
    const partial = this.dashboard?.machines.filter((outcome) => outcome.outcome !== "available") ?? [];
    return html`
      <section aria-labelledby="dashboard-heading">
        <header class="dashboard-header">
          <div class="dashboard-heading">
            <p class="eyebrow">SESSION DASHBOARD</p>
            <h1 id="dashboard-heading">Sessions <span aria-label="${String(cards.length)} sessions">${cards.length}</span></h1>
            <p class="subtitle">Recent work across every connected machine.</p>
          </div>
          <div class="dashboard-actions">
            <div class="filters" role="group" aria-label="Session filter">
              <button type="button" aria-pressed=${String(this.filter === "all")} @click=${() => { this.filter = "all"; }}>All <span>${cards.length}</span></button>
              <button type="button" aria-pressed=${String(this.filter === "attention")} @click=${() => { this.filter = "attention"; }}>Needs you <span>${cards.filter(({ session }) => session.needsAttention).length}</span></button>
            </div>
            <button class="new-session" type="button" @click=${(event: Event) => { void this.newSessionChooser?.openChooser(event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined); }}>New session</button>
          </div>
        </header>
        ${this.error === undefined ? nothing : html`<div class="notice error" role="alert">Could not refresh sessions: ${this.error} <button type="button" @click=${() => { void this.onRetry?.(); }}>Retry</button></div>`}
        ${this.selectionError === "" ? nothing : html`<div class="notice error" role="alert">Could not change selection: ${this.selectionError}</div>`}
        ${partial.length === 0 ? nothing : html`<div class="notice partial" role="status">${partial.map((outcome) => `${outcome.machine.name}: ${outcome.outcome}${outcome.error === undefined ? "" : ` — ${outcome.error}`}`).join(" · ")}</div>`}
        ${this.loading && this.dashboard === undefined ? html`<p class="state" role="status">Loading session dashboard…</p>` : visible.length === 0 ? html`<p class="state">${this.filter === "attention" ? "No sessions need your attention." : "No sessions are available yet."}</p>` : html`<div class="grid">${repeat(visible, ({ session, machineId }) => `${machineId}\u0000${session.id}`, ({ session, machineId, machineName, canRename }) => this.renderCard(session, machineId, machineName, canRename))}</div>`}
        <dashboard-new-session-chooser
          .projects=${this.projects}
          .selectedProjectId=${this.selectedProjectId}
          .selectedWorkspaceId=${this.selectedWorkspaceId}
          .loadWorkspaces=${this.loadWorkspaces}
          .onStart=${this.onStartNewSession}
        ></dashboard-new-session-chooser>
      </section>
    `;
  }

  private renderCard(session: LocalSessionDashboardSessionSummary, machineId: string, machineName: string, canRename: boolean) {
    const href = this.hrefForSession(session, machineId);
    const name = session.name?.trim();
    const firstMessage = session.firstMessage.trim();
    const label = name === undefined || name === "" ? (firstMessage === "" ? "Untitled session" : firstMessage) : name;
    const activity = activitySummary(session);
    const actionId = `dashboard-actions-${safeDomId(machineId)}-${safeDomId(session.id)}`;
    return html`
      <article class="card status-${session.displayStatus}">
        <div class="card-title-row">
          <h2><a href=${href} @click=${(event: MouseEvent) => { this.openSession(event, session, machineId); }}>${label}</a></h2>
          <span class="status" aria-label=${statusLabel(session.displayStatus)}>${statusMark(session.displayStatus)}<span>${statusLabel(session.displayStatus)}</span></span>
        </div>
        <p class="activity" title=${activity}>${activity}</p>
        <div class="card-footer">
          <dl class="primary-meta">
            <div><dt>Project</dt><dd>${nonEmpty(session.project.name, "Unknown project")}</dd></div>
            <div><dt>Workspace</dt><dd>${nonEmpty(session.workspace.label, nonEmpty(session.cwd, "Unknown workspace"))}</dd></div>
            <div><dt>Updated</dt><dd><time datetime=${session.modified}>${relativeTime(session.modified, this.now)}</time></dd></div>
          </dl>
          <details class="card-actions">
            <summary aria-controls=${actionId} aria-label=${`Actions for ${label}`}>Actions</summary>
            <div class="action-panel" id=${actionId}>
              <dl class="secondary-meta">
                <div><dt>Branch</dt><dd>${nonEmpty(session.workspace.branch, session.workspace.isMain ? "main" : "No branch")}</dd></div>
                <div><dt>Machine</dt><dd>${machineName}</dd></div>
              </dl>
              <div class="action-links">
                <a href=${href} @click=${(event: MouseEvent) => { this.openSession(event, session, machineId); }}>Open session</a>
                <button type="button" title=${canRename ? "Rename session" : "Update and restart Pi-Web on this machine to rename sessions."} ?disabled=${!canRename} @click=${(event: MouseEvent) => { this.renameSession(event, session, machineId, canRename); }}>Rename</button>
              </div>
              ${canRename ? nothing : html`<small>Update and restart Pi-Web on this machine to rename sessions.</small>`}
            </div>
          </details>
        </div>
      </article>
    `;
  }

  private renameSession(event: MouseEvent, session: LocalSessionDashboardSessionSummary, machineId: string, canRename: boolean): void {
    if (!canRename || !(event.currentTarget instanceof HTMLElement)) return;
    const details = event.currentTarget.closest("details");
    const opener = details?.querySelector("summary");
    details?.removeAttribute("open");
    this.onRenameSession?.(session, machineId, opener instanceof HTMLElement ? opener : event.currentTarget);
  }

  private openSession(event: MouseEvent, session: LocalSessionDashboardSessionSummary, machineId: string): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void this.onOpenSession?.(session, machineId);
  }

  static override styles = css`
    :host { display: block; min-width: 0; min-height: 0; overflow: auto; background: var(--pi-bg); color: var(--pi-text); font-family: Archivo, var(--pi-body-font-family, system-ui, sans-serif); }
    section { box-sizing: border-box; width: min(100%, 96rem); margin: 0 auto; padding: 2rem; }
    .dashboard-header, .dashboard-actions, .card-title-row, .card-footer, .action-links { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
    .dashboard-header { border-bottom: .125rem solid var(--pi-text); padding-bottom: 1rem; }
    .dashboard-heading { min-width: 0; }
    .eyebrow { margin: 0 0 .25rem; color: var(--pi-muted); font-size: .75rem; font-weight: 800; letter-spacing: .08em; }
    h1 { margin: 0; font-size: clamp(2rem, 4vw, 4rem); line-height: .95; letter-spacing: -.04em; } h1 span { color: var(--pi-accent); font-size: .5em; vertical-align: top; }
    .subtitle { margin: .5rem 0 0; color: var(--pi-text-secondary); }
    .dashboard-actions { flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; }
    .filters { display: flex; gap: .5rem; }
    .filters span { margin-left: .25rem; }
    button, a, summary { min-height: 2.75rem; border-radius: 0; font: inherit; font-weight: 700; }
    button, summary { box-sizing: border-box; border: .125rem solid var(--pi-text); background: transparent; color: var(--pi-text); padding: .5rem .75rem; cursor: pointer; }
    button:hover, button[aria-pressed="true"], summary:hover, details[open] summary { background: var(--pi-text); color: var(--pi-bg); }
    button:disabled { opacity: .6; cursor: not-allowed; }
    button:focus-visible, a:focus-visible, summary:focus-visible { outline: .1875rem solid var(--pi-accent); outline-offset: .1875rem; }
    .new-session { background: var(--pi-accent); border-color: var(--pi-accent); color: var(--pi-bg); } .new-session:hover { background: var(--pi-text); border-color: var(--pi-text); }
    .notice, .state { margin: 1rem 0; padding: .75rem; border: .125rem solid var(--pi-border); } .notice.error { border-color: var(--pi-text); border-width: .25rem; } .notice button { min-height: 2rem; margin-left: .5rem; } .partial { color: var(--pi-text-secondary); }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; padding: 1rem 0; }
    .card { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 14rem; border: .125rem solid var(--pi-border); border-top-color: var(--pi-text); padding: 1rem; background: var(--pi-surface); } .card.status-errored { border-width: .25rem; border-color: var(--pi-text); background: transparent; }
    .card-title-row { align-items: flex-start; }
    .status { flex: 0 0 auto; display: inline-flex; align-items: center; gap: .375rem; color: var(--pi-text); font-size: .75rem; font-weight: 800; text-transform: uppercase; } .status-mark { display: inline-grid; place-items: center; width: 1rem; height: 1rem; border: .125rem solid currentColor; } .status-running .status-mark { border-color: var(--pi-accent); border-right-color: transparent; animation: spin .8s linear infinite; } .status-waiting .status-mark { border-style: dashed; } .status-errored .status-mark { border-width: .1875rem; font-size: .875rem; }
    h2 { min-width: 0; margin: 0; font-size: 1.25rem; line-height: 1.15; overflow-wrap: anywhere; } h2 a, .action-panel a { color: inherit; text-decoration: none; } h2 a:hover, .action-panel a:hover { color: var(--pi-accent); text-decoration: underline; } .activity { min-width: 0; margin: .75rem 0 1rem; overflow: hidden; color: var(--pi-text-secondary); text-overflow: ellipsis; white-space: nowrap; }
    .card-footer { align-items: flex-end; margin-top: auto; border-top: .125rem solid var(--pi-border); padding-top: .75rem; }
    dl { margin: 0; } dl div { min-width: 0; } dt { color: var(--pi-muted); font-size: .6875rem; font-weight: 800; text-transform: uppercase; } dd { margin: .125rem 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .primary-meta { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: .75rem; }
    .primary-meta time { white-space: nowrap; }
    .card-actions { position: relative; flex: 0 0 auto; font-size: .8125rem; }
    .card-actions summary { min-height: 2rem; padding: .25rem .5rem; list-style: none; }
    .card-actions summary::-webkit-details-marker { display: none; }
    .action-panel { position: absolute; right: 0; bottom: calc(100% + .5rem); z-index: 2; box-sizing: border-box; width: min(19rem, calc(100vw - 3rem)); border: .125rem solid var(--pi-text); background: var(--pi-bg); color: var(--pi-text); padding: .75rem; box-shadow: .375rem .375rem 0 var(--pi-shadow-strong); }
    .secondary-meta { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: .75rem; border-bottom: .125rem solid var(--pi-border); padding-bottom: .75rem; }
    .action-links { justify-content: flex-start; margin-top: .75rem; }
    .action-links button { min-height: 2rem; padding: .25rem .5rem; }
    .action-panel small { display: block; margin-top: .5rem; color: var(--pi-muted); }
    @media (max-width: 73.75rem) { .dashboard-header { align-items: flex-start; } .dashboard-actions { max-width: 24rem; } .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .primary-meta { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .primary-meta div:last-child { grid-column: 1 / -1; } }
    @media (max-width: 47.9375rem) { section { padding: 1rem; } .dashboard-header, .dashboard-actions { align-items: stretch; flex-direction: column; } .dashboard-actions { width: 100%; max-width: none; } .filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); } .grid { grid-template-columns: minmax(0, 1fr); } .card-title-row { gap: .75rem; } .primary-meta { grid-template-columns: minmax(0, 1fr); } .primary-meta div:last-child { grid-column: auto; } }
    @media (pointer: coarse) { button, a, summary { min-height: 2.75rem; } } @media (prefers-reduced-motion: reduce) { .status-running .status-mark { animation: none; } } @keyframes spin { to { transform: rotate(360deg); } }
  `;
}

function statusLabel(status: LocalSessionDashboardSessionSummary["displayStatus"]): string { return status === "waiting" ? "Waiting for you" : status === "running" ? "Running" : status === "errored" ? "Error" : "Idle"; }
function statusMark(status: LocalSessionDashboardSessionSummary["displayStatus"]) { return html`<span class="status-mark" aria-hidden="true">${status === "waiting" ? "!" : status === "errored" ? "×" : nothing}</span>`; }
function activitySummary(session: LocalSessionDashboardSessionSummary): string { if (session.needsAttention) return "An extension needs your response."; if (session.displayStatus === "running") return "Work is in progress."; if (session.displayStatus === "errored") return "The latest activity ended with an error."; return nonEmpty(session.firstMessage.trim(), "No activity details are available."); }
function nonEmpty(value: string | undefined, fallback: string): string { return value === undefined || value === "" ? fallback : value; }
function safeDomId(value: string): string { return encodeURIComponent(value).replaceAll("%", "-"); }
export function relativeTime(timestamp: string, now: number): string { const date = new Date(timestamp); if (!Number.isFinite(date.getTime()) || !Number.isFinite(now)) return "Unknown time"; const seconds = Math.round((date.getTime() - now) / 1_000); const units: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31_536_000], ["month", 2_592_000], ["day", 86_400], ["hour", 3_600], ["minute", 60], ["second", 1]]; let selected: [Intl.RelativeTimeFormatUnit, number] = ["second", 1]; for (const candidate of units) { if (Math.abs(seconds) >= candidate[1]) { selected = candidate; break; } } return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(Math.round(seconds / selected[1]), selected[0]); }
