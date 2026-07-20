import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { WorkspacePanelContext } from "../plugins/types";
import { CORE_WORKSPACE_PANEL_IDS, type CoreWorkspacePanelId } from "../plugins/core/workspacePanelIds";
import { renderWorkspaceDiffViewer, renderWorkspaceGitStatus } from "./WorkspaceGitReview";
import "./WorkspaceFilesPanel";
import { workspacePanelStyles } from "./shared";

export type WorkspaceToolsPresentation = "desktop" | "tablet" | "mobile";
export type CompactSurface = "files" | "preview" | "terminal" | "git" | "diff";
type WorkspaceReviewIntent = "files" | "git";

/**
 * The Modernist composition only consumes a panel context. It deliberately owns
 * no transport: file, Git, terminal, and route effects remain at existing
 * controller boundaries.
 */
@customElement("workspace-tools-workbench")
export class WorkspaceToolsWorkbench extends LitElement {
  @property({ attribute: false }) context: WorkspacePanelContext | undefined;
  @property() presentation: WorkspaceToolsPresentation = "desktop";
  @property() activeCoreId: CoreWorkspacePanelId = CORE_WORKSPACE_PANEL_IDS.files;
  @property({ attribute: false }) onSelectCore: (id: CoreWorkspacePanelId) => void = () => undefined;
  @state() private compactDetail = false;
  @state() private compactSurfaceOverride: CompactSurface | undefined;
  @state() private terminalActivated = false;
  private reviewIntent: WorkspaceReviewIntent = "files";
  private observedFilePath: string | undefined;
  private observedDiffPath: string | undefined;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("context") && !changed.has("activeCoreId")) return;
    const context = this.context;
    const filePath = context?.selectedFilePath;
    const diffPath = context?.selectedDiffPath;
    const fileChanged = filePath !== this.observedFilePath;
    const diffChanged = diffPath !== this.observedDiffPath;
    this.reviewIntent = workspaceReviewIntent(
      this.activeCoreId,
      this.reviewIntent,
      { fileChanged, diffChanged, hasFile: hasSelection(filePath), hasDiff: hasSelection(diffPath) },
      changed.has("activeCoreId"),
    );
    if (this.activeCoreId === CORE_WORKSPACE_PANEL_IDS.terminal || context?.selectedTerminalId !== undefined || context?.terminalAutoStart === true) {
      this.terminalActivated = true;
    }
    if (this.presentation === "mobile" && (fileChanged || diffChanged)) {
      if (this.activeCoreId === CORE_WORKSPACE_PANEL_IDS.files && hasSelection(filePath)) this.compactDetail = true;
      if (this.activeCoreId === CORE_WORKSPACE_PANEL_IDS.git && hasSelection(diffPath)) this.compactDetail = true;
      if (fileChanged || diffChanged) this.compactSurfaceOverride = undefined;
    }
    this.observedFilePath = filePath;
    this.observedDiffPath = diffPath;
  }

  override render(): TemplateResult {
    const context = this.context;
    if (context === undefined) return html`<p class="muted">Workspace tools unavailable.</p>`;
    if (this.presentation === "desktop") return this.renderDesktop(context);
    if (this.presentation === "tablet") return this.renderTablet(context);
    return this.renderCompact(context);
  }

  private renderDesktop(context: WorkspacePanelContext): TemplateResult {
    return html`
      <section class="workbench" aria-label="Workspace tools" data-focus-intent=${this.activeCoreId}>
        ${this.renderWorkbenchError(context)}
        <div class="desktop">
          <section class="workbench-pane files-pane" aria-label="Files">
            <workspace-files-panel view="tree" .context=${context}></workspace-files-panel>
          </section>
          <section class="workbench-center" aria-label="Preview and terminal">
            <section class="workbench-pane preview-pane" aria-label="Read-only preview">
              ${this.renderPreviewOrDiff(context, false)}
            </section>
            <section class="workbench-pane terminal-pane" aria-label="Terminal">
              ${this.renderDesktopTerminal(context)}
            </section>
          </section>
          <section class="workbench-pane git-pane" aria-label="Git status">
            ${renderWorkspaceGitStatus(context, { showDiff: false })}
          </section>
        </div>
      </section>
    `;
  }

  private renderTablet(context: WorkspacePanelContext): TemplateResult {
    const utilityIsTerminal = this.activeCoreId === CORE_WORKSPACE_PANEL_IDS.terminal;
    const reviewIsGit = this.reviewIntent === "git";
    return html`
      <section class="workbench" aria-label="Workspace tools" data-focus-intent=${this.activeCoreId}>
        ${this.renderWorkbenchError(context)}
        <div class="tablet">
          <section class="workbench-pane utility-pane" aria-label=${utilityIsTerminal ? "Terminal" : "Files"}>
            ${utilityIsTerminal
              ? this.renderVisibleTerminal(context)
              : html`<workspace-files-panel view="tree" .context=${context}></workspace-files-panel>`}
          </section>
          <section class="workbench-pane review-pane" aria-label=${reviewIsGit ? "Git review" : "Read-only preview"}>
            ${reviewIsGit ? renderWorkspaceGitStatus(context, { showDiff: false }) : this.renderPreviewOrDiff(context, utilityIsTerminal)}
          </section>
        </div>
      </section>
    `;
  }

  private renderCompact(context: WorkspacePanelContext): TemplateResult {
    const surface = this.compactSurfaceOverride ?? workspaceToolsCompactSurface(this.activeCoreId, context, this.compactDetail);
    return html`
      <section class="workbench compact" aria-label="Workspace tools" data-surface=${surface}>
        <header class="workbench-header">
          ${surface === "preview" || surface === "diff" ? html`<button @click=${() => { this.backFromDetail(surface); }}>Back</button>` : null}
          <strong>${compactSurfaceTitle(surface)}</strong>
          <nav aria-label="Workspace tool region">
            ${this.renderCompactSurfaceTab("Files", "files")}
            ${this.renderCompactSurfaceTab("Preview", "preview")}
            ${context.workspace.isGitRepo ? this.renderCompactSurfaceTab("Git", "git") : null}
            ${context.workspace.isGitRepo ? this.renderCompactSurfaceTab("Diff", "diff") : null}
            ${this.renderCompactSurfaceTab("Terminal", "terminal")}
          </nav>
        </header>
        <section class="workbench-pane compact-pane">
          ${this.renderCompactSurface(context, surface)}
        </section>
      </section>
    `;
  }

  private renderCompactSurfaceTab(title: string, surface: CompactSurface): TemplateResult {
    const active = (this.compactSurfaceOverride ?? workspaceToolsCompactSurface(this.activeCoreId, this.context ?? { selectedFilePath: undefined, selectedDiffPath: undefined }, this.compactDetail)) === surface;
    return html`<button class=${active ? "selected" : ""} aria-current=${active ? "page" : "false"} @click=${() => { this.selectCompactSurface(surface); }}>${title}</button>`;
  }

  private renderCompactSurface(context: WorkspacePanelContext, surface: CompactSurface): TemplateResult {
    switch (surface) {
      case "files": return html`<workspace-files-panel view="tree" .context=${context}></workspace-files-panel>`;
      case "preview": return html`<workspace-files-panel view="preview" .context=${context}></workspace-files-panel>`;
      case "terminal": return this.renderVisibleTerminal(context);
      case "git": return renderWorkspaceGitStatus(context, { showDiff: false });
      case "diff": return renderWorkspaceDiffViewer(context);
    }
  }

  private renderPreviewOrDiff(context: WorkspacePanelContext, showUploadStatus = true): TemplateResult {
    return this.reviewIntent === "git"
      ? renderWorkspaceDiffViewer(context)
      : html`<workspace-files-panel view="preview" .showUploadStatus=${showUploadStatus} .context=${context}></workspace-files-panel>`;
  }

  private renderWorkbenchError(context: WorkspacePanelContext): TemplateResult | null {
    const error = context.state.error;
    return error === "" ? null : html`<div class="workbench-error" role="alert">${error}</div>`;
  }

  private renderDesktopTerminal(context: WorkspacePanelContext): TemplateResult {
    return this.terminalActivated ? this.renderTerminal(context) : this.renderTerminalPlaceholder();
  }

  private renderVisibleTerminal(context: WorkspacePanelContext): TemplateResult {
    return this.terminalActivated ? this.renderTerminal(context) : this.renderTerminalPlaceholder();
  }

  private renderTerminalPlaceholder(): TemplateResult {
    return html`<section class="terminal-placeholder"><p class="muted">Terminal is not open.</p><button @click=${this.openTerminal}>Open terminal</button></section>`;
  }

  private renderTerminal(context: WorkspacePanelContext): TemplateResult {
    // This is the lazy boundary: importing and mounting the terminal starts its
    // browser lifecycle only after a user or restored route activates it.
    void import("./TerminalPanel");
    return html`<terminal-panel .workspace=${context.workspace} .machineId=${context.machine.id} .selectedTerminalId=${context.selectedTerminalId} .autoStart=${context.terminalAutoStart} .onSelectTerminal=${context.onSelectTerminal}></terminal-panel>`;
  }

  private backFromDetail(surface: "preview" | "diff"): void {
    this.compactDetail = false;
    this.compactSurfaceOverride = surface === "diff" ? "git" : "files";
    this.selectCore(surface === "diff" ? CORE_WORKSPACE_PANEL_IDS.git : CORE_WORKSPACE_PANEL_IDS.files);
  }

  private selectCompactSurface(surface: CompactSurface): void {
    this.compactDetail = false;
    this.compactSurfaceOverride = surface;
    if (surface === "terminal") this.terminalActivated = true;
    this.selectCore(surface === "terminal" ? CORE_WORKSPACE_PANEL_IDS.terminal : surface === "git" || surface === "diff" ? CORE_WORKSPACE_PANEL_IDS.git : CORE_WORKSPACE_PANEL_IDS.files);
  }

  private readonly openTerminal = (): void => {
    this.terminalActivated = true;
    this.selectCore(CORE_WORKSPACE_PANEL_IDS.terminal);
  };

  private selectCore(id: CoreWorkspacePanelId): void {
    this.compactDetail = false;
    if (id === CORE_WORKSPACE_PANEL_IDS.terminal) this.terminalActivated = true;
    this.onSelectCore(id);
  }

  static override styles = [workspacePanelStyles, css`
    :host { flex: 1 1 auto; min-height: 0; display: flex; }
    .workbench { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
    .desktop, .tablet { flex: 1 1 auto; min-width: 0; min-height: 0; }
    .desktop { display: grid; grid-template-columns: 15rem minmax(0, 1fr) 23.75rem; }
    .tablet { display: grid; grid-template-columns: minmax(14rem, .9fr) minmax(0, 1.3fr); }
    .tablet .review-pane { border-right: 0; }
    .workbench-pane, .workbench-center { min-width: 0; min-height: 0; display: flex; overflow: hidden; }
    .workbench-pane { border-right: var(--pi-divider-width, 2px) solid var(--pi-border); }
    .git-pane { border-right: 0; }
    .workbench-center { flex-direction: column; }
    .preview-pane { flex: 1 1 auto; min-height: 0; border-right: 0; border-bottom: var(--pi-divider-width, 2px) solid var(--pi-border); }
    .terminal-pane { flex: 0 0 auto; height: 16.25rem; min-height: 0; border-right: 0; border-bottom: 0; }
    .workbench-error { flex: 0 0 auto; padding: .5rem .75rem; border-bottom: var(--pi-divider-width, 2px) solid var(--pi-border); color: var(--pi-danger); }
    .terminal-placeholder { flex: 1 1 auto; min-height: 0; display: grid; place-content: center; justify-items: center; gap: .5rem; text-align: center; }
    .terminal-placeholder p { margin: 0; }
    .compact { display: flex; flex-direction: column; }
    .workbench-header { flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; padding: .5rem; border-bottom: var(--pi-divider-width, 2px) solid var(--pi-border); }
    .workbench-header nav { display: flex; gap: .35rem; max-width: 100%; margin-left: auto; overflow-x: auto; }
    .compact-pane { flex: 1 1 auto; border-right: 0; }
    @media (pointer: coarse) { .workbench-header button { min-height: 2.75rem; } }
    @media (prefers-reduced-motion: reduce) { * { transition: none; } }
  `];
}

export function workspaceToolsCompactSurface(activeCoreId: CoreWorkspacePanelId, context: Pick<WorkspacePanelContext, "selectedFilePath" | "selectedDiffPath">, detail: boolean): CompactSurface {
  if (activeCoreId === CORE_WORKSPACE_PANEL_IDS.terminal) return "terminal";
  if (activeCoreId === CORE_WORKSPACE_PANEL_IDS.git) return detail && hasSelection(context.selectedDiffPath) ? "diff" : "git";
  return detail && hasSelection(context.selectedFilePath) ? "preview" : "files";
}

export function workspaceReviewIntent(
  activeCoreId: CoreWorkspacePanelId,
  previousIntent: WorkspaceReviewIntent,
  selection: { fileChanged: boolean; diffChanged: boolean; hasFile: boolean; hasDiff: boolean },
  activeCoreChanged: boolean,
): WorkspaceReviewIntent {
  if (activeCoreChanged && activeCoreId === CORE_WORKSPACE_PANEL_IDS.files) return "files";
  if (activeCoreChanged && activeCoreId === CORE_WORKSPACE_PANEL_IDS.git) return "git";
  if (selection.fileChanged && !selection.diffChanged) return "files";
  if (selection.diffChanged && !selection.fileChanged) return "git";
  if (selection.fileChanged && selection.diffChanged) {
    if (activeCoreId === CORE_WORKSPACE_PANEL_IDS.files) return "files";
    if (activeCoreId === CORE_WORKSPACE_PANEL_IDS.git) return "git";
    if (selection.hasFile !== selection.hasDiff) return selection.hasFile ? "files" : "git";
  }
  return previousIntent;
}

function hasSelection(path: string | undefined): boolean {
  return path !== undefined && path !== "";
}

function compactSurfaceTitle(surface: CompactSurface): string {
  switch (surface) {
    case "files": return "Files";
    case "preview": return "Preview";
    case "terminal": return "Terminal";
    case "git": return "Git";
    case "diff": return "Diff";
  }
}
