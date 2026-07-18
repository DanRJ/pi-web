import { html, type TemplateResult } from "lit";
import type { GitDiffResponse, GitStatusResponse } from "../api";
import type { WorkspacePanelContext } from "../plugins/types";

/** Shared, read-only Git status and diff UI used by the legacy panel and workbench. */
export function renderWorkspaceGitStatus(context: WorkspacePanelContext, options: { showDiff?: boolean } = {}): TemplateResult {
  const status = context.gitStatus;
  const showDiff = options.showDiff ?? true;
  return html`
    <section class="git-review">
      <section class="toolbar">
        <strong>Git</strong>
        ${context.gitStale ? html`<span class="stale">stale</span>` : null}
        <button @click=${context.onRefreshGit}>Refresh</button>
      </section>
      <section class=${showDiff ? "split" : "split status-only"}>
        <div class="list">
          ${status === undefined ? html`<p class="muted">No status loaded.</p>` : !status.isGitRepo ? html`<p class="muted">Not a git repository.</p>` : html`
            <p class="summary">${workspaceGitSummary(status)}</p>
            ${status.files.length === 0 ? html`<p class="muted">No changes.</p>` : status.files.map((file) => html`
              <button class="row ${context.selectedDiffPath === file.path ? "selected" : ""}" @click=${() => { context.onSelectDiff(file.path); }}>
                <span>${workspaceGitStateLabel(file.index, file.workingTree)}</span>
                <span>${file.path}</span>
              </button>
            `)}
          `}
        </div>
        ${showDiff ? html`
          <div class="viewer">
            ${renderWorkspaceDiffViewer(context)}
          </div>
        ` : null}
      </section>
    </section>
  `;
}

export function renderWorkspaceDiffViewer(context: WorkspacePanelContext): TemplateResult {
  if (context.selectedDiffPath === undefined || context.selectedDiffPath === "") return html`<p class="muted">Select a changed file.</p>`;
  const unstaged = context.selectedDiff;
  const staged = context.selectedStagedDiff;
  if (unstaged === undefined || staged === undefined) return html`<p class="muted">Loading diff…</p>`;
  const diffs = [staged, unstaged].filter((diff) => diff.diff !== "");
  if (diffs.length === 0) return html`<p class="muted">No staged or unstaged diff.</p>`;
  return html`<div class=${diffs.length === 1 ? "diffs single" : "diffs"}>${diffs.map(renderWorkspaceDiffSection)}</div>`;
}

function renderWorkspaceDiffSection(diff: GitDiffResponse): TemplateResult {
  loadUnifiedDiffViewer();
  return html`
    <section class="diff-section">
      <div class="viewer-header"><strong>${diff.path ?? "diff"}</strong><small>${diff.staged ? "staged" : "unstaged"}${diff.truncated ? " · truncated" : ""}</small></div>
      <unified-diff-viewer .diff=${diff.diff}></unified-diff-viewer>
    </section>
  `;
}

export function workspaceGitSummary(status: GitStatusResponse): string {
  const branch = status.branch ?? "detached";
  const ahead = status.ahead ?? 0;
  const behind = status.behind ?? 0;
  return ahead === 0 && behind === 0 ? branch : `${branch} · ↑${String(ahead)} ↓${String(behind)}`;
}

function loadUnifiedDiffViewer(): void {
  void import("./UnifiedDiffViewer");
}

export function workspaceGitStateLabel(index: string, workingTree: string): string {
  const label = workingTree !== "unmodified" ? workingTree : index;
  return label.slice(0, 1).toUpperCase();
}
