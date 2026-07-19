import { describe, expect, it } from "vitest";
import { CORE_WORKSPACE_PANEL_IDS, isCoreWorkspacePanel, isCoreWorkspacePanelId } from "../plugins/core/workspacePanelIds";
import { workspaceGitStateLabel, workspaceGitSummary } from "./WorkspaceGitReview";
import { workspaceToolsCompactSurface, WorkspaceToolsWorkbench } from "./WorkspaceToolsWorkbench";
import { appStyles, workspacePanelStyles } from "./shared";

describe("Modernist workspace workbench", () => {
  it("keeps the registered core panel IDs stable and distinguishes plugin panels", () => {
    expect(CORE_WORKSPACE_PANEL_IDS).toEqual({
      files: "core:workspace.files",
      git: "core:workspace.git",
      terminal: "core:workspace.terminal",
    });
    expect(isCoreWorkspacePanelId("core:workspace.terminal")).toBe(true);
    expect(isCoreWorkspacePanelId("review:workspace.audit")).toBe(false);
    expect(isCoreWorkspacePanel({ id: "core:workspace.files" })).toBe(true);
    expect(isCoreWorkspacePanel({ id: "review:workspace.audit" })).toBe(false);
  });

  it("uses deep-linked file and diff selections as compact detail surfaces", () => {
    expect(workspaceToolsCompactSurface(CORE_WORKSPACE_PANEL_IDS.files, { selectedFilePath: "src/app.ts", selectedDiffPath: undefined }, true)).toBe("preview");
    expect(workspaceToolsCompactSurface(CORE_WORKSPACE_PANEL_IDS.git, { selectedFilePath: undefined, selectedDiffPath: "src/app.ts" }, true)).toBe("diff");
    expect(workspaceToolsCompactSurface(CORE_WORKSPACE_PANEL_IDS.terminal, { selectedFilePath: "src/app.ts", selectedDiffPath: "src/app.ts" }, true)).toBe("terminal");
    expect(workspaceToolsCompactSurface(CORE_WORKSPACE_PANEL_IDS.files, { selectedFilePath: "src/app.ts", selectedDiffPath: undefined }, false)).toBe("files");
  });

  it("keeps desktop, tablet, and compact structural boundaries explicit", () => {
    const workbenchStyles = WorkspaceToolsWorkbench.styles;
    const cssText = (Array.isArray(workbenchStyles) ? workbenchStyles : [workbenchStyles]).map((style) => style.cssText).join("\n");
    expect(cssText).toContain("grid-template-columns: 15rem minmax(0, 1fr) 23.75rem");
    expect(cssText).toContain(".tablet { display: grid");
    expect(cssText).toContain("@media (pointer: coarse)");
    expect(appStyles.cssText).toContain(".shell.modernist-tools-expanded");
    expect(appStyles.cssText).toContain("workspace-panel { grid-column: 3; grid-row: 1; }");
    expect(workspacePanelStyles.cssText).toContain(":host([presentation=\"modernist-tablet\"]) header { display: block; }");
    expect(workspacePanelStyles.cssText).toContain(".split.status-only { grid-template-rows: minmax(0, 1fr); }");
  });

  it("retains staged/unstaged status wording and ahead/behind branch summary", () => {
    expect(workspaceGitStateLabel("modified", "unmodified")).toBe("M");
    expect(workspaceGitStateLabel("modified", "renamed")).toBe("R");
    expect(workspaceGitSummary({ isGitRepo: true, files: [], branch: "main", hash: "abc123", ahead: 2, behind: 1 })).toBe("main · ↑2 ↓1");
  });
});
