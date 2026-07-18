import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, deferred, EmitSocket, emptyPage, FakeSocket, oldSession, replacementSession, runPendingAnimationFrames, status, workspace, type AppState, type SessionActivity, type SessionInfo } from "./sessionController.testSupport";

describe("SessionController live events", () => {
  it("idempotently applies and clears names for list and selected session", () => {
    let state: AppState = { ...initialAppState(), selectedSession: oldSession, sessions: [oldSession] };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { socket: new FakeSocket() });

    controller.applySessionName(oldSession.id, "Release work");
    controller.applySessionName(oldSession.id, "Release work");
    expect(state.selectedSession?.name).toBe("Release work");
    expect(state.sessions[0]?.name).toBe("Release work");
    controller.applySessionName(oldSession.id);
    expect(state.selectedSession?.name).toBeUndefined();
    expect(state.sessions[0]?.name).toBeUndefined();
  });

  it("coalesces rapid status updates into a single state write per frame", () => {
    const setStateCalls: Partial<AppState>[] = [];
    let state: AppState = { ...initialAppState(), selectedSession: oldSession, sessions: [oldSession] };
    const controller = new SessionController(
      () => state,
      (patch) => { setStateCalls.push(patch); state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { socket: new FakeSocket() },
    );

    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true, messageCount: 1 } });
    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true, messageCount: 2 } });
    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true, messageCount: 3 } });

    // Nothing applies until the frame is flushed; last-write-wins per session.
    expect(setStateCalls).toHaveLength(0);
    expect(state.sessionStatuses[oldSession.id]).toBeUndefined();

    runPendingAnimationFrames();

    expect(setStateCalls).toHaveLength(1);
    expect(state.sessionStatuses[oldSession.id]).toMatchObject({ sessionId: oldSession.id, messageCount: 3 });
    expect(state.status?.messageCount).toBe(3);
  });

  it("applies the latest activity per session on flush", () => {
    const setStateCalls: Partial<AppState>[] = [];
    let state: AppState = { ...initialAppState(), selectedSession: oldSession, sessions: [oldSession] };
    const controller = new SessionController(
      () => state,
      (patch) => { setStateCalls.push(patch); state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { socket: new FakeSocket() },
    );

    controller.applyGlobalEvent({ type: "activity.update", activity: { sessionId: oldSession.id, phase: "active", label: "running tool", at: "t1" } });
    controller.applyGlobalEvent({ type: "activity.update", activity: { sessionId: oldSession.id, phase: "idle", label: "idle", at: "t2" } });

    expect(setStateCalls).toHaveLength(0);

    controller.flushPendingUpdates();

    expect(state.sessionActivities[oldSession.id]).toMatchObject({ phase: "idle", label: "idle" });
    expect(state.activity?.phase).toBe("idle");
  });

  it("coalesces status updates delivered over the per-session socket until the frame is flushed", async () => {
    const socket = new EmitSocket();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(emptyPage),
      status: () => Promise.resolve(status(oldSession.id)),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket },
    );
    await controller.selectSession(oldSession, { updateUrl: false });

    socket.emit({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true, messageCount: 7 } });
    socket.emit({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true, messageCount: 8 } });

    // Buffered, not applied synchronously.
    expect(state.sessionStatuses[oldSession.id]?.messageCount).toBeUndefined();

    controller.flushPendingUpdates();

    expect(state.sessionStatuses[oldSession.id]?.messageCount).toBe(8);
    expect(state.status?.messageCount).toBe(8);
  });

  it("clears stale active activity when an idle status arrives", () => {
    const activeActivity: SessionActivity = { sessionId: oldSession.id, phase: "active", label: "running tool", at: "2026-05-15T00:00:00.000Z" };
    let state: AppState = {
      ...initialAppState(),
      selectedSession: oldSession,
      sessions: [oldSession],
      activity: activeActivity,
      sessionActivities: { [oldSession.id]: activeActivity },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { socket: new FakeSocket() },
    );

    controller.applyGlobalEvent({ type: "status.update", status: status(oldSession.id) });
    controller.flushPendingUpdates();

    expect(state.activity).toBeUndefined();
    expect(state.sessionActivities[oldSession.id]).toBeUndefined();
    expect(state.sessionStatuses[oldSession.id]).toMatchObject({ sessionId: oldSession.id, isStreaming: false });
  });

  it("updates visible session message counts from live status events", () => {
    let state: AppState = {
      ...initialAppState(),
      selectedSession: oldSession,
      sessions: [oldSession],
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { socket: new FakeSocket() },
    );

    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), messageCount: 3 } });
    controller.flushPendingUpdates();

    expect(state.sessions[0]?.messageCount).toBe(3);
    expect(state.selectedSession?.messageCount).toBe(3);
  });

  it("adds a newly created session to the list when it belongs to the selected workspace", () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { socket: new FakeSocket() },
    );
    const spawned: SessionInfo = { ...oldSession, id: "spawned-session", path: "/tmp/spawned-session.jsonl" };

    controller.applyGlobalEvent({ type: "session.created", session: spawned });

    expect(state.sessions.map((session) => session.id)).toEqual(["spawned-session", "old-session"]);
  });

  it("converges live extension requests and resolutions without adding them to the transcript", async () => {
    const socket = new EmitSocket();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(emptyPage),
      status: () => Promise.resolve(status(oldSession.id)),
      extensionUiPending: () => Promise.resolve({ requests: [] }),
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket },
    );

    await controller.selectSession(oldSession, { updateUrl: false });
    socket.emit({ type: "extension-ui.request", request: { id: "dialog-1", state: "pending", method: "confirm", title: "Delete", message: "Really?" } });
    socket.emit({ type: "extension-ui.request", request: { id: "dialog-1", state: "pending", method: "confirm", title: "Delete", message: "Really?" } });
    socket.emit({ type: "extension-ui.resolved", resolution: { id: "dialog-1", state: "submitted", response: { id: "dialog-1", confirmed: true } } });

    expect(state.extensionUiRequests).toEqual([]);
    expect(state.extensionUiResolutions).toEqual([{ id: "dialog-1", state: "submitted", response: { id: "dialog-1", confirmed: true } }]);
    expect(state.messages).toEqual([]);
  });

  it("submits an extension response and applies the returned resolution", async () => {
    let state: AppState = {
      ...initialAppState(),
      selectedSession: oldSession,
      sessions: [oldSession],
      extensionUiRequests: [{ id: "dialog-1", state: "pending", method: "input", title: "Name" }],
    };
    const respondToExtensionUi = vi.fn(() => Promise.resolve({ outcome: "accepted" as const, resolution: { id: "dialog-1", state: "submitted" as const, response: { id: "dialog-1", value: "Ada" } } }));
    const api: typeof defaultApi = { ...defaultApi, respondToExtensionUi };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.respondToExtensionUi({ id: "dialog-1", value: "Ada" });

    expect(respondToExtensionUi).toHaveBeenCalledWith(oldSession, { id: "dialog-1", value: "Ada" }, "local");
    expect(state.extensionUiRequests).toEqual([]);
    expect(state.extensionUiResolutions).toEqual([{ id: "dialog-1", state: "submitted", response: { id: "dialog-1", value: "Ada" } }]);
  });

  it("does not retain extension reconciliation mutations across repeated live submissions", async () => {
    const socket = new EmitSocket();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(emptyPage),
      status: () => Promise.resolve(status(oldSession.id)),
      extensionUiPending: () => Promise.resolve({ requests: [] }),
      thinkingLevels: () => Promise.resolve({ levels: [] }),
      respondToExtensionUi: (_session, response) => Promise.resolve({
        outcome: "accepted" as const,
        resolution: { id: response.id, state: "submitted" as const, response },
      }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket },
    );

    await controller.selectSession(oldSession, { updateUrl: false });
    for (let index = 0; index < 32; index += 1) {
      const id = `dialog-${String(index)}`;
      socket.emit({ type: "extension-ui.request", request: { id, state: "pending", method: "confirm", title: "Confirm", message: "Continue?" } });

      await expect(controller.respondToExtensionUi({ id, confirmed: true })).resolves.toBe("settled");
      expect(state.extensionUiRequests).toEqual([]);
      expect(controller.extensionUiMutationLogSizeForTesting).toBe(0);
    }
  });

  it("keeps failed or invalid extension submissions retryable and removes stale requests", async () => {
    let attempt = 0;
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      sessions: [oldSession],
      extensionUiRequests: [{ id: "dialog-1", state: "pending", method: "input", title: "Name" }],
    };
    const api: typeof defaultApi = {
      ...defaultApi,
      respondToExtensionUi: () => {
        attempt += 1;
        if (attempt === 1) return Promise.reject(new Error("network down"));
        if (attempt === 2) return Promise.resolve({ outcome: "invalid-response" });
        return Promise.resolve({ outcome: "not-found" });
      },
      messages: () => Promise.resolve(emptyPage),
      status: () => Promise.resolve(status(oldSession.id)),
      extensionUiPending: () => Promise.resolve({ requests: [] }),
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await expect(controller.respondToExtensionUi({ id: "dialog-1", value: "Ada" })).resolves.toBe("retry");
    expect(state.extensionUiRequests).toHaveLength(1);
    await expect(controller.respondToExtensionUi({ id: "dialog-1", value: "Ada" })).resolves.toBe("retry");
    expect(state.extensionUiRequests).toHaveLength(1);
    await expect(controller.respondToExtensionUi({ id: "dialog-1", value: "Ada" })).resolves.toBe("removed");
    expect(state.extensionUiRequests).toEqual([]);
  });

  it("does not apply a deferred extension response after the selected session changes", async () => {
    const response = deferred<{ outcome: "accepted"; resolution: { id: string; state: "submitted"; response: { id: string; value: string } } }>();
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      sessions: [oldSession, replacementSession],
      extensionUiRequests: [{ id: "dialog-1", state: "pending", method: "input", title: "Name" }],
    };
    const api: typeof defaultApi = {
      ...defaultApi,
      respondToExtensionUi: () => response.promise,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(typeof session === "string" ? session : session.id)),
      extensionUiPending: () => Promise.resolve({ requests: [] }),
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const submit = controller.respondToExtensionUi({ id: "dialog-1", value: "Ada" });
    await controller.selectSession(replacementSession, { updateUrl: false });
    response.resolve({ outcome: "accepted", resolution: { id: "dialog-1", state: "submitted", response: { id: "dialog-1", value: "Ada" } } });

    await expect(submit).resolves.toBe("removed");
    expect(state.selectedSession?.id).toBe(replacementSession.id);
    expect(state.extensionUiRequests).toEqual([]);
    expect(state.extensionUiResolutions).toEqual([]);
  });

  it("ignores a created session for a different workspace or a duplicate id", () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { socket: new FakeSocket() },
    );

    controller.applyGlobalEvent({ type: "session.created", session: { ...oldSession, id: "other", cwd: "/other-repo" } });
    controller.applyGlobalEvent({ type: "session.created", session: { ...oldSession } });

    expect(state.sessions.map((session) => session.id)).toEqual(["old-session"]);
  });
});
