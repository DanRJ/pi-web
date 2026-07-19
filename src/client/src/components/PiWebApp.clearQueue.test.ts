import type { TemplateResult } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MachineRuntime, SessionInfo, SessionStatus } from "../api";
import { initialAppState, type AppState } from "../appState";
import { SessionController } from "../controllers/sessionController";
import { PI_WEB_CAPABILITIES } from "../../../shared/capabilities";
import { PiWebApp } from "./PiWebApp";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PiWebApp queued-message clear wiring", () => {
  it("passes authoritative command waiting state to ChatView", () => {
    const app = createApp();
    const state = stateWithRuntime(undefined);
    state.commandDialog = { type: "select", requestId: "command-1", title: "Choose", options: [] };

    expect(templateValueAfterMarker(renderChatView(app, state), ".waitingForUser=")).toBe(true);
  });

  it("passes a stable supported-runtime callback through to SessionController", () => {
    const app = createApp();
    const state = stateWithRuntime(runtimeWithCapabilities([PI_WEB_CAPABILITIES.sessionsClearQueue]));
    setAppState(app, state);
    const controller = appSessionController(app);
    const clearServerQueue = vi.spyOn(controller, "clearServerQueue").mockResolvedValue(undefined);

    const firstRender = renderChatView(app, state);
    const secondRender = renderChatView(app, state);
    const firstCallback = templateCallbackAfterMarker(firstRender, ".onClearServerQueue=");
    const secondCallback = templateCallbackAfterMarker(secondRender, ".onClearServerQueue=");

    expect(templateValueAfterMarker(firstRender, ".canClearServerQueue=")).toBe(true);
    expect(secondCallback).toBe(firstCallback);
    firstCallback();
    expect(clearServerQueue).toHaveBeenCalledOnce();
  });

  it("passes false when runtime discovery is unavailable, unhealthy, or lacks the capability", () => {
    const app = createApp();
    const runtimes: (MachineRuntime | undefined)[] = [
      undefined,
      { ...runtimeWithCapabilities([PI_WEB_CAPABILITIES.sessionsClearQueue]), ok: false },
      runtimeWithCapabilities([PI_WEB_CAPABILITIES.sessionsReload]),
    ];

    for (const runtime of runtimes) {
      const state = stateWithRuntime(runtime);
      setAppState(app, state);
      expect(templateValueAfterMarker(renderChatView(app, state), ".canClearServerQueue=")).toBe(false);
    }
  });

  it("keeps Stop available as the queue-only abort fallback without queue-clear capability", () => {
    const app = createApp();
    const state = stateWithRuntime(runtimeWithCapabilities([PI_WEB_CAPABILITIES.sessionsReload]));
    state.status = { ...queuedStatus(), isStreaming: false, pendingMessageCount: 1 };
    setAppState(app, state);

    expect(canStop(app, state.status)).toBe(true);
    expect(stopClearsServerQueue(app, state.status)).toBe(true);
    expect(templateValueAfterMarker(renderChatView(app, state), ".canStop=")).toBe(true);
    expect(templateValueAfterMarker(renderChatView(app, state), ".clearsServerQueue=")).toBe(true);
    expect(templateValueAfterMarker(renderChatView(app, state), ".canClearServerQueue=")).toBe(false);
    expect(templateValuesAfterMarkerDeep(app.render(), ".canStop=")).toEqual(expect.arrayContaining([true]));
    expect(templateValuesAfterMarkerDeep(app.render(), ".clearsServerQueue=")).toEqual(expect.arrayContaining([true]));
  });

  it("keeps Stop available for active work but does not promise queue clearing when the authoritative pending count is zero", () => {
    const app = createApp();
    const state = stateWithRuntime(runtimeWithCapabilities([PI_WEB_CAPABILITIES.sessionsReload]));
    state.status = { ...queuedStatus(), isStreaming: true, pendingMessageCount: 0, queuedMessages: [{ kind: "followUp", text: "stale listed row" }] };
    setAppState(app, state);

    expect(canStop(app, state.status)).toBe(true);
    expect(stopClearsServerQueue(app, state.status)).toBe(false);
    expect(templateValueAfterMarker(renderChatView(app, state), ".canStop=")).toBe(true);
    expect(templateValueAfterMarker(renderChatView(app, state), ".clearsServerQueue=")).toBe(false);
    expect(templateValuesAfterMarkerDeep(app.render(), ".clearsServerQueue=")).toEqual(expect.arrayContaining([false]));
  });
});

type RenderChatView = (this: PiWebApp, state: AppState, session: SessionInfo) => TemplateResult;
type SessionStopCheck = (this: PiWebApp, status?: SessionStatus) => boolean;
type ClearServerQueueCallback = () => void;

function createApp(): PiWebApp {
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  vi.stubGlobal("window", { location: { search: "" }, localStorage: storage });
  const app = new PiWebApp();
  Reflect.set(app, "getBoundingClientRect", () => ({ width: 0 }));
  return app;
}

function stateWithRuntime(runtime: MachineRuntime | undefined): AppState {
  const session: SessionInfo = {
    id: "session-1",
    cwd: "/repo",
    path: "/repo/session-1.jsonl",
    created: "2026-07-14T00:00:00.000Z",
    modified: "2026-07-14T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "hello",
  };
  return {
    ...initialAppState(),
    selectedSession: session,
    status: queuedStatus(),
    machineRuntimes: runtime === undefined ? {} : { local: runtime },
  };
}

function runtimeWithCapabilities(capabilities: NonNullable<MachineRuntime["capabilities"]>): MachineRuntime {
  return { machineId: "local", ok: true, checkedAt: "2026-07-14T00:00:00.000Z", capabilities };
}

function queuedStatus(): SessionStatus {
  return {
    sessionId: "session-1",
    isStreaming: true,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 1,
    queuedMessages: [{ kind: "followUp", text: "queued" }],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

function setAppState(app: PiWebApp, state: AppState): void {
  if (!Reflect.set(app, "state", state)) throw new Error("Could not set PiWebApp state");
}

function appSessionController(app: PiWebApp): SessionController {
  const controller: unknown = Reflect.get(app, "sessions");
  if (!(controller instanceof SessionController)) throw new Error("PiWebApp SessionController was unavailable");
  return controller;
}

function renderChatView(app: PiWebApp, state: AppState): TemplateResult {
  const method: unknown = Reflect.get(app, "renderChatView");
  if (!isRenderChatView(method)) throw new Error("PiWebApp.renderChatView is not callable");
  const session = state.selectedSession;
  if (session === undefined) throw new Error("Expected a selected session");
  return method.call(app, state, session);
}

function isRenderChatView(value: unknown): value is RenderChatView {
  return typeof value === "function";
}

function canStop(app: PiWebApp, status: SessionStatus): boolean {
  return sessionStopCheck(app, "canStopActiveWork").call(app, status);
}

function stopClearsServerQueue(app: PiWebApp, status: SessionStatus): boolean {
  return sessionStopCheck(app, "stopClearsServerQueue").call(app, status);
}

function sessionStopCheck(app: PiWebApp, property: "canStopActiveWork" | "stopClearsServerQueue"): SessionStopCheck {
  const check: unknown = Reflect.get(app, property);
  if (!isSessionStopCheck(check)) throw new Error(`PiWebApp.${property} is not callable`);
  return check;
}

function isSessionStopCheck(value: unknown): value is SessionStopCheck {
  return typeof value === "function";
}

function templateCallbackAfterMarker(template: TemplateResult, marker: string): ClearServerQueueCallback {
  const value = templateValueAfterMarker(template, marker);
  if (!isClearServerQueueCallback(value)) throw new Error(`Expected callback after ${marker}`);
  return value;
}

function isClearServerQueueCallback(value: unknown): value is ClearServerQueueCallback {
  return typeof value === "function";
}

function templateValueAfterMarker(template: TemplateResult, marker: string): unknown {
  const strings = templateStrings(template);
  const values = templateValues(template);
  const index = strings.findIndex((part) => part.includes(marker));
  if (index < 0) throw new Error(`Expected template marker ${marker}`);
  return values[index];
}

function templateStrings(template: TemplateResult): readonly string[] {
  const strings = Reflect.get(template, "strings");
  if (!isStringArray(strings)) throw new Error("TemplateResult strings were unavailable");
  return strings;
}

function templateValues(template: TemplateResult): readonly unknown[] {
  const values = Reflect.get(template, "values");
  if (!Array.isArray(values)) throw new Error("TemplateResult values were unavailable");
  return values.map((value: unknown) => value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

function templateValuesAfterMarkerDeep(template: TemplateResult, marker: string): unknown[] {
  const matches: unknown[] = [];
  visit(template);
  return matches;

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isTemplateResult(value)) return;
    const strings = templateStrings(value);
    const values = templateValues(value);
    for (let index = 0; index < values.length; index += 1) {
      if (strings[index]?.includes(marker) === true) matches.push(values[index]);
      visit(values[index]);
    }
  }
}

function isTemplateResult(value: unknown): value is TemplateResult {
  return typeof value === "object" && value !== null && isStringArray(Reflect.get(value, "strings")) && Array.isArray(Reflect.get(value, "values"));
}
