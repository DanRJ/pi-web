import type { QualifiedContributionId } from "../types";

/** Stable qualified IDs for PI WEB's built-in workspace tools. */
export const CORE_WORKSPACE_PANEL_IDS = {
  files: "core:workspace.files",
  git: "core:workspace.git",
  terminal: "core:workspace.terminal",
} as const;

/** Local contribution IDs; registration qualifies them to the stable IDs above. */
export const CORE_WORKSPACE_PANEL_LOCAL_IDS = {
  files: "workspace.files",
  git: "workspace.git",
  terminal: "workspace.terminal",
} as const;

export type CoreWorkspacePanelId = typeof CORE_WORKSPACE_PANEL_IDS[keyof typeof CORE_WORKSPACE_PANEL_IDS];

const coreWorkspacePanelIdSet: ReadonlySet<string> = new Set(Object.values(CORE_WORKSPACE_PANEL_IDS));

export function isCoreWorkspacePanelId(id: QualifiedContributionId): id is CoreWorkspacePanelId {
  return coreWorkspacePanelIdSet.has(id);
}

export function isCoreWorkspacePanel(panel: { id: QualifiedContributionId }): panel is { id: CoreWorkspacePanelId } {
  return isCoreWorkspacePanelId(panel.id);
}
