import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalSessionDashboardSessionSummary } from "../api";
import { initialAppState, type AppState } from "../appState";
import { PiWebApp } from "./PiWebApp";

afterEach(() => vi.unstubAllGlobals());

describe("PiWebApp dashboard transitions", () => {
  it("does not restore a workspace session for a fresh dashboard route", async () => {
    const app = createApp("?page=dashboard");
    const restoreRoute = vi.fn(() => Promise.resolve());
    Reflect.set(app, "restoreRoute", restoreRoute);
    const dashboard: unknown = Reflect.get(app, "dashboard");
    if (!isDashboardController(dashboard)) throw new Error("Dashboard controller unavailable");
    vi.spyOn(dashboard, "refresh").mockResolvedValue();
    const handler: unknown = Reflect.get(app, "onPopState");
    if (!isVoidMethod(handler)) throw new Error("Popstate handler unavailable");
    handler.call(app);
    await flush();
    expect(restoreRoute).not.toHaveBeenCalled();
  });

  it("only leaves the dashboard after the target card fully restores", async () => {
    const app = createApp();
    const original = appState();
    const selectedProject = original.projects[0];
    if (selectedProject === undefined) throw new Error("Expected project");
    setState(app, original);
    Reflect.set(app, "topLevelPage", "dashboard");
    Reflect.set(app, "restoreRouteFor", (route: { projectId?: string; workspaceId?: string; sessionId?: string }) => {
      setState(app, { ...original, selectedProject: { ...selectedProject }, selectedWorkspace: workspace("target"), selectedSession: session("target") });
      expect(route).toMatchObject({ projectId: "project", workspaceId: "target", sessionId: "target" });
      return Promise.resolve();
    });

    await callAsync(app, "openDashboardSession", card("target"), "local");
    expect(Reflect.get(app, "topLevelPage")).toBe("workspace");
  });

  it("rolls back a stale card restoration and keeps its visible error on the dashboard", async () => {
    const app = createApp();
    const original = appState();
    setState(app, original);
    Reflect.set(app, "topLevelPage", "dashboard");
    let calls = 0;
    Reflect.set(app, "restoreRouteFor", () => {
      calls += 1;
      if (calls === 1) setState(app, { ...original, selectedWorkspace: workspace("stale"), selectedSession: undefined });
      else setState(app, original);
      return Promise.resolve();
    });

    await callAsync(app, "openDashboardSession", card("missing"), "local");
    expect(calls).toBe(2);
    expect(Reflect.get(app, "state")).toMatchObject({ selectedWorkspace: { id: "workspace" }, selectedSession: { id: "session" } });
    expect(Reflect.get(app, "topLevelPage")).toBe("dashboard");
    expect(Reflect.get(app, "dashboardState")).toMatchObject({ error: "Could not open session: That session is no longer available." });
  });

  it("clears a partially selected stale card when the dashboard began with no selection", async () => {
    const app = createApp();
    const original = initialAppState();
    setState(app, original);
    Reflect.set(app, "topLevelPage", "dashboard");
    let calls = 0;
    Reflect.set(app, "restoreRouteFor", () => {
      calls += 1;
      if (calls === 1) {
        setState(app, {
          ...original,
          selectedProject: { id: "project", name: "Target", path: "/target", createdAt: "2026-01-01T00:00:00.000Z" },
          selectedWorkspace: workspace("stale"),
          selectedSession: session("stale"),
        });
      }
      return Promise.resolve();
    });

    await callAsync(app, "openDashboardSession", card("missing"), "local");
    expect(calls).toBe(2);
    expect(Reflect.get(app, "state")).toMatchObject({ selectedProject: undefined, selectedWorkspace: undefined, selectedSession: undefined });
    expect(Reflect.get(app, "topLevelPage")).toBe("dashboard");
  });

  it("keeps base paths and dynamic IDs safely encoded in dashboard card hrefs", () => {
    const app = createApp("?page=dashboard", "/pi%20web/");
    const href = callString(app, "dashboardSessionHref", { ...card("w & ?"), id: "s / ?", project: { id: "p & ?", name: "Project" } }, "remote & ?");
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/pi%20web/");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ machine: "remote & ?", project: "p & ?", workspace: "w & ?", session: "s / ?", view: "chat" });
    expect(url.searchParams.get("page")).toBeNull();
  });

  it("strips stale workspace tools and surface query state from dashboard card hrefs", () => {
    const app = createApp("?keep=1&page=dashboard&machine=old&project=old&workspace=old&session=old&tool=core%3Aworkspace.git&view=core%3Aworkspace.files&core.workspace.files--file=src%2Fold.ts&core.workspace.git--diff=README.md&core.workspace.terminal--terminal=terminal-1", "/nested/");
    const href = callString(app, "dashboardSessionHref", { ...card("workspace"), id: "session" }, "remote");

    expect(href).toBe("/nested/?keep=1&machine=remote&project=project&workspace=workspace&session=session&view=chat");
  });

  it("returns from the dashboard through the selected mobile destination", () => {
    const app = createApp();
    setState(app, appState());
    Reflect.set(app, "topLevelPage", "dashboard");
    setMobileLayout(app);
    callVoid(app, "selectMobileDestination", "chat");
    expect(Reflect.get(app, "topLevelPage")).toBe("workspace");
    expect(Reflect.get(app, "mobileDestination")).toBe("chat");
  });

  it("starts from a retained workspace but returns to Sessions without one", async () => {
    const retained = createApp();
    setState(retained, appState());
    Reflect.set(retained, "topLevelPage", "dashboard");
    const start = vi.fn(() => Promise.resolve());
    Reflect.set(retained, "startSessionAndOpenChat", start);
    await callAsync(retained, "startDashboardSession");
    expect(start).toHaveBeenCalledOnce();
    expect(Reflect.get(retained, "topLevelPage")).toBe("workspace");

    const empty = createApp();
    setState(empty, { ...initialAppState(), selectedWorkspace: undefined });
    Reflect.set(empty, "topLevelPage", "dashboard");
    await callAsync(empty, "startDashboardSession");
    expect(Reflect.get(empty, "topLevelPage")).toBe("workspace");
    expect(Reflect.get(empty, "state")).toMatchObject({ mainView: "navigation" });
  });
});

function createApp(search = "", pathname = "/"): PiWebApp {
  const location = { href: `http://localhost${pathname}${search}`, pathname, search, hash: "" };
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal("window", { location, history: { pushState: () => undefined, replaceState: () => undefined }, localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }, matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }), clearTimeout: () => undefined });
  const app = new PiWebApp();
  Object.defineProperty(app, "updateComplete", { configurable: true, value: Promise.resolve(true) });
  Reflect.set(app, "getBoundingClientRect", () => ({ width: 0 }));
  return app;
}

function appState(): AppState {
  const project = { id: "project", name: "Project", path: "/repo", createdAt: "2026-01-01T00:00:00.000Z" };
  return { ...initialAppState(), machines: [machine()], selectedMachine: machine(), projects: [project], selectedProject: project, selectedWorkspace: workspace("workspace"), selectedSession: session("session"), mainView: "chat" };
}
function machine() { return { id: "local", name: "Local", kind: "local" as const, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }; }
function workspace(id: string) { return { id, projectId: "project", path: "/repo", label: id, isMain: true, isGitRepo: true, isGitWorktree: false }; }
function session(id: string) { return { id, cwd: "/repo", path: `/repo/${id}.jsonl`, created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:00:00.000Z", messageCount: 1, firstMessage: "Open dashboard" }; }
function card(id: string): LocalSessionDashboardSessionSummary { return { ...session(id), runtimeStatus: "idle", displayStatus: "idle", needsAttention: false, project: { id: "project", name: "Project" }, workspace: { id, label: id, isMain: true } }; }
function setState(app: PiWebApp, state: AppState): void { if (!Reflect.set(app, "state", state)) throw new Error("Could not set state"); }
function setMobileLayout(app: PiWebApp): void {
  const shell: unknown = Reflect.get(app, "appShell");
  if (typeof shell !== "object" || shell === null || !("isMobileNavigationLayout" in shell)) throw new Error("App shell unavailable");
  if (!Reflect.set(shell, "isMobileNavigationLayout", true)) throw new Error("Could not set mobile layout");
}

function callAsync(app: PiWebApp, name: string, ...args: unknown[]): Promise<void> {
  const method: unknown = Reflect.get(app, name);
  if (!isAsyncMethod(method)) throw new Error(`Missing ${name}`);
  return method.call(app, ...args);
}

function callString(app: PiWebApp, name: string, ...args: unknown[]): string {
  const method: unknown = Reflect.get(app, name);
  if (!isUnknownMethod(method)) throw new Error(`Missing ${name}`);
  const value = method.call(app, ...args);
  if (typeof value !== "string") throw new Error(`${name} did not return a string`);
  return value;
}

function callVoid(app: PiWebApp, name: string, ...args: unknown[]): void {
  const method: unknown = Reflect.get(app, name);
  if (!isVoidMethod(method)) throw new Error(`Missing ${name}`);
  method.call(app, ...args);
}

function isDashboardController(value: unknown): value is { refresh(): Promise<void> } {
  return typeof value === "object" && value !== null && "refresh" in value && isAsyncMethod(Reflect.get(value, "refresh"));
}

function isAsyncMethod(value: unknown): value is { call(thisArg: unknown, ...args: unknown[]): Promise<void> } {
  return typeof value === "function";
}

function isUnknownMethod(value: unknown): value is { call(thisArg: unknown, ...args: unknown[]): unknown } {
  return typeof value === "function";
}

function isVoidMethod(value: unknown): value is { call(thisArg: unknown, ...args: unknown[]): void } {
  return typeof value === "function";
}

async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }
