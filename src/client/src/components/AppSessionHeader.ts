import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SessionActivity, SessionInfo, SessionStatus, Workspace } from "../api";
import { shortSessionId } from "../sessionLabels";

export type SessionShellStatus = "running" | "queued" | "error" | "idle";

export interface SessionShellStatusInfo {
  kind: SessionShellStatus;
  label: string;
  detail: string;
}

export function sessionShellStatus(status: SessionStatus | undefined, activity: SessionActivity | undefined): SessionShellStatusInfo {
  if (activity?.phase === "error") return { kind: "error", label: "Error", detail: activity.detail ?? activity.label };
  const pendingMessageCount = status?.pendingMessageCount ?? 0;
  if (status?.isStreaming === true || status?.isBashRunning === true || status?.isCompacting === true) {
    const activityDetail = activity?.detail ?? activity?.label ?? "Session is active";
    const queueDetail = pendingMessageCount > 0 ? `; ${String(pendingMessageCount)} message${pendingMessageCount === 1 ? "" : "s"} queued` : "";
    return { kind: "running", label: "Running", detail: `${activityDetail}${queueDetail}` };
  }
  if (pendingMessageCount > 0) return { kind: "queued", label: "Queued", detail: `${String(pendingMessageCount)} message${pendingMessageCount === 1 ? "" : "s"} queued` };
  return { kind: "idle", label: "Idle", detail: activity?.detail ?? activity?.label ?? "Session is idle" };
}

@customElement("app-session-header")
export class AppSessionHeader extends LitElement {
  @property({ attribute: false }) session?: SessionInfo;
  @property({ attribute: false }) workspace?: Workspace;
  @property({ attribute: false }) status?: SessionStatus;
  @property({ attribute: false }) activity?: SessionActivity;
  @property({ type: Boolean }) canStop = false;
  @property({ attribute: false }) onStop?: () => void;
  @property({ attribute: false }) onToggleTheme?: () => void;

  override render() {
    const session = this.session;
    if (session === undefined) return null;
    const shellStatus = sessionShellStatus(this.status, this.activity);
    const branch = this.workspace?.branch ?? this.workspace?.label;
    const model = this.status?.model?.name ?? this.status?.model?.id;
    return html`
      <header aria-label="Session controls">
        <div class="session-context">
          <strong title=${session.path}>${sessionLabel(session)}</strong>
          <span class="session-detail" title=${branch ?? "No workspace selected"}>${branch ?? "No workspace"}</span>
          <span class="session-detail">${model ?? "Model unavailable"}</span>
        </div>
        <div class="session-actions">
          <span class=${`status-badge ${shellStatus.kind}`} role="status" title=${shellStatus.detail} aria-label=${`${shellStatus.label}: ${shellStatus.detail}`}>
            ${statusIcon(shellStatus.kind)}<span>${shellStatus.label}</span>
          </span>
          ${this.canStop ? html`<button type="button" class="session-stop-control" aria-label="Stop session work" @click=${() => { this.onStop?.(); }}>Stop</button>` : null}
          <button type="button" class="theme-control" aria-label="Toggle light and dark theme" title="Toggle light and dark theme" @click=${() => { this.onToggleTheme?.(); }}>${themeIcon()}</button>
        </div>
      </header>
    `;
  }

  static override styles = css`
    :host { display: block; flex: 0 0 auto; color: var(--pi-text); font-family: var(--pi-body-font-family, system-ui, sans-serif); }
    header { display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-3, 0.75rem); min-width: 0; padding: var(--pi-space-3, 0.75rem) var(--pi-space-4, 1rem); border-bottom: var(--pi-divider-width, 1px) solid var(--pi-border-muted); background: var(--pi-bg); }
    .session-context, .session-actions { min-width: 0; display: flex; align-items: center; gap: var(--pi-space-2, 0.5rem); }
    .session-context { overflow: hidden; }
    strong { min-width: 0; overflow: hidden; font-family: var(--pi-heading-font-family, inherit); font-size: 0.9375rem; font-weight: var(--pi-heading-font-weight, 700); letter-spacing: -0.015em; text-overflow: ellipsis; white-space: nowrap; }
    .session-detail { min-width: 0; max-width: 16rem; overflow: hidden; border: 1px solid var(--pi-border-muted); color: var(--pi-muted); padding: 0.1875rem 0.5rem; font-size: 0.75rem; text-overflow: ellipsis; white-space: nowrap; }
    .status-badge { display: inline-flex; align-items: center; gap: 0.375rem; border: 1px solid var(--pi-text); color: var(--pi-text); padding: 0.1875rem 0.5rem; font-family: var(--pi-heading-font-family, inherit); font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; white-space: nowrap; }
    .status-badge.running { border-color: var(--pi-accent-border); background: var(--pi-accent); color: var(--pi-bg); }
    .status-badge.error { border-width: var(--pi-divider-width, 2px); }
    .status-icon { width: 0.75rem; height: 0.75rem; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .status-badge.running .status-icon { animation: spin 1s linear infinite; }
    button { display: inline-grid; place-items: center; min-width: 2.25rem; height: 2.25rem; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control, 0.5rem); background: var(--pi-surface); color: var(--pi-text); padding: 0.375rem; cursor: pointer; font: 600 0.75rem var(--pi-control-font-family, system-ui, sans-serif); }
    button:hover { background: var(--pi-surface-hover); }
    button:focus-visible { outline: var(--pi-focus-ring-width, 2px) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset, 2px); }
    .session-stop-control { padding-inline: 0.5625rem; white-space: nowrap; border-color: var(--pi-danger); color: var(--pi-danger); }
    svg { width: 1rem; height: 1rem; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .status-badge.running .status-icon { animation: none; } }
    @media (max-width: 760px) {
      header { padding: var(--pi-space-2, 0.5rem) var(--pi-space-3, 0.75rem); }
      .session-detail, .session-stop-control { display: none; }
    }
    @media (max-width: 430px) { .session-actions { gap: 0.25rem; } .status-badge { padding-inline: 0.375rem; } }
  `;
}

function sessionLabel(session: SessionInfo): string {
  const name = session.name?.trim();
  if (name !== undefined && name !== "") return name;
  const firstMessage = session.firstMessage.trim();
  return firstMessage !== "" ? firstMessage : shortSessionId(session.id);
}

function statusIcon(kind: SessionShellStatus) {
  if (kind === "error") return html`<svg class="status-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg>`;
  if (kind === "queued") return html`<svg class="status-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v4l3 2"></path><circle cx="12" cy="12" r="9"></circle></svg>`;
  if (kind === "idle") return html`<svg class="status-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v4l3 2"></path><circle cx="12" cy="12" r="9"></circle></svg>`;
  return html`<svg class="status-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"></path></svg>`;
}

function themeIcon() {
  return html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"></path></svg>`;
}
