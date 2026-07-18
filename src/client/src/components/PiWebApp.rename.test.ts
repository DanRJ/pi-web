import { afterEach, describe, expect, it, vi } from "vitest";
import type { Machine, MachineRuntime, SessionInfo } from "../api";
import { sessionsApi } from "../api/clients";
import { initialAppState, type AppState } from "../appState";
import { PI_WEB_CAPABILITIES } from "../../../shared/capabilities";
import { PiWebApp } from "./PiWebApp";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("PiWebApp session rename", () => {
  it("converges a local successful rename across the selected session, list, and dashboard then returns focus", async () => {
    const app = createApp();
    const state = stateFor("local");
    setState(app, state);
    const applySessionName = vi.spyOn(sessionController(app), "applySessionName");
    const dashboard = dashboardRenamer(app);
    const applyDashboardName = vi.spyOn(dashboard, "applySessionName");
    vi.spyOn(sessionsApi, "rename").mockResolvedValue({ sessionId: "session", name: "Renamed" });
    const focus = vi.fn();
    Reflect.set(app, "sessionRenameTarget", { machineId: "local", sessionId: "session", cwd: "/repo", oldName: "Old", opener: { isConnected: true, focus } });

    await callSubmit(app, "Renamed");
    await Promise.resolve();

    expect(applySessionName).toHaveBeenCalledWith("session", "Renamed");
    expect(applyDashboardName).toHaveBeenCalledWith("local", "session", "Renamed");
    expect(Reflect.get(app, "sessionRenameTarget")).toBeUndefined();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("keeps the remote dialog, old name, and focusable retry error when its revision becomes stale", async () => {
    const app = createApp();
    const state = stateFor("remote");
    setState(app, state);
    const applySessionName = vi.spyOn(sessionController(app), "applySessionName");
    const dashboard = dashboardRenamer(app);
    const applyDashboardName = vi.spyOn(dashboard, "applySessionName");
    const rename = vi.spyOn(sessionsApi, "rename").mockResolvedValue({ sessionId: "session", name: "Wrong remote result" });
    const target = { machineId: "remote", sessionId: "session", cwd: "/repo", oldName: "Old", machineRevision: "before" };
    Reflect.set(app, "sessionRenameTarget", target);
    setState(app, { ...state, machines: state.machines.map((machine) => machine.id === "remote" ? { ...machine, updatedAt: "after" } : machine) });

    await callSubmit(app, "Renamed");

    expect(rename).not.toHaveBeenCalled();
    expect(applySessionName).not.toHaveBeenCalled();
    expect(applyDashboardName).not.toHaveBeenCalled();
    expect(Reflect.get(app, "sessionRenameTarget")).toBe(target);
    expect(Reflect.get(app, "sessionRenameError")).toBe("This machine changed. Reopen Rename and try again.");
    expect(projectState(app).selectedSession?.name).toBe("Old");
  });

  it("keeps an old remote name and dialog on failed writes without restoring a runtime", async () => {
    const app = createApp();
    const state = stateFor("remote");
    setState(app, state);
    const machines = { refreshMachineRuntime: vi.fn() };
    Reflect.set(app, "machines", machines);
    vi.spyOn(sessionsApi, "rename").mockRejectedValue(new Error("offline"));
    const target = { machineId: "remote", sessionId: "session", cwd: "/repo", oldName: "Old", machineRevision: "now" };
    Reflect.set(app, "sessionRenameTarget", target);

    await callSubmit(app, "Renamed");

    expect(Reflect.get(app, "sessionRenameTarget")).toBe(target);
    expect(Reflect.get(app, "sessionRenameError")).toContain("offline");
    expect(projectState(app).selectedSession?.name).toBe("Old");
    expect(machines.refreshMachineRuntime).not.toHaveBeenCalled();
  });
});

function createApp(): PiWebApp {
  vi.stubGlobal("window", { location: { search: "", href: "http://localhost/", pathname: "/", hash: "" }, history: { pushState: () => undefined, replaceState: () => undefined }, localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }, matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) });
  const app = new PiWebApp();
  Object.defineProperty(app, "updateComplete", { configurable: true, value: Promise.resolve(true) });
  Reflect.set(app, "getBoundingClientRect", () => ({ width: 0 }));
  return app;
}

function stateFor(machineId: "local" | "remote"): AppState {
  const local: Machine = { id: "local", name: "Local", kind: "local", createdAt: "now", updatedAt: "now" };
  const remote: Machine = { id: "remote", name: "Remote", kind: "remote", baseUrl: "https://remote.example.test", createdAt: "now", updatedAt: "now" };
  const selectedMachine = machineId === "local" ? local : remote;
  const session: SessionInfo = { id: "session", cwd: "/repo", path: "/repo/session.jsonl", name: "Old", created: "now", modified: "now", messageCount: 0, firstMessage: "" };
  const runtime: MachineRuntime = { machineId, ok: true, checkedAt: "now", capabilities: [PI_WEB_CAPABILITIES.sessionsRename] };
  return { ...initialAppState(), machines: [local, remote], selectedMachine, selectedSession: session, sessions: [session], machineRuntimes: { [machineId]: runtime } };
}

function setState(app: PiWebApp, state: AppState): void { Reflect.set(app, "state", state); }
function projectState(app: PiWebApp): AppState {
  const state: unknown = Reflect.get(app, "state");
  if (!isAppState(state)) throw new Error("App state unavailable");
  return state;
}
function sessionController(app: PiWebApp): { applySessionName(sessionId: string, name?: string): void } {
  const controller: unknown = Reflect.get(app, "sessions");
  if (!hasSessionNameApplicator(controller)) throw new Error("Session controller unavailable");
  return controller;
}
function dashboardRenamer(app: PiWebApp): { applySessionName(machineId: string, sessionId: string, name?: string): void } {
  const dashboard: unknown = Reflect.get(app, "dashboard");
  if (!hasDashboardNameApplicator(dashboard)) throw new Error("Dashboard controller unavailable");
  return dashboard;
}
async function callSubmit(app: PiWebApp, name: string): Promise<void> {
  const submit: unknown = Reflect.get(app, "submitSessionRename");
  if (typeof submit !== "function") throw new Error("Rename submitter unavailable");
  await submit.call(app, name);
}
function isAppState(value: unknown): value is AppState {
  return typeof value === "object" && value !== null && "sessions" in value && "machineRuntimes" in value;
}
function hasSessionNameApplicator(value: unknown): value is { applySessionName(sessionId: string, name?: string): void } {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "applySessionName") === "function";
}
function hasDashboardNameApplicator(value: unknown): value is { applySessionName(machineId: string, sessionId: string, name?: string): void } {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "applySessionName") === "function";
}
