import { html, type TemplateResult } from "lit";
import { renderBuiltinTabIcon } from "../../components/tabIcons";
import { renderWorkspaceGitStatus } from "../../components/WorkspaceGitReview";
import "../../components/WorkspaceFilesPanel";
import type { WorkspacePanelContribution, WorkspacePanelContext } from "../types";
import { CORE_WORKSPACE_PANEL_LOCAL_IDS } from "./workspacePanelIds";

export function createCoreWorkspacePanels(): WorkspacePanelContribution[] {
  return [
    {
      id: CORE_WORKSPACE_PANEL_LOCAL_IDS.files,
      title: "Files",
      icon: renderBuiltinTabIcon("files"),
      order: 10,
      render: renderFiles,
    },
    {
      id: CORE_WORKSPACE_PANEL_LOCAL_IDS.git,
      title: "Git",
      icon: renderBuiltinTabIcon("git"),
      order: 20,
      visible: ({ workspace }) => workspace.isGitRepo,
      render: renderGit,
    },
    {
      id: CORE_WORKSPACE_PANEL_LOCAL_IDS.terminal,
      title: "Terminal",
      icon: renderBuiltinTabIcon("terminal"),
      order: 30,
      badge: (context) => context.activeTerminalCount > 0 ? context.activeTerminalCount : undefined,
      render: renderTerminal,
    },
  ];
}

function renderFiles(context: WorkspacePanelContext): TemplateResult {
  return html`<workspace-files-panel .context=${context}></workspace-files-panel>`;
}

function renderTerminal(context: WorkspacePanelContext): TemplateResult {
  loadTerminalPanel();
  return html`<terminal-panel .workspace=${context.workspace} .machineId=${context.machine.id} .selectedTerminalId=${context.selectedTerminalId} .autoStart=${context.terminalAutoStart} .onSelectTerminal=${context.onSelectTerminal}></terminal-panel>`;
}

function renderGit(context: WorkspacePanelContext): TemplateResult {
  return renderWorkspaceGitStatus(context);
}

function loadTerminalPanel(): void {
  void import("../../components/TerminalPanel");
}
