// @vitest-environment jsdom

import { html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileContentResponse } from "../api";
import type { WorkspaceUploadBatchState } from "../workspaceUploadState";
import { initialAppState } from "../appState";
import { CORE_WORKSPACE_PANEL_IDS, type CoreWorkspacePanelId } from "../plugins/core/workspacePanelIds";
import type { QualifiedWorkspacePanelContribution, WorkspacePanelContext } from "../plugins/types";
import { WorkspaceFilesPanel } from "./WorkspaceFilesPanel";
import { WorkspacePanel } from "./WorkspacePanel";
import "./UnifiedDiffViewer";
import { WorkspaceToolsWorkbench } from "./WorkspaceToolsWorkbench";

vi.mock("./TerminalPanel", () => ({}));

registerElement("workspace-tools-workbench", WorkspaceToolsWorkbench);
registerElement("workspace-panel", WorkspacePanel);

class FakeIntersectionObserver {
  observe(): void { return undefined; }
  disconnect(): void { return undefined; }
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("workspace tools workbench rendered boundaries", () => {
  it("does not mount a desktop terminal until Open terminal is explicitly chosen, then retains it across tool focus changes", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const onSelectCore = vi.fn();
    const workbench = createWorkbench(workspacePanelContext());
    workbench.onSelectCore = onSelectCore;
    document.body.append(workbench);
    await workbench.updateComplete;

    expect(workbench.shadowRoot?.querySelector("terminal-panel")).toBeNull();
    const openTerminal = workbench.shadowRoot?.querySelector<HTMLButtonElement>(".terminal-placeholder button");
    expect(openTerminal?.textContent).toBe("Open terminal");
    openTerminal?.click();
    await workbench.updateComplete;

    expect(onSelectCore).toHaveBeenCalledWith(CORE_WORKSPACE_PANEL_IDS.terminal);
    expect(workbench.shadowRoot?.querySelector("terminal-panel")).toBeTruthy();

    workbench.activeCoreId = CORE_WORKSPACE_PANEL_IDS.files;
    await workbench.updateComplete;
    expect(workbench.shadowRoot?.querySelector("terminal-panel")).toBeTruthy();
  });

  it("uses files as the latest review intent instead of a stale diff, including binary, image, and truncated previews", async () => {
    const staleDiff = "src/old.ts";
    const workbench = createWorkbench(workspacePanelContext({
      selectedDiffPath: staleDiff,
      selectedFilePath: "README.bin",
      selectedFileContent: fileContent({ path: "README.bin", binary: true, size: 2048 }),
    }));
    document.body.append(workbench);
    await workbench.updateComplete;
    await previewPanel(workbench)?.updateComplete;

    expect(workbench.shadowRoot?.querySelector(".preview-pane unified-diff-viewer")).toBeNull();
    expect(previewPanel(workbench)?.shadowRoot?.textContent).toContain("Binary file: README.bin · 2.0 KB");

    workbench.context = workspacePanelContext({
      selectedDiffPath: staleDiff,
      selectedFilePath: "diagram.png",
      selectedFileContent: fileContent({ path: "diagram.png", mediaType: "image", mimeType: "image/png" }),
    });
    await workbench.updateComplete;
    await previewPanel(workbench)?.updateComplete;
    expect(previewPanel(workbench)?.shadowRoot?.querySelector("img")?.getAttribute("alt")).toBe("diagram.png");

    workbench.context = workspacePanelContext({
      selectedDiffPath: staleDiff,
      selectedFilePath: "large.ts",
      selectedFileContent: fileContent({ path: "large.ts", truncated: true, content: "const value = 1;" }),
    });
    await workbench.updateComplete;
    await previewPanel(workbench)?.updateComplete;
    expect(previewPanel(workbench)?.shadowRoot?.textContent).toContain("text · truncated");
  });

  it("starts a deep-linked Git diff in Diff, then keeps a later file preview while Terminal is active", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const workbench = createWorkbench(workspacePanelContext({
      selectedDiffPath: "src/app.ts",
      selectedStagedDiff: { path: "src/app.ts", hash: "abc123", staged: true, truncated: false, diff: "-old\n+new" },
      selectedDiff: { path: "src/app.ts", hash: "abc123", staged: false, truncated: false, diff: "" },
    }), CORE_WORKSPACE_PANEL_IDS.git);
    document.body.append(workbench);
    await workbench.updateComplete;

    expect(workbench.shadowRoot?.querySelector(".preview-pane unified-diff-viewer")).toBeTruthy();
    workbench.activeCoreId = CORE_WORKSPACE_PANEL_IDS.files;
    workbench.context = workspacePanelContext({
      selectedDiffPath: "src/app.ts",
      selectedFilePath: "after-diff.bin",
      selectedFileContent: fileContent({ path: "after-diff.bin", binary: true }),
    });
    await workbench.updateComplete;
    await previewPanel(workbench)?.updateComplete;
    expect(previewPanel(workbench)?.shadowRoot?.textContent).toContain("Binary file: after-diff.bin");

    workbench.activeCoreId = CORE_WORKSPACE_PANEL_IDS.terminal;
    await workbench.updateComplete;
    expect(previewPanel(workbench)?.shadowRoot?.textContent).toContain("Binary file: after-diff.bin");
  });

  it("mounts a restored terminal deep link without waiting for a second activation", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const workbench = createWorkbench(workspacePanelContext({ selectedTerminalId: "terminal-1" }));
    document.body.append(workbench);
    await workbench.updateComplete;

    expect(workbench.shadowRoot?.querySelector("terminal-panel")).toBeTruthy();
    expect(workbench.shadowRoot?.querySelector(".terminal-placeholder")).toBeNull();
  });

  it("offers every compact core surface and sends Back from a diff to Git", async () => {
    const workbench = createWorkbench(workspacePanelContext({
      selectedDiffPath: "src/app.ts",
      selectedStagedDiff: { path: "src/app.ts", hash: "abc123", staged: true, truncated: false, diff: "-old\n+new" },
      selectedDiff: { path: "src/app.ts", hash: "abc123", staged: false, truncated: false, diff: "" },
    }), CORE_WORKSPACE_PANEL_IDS.git, "mobile");
    document.body.append(workbench);
    await workbench.updateComplete;

    const names = Array.from(workbench.shadowRoot?.querySelectorAll(".workbench-header nav button") ?? []).map((button) => button.textContent);
    expect(names).toEqual(["Files", "Preview", "Git", "Diff", "Terminal"]);
    expect(workbench.shadowRoot?.querySelector("[data-surface=diff]")).toBeTruthy();
    workbench.shadowRoot?.querySelector<HTMLButtonElement>(".workbench-header > button")?.click();
    await workbench.updateComplete;
    expect(workbench.shadowRoot?.querySelector("[data-surface=git]")).toBeTruthy();
  });

  it("renders controller errors once in expanded desktop and tablet workbenches", async () => {
    const desktop = createWorkbench(workspacePanelContext({ state: { ...initialAppState(), error: "Could not load files." } }));
    const tablet = createWorkbench(workspacePanelContext({ state: { ...initialAppState(), error: "Could not load Git status." } }), CORE_WORKSPACE_PANEL_IDS.git, "tablet");
    document.body.append(desktop, tablet);
    await Promise.all([desktop.updateComplete, tablet.updateComplete]);

    expect(desktop.shadowRoot?.querySelectorAll("[role=alert]")).toHaveLength(1);
    expect(desktop.shadowRoot?.querySelector("[role=alert]")?.textContent).toContain("Could not load files.");
    expect(tablet.shadowRoot?.querySelectorAll("[role=alert]")).toHaveLength(1);
    expect(tablet.shadowRoot?.querySelector("[role=alert]")?.textContent).toContain("Could not load Git status.");
  });

  it("keeps completed and failed uploads actionable after compact auto-selection switches to Preview", async () => {
    const onClearWorkspaceUpload = vi.fn();
    const workbench = createWorkbench(workspacePanelContext({ onClearWorkspaceUpload }), CORE_WORKSPACE_PANEL_IDS.files, "mobile");
    document.body.append(workbench);
    await workbench.updateComplete;
    expect(workbench.shadowRoot?.querySelector("[data-surface=files]")).toBeTruthy();

    workbench.context = workspacePanelContext({
      selectedFilePath: "uploaded.txt",
      selectedFileContent: fileContent({ path: "uploaded.txt", content: "done" }),
      onClearWorkspaceUpload,
      state: {
        ...initialAppState(),
        workspaceUploadBatches: {
          completed: uploadBatch({ id: "completed", status: "completed" }),
          failed: uploadBatch({ id: "failed", status: "error" }),
        },
      },
    });
    await workbench.updateComplete;
    const preview = workbench.shadowRoot?.querySelector<WorkspaceFilesPanel>("[data-surface=preview] workspace-files-panel");
    await preview?.updateComplete;

    expect(preview?.shadowRoot?.querySelectorAll(".upload-progress")).toHaveLength(1);
    expect(preview?.shadowRoot?.textContent).toContain("Uploaded 1 file");
    expect(preview?.shadowRoot?.textContent).toContain("Upload failed for 1 file");
    const dismiss = preview?.shadowRoot?.querySelector<HTMLButtonElement>(".upload-actions button");
    expect(dismiss?.textContent).toBe("Dismiss");
    dismiss?.click();
    expect(onClearWorkspaceUpload).toHaveBeenCalledWith("completed");
  });

  it("renders the Git toolbar above an independently scrollable status and diff column", async () => {
    const workbench = createWorkbench(workspacePanelContext({
      gitStatus: {
        isGitRepo: true,
        branch: "main",
        hash: "abc123",
        ahead: 0,
        behind: 0,
        files: [
          { path: "staged.ts", index: "modified", workingTree: "unmodified" },
          { path: "unstaged.ts", index: "unmodified", workingTree: "deleted" },
          { path: "renamed.ts", index: "renamed", workingTree: "unmodified" },
        ],
      },
    }));
    document.body.append(workbench);
    await workbench.updateComplete;

    const review = workbench.shadowRoot?.querySelector(".git-pane > .git-review");
    if (review === null || review === undefined) throw new Error("Expected rendered Git review");
    expect(review.children[0]?.className).toBe("toolbar");
    expect(review.children[1]?.className).toBe("split status-only");
    expect(Array.from(review.querySelectorAll(".row span:first-child")).map((element) => element.textContent)).toEqual(["M", "D", "R"]);
  });
});

describe("workspace-panel modernist boundary", () => {
  it("renders the no-workspace Tools empty state as a status", async () => {
    const panel = createRegisteredElement("workspace-panel", WorkspacePanel);
    document.body.append(panel);
    await panel.updateComplete;

    const emptyState = panel.shadowRoot?.querySelector<HTMLElement>(".empty-state[role=status]");
    expect(emptyState?.querySelector("h2")?.textContent).toBe("Select a workspace");
    expect(emptyState?.textContent).toContain("Choose a workspace to inspect files, Git, or terminals.");
  });

  it("keeps one tablet selector for registered core and plugin panels in registry order", async () => {
    const onSelectTool = vi.fn();
    const panels: QualifiedWorkspacePanelContribution[] = [
      { id: CORE_WORKSPACE_PANEL_IDS.files, pluginId: "core", localId: "workspace.files", title: "Files", order: 10, render: () => html`` },
      { id: "review:workspace.audit", pluginId: "review", localId: "workspace.audit", title: "Audit", order: 20, icon: html`<span>R</span>`, badge: () => 3, render: () => html`<article>Audit</article>` },
      { id: CORE_WORKSPACE_PANEL_IDS.git, pluginId: "core", localId: "workspace.git", title: "Git", order: 30, render: () => html`` },
      { id: CORE_WORKSPACE_PANEL_IDS.terminal, pluginId: "core", localId: "workspace.terminal", title: "Terminal", order: 40, render: () => html`` },
    ];
    const panel = createRegisteredElement("workspace-panel", WorkspacePanel);
    panel.workspace = workspacePanelContext().workspace;
    panel.panelContext = workspacePanelContext();
    panel.panels = panels;
    panel.tool = "review:workspace.audit";
    panel.presentation = "modernist-tablet";
    panel.onSelectTool = onSelectTool;
    document.body.append(panel);
    await panel.updateComplete;

    const tabs = Array.from(panel.shadowRoot?.querySelectorAll<HTMLButtonElement>(".tabs button") ?? []);
    expect(tabs.map((tab) => tab.dataset["panelId"])).toEqual(panels.map((panel) => panel.id));
    expect(tabs[1]?.getAttribute("aria-label")).toBe("Audit, 3");
    expect(tabs[1]?.querySelector(".tab-custom-icon")?.textContent).toBe("R");
    expect(panel.shadowRoot?.querySelector("workspace-tools-workbench")).toBeNull();

    tabs[0]?.click();
    expect(onSelectTool).toHaveBeenCalledWith(CORE_WORKSPACE_PANEL_IDS.files);
  });

  it("keeps legacy and plugin panels opaque while preserving tab order, badges, keyboard navigation, and fallback", async () => {
    const onSelectTool = vi.fn();
    const pluginPanel: QualifiedWorkspacePanelContribution = {
      id: "review:workspace.audit",
      pluginId: "review",
      localId: "workspace.audit",
      title: "Audit",
      order: 20,
      badge: () => 3,
      render: () => html`<article data-plugin-panel>Opaque plugin review</article>`,
    };
    const panels: QualifiedWorkspacePanelContribution[] = [
      { id: CORE_WORKSPACE_PANEL_IDS.files, pluginId: "core", localId: "workspace.files", title: "Files", order: 10, render: (context) => html`<workspace-files-panel .context=${context}></workspace-files-panel>` },
      pluginPanel,
      { id: CORE_WORKSPACE_PANEL_IDS.terminal, pluginId: "core", localId: "workspace.terminal", title: "Terminal", order: 30, render: () => html`<p>Terminal fallback</p>` },
    ];
    const panel = createRegisteredElement("workspace-panel", WorkspacePanel);
    panel.workspace = workspacePanelContext().workspace;
    panel.panelContext = workspacePanelContext();
    panel.panels = panels;
    panel.tool = "missing:workspace.tool";
    panel.presentation = "legacy";
    panel.onSelectTool = onSelectTool;
    document.body.append(panel);
    await panel.updateComplete;

    const root = panel.shadowRoot;
    if (root === null) throw new Error("Expected workspace panel shadow root");
    expect(root.querySelector("workspace-tools-workbench")).toBeNull();
    expect(root.querySelector("workspace-files-panel")).toBeTruthy();
    expect(Array.from(root.querySelectorAll(".tabs button")).map((button) => button.textContent.replace(/\s+/g, " ").trim())).toEqual(["Files", "Audit 3", "Terminal"]);

    panel.tool = pluginPanel.id;
    await panel.updateComplete;
    const pluginTab = Array.from(root.querySelectorAll<HTMLButtonElement>(".tabs button")).find((button) => button.textContent.includes("Audit"));
    expect(pluginTab?.getAttribute("aria-label")).toBe("Audit, 3");
    expect(root.querySelector("[data-plugin-panel]")?.textContent).toContain("Opaque plugin review");
    panel.presentation = "modernist-mobile";
    await panel.updateComplete;
    expect(root.querySelector("workspace-tools-workbench")).toBeNull();
    expect(root.querySelector("[data-plugin-panel]")?.textContent).toContain("Opaque plugin review");
    pluginTab?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(onSelectTool).toHaveBeenCalledWith(CORE_WORKSPACE_PANEL_IDS.terminal);
  });
});

function createWorkbench(context: WorkspacePanelContext, activeCoreId: CoreWorkspacePanelId = CORE_WORKSPACE_PANEL_IDS.files, presentation: WorkspaceToolsWorkbench["presentation"] = "desktop"): WorkspaceToolsWorkbench {
  const workbench = createRegisteredElement("workspace-tools-workbench", WorkspaceToolsWorkbench);
  workbench.presentation = presentation;
  workbench.context = context;
  workbench.activeCoreId = activeCoreId;
  return workbench;
}

function previewPanel(workbench: WorkspaceToolsWorkbench): WorkspaceFilesPanel | undefined {
  const panel = workbench.shadowRoot?.querySelector<WorkspaceFilesPanel>(".preview-pane workspace-files-panel");
  return panel ?? undefined;
}

function workspacePanelContext(patch: Partial<WorkspacePanelContext> = {}): WorkspacePanelContext {
  const workspace = patch.workspace ?? { id: "workspace-1", projectId: "project-1", path: "/tmp/project", label: "main", isMain: true, isGitRepo: true, isGitWorktree: false };
  return {
    machine: patch.machine ?? { id: "local", name: "Local", kind: "local" },
    workspace,
    state: patch.state ?? initialAppState(),
    files: patch.files ?? {
      readFile: vi.fn<WorkspacePanelContext["files"]["readFile"]>(() => Promise.reject(new Error("not implemented"))),
      writeFile: vi.fn<WorkspacePanelContext["files"]["writeFile"]>(() => Promise.reject(new Error("not implemented"))),
      deleteFile: vi.fn<WorkspacePanelContext["files"]["deleteFile"]>(() => Promise.reject(new Error("not implemented"))),
      moveFile: vi.fn<WorkspacePanelContext["files"]["moveFile"]>(() => Promise.reject(new Error("not implemented"))),
    },
    prompt: patch.prompt ?? { insertText: vi.fn(), send: vi.fn(), getText: vi.fn(() => ""), getSelection: vi.fn(() => null) },
    terminal: patch.terminal ?? { open: vi.fn(), runCommand: vi.fn(() => Promise.reject(new Error("not implemented"))) },
    host: patch.host ?? { requestRender: vi.fn() },
    fileTree: patch.fileTree ?? [],
    expandedDirs: patch.expandedDirs ?? {},
    selectedFilePath: patch.selectedFilePath,
    selectedFileContent: patch.selectedFileContent,
    fileTreeStale: patch.fileTreeStale ?? false,
    gitStatus: patch.gitStatus,
    selectedDiffPath: patch.selectedDiffPath,
    selectedDiff: patch.selectedDiff,
    selectedStagedDiff: patch.selectedStagedDiff,
    gitStale: patch.gitStale ?? false,
    activeTerminalCount: patch.activeTerminalCount ?? 0,
    selectedTerminalId: patch.selectedTerminalId,
    terminalAutoStart: patch.terminalAutoStart ?? false,
    workspaceUploadDefaultFolder: patch.workspaceUploadDefaultFolder ?? ".pi-web/uploads",
    onRefreshFiles: patch.onRefreshFiles ?? vi.fn(),
    onExpandDir: patch.onExpandDir ?? vi.fn(),
    onSelectFile: patch.onSelectFile ?? vi.fn(),
    onStartWorkspaceUpload: patch.onStartWorkspaceUpload ?? vi.fn(() => undefined),
    onCancelWorkspaceUpload: patch.onCancelWorkspaceUpload ?? vi.fn(),
    onClearWorkspaceUpload: patch.onClearWorkspaceUpload ?? vi.fn(),
    onRefreshGit: patch.onRefreshGit ?? vi.fn(),
    onSelectDiff: patch.onSelectDiff ?? vi.fn(),
    onSelectTerminal: patch.onSelectTerminal ?? vi.fn(),
  };
}

function uploadBatch(patch: Partial<WorkspaceUploadBatchState> = {}): WorkspaceUploadBatchState {
  return {
    id: patch.id ?? "batch-1",
    projectId: patch.projectId ?? "project-1",
    workspaceId: patch.workspaceId ?? "workspace-1",
    machineId: patch.machineId ?? "local",
    destinationFolder: patch.destinationFolder ?? ".pi-web/uploads",
    overwrite: patch.overwrite ?? false,
    createDirs: patch.createDirs ?? true,
    files: patch.files ?? [{ index: 0, name: "uploaded.txt", path: ".pi-web/uploads/uploaded.txt", size: 4, total: 4, loaded: 4, percent: 1, lengthComputable: true, status: patch.status === "error" ? "error" : "completed" }],
    currentFileIndex: patch.currentFileIndex ?? 0,
    loaded: patch.loaded ?? 4,
    total: patch.total ?? 4,
    percent: patch.percent ?? 1,
    status: patch.status ?? "completed",
    startedAt: patch.startedAt ?? "2026-07-14T00:00:00.000Z",
  };
}

function fileContent(patch: Partial<FileContentResponse> & Pick<FileContentResponse, "path">): FileContentResponse {
  return {
    path: patch.path,
    encoding: patch.encoding ?? "utf8",
    size: patch.size ?? 128,
    modifiedAt: patch.modifiedAt ?? "2026-07-14T00:00:00.000Z",
    content: patch.content ?? "",
    truncated: patch.truncated ?? false,
    binary: patch.binary ?? false,
    ...(patch.mediaType === undefined ? {} : { mediaType: patch.mediaType }),
    ...(patch.mimeType === undefined ? {} : { mimeType: patch.mimeType }),
    ...(patch.language === undefined ? {} : { language: patch.language }),
  };
}

function registerElement(name: string, elementType: CustomElementConstructor): void {
  if (customElements.get(name) === undefined) customElements.define(name, elementType);
}

function createRegisteredElement<T extends HTMLElement>(name: string, elementType: abstract new () => T): T {
  const element = document.createElement(name);
  if (!(element instanceof elementType)) throw new Error(`Expected ${name} to be registered`);
  return element;
}
