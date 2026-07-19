import { afterEach, describe, expect, it, vi } from "vitest";
import { terminalsApi, type TerminalCommandRun, type TerminalInfo, type Workspace } from "../api";
import { TerminalPanel } from "./TerminalPanel";

const workspaceA = workspace("a");
const workspaceB = { ...workspace("b"), path: workspaceA.path };
const terminalB = terminal("terminal-b", workspaceB.path);

// Direct method calls keep these async state-transition tests independent of xterm and browser layout APIs.
describe("TerminalPanel workspace loading", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not let an older workspace response replace the current terminals or trigger auto-start", async () => {
    const oldTerminals = deferred<TerminalInfo[]>();
    const oldCommandRuns = deferred<TerminalCommandRun[]>();
    vi.spyOn(terminalsApi, "terminals").mockImplementation((projectId) => (
      projectId === workspaceA.projectId ? oldTerminals.promise : Promise.resolve([terminalB])
    ));
    vi.spyOn(terminalsApi, "listCommandRuns").mockImplementation((filter) => (
      filter?.projectId === workspaceA.projectId ? oldCommandRuns.promise : Promise.resolve([])
    ));
    const startTerminal = vi.spyOn(terminalsApi, "startTerminal");
    const panel = createPanel(workspaceA);
    panel.autoStart = true;

    const oldLoad = callAsync(panel, "loadTerminals");
    changeWorkspace(panel, workspaceB);
    await callAsync(panel, "loadTerminals");

    oldTerminals.resolve([]);
    oldCommandRuns.resolve([]);
    await oldLoad;

    expect(Reflect.get(panel, "terminals")).toEqual([terminalB]);
    expect(Reflect.get(panel, "error")).toBeUndefined();
    expect(Reflect.get(panel, "loading")).toBe(false);
    expect(startTerminal).not.toHaveBeenCalled();
  });

  it("does not apply an auto-start result after leaving its workspace", async () => {
    const startedTerminal = deferred<TerminalInfo>();
    vi.spyOn(terminalsApi, "terminals").mockResolvedValue([]);
    vi.spyOn(terminalsApi, "listCommandRuns").mockResolvedValue([]);
    const startTerminal = vi.spyOn(terminalsApi, "startTerminal").mockReturnValue(startedTerminal.promise);
    const panel = createPanel(workspaceA);
    panel.autoStart = true;

    const oldLoad = callAsync(panel, "loadTerminals");
    await vi.waitFor(() => {
      expect(startTerminal).toHaveBeenCalledWith(workspaceA.projectId, workspaceA.id, expect.any(Object), "local");
    });

    changeWorkspace(panel, workspaceB);
    startedTerminal.resolve(terminal("terminal-a", workspaceA.path));
    await oldLoad;

    expect(Reflect.get(panel, "terminals")).toEqual([]);
    expect(panel.onSelectTerminal).not.toHaveBeenCalled();
    expect(Reflect.get(panel, "error")).toBeUndefined();
  });

  it("ignores an error from a superseded workspace load", async () => {
    const oldTerminals = deferred<TerminalInfo[]>();
    vi.spyOn(terminalsApi, "terminals").mockImplementation((projectId) => (
      projectId === workspaceA.projectId ? oldTerminals.promise : Promise.resolve([terminalB])
    ));
    vi.spyOn(terminalsApi, "listCommandRuns").mockResolvedValue([]);
    const panel = createPanel(workspaceA);

    const oldLoad = callAsync(panel, "loadTerminals");
    changeWorkspace(panel, workspaceB);
    await callAsync(panel, "loadTerminals");

    oldTerminals.reject(new Error("old workspace offline"));
    await oldLoad;

    expect(Reflect.get(panel, "terminals")).toEqual([terminalB]);
    expect(Reflect.get(panel, "error")).toBeUndefined();
    expect(Reflect.get(panel, "loading")).toBe(false);
  });

  it("ignores command-run polling results after switching machines", async () => {
    const oldCommandRuns = deferred<TerminalCommandRun[]>();
    vi.spyOn(terminalsApi, "listCommandRuns").mockReturnValue(oldCommandRuns.promise);
    const panel = createPanel(workspaceA);

    const oldPoll = callAsync(panel, "loadCommandRuns");
    panel.machineId = "remote";
    callVoid(panel, "willUpdate", new Map());

    oldCommandRuns.resolve([commandRun("run-a", workspaceA)]);
    await oldPoll;

    expect(Reflect.get(panel, "commandRuns")).toEqual([]);
    expect(Reflect.get(panel, "error")).toBeUndefined();
    expect(Reflect.get(panel, "commandRunPollTimer")).toBeUndefined();
  });
});

function createPanel(initialWorkspace: Workspace): TerminalPanel {
  const panel = new TerminalPanel();
  panel.workspace = initialWorkspace;
  panel.onSelectTerminal = vi.fn();
  Reflect.set(panel, "measureTerminalSize", () => undefined);
  callVoid(panel, "willUpdate", new Map());
  return panel;
}

function changeWorkspace(panel: TerminalPanel, nextWorkspace: Workspace): void {
  panel.workspace = nextWorkspace;
  callVoid(panel, "willUpdate", new Map());
}

function workspace(id: string): Workspace {
  return {
    id: `workspace-${id}`,
    projectId: `project-${id}`,
    path: `/repo/${id}`,
    label: id,
    isMain: id === "a",
    isGitRepo: true,
    isGitWorktree: id !== "a",
  };
}

function terminal(id: string, cwd: string): TerminalInfo {
  return { id, cwd, name: id, createdAt: "2026-07-19T00:00:00.000Z", exited: false };
}

function commandRun(id: string, targetWorkspace: Workspace): TerminalCommandRun {
  return {
    id,
    origin: "core",
    projectId: targetWorkspace.projectId,
    workspaceId: targetWorkspace.id,
    terminalId: "terminal-a",
    title: "Test",
    command: "npm test",
    status: "running",
    createdAt: "2026-07-19T00:00:00.000Z",
    metadata: {},
  };
}

interface CallableMethod {
  call(thisArg: object, ...args: unknown[]): unknown;
}

function callAsync(target: object, name: string, ...args: unknown[]): Promise<void> {
  return Promise.resolve(callMethod(target, name).call(target, ...args)).then(() => undefined);
}

function callVoid(target: object, name: string, ...args: unknown[]): void {
  callMethod(target, name).call(target, ...args);
}

function callMethod(target: object, name: string): CallableMethod {
  const method: unknown = Reflect.get(target, name);
  if (typeof method !== "function") throw new Error(`Missing ${name}`);
  return method;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}
