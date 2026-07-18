import type { TemplateResult } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalSessionDashboardSessionSummary } from "../api";
import type { AppAction } from "../actions";
import { initialAppState, type AppState } from "../appState";
import { PiWebApp } from "./PiWebApp";
import { WorkspacePanel, type WorkspacePanelEmptyState } from "./WorkspacePanel";

afterEach(() => vi.unstubAllGlobals());

describe("PiWebApp dashboard transitions", () => {
  it("keeps the Configure dialog open when a remote edit fails", async () => {
    const app = createApp();
    const remote = { id: "remote", name: "Remote", kind: "remote" as const, baseUrl: "https://remote.example.test", createdAt: "now", updatedAt: "now" };
    setState(app, { ...appState(), machines: [machine(), remote], selectedMachine: remote });
    const updateMachine = vi.fn(() => Promise.resolve(undefined));
    Reflect.set(app, "machines", { updateMachine });

    callVoid(app, "openMachineDialog", remote);
    await callAsync(app, "submitMachineDialog", { name: "Renamed", baseUrl: "https://remote.example.test" });

    expect(updateMachine).toHaveBeenCalledWith(remote, { name: "Renamed", baseUrl: "https://remote.example.test" });
    expect(projectAppState(app).machineDialogOpen).toBe(true);
    expect(Reflect.get(app, "machineDialogMachine")).toEqual(remote);
  });

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

  it("renders the Actions palette from the dashboard sidebar", () => {
    const app = createApp();
    setState(app, appState());
    Reflect.set(app, "topLevelPage", "dashboard");

    // Template extraction keeps this narrow wiring test independent of a DOM harness.
    binding(renderTemplate(app, "renderNavigationPanel"), ".onShowActions")();

    expect(templateMarkup(app.render())).toContain("<action-palette");
  });

  it("closes the dashboard Actions palette when cancelled", () => {
    const app = createApp();
    setState(app, { ...appState(), actionPaletteOpen: true });
    Reflect.set(app, "topLevelPage", "dashboard");

    binding(findTemplate(app.render(), "<action-palette"), ".onCancel")();

    expect(projectAppState(app).actionPaletteOpen).toBe(false);
    expect(templateMarkup(app.render())).not.toContain("<action-palette");
  });

  it("runs a modal action over the dashboard without leaving it", async () => {
    const app = createApp();
    setState(app, { ...appState(), actionPaletteOpen: true });
    Reflect.set(app, "topLevelPage", "dashboard");
    const projectAction = actions(app).find((action) => action.id === "core:project.add");
    if (projectAction === undefined) throw new Error("Add Project action unavailable");

    binding(findTemplate(app.render(), "<action-palette"), ".onRun")(projectAction);
    await flush();

    expect(projectAppState(app)).toMatchObject({ actionPaletteOpen: false, projectDialogOpen: true });
    expect(Reflect.get(app, "topLevelPage")).toBe("dashboard");
    expect(templateMarkup(app.render())).toContain("<project-dialog");
  });

  it("leaves the dashboard for an action that focuses the workspace", async () => {
    const app = createApp();
    setState(app, { ...appState(), actionPaletteOpen: true });
    Reflect.set(app, "topLevelPage", "dashboard");
    const focusPrompt = actions(app).find((action) => action.id === "core:prompt.focus");
    if (focusPrompt === undefined) throw new Error("Focus Prompt action unavailable");

    binding(findTemplate(app.render(), "<action-palette"), ".onRun")(focusPrompt);
    await flush();

    expect(Reflect.get(app, "topLevelPage")).toBe("workspace");
    expect(projectAppState(app).mainView).toBe("chat");
  });

  it("renders one action palette in the workspace shell", () => {
    const app = createApp();
    setState(app, { ...appState(), actionPaletteOpen: true });

    expect(occurrences(templateMarkup(app.render()), "<action-palette")).toBe(1);
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

  it("lets the browser route win when popstate supersedes a deferred card open", async () => {
    const app = createApp("?page=dashboard");
    const original = appState();
    const browserState = { ...original, selectedWorkspace: workspace("browser"), selectedSession: session("browser") };
    setState(app, original);
    Reflect.set(app, "topLevelPage", "dashboard");
    const cardRestore = deferred<undefined>();
    Reflect.set(app, "restoreRouteFor", vi.fn(() => cardRestore.promise));
    const restoreRoute = vi.fn(() => {
      setState(app, browserState);
      return Promise.resolve();
    });
    Reflect.set(app, "restoreRoute", restoreRoute);
    const updateUrl = vi.fn();
    Reflect.set(app, "updateUrl", updateUrl);

    const openingCard = callAsync(app, "openDashboardSession", card("card"), "local");
    await flush();
    window.location.search = "?project=project&workspace=browser&session=browser&view=chat";
    const handler: unknown = Reflect.get(app, "onPopState");
    if (!isVoidMethod(handler)) throw new Error("Popstate handler unavailable");
    handler.call(app);
    await flush();
    cardRestore.resolve(undefined);
    await openingCard;

    expect(restoreRoute).toHaveBeenCalledWith(false);
    expect(Reflect.get(app, "topLevelPage")).toBe("workspace");
    expect(projectAppState(app)).toMatchObject({ selectedWorkspace: { id: "browser" }, selectedSession: { id: "browser" } });
    expect(Reflect.get(app, "dashboardState")).toMatchObject({ error: undefined });
    expect(updateUrl).not.toHaveBeenCalled();
  });

  it("ignores a stale card completion after a newer card opens", async () => {
    const app = createApp();
    const original = appState();
    setState(app, original);
    Reflect.set(app, "topLevelPage", "dashboard");
    const first = deferred<undefined>();
    const second = deferred<undefined>();
    const restoreRouteFor = vi.fn((route: { sessionId?: string }) => {
      if (route.sessionId === "first") return first.promise;
      return second.promise.then(() => {
        const project = original.projects[0];
        if (project === undefined) throw new Error("Expected project");
        setState(app, { ...original, selectedProject: project, selectedWorkspace: workspace("second"), selectedSession: session("second") });
      });
    });
    Reflect.set(app, "restoreRouteFor", restoreRouteFor);

    const openingFirst = callAsync(app, "openDashboardSession", card("first"), "local");
    const openingSecond = callAsync(app, "openDashboardSession", card("second"), "local");
    second.resolve(undefined);
    await openingSecond;
    first.resolve(undefined);
    await openingFirst;

    expect(restoreRouteFor).toHaveBeenCalledTimes(2);
    expect(Reflect.get(app, "topLevelPage")).toBe("workspace");
    expect(projectAppState(app)).toMatchObject({ selectedWorkspace: { id: "second" }, selectedSession: { id: "second" } });
    expect(Reflect.get(app, "dashboardState")).toMatchObject({ error: undefined });
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

  it("keeps the desktop dashboard mounted while Modernist Settings opens and closes", () => {
    const app = createApp("?page=dashboard");
    const state = appState();
    const dashboardState = { dashboard: undefined, loading: false, error: undefined };
    setState(app, state);
    Reflect.set(app, "topLevelPage", "dashboard");
    Reflect.set(app, "dashboardState", dashboardState);
    Reflect.set(app, "activeThemeId", "themes:modernist-dark");

    callVoid(app, "openSettings");

    expect(Reflect.get(app, "topLevelPage")).toBe("dashboard");
    expect(Reflect.get(app, "dashboardState")).toBe(dashboardState);
    expect(templateMarkup(app.render())).toContain("<settings-dialog");
    expect(templateMarkup(app.render())).toContain("<session-dashboard");

    callVoid(app, "closeSettings");

    expect(Reflect.get(app, "topLevelPage")).toBe("dashboard");
    expect(Reflect.get(app, "dashboardState")).toBe(dashboardState);
    expect(projectAppState(app)).toBe(state);
  });

  it("keeps the legacy Settings modal dashboard handoff unchanged", () => {
    const app = createApp("?page=dashboard");
    setState(app, appState());
    Reflect.set(app, "topLevelPage", "dashboard");

    callVoid(app, "openSettings");

    expect(Reflect.get(app, "topLevelPage")).toBe("workspace");
  });

  it("keeps the mobile dashboard and its prior destination while Modernist Settings opens and closes", () => {
    const app = createApp("?page=dashboard");
    const state = appState();
    setState(app, state);
    Reflect.set(app, "topLevelPage", "dashboard");
    Reflect.set(app, "activeThemeId", "themes:modernist-dark");
    setMobileLayout(app);
    Reflect.set(app, "mobileDestination", "sessions");

    callVoid(app, "selectMobileDestination", "settings");

    expect(Reflect.get(app, "topLevelPage")).toBe("dashboard");
    expect(Reflect.get(app, "mobileDestination")).toBe("settings");
    expect(templateMarkup(app.render())).toContain("<session-dashboard");

    callVoid(app, "closeSettings");

    expect(Reflect.get(app, "topLevelPage")).toBe("dashboard");
    expect(Reflect.get(app, "mobileDestination")).toBe("sessions");
    expect(projectAppState(app)).toBe(state);
  });

  it("keeps the mounted dashboard intact when browser Back closes Modernist Settings", async () => {
    const app = createApp("?page=dashboard&settings=general");
    const state = appState();
    const dashboardState = { dashboard: undefined, loading: false, error: undefined };
    setState(app, state);
    Reflect.set(app, "topLevelPage", "dashboard");
    Reflect.set(app, "dashboardState", dashboardState);
    Reflect.set(app, "activeThemeId", "themes:modernist-dark");
    const dashboard: unknown = Reflect.get(app, "dashboard");
    if (!isDashboardController(dashboard)) throw new Error("Dashboard controller unavailable");
    const refresh = vi.spyOn(dashboard, "refresh").mockResolvedValue();
    const restoreRoute = vi.fn(() => Promise.resolve());
    Reflect.set(app, "restoreRoute", restoreRoute);
    window.location.href = "http://localhost/?page=dashboard";
    window.location.search = "?page=dashboard";
    const handler: unknown = Reflect.get(app, "onPopState");
    if (!isVoidMethod(handler)) throw new Error("Popstate handler unavailable");

    handler.call(app);
    await flush();

    expect(Reflect.get(app, "settingsSection")).toBeUndefined();
    expect(Reflect.get(app, "topLevelPage")).toBe("dashboard");
    expect(Reflect.get(app, "dashboardState")).toBe(dashboardState);
    expect(refresh).not.toHaveBeenCalled();
    expect(restoreRoute).not.toHaveBeenCalled();
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

  it("opens the empty Tools destination from a fresh dashboard without restoring a workspace or session", () => {
    const app = createApp();
    setState(app, initialAppState());
    setMobileLayout(app);
    Reflect.set(app, "topLevelPage", "dashboard");
    const selectProject = vi.fn();
    const selectWorkspace = vi.fn();
    const restoreRouteFor = vi.fn();
    Reflect.set(app, "workspaces", { selectProject, selectWorkspace });
    Reflect.set(app, "restoreRouteFor", restoreRouteFor);

    // This narrow extraction verifies the rendered destination-tab click wiring.
    binding(renderTemplate(app, "renderMobileDestinationTabs"), ".onSelect=")("tools");

    expect(Reflect.get(app, "topLevelPage")).toBe("workspace");
    expect(Reflect.get(app, "mobileDestination")).toBe("tools");
    expect(projectAppState(app)).toMatchObject({ selectedProject: undefined, selectedWorkspace: undefined, selectedSession: undefined });
    expect(selectProject).not.toHaveBeenCalled();
    expect(selectWorkspace).not.toHaveBeenCalled();
    expect(restoreRouteFor).not.toHaveBeenCalled();

    const workspacePanel = renderTemplate(app, "renderWorkspacePanel");
    const emptyState = propertyValue(workspacePanel, ".emptyState=");
    if (!isWorkspacePanelEmptyState(emptyState)) throw new Error("Expected workspace empty state");
    expect(emptyState).toEqual({
      title: "No projects yet",
      body: "Use Actions → Add Project to add a folder. Workspace tools will appear here after you choose a workspace.",
    });

    const emptyPanel = new WorkspacePanel();
    emptyPanel.emptyState = emptyState;
    expect(strings(emptyPanel.render()).join("")).toContain('<section class="empty-state" role="status">');
  });

  it("starts through the existing session flow only after the dashboard chooser selects its workspace", async () => {
    const app = createApp();
    const original = appState();
    const selectedProject = original.projects[0];
    if (selectedProject === undefined) throw new Error("Expected project");
    setState(app, original);
    Reflect.set(app, "topLevelPage", "dashboard");
    const chosen = workspace("chosen");
    const selectWorkspace = vi.fn(() => {
      setState(app, { ...original, selectedProject, selectedWorkspace: chosen, selectedSession: undefined });
      return Promise.resolve(true);
    });
    Reflect.set(app, "workspaces", { selectWorkspace });
    const start = vi.fn(() => Promise.resolve(true));
    Reflect.set(app, "sessions", { startSession: start });
    const updateUrl = vi.fn();
    Reflect.set(app, "updateUrl", updateUrl);

    await callAsync(app, "startDashboardSession", chosen);

    expect(selectWorkspace).toHaveBeenCalledWith(chosen, { updateUrl: false, selectSession: false });
    expect(start).toHaveBeenCalledWith({ updateUrl: false });
    expect(updateUrl).toHaveBeenCalledOnce();
    expect(Reflect.get(app, "topLevelPage")).toBe("workspace");
    expect(Reflect.get(app, "state")).toMatchObject({ selectedWorkspace: { id: "chosen" }, selectedSession: undefined });
  });

  it("rolls back the retained selection and stays on the dashboard when backend creation fails", async () => {
    const app = createApp();
    const original = appState();
    const chosen = workspace("chosen");
    setState(app, original);
    Reflect.set(app, "topLevelPage", "dashboard");
    Reflect.set(app, "workspaces", { selectWorkspace: vi.fn(() => {
      setState(app, { ...projectAppState(app), selectedWorkspace: chosen, selectedSession: undefined });
      return Promise.resolve(true);
    }) });
    Reflect.set(app, "sessions", { startSession: vi.fn(() => {
      setState(app, { ...projectAppState(app), error: "backend unavailable" });
      return Promise.resolve(false);
    }) });
    Reflect.set(app, "restoreRouteFor", () => { setState(app, original); return Promise.resolve(); });

    await expect(callAsync(app, "startDashboardSession", chosen)).rejects.toThrow("backend unavailable");

    expect(Reflect.get(app, "topLevelPage")).toBe("dashboard");
    expect(projectAppState(app)).toMatchObject({ selectedProject: original.selectedProject, selectedWorkspace: original.selectedWorkspace, selectedSession: original.selectedSession, error: "" });
  });

  it("selects an explicitly chosen workspace from another project without restoring its remembered session", async () => {
    const app = createApp();
    const original = appState();
    const other = { id: "other", name: "Other", path: "/other", createdAt: "2026-01-01T00:00:00.000Z" };
    const chosen = { ...workspace("other-workspace"), projectId: other.id, path: "/other" };
    setState(app, { ...original, projects: [...original.projects, other] });
    Reflect.set(app, "topLevelPage", "dashboard");
    const selectProject = vi.fn(() => {
      setState(app, { ...projectAppState(app), selectedProject: other, selectedWorkspace: chosen, selectedSession: undefined });
      return Promise.resolve(true);
    });
    Reflect.set(app, "workspaces", { selectProject });
    Reflect.set(app, "sessions", { startSession: vi.fn(() => Promise.resolve(true)) });

    await callAsync(app, "startDashboardSession", chosen);

    expect(selectProject).toHaveBeenCalledWith(other, { workspaceId: chosen.id, selectSession: false, updateUrl: false });
    expect(projectAppState(app).selectedSession).toBeUndefined();
    expect(Reflect.get(app, "topLevelPage")).toBe("workspace");
  });

  it("keeps the dashboard visible when chooser workspace selection fails", async () => {
    const app = createApp();
    setState(app, appState());
    Reflect.set(app, "topLevelPage", "dashboard");
    Reflect.set(app, "workspaces", { selectWorkspace: vi.fn(() => Promise.resolve(false)) });

    await expect(callAsync(app, "startDashboardSession", workspace("chosen"))).rejects.toThrow("That workspace is no longer available.");

    expect(Reflect.get(app, "topLevelPage")).toBe("dashboard");
  });

  it("leaves the dashboard after successful desktop project and session navigation", async () => {
    const projectApp = createApp();
    const projectState = appState();
    setState(projectApp, projectState);
    Reflect.set(projectApp, "topLevelPage", "dashboard");
    await callAsync(projectApp, "selectNavigationItem", "projects", "workspaces", () => Promise.resolve(), () => projectAppState(projectApp).selectedProject?.id === "project");
    expect(Reflect.get(projectApp, "topLevelPage")).toBe("workspace");
    expect(projectAppState(projectApp).mainView).toBe("navigation");

    const sessionApp = createApp();
    setState(sessionApp, appState());
    Reflect.set(sessionApp, "topLevelPage", "dashboard");
    await callAsync(sessionApp, "selectNavigationItem", "sessions", "chat", () => Promise.resolve(), () => projectAppState(sessionApp).selectedSession?.id === "session");
    expect(Reflect.get(sessionApp, "topLevelPage")).toBe("workspace");
    expect(projectAppState(sessionApp).mainView).toBe("chat");
  });

  it("leaves the dashboard through the Sessions mobile destination after workspace navigation", async () => {
    const app = createApp();
    setState(app, appState());
    setMobileLayout(app);
    Reflect.set(app, "topLevelPage", "dashboard");

    await callAsync(app, "selectNavigationItem", "workspaces", "sessions", () => Promise.resolve(), () => projectAppState(app).selectedWorkspace?.id === "workspace");

    expect(Reflect.get(app, "topLevelPage")).toBe("workspace");
    expect(Reflect.get(app, "mobileDestination")).toBe("sessions");
  });

  it.each([
    ["projects", "workspaces", (state: AppState) => {
      if (state.selectedProject === undefined) throw new Error("Expected selected project");
      return { ...state, selectedProject: { ...state.selectedProject, id: "partial-project" } };
    }],
    ["workspaces", "sessions", (state: AppState) => ({ ...state, selectedWorkspace: workspace("partial-workspace"), selectedSession: undefined })],
    ["sessions", "chat", (state: AppState) => ({ ...state, selectedSession: session("partial-session") })],
  ] as const)("rolls back a failed dashboard %s selection", async (section, target, partial) => {
    const app = createApp();
    const original = appState();
    setState(app, original);
    Reflect.set(app, "topLevelPage", "dashboard");
    Reflect.set(app, "restoreRouteFor", () => { setState(app, original); return Promise.resolve(); });

    await callAsync(app, "selectNavigationItem", section, target, () => {
      setState(app, { ...partial(projectAppState(app)), error: "offline" });
      return Promise.resolve();
    }, () => false);

    expect(Reflect.get(app, "topLevelPage")).toBe("dashboard");
    expect(projectAppState(app)).toMatchObject({ selectedProject: original.selectedProject, selectedWorkspace: original.selectedWorkspace, selectedSession: original.selectedSession, error: "offline" });
  });

  it("does not let a stale failed dashboard selection clear a newer successful selection", async () => {
    const app = createApp();
    setState(app, initialAppState());
    Reflect.set(app, "topLevelPage", "dashboard");
    const rollback = deferred<undefined>();
    const clearSelection = vi.fn();
    Reflect.set(app, "restoreRouteFor", vi.fn(() => rollback.promise));
    Reflect.set(app, "workspaces", { clearSelection });

    const failedFirst = callAsync(app, "selectNavigationItem", "projects", "workspaces", () => {
      setState(app, { ...projectAppState(app), selectedProject: { id: "partial", name: "Partial", path: "/partial", createdAt: "2026-01-01T00:00:00.000Z" }, error: "offline" });
      return Promise.resolve();
    }, () => false);
    await flush();

    const successfulSecond = callAsync(app, "selectNavigationItem", "projects", "workspaces", () => {
      setState(app, appState());
      return Promise.resolve();
    }, () => projectAppState(app).selectedProject?.id === "project");
    await successfulSecond;
    rollback.resolve(undefined);
    await failedFirst;

    expect(clearSelection).not.toHaveBeenCalled();
    expect(Reflect.get(app, "topLevelPage")).toBe("workspace");
    expect(projectAppState(app)).toMatchObject({ selectedProject: { id: "project" }, selectedWorkspace: { id: "workspace" }, selectedSession: { id: "session" }, error: "" });
  });

  it("clears a failed navigation target when the dashboard retained no selection", async () => {
    const app = createApp();
    const original = initialAppState();
    setState(app, original);
    Reflect.set(app, "topLevelPage", "dashboard");
    Reflect.set(app, "restoreRouteFor", () => Promise.resolve());

    await callAsync(app, "selectNavigationItem", "projects", "workspaces", () => {
      setState(app, { ...projectAppState(app), selectedProject: { id: "partial", name: "Partial", path: "/partial", createdAt: "2026-01-01T00:00:00.000Z" }, selectedWorkspace: workspace("partial"), error: "offline" });
      return Promise.resolve();
    }, () => false);

    expect(projectAppState(app)).toMatchObject({ selectedProject: undefined, selectedWorkspace: undefined, selectedSession: undefined, error: "offline" });
    expect(Reflect.get(app, "topLevelPage")).toBe("dashboard");
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
function projectAppState(app: PiWebApp): AppState {
  const state: unknown = Reflect.get(app, "state");
  if (!isAppState(state)) throw new Error("App state unavailable");
  return state;
}
function isAppState(value: unknown): value is AppState { return typeof value === "object" && value !== null && "projects" in value && "selectedWorkspace" in value && "mainView" in value; }
function setMobileLayout(app: PiWebApp): void {
  const shell: unknown = Reflect.get(app, "appShell");
  if (typeof shell !== "object" || shell === null || !("isMobileNavigationLayout" in shell)) throw new Error("App shell unavailable");
  if (!Reflect.set(shell, "isMobileNavigationLayout", true)) throw new Error("Could not set mobile layout");
}

function renderTemplate(app: PiWebApp, name: string): TemplateResult {
  const method: unknown = Reflect.get(app, name);
  if (!isUnknownMethod(method)) throw new Error(`Missing ${name}`);
  const template = method.call(app);
  if (!isTemplate(template)) throw new Error(`${name} did not return a template`);
  return template;
}

function actions(app: PiWebApp): AppAction[] {
  const method: unknown = Reflect.get(app, "getActions");
  if (!isUnknownMethod(method)) throw new Error("Actions unavailable");
  const result = method.call(app);
  if (!Array.isArray(result) || !result.every(isAppAction)) throw new Error("Invalid actions");
  return result;
}

function binding(template: TemplateResult, marker: string): (...args: unknown[]) => void {
  const handler = propertyValue(template, marker);
  if (!isTemplateBinding(handler)) throw new Error(`Binding ${marker} unavailable`);
  return handler;
}

function propertyValue(template: TemplateResult, marker: string): unknown {
  const index = strings(template).findIndex((value) => value.includes(marker));
  if (index < 0) throw new Error(`Property ${marker} unavailable`);
  return values(template)[index];
}

function findTemplate(template: TemplateResult, marker: string): TemplateResult {
  if (strings(template).some((value) => value.includes(marker))) return template;
  for (const value of values(template)) {
    const found = findNestedTemplate(value, marker);
    if (found !== undefined) return found;
  }
  throw new Error(`Template ${marker} unavailable`);
}

function findNestedTemplate(value: unknown, marker: string): TemplateResult | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedTemplate(item, marker);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return isTemplate(value) ? (strings(value).some((item) => item.includes(marker)) ? value : values(value).map((item) => findNestedTemplate(item, marker)).find((item) => item !== undefined)) : undefined;
}

function templateMarkup(template: TemplateResult): string {
  return `${strings(template).join("")}${values(template).map((value) => nestedMarkup(value)).join("")}`;
}

function nestedMarkup(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => nestedMarkup(item)).join("");
  return isTemplate(value) ? templateMarkup(value) : "";
}

function occurrences(value: string, search: string): number {
  return value.split(search).length - 1;
}

function strings(template: TemplateResult): readonly string[] {
  const value: unknown = Reflect.get(template, "strings");
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error("Template strings unavailable");
  return value;
}

function values(template: TemplateResult): readonly unknown[] {
  const value: unknown = Reflect.get(template, "values");
  if (!Array.isArray(value)) throw new Error("Template values unavailable");
  return value;
}

function isTemplate(value: unknown): value is TemplateResult {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "strings"));
}

function isAppAction(value: unknown): value is AppAction {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "id") === "string" && typeof Reflect.get(value, "run") === "function";
}

function isWorkspacePanelEmptyState(value: unknown): value is WorkspacePanelEmptyState {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "title") === "string";
}

function isTemplateBinding(value: unknown): value is (...args: unknown[]) => void {
  return typeof value === "function";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
