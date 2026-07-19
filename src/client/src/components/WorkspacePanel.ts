import { LitElement, html, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { Workspace } from "../api";
import type { QualifiedContributionId, QualifiedWorkspacePanelContribution, WorkspacePanelContext } from "../plugins/types";
import { isCoreWorkspacePanelId, type CoreWorkspacePanelId } from "../plugins/core/workspacePanelIds";
import "./WorkspaceToolsWorkbench";
import type { WorkspaceToolsPresentation } from "./WorkspaceToolsWorkbench";
import { workspacePanelStyles } from "./shared";

export interface WorkspacePanelEmptyState {
  title: string;
  body?: string;
}

type WorkspacePanelBadge = string | number | TemplateResult | undefined;

export function selectedWorkspacePanel<T extends { id: QualifiedContributionId }>(panels: readonly T[], tool: QualifiedContributionId): T | undefined {
  return panels.find((panel) => panel.id === tool) ?? panels[0];
}

@customElement("workspace-panel")
export class WorkspacePanel extends LitElement {
  @property({ attribute: false }) workspace: Workspace | undefined;
  @property({ attribute: false }) panelContext: WorkspacePanelContext | undefined;
  @property({ attribute: false }) emptyState: WorkspacePanelEmptyState | undefined;
  @property() tool: QualifiedContributionId = "core:workspace.files";
  @property({ attribute: false }) panels: QualifiedWorkspacePanelContribution[] = [];
  @property({ type: Boolean }) hideToolTabs = false;
  @property({ type: Boolean, reflect: true }) mobileTools = false;
  /** Explicit app-shell/theme presentation, rather than a CSS-only theme guess. */
  @property() presentation: "legacy" | `modernist-${WorkspaceToolsPresentation}` = "legacy";
  @property({ attribute: false }) onSelectTool: (tool: QualifiedContributionId) => void = () => undefined;
  @query(".workspace-header-strip") private workspaceHeaderStrip?: HTMLElement | null;
  @state() private workspaceHeaderCanScrollLeft = false;
  @state() private workspaceHeaderCanScrollRight = false;

  private observedWorkspaceHeaderStrip: HTMLElement | undefined;
  private workspaceHeaderResizeObserver: ResizeObserver | undefined;
  private readonly onWorkspaceHeaderScroll = () => {
    this.updateWorkspaceHeaderScrollState();
  };

  override firstUpdated(): void {
    this.observeWorkspaceHeaderStrip();
    this.updateWorkspaceHeaderScrollState();
  }

  override updated(): void {
    this.observeWorkspaceHeaderStrip();
    this.updateWorkspaceHeaderScrollState();
  }

  override disconnectedCallback(): void {
    this.workspaceHeaderResizeObserver?.disconnect();
    this.workspaceHeaderResizeObserver = undefined;
    this.observedWorkspaceHeaderStrip = undefined;
    super.disconnectedCallback();
  }

  override render() {
    const workspace = this.workspace;
    if (workspace === undefined) return this.renderEmptyState(this.emptyState ?? {
      title: "Select a workspace",
      body: "Choose a workspace to inspect files, Git, or terminals.",
    });
    const context = this.panelContext;
    if (context === undefined) return this.renderEmptyState({
      title: "Workspace tools unavailable",
      body: "Try selecting the workspace again.",
    });
    const visiblePanels = this.panels;
    const selectedPanel = selectedWorkspacePanel(visiblePanels, this.tool);
    const activeCoreId = selectedPanel !== undefined && isCoreWorkspacePanelId(selectedPanel.id) ? selectedPanel.id : undefined;
    const workbenchPresentation = workspaceToolsPresentationFor(this.presentation);
    return html`
      ${this.hideToolTabs || visiblePanels.length < 2 ? null : this.renderToolTabs(visiblePanels, selectedPanel, context)}
      ${selectedPanel === undefined ? this.renderEmptyState({
        title: "No workspace tools available",
        body: "No tools are available for this workspace.",
      }) : html`
        <div class="panel-content">
          ${activeCoreId === undefined || workbenchPresentation === undefined
            ? selectedPanel.render(context)
            : html`<workspace-tools-workbench .context=${context} .presentation=${workbenchPresentation} .activeCoreId=${activeCoreId} .onSelectCore=${(id: CoreWorkspacePanelId) => { this.onSelectTool(id); }}></workspace-tools-workbench>`}
        </div>
      `}
    `;
  }

  private renderToolTabs(visiblePanels: readonly QualifiedWorkspacePanelContribution[], selectedPanel: QualifiedWorkspacePanelContribution | undefined, context: WorkspacePanelContext): TemplateResult {
    return html`
      <header>
        <div class=${this.workspaceHeaderFrameClass()}>
          <div class="workspace-header-strip" @scroll=${this.onWorkspaceHeaderScroll}>
            <div class="tabs" aria-label="Workspace tools">
              ${visiblePanels.map((panel) => {
                const selected = selectedPanel?.id === panel.id;
                const badge = panel.badge?.(context);
                const ariaLabel = this.panelTabAriaLabel(panel, badge);
                return html`
                  <button class=${this.panelTabClass(panel, selected)} data-panel-id=${panel.id} title=${ariaLabel} aria-label=${ariaLabel} aria-current=${selected ? "page" : "false"} @click=${() => { this.onSelectTool(panel.id); }} @keydown=${(event: KeyboardEvent) => { this.onPanelTabKeyDown(event, panel.id, visiblePanels); }}>
                    ${this.renderPanelTabContent(panel, badge)}
                  </button>
                `;
              })}
            </div>
          </div>
        </div>
      </header>
    `;
  }

  private onPanelTabKeyDown(event: KeyboardEvent, panelId: QualifiedContributionId, panels: readonly QualifiedWorkspacePanelContribution[]): void {
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const index = panels.findIndex((panel) => panel.id === panelId);
    const target = event.key === "Home" ? panels[0] : event.key === "End" ? panels[panels.length - 1] : direction === 0 ? undefined : panels[(index + direction + panels.length) % panels.length];
    if (target === undefined) return;
    event.preventDefault();
    this.onSelectTool(target.id);
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLButtonElement>(`button[aria-current="page"]`)?.focus();
    });
  }

  private panelTabClass(panel: QualifiedWorkspacePanelContribution, selected: boolean): string {
    return [
      ...(panel.icon === undefined ? [] : ["icon-tab"]),
      ...(selected ? ["selected"] : []),
    ].join(" ");
  }

  private panelTabAriaLabel(panel: QualifiedWorkspacePanelContribution, badge: WorkspacePanelBadge): string {
    if (typeof badge !== "string" && typeof badge !== "number") return panel.title;
    const trimmedBadge = String(badge).trim();
    return trimmedBadge === "" ? panel.title : `${panel.title}, ${trimmedBadge}`;
  }

  private renderPanelTabContent(panel: QualifiedWorkspacePanelContribution, badge: WorkspacePanelBadge): TemplateResult {
    return html`
      ${panel.icon === undefined ? null : html`<span class="tab-custom-icon" aria-hidden="true">${panel.icon}</span>`}
      <span class="tab-label">${panel.title}</span>
      ${this.isEmptyBadge(badge) ? null : html`<span class="tab-badge">${badge}</span>`}
    `;
  }

  private isEmptyBadge(badge: WorkspacePanelBadge): boolean {
    return badge === undefined || badge === "";
  }

  private renderEmptyState(state: WorkspacePanelEmptyState): TemplateResult {
    return html`
      <section class="empty-state" role="status">
        <h2>${state.title}</h2>
        ${state.body === undefined ? null : html`<p>${state.body}</p>`}
      </section>
    `;
  }

  private workspaceHeaderFrameClass(): string {
    return `workspace-header-scroll-frame${this.workspaceHeaderCanScrollLeft ? " can-scroll-left" : ""}${this.workspaceHeaderCanScrollRight ? " can-scroll-right" : ""}`;
  }

  private observeWorkspaceHeaderStrip(): void {
    const strip = this.workspaceHeaderStripElement();
    if (this.observedWorkspaceHeaderStrip === strip) return;
    this.workspaceHeaderResizeObserver?.disconnect();
    this.observedWorkspaceHeaderStrip = strip;
    this.workspaceHeaderResizeObserver = undefined;
    if (strip === undefined || typeof ResizeObserver === "undefined") return;
    this.workspaceHeaderResizeObserver = new ResizeObserver(() => {
      this.updateWorkspaceHeaderScrollState();
    });
    this.workspaceHeaderResizeObserver.observe(strip);
  }

  private updateWorkspaceHeaderScrollState(): void {
    const strip = this.workspaceHeaderStripElement();
    const maxScrollLeft = strip === undefined ? 0 : Math.max(0, strip.scrollWidth - strip.clientWidth);
    const canScrollLeft = strip !== undefined && strip.scrollLeft > 1;
    const canScrollRight = strip !== undefined && maxScrollLeft - strip.scrollLeft > 1;
    if (this.workspaceHeaderCanScrollLeft !== canScrollLeft) this.workspaceHeaderCanScrollLeft = canScrollLeft;
    if (this.workspaceHeaderCanScrollRight !== canScrollRight) this.workspaceHeaderCanScrollRight = canScrollRight;
  }

  private workspaceHeaderStripElement(): HTMLElement | undefined {
    const strip = this.workspaceHeaderStrip;
    return strip instanceof HTMLElement ? strip : undefined;
  }

  static override styles = workspacePanelStyles;
}

function workspaceToolsPresentationFor(presentation: WorkspacePanel["presentation"]): WorkspaceToolsPresentation | undefined {
  switch (presentation) {
    case "modernist-desktop": return "desktop";
    case "modernist-tablet": return "tablet";
    case "modernist-mobile": return "mobile";
    case "legacy": return undefined;
  }
}
