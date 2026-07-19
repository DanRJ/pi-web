import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, deferred, EmitSocket, FakeSocket, oldSession, replacementSession, sessionLookupId, status, workspace, type AppState, type MessagePage, type SessionStatus } from "./sessionController.testSupport";

function page(text: string, total: number): MessagePage {
  return { messages: [{ role: "assistant", content: text }], start: 0, total };
}

function emptyPage(): MessagePage {
  return { messages: [], start: 0, total: 0 };
}

class ReconnectSocket extends EmitSocket {}

describe("SessionController selected-session refresh", () => {
  it("shares same-turn requests and runs one trailing refresh requested during the active fetch", async () => {
    const firstPage = deferred<MessagePage>();
    const firstStatus = deferred<SessionStatus>();
    const trailingPage = deferred<MessagePage>();
    const trailingStatus = deferred<SessionStatus>();
    const trailingStarted = deferred<undefined>();
    let messageCalls = 0;
    let statusCalls = 0;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => {
        messageCalls += 1;
        if (messageCalls === 2) trailingStarted.resolve(undefined);
        return messageCalls === 1 ? firstPage.promise : trailingPage.promise;
      },
      status: () => {
        statusCalls += 1;
        return statusCalls === 1 ? firstStatus.promise : trailingStatus.promise;
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const first = controller.refreshSelectedSession();
    const duplicate = controller.refreshSelectedSession();
    await Promise.resolve();

    expect(messageCalls).toBe(1);
    expect(statusCalls).toBe(1);

    const later = controller.refreshSelectedSession();
    const laterDuplicate = controller.refreshSelectedSession();
    firstPage.resolve(page("stale", 1));
    firstStatus.resolve({ ...status(oldSession.id), messageCount: 1 });
    await trailingStarted.promise;

    expect(messageCalls).toBe(2);
    expect(statusCalls).toBe(2);

    trailingPage.resolve(page("fresh", 2));
    trailingStatus.resolve({ ...status(oldSession.id), messageCount: 2 });
    await Promise.all([first, duplicate, later, laterDuplicate]);

    expect(messageCalls).toBe(2);
    expect(statusCalls).toBe(2);
    expect(state.messages).toEqual([{ role: "assistant", parts: [{ type: "text", text: "fresh" }] }]);
    expect(state.status?.messageCount).toBe(2);
  });

  it("replays live extension dialog requests and resolutions over a deferred reconnect discovery", async () => {
    let discoveries = 0;
    const secondDiscoveryStarted = deferred<undefined>();
    const secondDiscovery = deferred<{ requests: [{ id: string; state: "pending"; method: "confirm"; title: string; message: string }] }>();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(emptyPage()),
      status: () => Promise.resolve(status(oldSession.id)),
      extensionUiPending: () => {
        discoveries += 1;
        if (discoveries === 1) return Promise.resolve({ requests: [{ id: "request-1", state: "pending" as const, method: "input" as const, title: "First" }] });
        secondDiscoveryStarted.resolve(undefined);
        return secondDiscovery.promise;
      },
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const reconnectingSocket = new ReconnectSocket();
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: reconnectingSocket },
    );

    await controller.selectSession(oldSession, { updateUrl: false });
    expect(state.extensionUiRequests.map((request) => request.id)).toEqual(["request-1"]);

    reconnectingSocket.reconnect();
    await secondDiscoveryStarted.promise;
    reconnectingSocket.emit({ type: "extension-ui.request", request: { id: "live-resolved", state: "pending", method: "confirm", title: "Live", message: "Resolve me" } });
    reconnectingSocket.emit({ type: "extension-ui.resolved", resolution: { id: "live-resolved", state: "submitted", response: { id: "live-resolved", confirmed: true } } });
    reconnectingSocket.emit({ type: "extension-ui.request", request: { id: "live-pending", state: "pending", method: "input", title: "Keep me" } });
    secondDiscovery.resolve({ requests: [{ id: "snapshot-pending", state: "pending", method: "confirm", title: "Snapshot", message: "Older HTTP view" }] });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(discoveries).toBe(2);
    expect(state.extensionUiRequests.map((request) => request.id)).toEqual(["snapshot-pending", "live-pending"]);
    expect(state.extensionUiResolutions).toEqual([{ id: "live-resolved", state: "submitted", response: { id: "live-resolved", confirmed: true } }]);
  });

  it("does not apply an older refresh after the user selects another session", async () => {
    const stalePage = deferred<MessagePage>();
    const staleStatus = deferred<SessionStatus>();
    const replacementPage = page("replacement", 1);
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession, replacementSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: (session) => sessionLookupId(session) === oldSession.id ? stalePage.promise : Promise.resolve(replacementPage),
      status: (session) => sessionLookupId(session) === oldSession.id ? staleStatus.promise : Promise.resolve(status(replacementSession.id)),
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const staleRefresh = controller.refreshSelectedSession();
    await Promise.resolve();
    await controller.selectSession(replacementSession, { updateUrl: false });
    stalePage.resolve(page("old response", 1));
    staleStatus.resolve({ ...status(oldSession.id), messageCount: 1 });
    await staleRefresh;

    expect(state.selectedSession?.id).toBe(replacementSession.id);
    expect(state.messages).toEqual([{ role: "assistant", parts: [{ type: "text", text: "replacement" }] }]);
    expect(state.status?.sessionId).toBe(replacementSession.id);
  });
});
