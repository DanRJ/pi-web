import { deriveSessionDashboardDisplayStatus, deriveSessionDashboardRuntimeStatus, type FederatedSessionDashboardResponse, type LocalSessionDashboardSessionSummary } from "../../../shared/sessionDashboard";
import type { RealtimeEvent, SessionActivity, SessionStatus } from "../api";

export interface DashboardControllerState {
  dashboard: FederatedSessionDashboardResponse | undefined;
  loading: boolean;
  error: string | undefined;
}

export interface DashboardControllerTimer {
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof globalThis.setTimeout>;
  clearTimeout(timer: ReturnType<typeof globalThis.setTimeout>): void;
}

export interface DashboardControllerDependencies {
  load(signal: AbortSignal): Promise<FederatedSessionDashboardResponse>;
  debounceMs?: number;
  loadTimeoutMs?: number;
  maxRealtimeMutations?: number;
  timer?: DashboardControllerTimer;
}

type DashboardMutationEvent = Extract<RealtimeEvent, { type: "session.attention" | "status.update" | "activity.update" | "session.name" }>;

interface DashboardMutation {
  revision: number;
  machineId: string;
  event: DashboardMutationEvent;
}

/** Owns one aggregate dashboard read and patches its compact cards from existing realtime streams. */
const DEFAULT_LOAD_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REALTIME_MUTATIONS = 1_000;

export class DashboardController {
  private refreshSequence = 0;
  private refreshTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  private activeLoad: { sequence: number; controller: AbortController } | undefined;
  private readonly debounceMs: number;
  private readonly loadTimeoutMs: number;
  private readonly maxRealtimeMutations: number;
  private readonly timer: DashboardControllerTimer;
  /** Last known status/activity per card, so realtime ordering uses shared precedence. */
  private readonly runtimeSnapshots = new Map<string, { status?: SessionStatus; activity?: SessionActivity }>();
  private realtimeMutationRevision = 0;
  /** Coalesced card mutations that arrived after one or more aggregate reads began. */
  private readonly realtimeMutations = new Map<string, DashboardMutation>();
  private readonly activeRefreshWatermarks = new Map<number, number>();

  constructor(
    private readonly getState: () => DashboardControllerState,
    private readonly setState: (state: DashboardControllerState) => void,
    private readonly deps: DashboardControllerDependencies,
  ) {
    this.debounceMs = deps.debounceMs ?? 300;
    this.loadTimeoutMs = positiveFiniteInteger(deps.loadTimeoutMs, DEFAULT_LOAD_TIMEOUT_MS);
    this.maxRealtimeMutations = positiveFiniteInteger(deps.maxRealtimeMutations, DEFAULT_MAX_REALTIME_MUTATIONS);
    this.timer = deps.timer ?? globalThis;
  }

  async refresh(): Promise<void> {
    this.activeLoad?.controller.abort();
    const sequence = ++this.refreshSequence;
    const controller = new AbortController();
    this.activeLoad = { sequence, controller };
    const watermark = this.realtimeMutationRevision;
    this.activeRefreshWatermarks.set(sequence, watermark);
    const current = this.getState();
    this.setState({ ...current, loading: true, error: undefined });
    try {
      const dashboard = await this.loadDashboard(controller);
      if (sequence !== this.refreshSequence) return;
      this.runtimeSnapshots.clear();
      this.setState({ dashboard: this.replayRealtimeMutations(dashboard, watermark), loading: false, error: undefined });
    } catch (error) {
      if (sequence !== this.refreshSequence) return;
      this.setState({ ...this.getState(), loading: false, error: errorMessage(error) });
    } finally {
      this.clearActiveLoad(sequence);
      this.activeRefreshWatermarks.delete(sequence);
      this.pruneRealtimeMutations();
    }
  }

  reportError(error: unknown): void {
    const state = this.getState();
    this.setState({ ...state, loading: false, error: errorMessage(error) });
  }

  scheduleRefresh(): void {
    if (this.refreshTimer !== undefined) return;
    this.refreshTimer = this.timer.setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, this.debounceMs);
  }

  dispose(): void {
    if (this.refreshTimer !== undefined) this.timer.clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.activeLoad?.controller.abort();
    this.activeLoad = undefined;
    this.refreshSequence += 1;
    this.activeRefreshWatermarks.clear();
    this.realtimeMutations.clear();
    this.runtimeSnapshots.clear();
  }

  /** Applies a durable name mutation exactly like a realtime event, including refresh replay. */
  applySessionName(machineId: string, sessionId: string, name?: string): void {
    this.applyDashboardMutation(machineId, name === undefined ? { type: "session.name", sessionId } : { type: "session.name", sessionId, name });
  }

  applyRealtimeEvent(machineId: string, event: RealtimeEvent): void {
    if (event.type === "session.created") {
      this.scheduleRefresh();
      return;
    }
    if (!isDashboardMutationEvent(event)) return;
    this.applyDashboardMutation(machineId, event);
  }

  private applyDashboardMutation(machineId: string, event: DashboardMutationEvent): void {
    this.recordRealtimeMutation(machineId, event);
    const state = this.getState();
    if (state.dashboard === undefined) return;
    this.setState({ ...state, dashboard: patchDashboard(state.dashboard, machineId, event, this.runtimeSnapshots) });
  }

  private recordRealtimeMutation(machineId: string, event: DashboardMutationEvent): void {
    if (this.activeRefreshWatermarks.size === 0) return;
    const revision = ++this.realtimeMutationRevision;
    const key = `${machineId}\u0000${sessionIdForMutation(event)}\u0000${event.type}`;
    // Retain only the newest value for each card property while a read is in flight.
    this.realtimeMutations.delete(key);
    this.realtimeMutations.set(key, { revision, machineId, event });
    while (this.realtimeMutations.size > this.maxRealtimeMutations) {
      const oldest = this.realtimeMutations.keys().next().value;
      if (oldest === undefined) break;
      this.realtimeMutations.delete(oldest);
    }
  }

  private loadDashboard(controller: AbortController): Promise<FederatedSessionDashboardResponse> {
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const interruption = new Promise<never>((_resolve, reject) => {
      onAbort = () => { reject(new Error("Dashboard load aborted.")); };
      controller.signal.addEventListener("abort", onAbort, { once: true });
      timeout = this.timer.setTimeout(() => {
        reject(new Error(`Dashboard load timed out after ${String(this.loadTimeoutMs)}ms.`));
        controller.abort();
      }, this.loadTimeoutMs);
    });
    // The race observes a late source rejection even after timeout or cancellation.
    let source: Promise<FederatedSessionDashboardResponse>;
    try {
      source = Promise.resolve(this.deps.load(controller.signal));
    } catch (error) {
      source = Promise.reject(asError(error));
    }
    return Promise.race([source, interruption]).finally(() => {
      if (timeout !== undefined) this.timer.clearTimeout(timeout);
      if (onAbort !== undefined) controller.signal.removeEventListener("abort", onAbort);
    });
  }

  private clearActiveLoad(sequence: number): void {
    const activeLoad = this.activeLoad;
    if (activeLoad?.sequence === sequence) this.activeLoad = undefined;
  }

  private replayRealtimeMutations(dashboard: FederatedSessionDashboardResponse, watermark: number): FederatedSessionDashboardResponse {
    return [...this.realtimeMutations.values()]
      .filter((mutation) => mutation.revision > watermark)
      .sort((left, right) => left.revision - right.revision)
      .reduce((current, mutation) => patchDashboard(current, mutation.machineId, mutation.event, this.runtimeSnapshots), dashboard);
  }

  private pruneRealtimeMutations(): void {
    if (this.activeRefreshWatermarks.size === 0) {
      this.realtimeMutations.clear();
      return;
    }
    const oldestWatermark = Math.min(...this.activeRefreshWatermarks.values());
    for (const [key, mutation] of this.realtimeMutations) {
      if (mutation.revision <= oldestWatermark) this.realtimeMutations.delete(key);
    }
  }
}

function patchDashboard(
  dashboard: FederatedSessionDashboardResponse,
  machineId: string,
  event: DashboardMutationEvent,
  snapshots: Map<string, { status?: SessionStatus; activity?: SessionActivity }>,
): FederatedSessionDashboardResponse {
  const machines = dashboard.machines.map((outcome) => {
    if (outcome.machine.id !== machineId || outcome.outcome !== "available") return outcome;
    const sessions = outcome.sessions.map((session) => patchSession(session, event, snapshots, machineId));
    return { ...outcome, sessions };
  });
  return { machines };
}

function isDashboardMutationEvent(event: RealtimeEvent): event is DashboardMutationEvent {
  return event.type === "session.attention" || event.type === "status.update" || event.type === "activity.update" || event.type === "session.name";
}

function sessionIdForMutation(event: DashboardMutationEvent): string {
  return event.type === "status.update" ? event.status.sessionId : event.type === "activity.update" ? event.activity.sessionId : event.sessionId;
}

function patchSession(
  session: LocalSessionDashboardSessionSummary,
  event: DashboardMutationEvent,
  snapshots: Map<string, { status?: SessionStatus; activity?: SessionActivity }>,
  machineId: string,
): LocalSessionDashboardSessionSummary {
  const sessionId = event.type === "status.update" ? event.status.sessionId : event.type === "activity.update" ? event.activity.sessionId : event.sessionId;
  if (session.id !== sessionId) return session;
  if (event.type === "session.name") {
    if (event.name !== undefined) return { ...session, name: event.name };
    const withoutName = { ...session };
    delete withoutName.name;
    return withoutName;
  }

  const key = `${machineId}\u0000${session.id}`;
  const current = snapshots.get(key) ?? snapshotFromCard(session);
  if (event.type === "status.update") current.status = event.status;
  else if (event.type === "activity.update") current.activity = event.activity;
  snapshots.set(key, current);
  const needsAttention = event.type === "session.attention" ? event.needsAttention : session.needsAttention;
  return {
    ...session,
    needsAttention,
    // Runtime status never follows attention; it is the authoritative state to restore after waiting clears.
    runtimeStatus: deriveSessionDashboardRuntimeStatus({ ...current, pendingExtensionUi: needsAttention }),
    displayStatus: deriveSessionDashboardDisplayStatus({ ...current, pendingExtensionUi: needsAttention }),
  };
}

function snapshotFromCard(session: LocalSessionDashboardSessionSummary): { status?: SessionStatus; activity?: SessionActivity } {
  if (session.runtimeStatus === "active") return { status: inactiveStatus(session, true) };
  if (session.runtimeStatus === "error") return { activity: { sessionId: session.id, phase: "error", label: "error", at: session.modified } };
  return { status: inactiveStatus(session, false) };
}

function inactiveStatus(session: LocalSessionDashboardSessionSummary, active: boolean): SessionStatus {
  return { sessionId: session.id, isStreaming: active, isCompacting: false, isBashRunning: false, pendingMessageCount: 0, queuedMessages: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
}

function positiveFiniteInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function errorMessage(error: unknown): string {
  return asError(error).message;
}
