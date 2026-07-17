import { afterEach, describe, expect, it, vi } from "vitest";
import type { FederatedSessionDashboardResponse } from "../../../shared/sessionDashboard";
import { DashboardController, type DashboardControllerState } from "./dashboardController";

afterEach(() => vi.useRealTimers());

describe("DashboardController", () => {
  it("keeps the newest refresh when an older request resolves late", async () => {
    const first = deferred<FederatedSessionDashboardResponse>();
    const second = deferred<FederatedSessionDashboardResponse>();
    let state: DashboardControllerState = { dashboard: undefined, loading: false, error: undefined };
    let calls = 0;
    const controller = new DashboardController(() => state, (next) => { state = next; }, { load: () => ++calls === 1 ? first.promise : second.promise });
    const oldRequest = controller.refresh();
    const newRequest = controller.refresh();
    second.resolve(snapshot("fresh"));
    await newRequest;
    first.resolve(snapshot("stale"));
    await oldRequest;
    expect(state.dashboard?.machines[0]).toMatchObject({ sessions: [{ id: "fresh" }] });
  });

  it("passes the owned signal to a normal dashboard load", async () => {
    let state: DashboardControllerState = { dashboard: undefined, loading: false, error: undefined };
    let receivedSignal: AbortSignal | undefined;
    const controller = new DashboardController(() => state, (next) => { state = next; }, {
      load: (signal) => {
        receivedSignal = signal;
        return Promise.resolve(snapshot("s1"));
      },
    });

    await controller.refresh();

    expect(receivedSignal?.aborted).toBe(false);
    expect(state.dashboard).toEqual(snapshot("s1"));
  });

  it("aborts a superseded dashboard load", async () => {
    const first = deferred<FederatedSessionDashboardResponse>();
    const second = deferred<FederatedSessionDashboardResponse>();
    const signals: AbortSignal[] = [];
    let state: DashboardControllerState = { dashboard: undefined, loading: false, error: undefined };
    let calls = 0;
    const controller = new DashboardController(() => state, (next) => { state = next; }, {
      load: (signal) => {
        signals.push(signal);
        return ++calls === 1 ? first.promise : second.promise;
      },
    });

    const oldRefresh = controller.refresh();
    await Promise.resolve();
    const newRefresh = controller.refresh();
    await Promise.resolve();
    expect(signals[0]?.aborted).toBe(true);
    second.resolve(snapshot("fresh"));
    await Promise.all([oldRefresh, newRefresh]);
    expect(state.dashboard?.machines[0]).toMatchObject({ sessions: [{ id: "fresh" }] });
  });

  it("aborts an active dashboard load when disposed", async () => {
    const load = deferred<FederatedSessionDashboardResponse>();
    let state: DashboardControllerState = { dashboard: undefined, loading: false, error: undefined };
    let signal: AbortSignal | undefined;
    const controller = new DashboardController(() => state, (next) => { state = next; }, { load: (nextSignal) => { signal = nextSignal; return load.promise; } });

    const refresh = controller.refresh();
    await Promise.resolve();
    controller.dispose();
    await refresh;

    expect(signal?.aborted).toBe(true);
  });

  it("times out a never-settling load, clears interleaved mutations, and observes a late rejection", async () => {
    vi.useFakeTimers();
    const first = deferred<FederatedSessionDashboardResponse>();
    let state: DashboardControllerState = { dashboard: undefined, loading: false, error: undefined };
    let calls = 0;
    const controller = new DashboardController(() => state, (next) => { state = next; }, {
      load: () => ++calls === 1 ? first.promise : Promise.resolve(snapshot("s0")),
      loadTimeoutMs: 20,
      maxRealtimeMutations: 100,
    });

    const timedOutRefresh = controller.refresh();
    await Promise.resolve();
    for (let index = 0; index < 50; index += 1) {
      controller.applyRealtimeEvent("local", { type: "session.name", sessionId: `s${String(index)}`, name: `Live ${String(index)}` });
    }
    await vi.advanceTimersByTimeAsync(20);
    await timedOutRefresh;

    expect(state).toMatchObject({ loading: false, error: "Dashboard load timed out after 20ms." });
    first.reject(new Error("late dashboard rejection"));
    await Promise.resolve();
    await controller.refresh();
    expect(availableMachine(state).sessions[0]?.name).toBeUndefined();
  });

  it("bounds coalesced mutations by evicting the oldest property and retaining its latest replacement", async () => {
    const load = deferred<FederatedSessionDashboardResponse>();
    let state: DashboardControllerState = { dashboard: snapshot("a", "b", "c"), loading: false, error: undefined };
    const controller = new DashboardController(() => state, (next) => { state = next; }, { load: () => load.promise, maxRealtimeMutations: 2 });

    const refresh = controller.refresh();
    controller.applyRealtimeEvent("local", { type: "session.name", sessionId: "a", name: "Evicted" });
    controller.applyRealtimeEvent("local", { type: "session.name", sessionId: "b", name: "Old b" });
    controller.applyRealtimeEvent("local", { type: "session.name", sessionId: "c", name: "Retained c" });
    controller.applyRealtimeEvent("local", { type: "session.name", sessionId: "b", name: "Latest b" });
    load.resolve(snapshot("a", "b", "c"));
    await refresh;

    expect(availableMachine(state).sessions).toMatchObject([
      { id: "a" },
      { id: "b", name: "Latest b" },
      { id: "c", name: "Retained c" },
    ]);
    expect(availableMachine(state).sessions[0]?.name).toBeUndefined();
  });

  it("prunes replayed mutations before the next aggregate load", async () => {
    const first = deferred<FederatedSessionDashboardResponse>();
    let state: DashboardControllerState = { dashboard: snapshot("s1"), loading: false, error: undefined };
    let calls = 0;
    const controller = new DashboardController(() => state, (next) => { state = next; }, { load: () => ++calls === 1 ? first.promise : Promise.resolve(snapshot("s1")) });

    const firstRefresh = controller.refresh();
    controller.applyRealtimeEvent("local", { type: "session.name", sessionId: "s1", name: "Replayed once" });
    first.resolve(snapshot("s1"));
    await firstRefresh;
    expect(availableMachine(state).sessions[0]).toMatchObject({ name: "Replayed once" });

    await controller.refresh();
    expect(availableMachine(state).sessions[0]?.name).toBeUndefined();
  });

  it("replays status, name, and attention mutations that interleave with a deferred refresh", async () => {
    const load = deferred<FederatedSessionDashboardResponse>();
    let state: DashboardControllerState = { dashboard: snapshot("s1"), loading: false, error: undefined };
    const controller = new DashboardController(() => state, (next) => { state = next; }, { load: () => load.promise });

    const refresh = controller.refresh();
    controller.applyRealtimeEvent("local", { type: "status.update", status: status("s1", true) });
    controller.applyRealtimeEvent("local", { type: "session.name", sessionId: "s1", name: "Live name" });
    controller.applyRealtimeEvent("local", { type: "session.attention", sessionId: "s1", needsAttention: true });
    load.resolve(snapshot("s1"));
    await refresh;

    expect(state.dashboard?.machines[0]).toMatchObject({ sessions: [{ id: "s1", name: "Live name", runtimeStatus: "active", displayStatus: "waiting", needsAttention: true }] });
  });

  it("clears a name rather than retaining stale card text", () => {
    let state: DashboardControllerState = { dashboard: snapshot("s1"), loading: false, error: undefined };
    const available = availableMachine(state);
    const firstSession = available.sessions[0];
    if (firstSession === undefined) throw new Error("expected session");
    firstSession.name = "Old name";
    const controller = new DashboardController(() => state, (next) => { state = next; }, { load: () => Promise.resolve(snapshot("s1")) });
    controller.applyRealtimeEvent("local", { type: "session.name", sessionId: "s1" });
    expect(state.dashboard?.machines[0]).toMatchObject({ sessions: [{ id: "s1" }] });
    expect(availableMachine(state).sessions[0]?.name).toBeUndefined();
  });

  it("restores the authoritative runtime status when attention clears", () => {
    let state: DashboardControllerState = { dashboard: snapshot("s1"), loading: false, error: undefined };
    const controller = new DashboardController(() => state, (next) => { state = next; }, { load: () => Promise.resolve(snapshot("s1")) });
    controller.applyRealtimeEvent("local", { type: "status.update", status: status("s1", true) });
    controller.applyRealtimeEvent("local", { type: "session.attention", sessionId: "s1", needsAttention: true });
    controller.applyRealtimeEvent("local", { type: "session.attention", sessionId: "s1", needsAttention: false });
    expect(state.dashboard?.machines[0]).toMatchObject({ sessions: [{ runtimeStatus: "active", displayStatus: "running", needsAttention: false }] });
  });

  it("uses shared status precedence regardless of status/activity event ordering", () => {
    for (const events of [
      ["status", "activity"],
      ["activity", "status"],
    ] as const) {
      let state: DashboardControllerState = { dashboard: snapshot("s1"), loading: false, error: undefined };
      const controller = new DashboardController(() => state, (next) => { state = next; }, { load: () => Promise.resolve(snapshot("s1")) });
      for (const event of events) {
        if (event === "status") controller.applyRealtimeEvent("local", { type: "status.update", status: status("s1", true) });
        else controller.applyRealtimeEvent("local", { type: "activity.update", activity: { sessionId: "s1", phase: "error", label: "Failed", at: "2026-01-01T00:00:00.000Z" } });
      }
      expect(state.dashboard?.machines[0]).toMatchObject({ sessions: [{ runtimeStatus: "active", displayStatus: "running" }] });
    }
  });

  it("debounces created-session refreshes", () => {
    vi.useFakeTimers();
    let state: DashboardControllerState = { dashboard: snapshot("s1"), loading: false, error: undefined };
    const load = vi.fn(() => Promise.resolve(snapshot("s1")));
    const controller = new DashboardController(() => state, (next) => { state = next; }, { load, debounceMs: 20 });
    controller.applyRealtimeEvent("local", { type: "session.created", session: session("s2") });
    controller.applyRealtimeEvent("local", { type: "session.created", session: session("s3") });
    vi.advanceTimersByTime(20);
    expect(load).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
});

function snapshot(...ids: string[]): FederatedSessionDashboardResponse {
  return { machines: [{ machine: { id: "local", name: "Local", kind: "local", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, outcome: "available", sessions: ids.map((id) => ({ id, cwd: "/repo", firstMessage: "Build", created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:00:00.000Z", messageCount: 1, runtimeStatus: "idle" as const, displayStatus: "idle" as const, needsAttention: false, project: { id: "p1", name: "Repo" }, workspace: { id: "w1", label: "main", isMain: true } })) }] };
}

function session(id: string) {
  return { id, cwd: "/repo", path: `/repo/${id}.jsonl`, firstMessage: "Build", created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:00:00.000Z", messageCount: 1 };
}

function status(sessionId: string, isStreaming: boolean) {
  return { sessionId, isStreaming, isCompacting: false, isBashRunning: false, pendingMessageCount: 0, queuedMessages: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
}

function availableMachine(state: DashboardControllerState): Extract<FederatedSessionDashboardResponse["machines"][number], { outcome: "available" }> {
  const machine = state.dashboard?.machines[0];
  if (machine?.outcome !== "available") throw new Error("expected available machine");
  return machine;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolveDeferred: ((value: T) => void) | undefined;
  let rejectDeferred: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => { resolveDeferred = resolve; rejectDeferred = reject; });
  if (resolveDeferred === undefined || rejectDeferred === undefined) throw new Error("Deferred promise was not initialized");
  return { promise, resolve: resolveDeferred, reject: rejectDeferred };
}
