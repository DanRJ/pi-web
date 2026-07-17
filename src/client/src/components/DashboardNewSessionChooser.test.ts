import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, Workspace } from "../api";
import { DashboardNewSessionChooser } from "./DashboardNewSessionChooser";

const project = { id: "project", name: "Project", path: "/repo", createdAt: "2026-01-01T00:00:00.000Z" } satisfies Project;
const otherProject = { id: "other", name: "Other", path: "/other", createdAt: "2026-01-01T00:00:00.000Z" } satisfies Project;
const workspace = { id: "workspace", projectId: project.id, path: "/repo", label: "main", isMain: true, isGitRepo: true, isGitWorktree: false } satisfies Workspace;
const otherWorkspace = { ...workspace, id: "other-workspace", projectId: otherProject.id, path: "/other", label: "other" } satisfies Workspace;

afterEach(() => vi.unstubAllGlobals());

describe("DashboardNewSessionChooser", () => {
  it("preselects a retained valid project and workspace", async () => {
    const chooser = createChooser();
    chooser.selectedProjectId = project.id;
    chooser.selectedWorkspaceId = workspace.id;
    chooser.loadWorkspaces = vi.fn(() => Promise.resolve([workspace]));

    await chooser.openChooser();

    expect(Reflect.get(chooser, "projectId")).toBe(project.id);
    expect(Reflect.get(chooser, "workspaceId")).toBe(workspace.id);
  });

  it("requires a project when there is no retained valid selection", async () => {
    const chooser = createChooser();
    chooser.selectedProjectId = "missing";
    chooser.loadWorkspaces = vi.fn(() => Promise.resolve([workspace]));

    await chooser.openChooser();

    expect(Reflect.get(chooser, "projectId")).toBeUndefined();
    expect(chooser.loadWorkspaces).not.toHaveBeenCalled();
  });

  it("replaces workspace choices when the project changes", async () => {
    const chooser = createChooser();
    chooser.loadWorkspaces = vi.fn((selected: Project) => Promise.resolve(selected.id === project.id ? [workspace] : [otherWorkspace]));

    Reflect.set(chooser, "projectId", project.id);
    await callAsync(chooser, "loadProjectWorkspaces", project.id);
    Reflect.set(chooser, "projectId", otherProject.id);
    await callAsync(chooser, "loadProjectWorkspaces", otherProject.id);

    expect(Reflect.get(chooser, "workspaces")).toEqual([otherWorkspace]);
    expect(Reflect.get(chooser, "workspaceId")).toBeUndefined();
  });

  it("reports empty and failed workspace loads truthfully", async () => {
    const empty = createChooser();
    empty.loadWorkspaces = vi.fn(() => Promise.resolve([]));
    Reflect.set(empty, "projectId", project.id);
    await callAsync(empty, "loadProjectWorkspaces", project.id);
    expect(Reflect.get(empty, "workspaces")).toEqual([]);
    expect(Reflect.get(empty, "error")).toBeUndefined();

    const failed = createChooser();
    failed.loadWorkspaces = vi.fn(() => Promise.reject(new Error("offline")));
    Reflect.set(failed, "projectId", project.id);
    await callAsync(failed, "loadProjectWorkspaces", project.id);
    expect(Reflect.get(failed, "error")).toBe("Could not load workspaces: offline");
  });

  it("focuses the mounted modal and keeps its Tab trap active while retained workspaces load", async () => {
    const chooser = createChooser();
    const load = deferred<Workspace[]>();
    class FakeHTMLElement {
      hasAttribute = () => false;
      focus = vi.fn();
    }
    vi.stubGlobal("HTMLElement", FakeHTMLElement);
    const projectSelect = { focus: vi.fn() };
    const firstControl = new FakeHTMLElement();
    const lastControl = new FakeHTMLElement();
    chooser.selectedProjectId = project.id;
    chooser.loadWorkspaces = vi.fn(() => load.promise);
    Object.defineProperty(chooser, "projectSelect", { configurable: true, value: projectSelect });
    Object.defineProperty(chooser, "dialog", { configurable: true, value: { querySelectorAll: () => [firstControl, lastControl] } });

    const opening = chooser.openChooser();
    await flush();

    expect(Reflect.get(chooser, "open")).toBe(true);
    expect(Reflect.get(chooser, "loading")).toBe(true);
    expect(projectSelect.focus).toHaveBeenCalledOnce();
    const preventDefault = vi.fn();
    callVoid(chooser, "onDialogKeydown", { key: "Tab", shiftKey: false, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(firstControl.focus).toHaveBeenCalledOnce();

    load.resolve([workspace]);
    await opening;
    expect(Reflect.get(chooser, "workspaceId")).toBeUndefined();
  });

  it("cancels without starting a session", async () => {
    const chooser = createChooser();
    chooser.selectedProjectId = project.id;
    chooser.loadWorkspaces = vi.fn(() => Promise.resolve([workspace]));
    chooser.onStart = vi.fn(() => Promise.resolve());
    await chooser.openChooser();

    callVoid(chooser, "close");

    expect(Reflect.get(chooser, "open")).toBe(false);
    expect(chooser.onStart).not.toHaveBeenCalled();
  });

  it("ignores cancel, Escape, and scrim-close attempts while a start is pending", async () => {
    const chooser = createChooser();
    const start = deferred<undefined>();
    chooser.onStart = vi.fn(() => start.promise);
    Reflect.set(chooser, "open", true);
    Reflect.set(chooser, "projectId", project.id);
    Reflect.set(chooser, "workspaces", [workspace]);
    Reflect.set(chooser, "workspaceId", workspace.id);

    const pending = callAsync(chooser, "start");
    callVoid(chooser, "close");
    callVoid(chooser, "requestClose");
    callVoid(chooser, "onDialogKeydown", { key: "Escape", preventDefault: vi.fn() });

    expect(Reflect.get(chooser, "open")).toBe(true);
    expect(Reflect.get(chooser, "starting")).toBe(true);
    start.resolve(undefined);
    await pending;
    expect(Reflect.get(chooser, "open")).toBe(false);
  });
});

function createChooser(): DashboardNewSessionChooser {
  const chooser = new DashboardNewSessionChooser();
  chooser.projects = [project, otherProject];
  Object.defineProperty(chooser, "updateComplete", { configurable: true, value: Promise.resolve(true) });
  return chooser;
}

interface CallableMethod {
  call(thisArg: object, ...args: unknown[]): unknown;
}

function callAsync(target: object, name: string, ...args: unknown[]): Promise<void> {
  const method = getCallableMethod(target, name);
  return Promise.resolve(method.call(target, ...args)).then(() => undefined);
}

function callVoid(target: object, name: string, ...args: unknown[]): void {
  getCallableMethod(target, name).call(target, ...args);
}

function getCallableMethod(target: object, name: string): CallableMethod {
  const method: unknown = Reflect.get(target, name);
  if (typeof method !== "function") throw new Error(`Missing ${name}`);
  return method;
}

async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
