import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type Machine, type MachineHealth } from "../api";
import { initialAppState, type AppState } from "../appState";
import { MachineController } from "./machineController";

const localMachine: Machine = {
  id: "local",
  name: "Local",
  kind: "local",
  createdAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z",
};

const remoteMachine: Machine = {
  id: "remote-1",
  name: "Remote",
  kind: "remote",
  baseUrl: "http://remote.example.test:8504",
  createdAt: "2026-05-26T00:00:00.000Z",
  updatedAt: "2026-05-26T00:00:00.000Z",
};

const addedMachine: Machine = {
  id: "remote-2",
  name: "New Remote",
  kind: "remote",
  baseUrl: "https://new-remote.example.test",
  createdAt: "2026-05-27T00:00:00.000Z",
  updatedAt: "2026-05-27T00:00:00.000Z",
};

const offlineHealth: MachineHealth = {
  machineId: remoteMachine.id,
  ok: false,
  checkedAt: "2026-05-26T00:00:01.000Z",
  status: "offline",
  error: "Remote machine request timed out",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("MachineController", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("selects a newly added machine and clears stale workspace state", async () => {
    const project = { id: "p1", name: "Project", path: "/repo", createdAt: "now" };
    const workspace = { id: "w1", projectId: project.id, path: "/repo", label: "main", isMain: true, isGitRepo: true, isGitWorktree: false };
    const session = { id: "s1", cwd: "/repo", path: "/repo/.pi/sessions/s1.json", created: "now", modified: "now", messageCount: 1, firstMessage: "hello" };
    let state: AppState = {
      ...initialAppState(),
      machines: [localMachine, remoteMachine],
      selectedMachine: localMachine,
      projects: [project],
      workspaces: [workspace],
      sessions: [session],
      selectedProject: project,
      selectedWorkspace: workspace,
      selectedSession: session,
      fileTree: [{ name: "index.ts", path: "src/index.ts", type: "file" }],
      selectedFilePath: "src/index.ts",
      gitStatus: { isGitRepo: true, hash: "abc123", branch: "main", files: [{ path: "src/index.ts", index: "modified", workingTree: "modified" }] },
      activeTerminalCount: 2,
      error: "stale error",
    };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const updateUrl = vi.fn();
    const projects = { loadProjects: vi.fn() };
    const input = { name: "New Remote", baseUrl: "https://new-remote.example.test", token: "secret-token" };

    const addMachine = vi.spyOn(api, "addMachine").mockResolvedValue(addedMachine);
    const health = vi.spyOn(api, "health").mockResolvedValue({ machineId: addedMachine.id, ok: true, checkedAt: "2026-05-27T00:00:01.000Z", status: "online" });
    const runtime = vi.spyOn(api, "runtime").mockResolvedValue({ machineId: addedMachine.id, ok: true, checkedAt: "2026-05-27T00:00:02.000Z" });

    const controller = new MachineController(() => state, setState, updateUrl, projects);

    const machine = await controller.addMachine(input);

    expect(machine).toEqual(addedMachine);
    expect(addMachine).toHaveBeenCalledWith(input);
    expect(state.machines).toEqual([localMachine, remoteMachine, addedMachine]);
    expect(state.selectedMachine).toEqual(addedMachine);
    expect(state.projects).toEqual([]);
    expect(state.workspaces).toEqual([]);
    expect(state.sessions).toEqual([]);
    expect(state.selectedProject).toBeUndefined();
    expect(state.selectedWorkspace).toBeUndefined();
    expect(state.selectedSession).toBeUndefined();
    expect(state.fileTree).toEqual([]);
    expect(state.selectedFilePath).toBeUndefined();
    expect(state.gitStatus).toBeUndefined();
    expect(state.activeTerminalCount).toBe(0);
    expect(state.error).toBe("");
    expect(projects.loadProjects).toHaveBeenCalledOnce();
    expect(updateUrl).toHaveBeenCalledOnce();
    expect(health).toHaveBeenCalledWith(addedMachine.id);
    expect(runtime).toHaveBeenCalledWith(addedMachine.id, true);
  });

  it("preserves the current machine state when adding a machine fails", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine], selectedMachine: localMachine };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const updateUrl = vi.fn();
    const projects = { loadProjects: vi.fn() };
    const input = { name: "New Remote", baseUrl: "https://new-remote.example.test" };

    vi.spyOn(api, "addMachine").mockRejectedValue(new Error("Remote rejected"));
    const health = vi.spyOn(api, "health");
    const runtime = vi.spyOn(api, "runtime");

    const controller = new MachineController(() => state, setState, updateUrl, projects);

    const machine = await controller.addMachine(input);

    expect(machine).toBeUndefined();
    expect(state.machines).toEqual([localMachine]);
    expect(state.selectedMachine).toEqual(localMachine);
    expect(state.error).toBe("Error: Remote rejected");
    expect(projects.loadProjects).not.toHaveBeenCalled();
    expect(updateUrl).not.toHaveBeenCalled();
    expect(health).not.toHaveBeenCalled();
    expect(runtime).not.toHaveBeenCalled();
  });

  it("keeps the routed remote machine selected while its health is offline", async () => {
    let state: AppState = initialAppState();
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const updateUrl = vi.fn();
    const projects = { loadProjects: vi.fn() };

    vi.spyOn(api, "machines").mockResolvedValue([localMachine, remoteMachine]);
    vi.spyOn(api, "health").mockImplementation((machineId: string) => Promise.resolve(
      machineId === remoteMachine.id
        ? offlineHealth
        : { machineId: "local", ok: true, checkedAt: "2026-05-26T00:00:01.000Z", status: "online" },
    ));

    const controller = new MachineController(() => state, setState, updateUrl, projects);

    await controller.loadMachines(remoteMachine.id);

    expect(state.selectedMachine).toEqual(remoteMachine);
    expect(state.machineStatuses[remoteMachine.id]).toEqual(offlineHealth);
    expect(state.error).toContain("Remote is unavailable");
  });

  it("records offline health without falling back when the routed remote health request rejects", async () => {
    let state: AppState = initialAppState();
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const updateUrl = vi.fn();
    const projects = { loadProjects: vi.fn() };

    vi.spyOn(api, "machines").mockResolvedValue([localMachine, remoteMachine]);
    vi.spyOn(api, "health").mockRejectedValue(new Error("Internal Server Error"));

    const controller = new MachineController(() => state, setState, updateUrl, projects);

    await controller.loadMachines(remoteMachine.id);

    expect(state.selectedMachine).toEqual(remoteMachine);
    expect(state.machineStatuses[remoteMachine.id]).toMatchObject({ machineId: remoteMachine.id, ok: false, status: "offline", error: "Internal Server Error" });
    expect(state.error).toContain("Remote is unavailable");
  });

  it("falls back to local when the routed machine is no longer configured", async () => {
    let state: AppState = initialAppState();
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const updateUrl = vi.fn();
    const projects = { loadProjects: vi.fn() };

    vi.spyOn(api, "machines").mockResolvedValue([localMachine]);
    vi.spyOn(api, "health").mockResolvedValue({ machineId: "local", ok: true, checkedAt: "2026-05-26T00:00:01.000Z", status: "online" });

    const controller = new MachineController(() => state, setState, updateUrl, projects);

    await controller.loadMachines(remoteMachine.id);

    expect(state.selectedMachine).toEqual(localMachine);
    expect(state.error).toBe("");
  });

  it("replaces an edited selected connection and refreshes it without clearing scoped state", async () => {
    const project = { id: "p1", name: "Project", path: "/repo", createdAt: "now" };
    const workspace = { id: "w1", projectId: project.id, path: "/repo", label: "main", isMain: true, isGitRepo: true, isGitWorktree: false };
    const session = { id: "s1", cwd: "/repo", path: "/repo/.pi/sessions/s1.json", created: "now", modified: "now", messageCount: 1, firstMessage: "hello" };
    const updated = { ...remoteMachine, name: "Renamed", baseUrl: "https://new.example.test", updatedAt: "later" };
    let state: AppState = { ...initialAppState(), machines: [localMachine, remoteMachine], selectedMachine: remoteMachine, projects: [project], workspaces: [workspace], sessions: [session], selectedProject: project, selectedWorkspace: workspace, selectedSession: session, workspaceTool: "core:workspace.git", mainView: "core:workspace.git", selectedFilePath: "src/index.ts" };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const projects = { loadProjects: vi.fn() };
    const updateUrl = vi.fn();
    const updateMachine = vi.spyOn(api, "updateMachine").mockResolvedValue(updated);
    const health = vi.spyOn(api, "health").mockResolvedValue({ machineId: updated.id, ok: true, checkedAt: "now", status: "online" });
    const runtime = vi.spyOn(api, "runtime").mockResolvedValue({ machineId: updated.id, ok: true, checkedAt: "now" });
    const controller = new MachineController(() => state, setState, updateUrl, projects);

    await expect(controller.updateMachine(remoteMachine, { name: "Renamed", baseUrl: "https://new.example.test" })).resolves.toEqual(updated);

    expect(updateMachine).toHaveBeenCalledWith(remoteMachine.id, { name: "Renamed", baseUrl: "https://new.example.test" });
    expect(state.machines).toEqual([localMachine, updated]);
    expect(state.selectedMachine).toEqual(updated);
    expect(state).toMatchObject({ selectedProject: project, selectedWorkspace: workspace, selectedSession: session, workspaceTool: "core:workspace.git", mainView: "core:workspace.git", selectedFilePath: "src/index.ts" });
    expect(health).toHaveBeenCalledWith(updated.id);
    expect(runtime).toHaveBeenCalledWith(updated.id, true);
    expect(projects.loadProjects).not.toHaveBeenCalled();
    expect(updateUrl).not.toHaveBeenCalled();
  });

  it.each(["health", "runtime"] as const)("removes stale cached %s data when the refreshed connection check rejects", async (_kind) => {
    const updated = { ...remoteMachine, baseUrl: "https://new.example.test", updatedAt: "later" };
    const oldHealth: MachineHealth = { machineId: remoteMachine.id, ok: true, checkedAt: "before", status: "online" };
    const oldRuntime = { machineId: remoteMachine.id, ok: true, checkedAt: "before", packageName: "pi-web@old" };
    let state: AppState = {
      ...initialAppState(),
      machines: [localMachine, remoteMachine],
      selectedMachine: remoteMachine,
      machineStatuses: { [remoteMachine.id]: oldHealth },
      machineRuntimes: { [remoteMachine.id]: oldRuntime },
      selectedProject: { id: "p1", name: "Project", path: "/repo", createdAt: "now" },
    };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const projects = { loadProjects: vi.fn() };
    const updateUrl = vi.fn();
    vi.spyOn(api, "updateMachine").mockResolvedValue(updated);
    vi.spyOn(api, "health").mockImplementation((machineId: string) => {
      if (_kind === "health") return Promise.reject(new Error(`health failed for ${machineId}`));
      return Promise.resolve({ machineId, ok: true, checkedAt: "now", status: "online" });
    });
    vi.spyOn(api, "runtime").mockImplementation((machineId: string) => {
      if (_kind === "runtime") return Promise.reject(new Error(`runtime failed for ${machineId}`));
      return Promise.resolve({ machineId, ok: true, checkedAt: "now" });
    });
    const controller = new MachineController(() => state, setState, updateUrl, projects);

    await expect(controller.updateMachine(remoteMachine, { baseUrl: updated.baseUrl })).resolves.toEqual(updated);

    expect(state.selectedProject).toMatchObject({ id: "p1" });
    if (_kind === "health") {
      expect(state.machineStatuses[remoteMachine.id]).toBeUndefined();
      expect(state.machineRuntimes[remoteMachine.id]).toMatchObject({ checkedAt: "now" });
    } else {
      expect(state.machineStatuses[remoteMachine.id]).toMatchObject({ checkedAt: "now" });
      expect(state.machineRuntimes[remoteMachine.id]).toBeUndefined();
    }
  });

  it("keeps the old connection and active state when an edit fails", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine, remoteMachine], selectedMachine: remoteMachine, selectedProject: { id: "p1", name: "Project", path: "/repo", createdAt: "now" } };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const projects = { loadProjects: vi.fn() };
    const updateUrl = vi.fn();
    vi.spyOn(api, "updateMachine").mockRejectedValue(new Error("Remote rejected"));
    const health = vi.spyOn(api, "health");
    const runtime = vi.spyOn(api, "runtime");
    const controller = new MachineController(() => state, setState, updateUrl, projects);

    await expect(controller.updateMachine(remoteMachine, { name: "Broken" })).resolves.toBeUndefined();

    expect(state.machines).toEqual([localMachine, remoteMachine]);
    expect(state.selectedMachine).toEqual(remoteMachine);
    expect(state.selectedProject).toMatchObject({ id: "p1" });
    expect(state.error).toBe("Error: Remote rejected");
    expect(health).not.toHaveBeenCalled();
    expect(runtime).not.toHaveBeenCalled();
    expect(projects.loadProjects).not.toHaveBeenCalled();
    expect(updateUrl).not.toHaveBeenCalled();
  });

  it("returns the fallback machine without selecting it when requested", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine, remoteMachine], selectedMachine: remoteMachine };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const updateUrl = vi.fn();
    const projects = { loadProjects: vi.fn() };

    vi.spyOn(api, "deleteMachine").mockResolvedValue({ deleted: true });

    const controller = new MachineController(() => state, setState, updateUrl, projects);

    const fallback = await controller.deleteMachine(remoteMachine, { selectFallback: false });

    expect(fallback).toEqual(localMachine);
    expect(state.machines).toEqual([localMachine]);
    expect(state.selectedMachine).toEqual(remoteMachine);
    expect(projects.loadProjects).not.toHaveBeenCalled();
    expect(updateUrl).not.toHaveBeenCalled();
  });

  it("selects the fallback machine after deleting the selected machine by default", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine, remoteMachine], selectedMachine: remoteMachine, selectedProject: { id: "p1", name: "Project", path: "/repo", createdAt: "now" } };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const updateUrl = vi.fn();
    const projects = { loadProjects: vi.fn() };

    vi.spyOn(api, "deleteMachine").mockResolvedValue({ deleted: true });

    const controller = new MachineController(() => state, setState, updateUrl, projects);

    const fallback = await controller.deleteMachine(remoteMachine);

    expect(fallback).toEqual(localMachine);
    expect(state.selectedMachine).toEqual(localMachine);
    expect(state.selectedProject).toBeUndefined();
    expect(projects.loadProjects).toHaveBeenCalledOnce();
    expect(updateUrl).toHaveBeenCalledOnce();
  });

  it("does not let a deferred old endpoint health probe overwrite an updated connection", async () => {
    const updated = { ...remoteMachine, baseUrl: "https://new.example.test", updatedAt: "later" };
    let state: AppState = { ...initialAppState(), machines: [localMachine, remoteMachine], selectedMachine: remoteMachine };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const oldProbe = deferred<MachineHealth>();
    let calls = 0;
    vi.spyOn(api, "health").mockImplementation(() => ++calls === 1 ? oldProbe.promise : Promise.resolve({ machineId: remoteMachine.id, ok: true, checkedAt: "new", status: "online" }));
    vi.spyOn(api, "runtime").mockResolvedValue({ machineId: remoteMachine.id, ok: true, checkedAt: "new" });
    vi.spyOn(api, "updateMachine").mockResolvedValue(updated);
    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });

    const pending = controller.refreshMachineHealth(remoteMachine.id);
    await controller.updateMachine(remoteMachine, { baseUrl: updated.baseUrl });
    oldProbe.resolve({ machineId: remoteMachine.id, ok: true, checkedAt: "old", status: "online" });
    await pending;

    expect(state.machineStatuses[remoteMachine.id]).toMatchObject({ checkedAt: "new" });
  });

  it("does not let a deferred bulk probe overwrite an updated connection", async () => {
    const updated = { ...remoteMachine, baseUrl: "https://new.example.test", updatedAt: "later" };
    let state: AppState = initialAppState();
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const oldProbe = deferred<MachineHealth>();
    vi.spyOn(api, "machines").mockResolvedValue([localMachine, remoteMachine]);
    let remoteHealthCalls = 0;
    vi.spyOn(api, "health").mockImplementation((id) => id === remoteMachine.id && ++remoteHealthCalls === 1 ? oldProbe.promise : Promise.resolve({ machineId: id, ok: true, checkedAt: "new", status: "online" }));
    vi.spyOn(api, "runtime").mockResolvedValue({ machineId: remoteMachine.id, ok: true, checkedAt: "new" });
    vi.spyOn(api, "updateMachine").mockResolvedValue(updated);
    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });

    await controller.loadMachines(localMachine.id);
    await controller.updateMachine(remoteMachine, { baseUrl: updated.baseUrl });
    oldProbe.resolve({ machineId: remoteMachine.id, ok: true, checkedAt: "old", status: "online" });
    await Promise.resolve();

    expect(state.machineStatuses[remoteMachine.id]?.checkedAt).not.toBe("old");
  });
});
