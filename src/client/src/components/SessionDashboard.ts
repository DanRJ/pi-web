import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { Project, Workspace } from "../api";
import type { FederatedSessionDashboardResponse, LocalSessionDashboardSessionSummary, SessionDashboardMachineOutcome } from "../../../shared/sessionDashboard";
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
    const cards = available.flatMap((outcome) => outcome.sessions.map((session) => ({ machineId: outcome.machine.id, machineName: outcome.machine.name, session })));
    const visible = this.filter === "attention" ? cards.filter(({ session }) => session.needsAttention) : cards;
    const partial = this.dashboard?.machines.filter((outcome) => outcome.outcome !== "available") ?? [];
    return html`
      <section aria-labelledby="dashboard-heading">
        <header>
          <div>
            <p class="eyebrow">SESSION DASHBOARD</p>
            <h1 id="dashboard-heading">Sessions <span aria-label="${String(cards.length)} sessions">${cards.length}</span></h1>
          </div>
          <button class="new-session" type="button" @click=${(event: Event) => { void this.newSessionChooser?.openChooser(event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined); }}>New session</button>
        </header>
        <div class="controls" aria-label="Dashboard filters">
          <div role="group" aria-label="Session filter">
            <button type="button" aria-pressed=${String(this.filter === "all")} @click=${() => { this.filter = "all"; }}>All <span>${cards.length}</span></button>
            <button type="button" aria-pressed=${String(this.filter === "attention")} @click=${() => { this.filter = "attention"; }}>Needs you <span>${cards.filter(({ session }) => session.needsAttention).length}</span></button>
          </div>
          <button class="refresh" type="button" ?disabled=${this.loading} @click=${() => { void this.onRetry?.(); }}>${this.loading ? "Refreshing…" : "Refresh"}</button>
        </div>
        ${this.error === undefined ? nothing : html`<div class="notice error" role="alert">Could not refresh sessions: ${this.error} <button type="button" @click=${() => { void this.onRetry?.(); }}>Retry</button></div>`}
        ${this.selectionError === "" ? nothing : html`<div class="notice error" role="alert">Could not change selection: ${this.selectionError}</div>`}
        ${partial.length === 0 ? nothing : html`<div class="notice partial" role="status">${partial.map((outcome) => `${outcome.machine.name}: ${outcome.outcome}${outcome.error === undefined ? "" : ` — ${outcome.error}`}`).join(" · ")}</div>`}
        ${this.loading && this.dashboard === undefined ? html`<p class="state" role="status">Loading session dashboard…</p>` : visible.length === 0 ? html`<p class="state">${this.filter === "attention" ? "No sessions need your attention." : "No sessions are available yet."}</p>` : html`<div class="grid">${visible.map(({ session, machineId, machineName }) => this.renderCard(session, machineId, machineName))}</div>`}
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

  private renderCard(session: LocalSessionDashboardSessionSummary, machineId: string, machineName: string) {
    const href = this.hrefForSession(session, machineId);
    const name = session.name?.trim();
    const firstMessage = session.firstMessage.trim();
    const label = name === undefined || name === "" ? (firstMessage === "" ? "Untitled session" : firstMessage) : name;
    return html`
      <article class="card status-${session.displayStatus}">
        <div class="card-top">
          <span class="status" aria-label=${statusLabel(session.displayStatus)}>${statusMark(session.displayStatus)}<span>${statusLabel(session.displayStatus)}</span></span>
          <time datetime=${session.modified}>${relativeTime(session.modified, this.now)}</time>
        </div>
        <h2><a href=${href} @click=${(event: MouseEvent) => { this.openSession(event, session, machineId); }}>${label}</a></h2>
        <p class="activity">${activitySummary(session)}</p>
        <dl>
          <div><dt>Project</dt><dd>${nonEmpty(session.project.name, "Unknown project")}</dd></div>
          <div><dt>Workspace</dt><dd>${nonEmpty(session.workspace.label, nonEmpty(session.cwd, "Unknown workspace"))}</dd></div>
          <div><dt>Branch</dt><dd>${nonEmpty(session.workspace.branch, session.workspace.isMain ? "main" : "No branch")}</dd></div>
          <div><dt>Machine</dt><dd>${machineName}</dd></div>
        </dl>
        <div class="card-actions"><a href=${href} @click=${(event: MouseEvent) => { this.openSession(event, session, machineId); }}>Open session</a><a href=${href} target="_blank" rel="noopener">Open in new tab</a></div>
      </article>
    `;
  }

  private openSession(event: MouseEvent, session: LocalSessionDashboardSessionSummary, machineId: string): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void this.onOpenSession?.(session, machineId);
  }

  static override styles = css`
    :host { display: block; min-width: 0; min-height: 0; overflow: auto; background: var(--pi-bg); color: var(--pi-text); font-family: Archivo, var(--pi-body-font-family, system-ui, sans-serif); }
    section { box-sizing: border-box; width: min(100%, 96rem); margin: 0 auto; padding: 2rem; }
    header, .controls, .card-top, .card-actions { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
    header { border-bottom: .125rem solid var(--pi-text); padding-bottom: 1rem; }
    .eyebrow { margin: 0 0 .25rem; color: var(--pi-muted); font-size: .75rem; font-weight: 800; letter-spacing: .08em; }
    h1 { margin: 0; font-size: clamp(2rem, 4vw, 4rem); line-height: .95; letter-spacing: -.04em; } h1 span { color: var(--pi-accent); font-size: .5em; vertical-align: top; }
    button, a { min-height: 2.75rem; border-radius: 0; font: inherit; font-weight: 700; } button { border: .125rem solid var(--pi-text); background: transparent; color: var(--pi-text); padding: .5rem .75rem; cursor: pointer; } button:hover, button[aria-pressed="true"] { background: var(--pi-text); color: var(--pi-bg); } button:disabled { opacity: .6; cursor: wait; } button:focus-visible, a:focus-visible { outline: .1875rem solid var(--pi-accent); outline-offset: .1875rem; }
    .new-session { background: var(--pi-accent); border-color: var(--pi-accent); color: var(--pi-bg); } .new-session:hover { background: var(--pi-text); border-color: var(--pi-text); }
    .controls { padding: 1rem 0; border-bottom: .125rem solid var(--pi-border); } .controls [role="group"] { display: flex; gap: .5rem; } .controls span { margin-left: .25rem; }
    .notice, .state { margin: 1rem 0; padding: .75rem; border: .125rem solid var(--pi-border); } .notice.error { border-color: var(--pi-text); border-width: .25rem; } .notice button { min-height: 2rem; margin-left: .5rem; } .partial { color: var(--pi-text-secondary); }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; padding: 1rem 0; }
    .card { display: flex; flex-direction: column; min-width: 0; min-height: 18rem; border: .125rem solid var(--pi-border); border-top-color: var(--pi-text); padding: 1rem; background: var(--pi-surface); } .card.status-errored { border-width: .25rem; border-color: var(--pi-text); background: transparent; }
    .card-top { color: var(--pi-muted); font-size: .75rem; } .status { display: inline-flex; align-items: center; gap: .375rem; color: var(--pi-text); font-weight: 800; text-transform: uppercase; } .status-mark { display: inline-grid; place-items: center; width: 1rem; height: 1rem; border: .125rem solid currentColor; } .status-running .status-mark { border-color: var(--pi-accent); border-right-color: transparent; animation: spin .8s linear infinite; } .status-waiting .status-mark { border-style: dashed; } .status-errored .status-mark { border-width: .1875rem; font-size: .875rem; }
    h2 { margin: 1.25rem 0 .5rem; font-size: 1.25rem; line-height: 1.15; overflow-wrap: anywhere; } h2 a, .card-actions a { color: inherit; text-decoration: none; } h2 a:hover, .card-actions a:hover { color: var(--pi-accent); text-decoration: underline; } .activity { min-height: 2.5rem; margin: 0 0 1rem; color: var(--pi-text-secondary); overflow-wrap: anywhere; }
    dl { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; margin: auto 0 1rem; border-top: .125rem solid var(--pi-border); padding-top: .75rem; } dl div { min-width: 0; } dt { color: var(--pi-muted); font-size: .6875rem; font-weight: 800; text-transform: uppercase; } dd { margin: .125rem 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .card-actions { justify-content: flex-start; flex-wrap: wrap; gap: .75rem; border-top: .125rem solid var(--pi-border); padding-top: .75rem; font-size: .8125rem; }
    @media (max-width: 70rem) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } } @media (max-width: 42rem) { section { padding: 1rem; } header { align-items: flex-start; flex-direction: column; } .grid { grid-template-columns: 1fr; } .controls { align-items: flex-start; flex-direction: column; } }
    @media (pointer: coarse) { button, a { min-height: 2.75rem; } } @media (prefers-reduced-motion: reduce) { .status-running .status-mark { animation: none; } } @keyframes spin { to { transform: rotate(360deg); } }
  `;
}

function statusLabel(status: LocalSessionDashboardSessionSummary["displayStatus"]): string { return status === "waiting" ? "Waiting for you" : status === "running" ? "Running" : status === "errored" ? "Error" : "Idle"; }
function statusMark(status: LocalSessionDashboardSessionSummary["displayStatus"]) { return html`<span class="status-mark" aria-hidden="true">${status === "waiting" ? "!" : status === "errored" ? "×" : nothing}</span>`; }
function activitySummary(session: LocalSessionDashboardSessionSummary): string { if (session.needsAttention) return "An extension needs your response."; if (session.displayStatus === "running") return "Work is in progress."; if (session.displayStatus === "errored") return "The latest activity ended with an error."; return nonEmpty(session.firstMessage.trim(), "No activity details are available."); }
function nonEmpty(value: string | undefined, fallback: string): string { return value === undefined || value === "" ? fallback : value; }
export function relativeTime(timestamp: string, now: number): string { const date = new Date(timestamp); if (!Number.isFinite(date.getTime()) || !Number.isFinite(now)) return "Unknown time"; const seconds = Math.round((date.getTime() - now) / 1_000); const units: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31_536_000], ["month", 2_592_000], ["day", 86_400], ["hour", 3_600], ["minute", 60], ["second", 1]]; let selected: [Intl.RelativeTimeFormatUnit, number] = ["second", 1]; for (const candidate of units) { if (Math.abs(seconds) >= candidate[1]) { selected = candidate; break; } } return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(Math.round(seconds / selected[1]), selected[0]); }
