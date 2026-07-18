import { PI_WEB_CAPABILITIES, supportsPiWebCapability } from "../../shared/capabilities.js";
import type { PiWebCapability } from "../../shared/apiTypes.js";
import type { FederatedSessionDashboardResponse, LocalSessionDashboardResponse, SessionDashboardMachineOutcome } from "../../shared/sessionDashboard.js";
import { parseLocalSessionDashboardResponse } from "./sessionDashboardParsing.js";
import type { MachineClient } from "./machineClient.js";
import type { MachineService } from "./machineService.js";

export const SESSION_DASHBOARD_REMOTE_TIMEOUT_MS = 5_000;
export const SESSION_DASHBOARD_LOCAL_TIMEOUT_MS = 5_000;

export interface SessionDashboardFederationDependencies {
  local: Pick<{ summary(): Promise<LocalSessionDashboardResponse> }, "summary">;
  machines: Pick<MachineService, "list" | "runtime" | "remoteClient">;
  /** Test seams; production uses finite per-machine deadlines. */
  localTimeoutMs?: number;
  remoteTimeoutMs?: number;
}

/** Aggregates independently so a failed machine never discards good results. */
export class SessionDashboardFederationService {
  constructor(private readonly deps: SessionDashboardFederationDependencies) {}

  async summary(): Promise<FederatedSessionDashboardResponse> {
    const machines = await this.deps.machines.list();
    const outcomes = await Promise.all(machines.map((machine) => this.machineSummary(machine)));
    return { machines: outcomes };
  }

  private async machineSummary(machine: Awaited<ReturnType<MachineService["list"]>>[number]): Promise<SessionDashboardMachineOutcome> {
    const localMachine = machine.id === "local";
    const timeoutMs = localMachine ? this.deps.localTimeoutMs ?? SESSION_DASHBOARD_LOCAL_TIMEOUT_MS : this.deps.remoteTimeoutMs ?? SESSION_DASHBOARD_REMOTE_TIMEOUT_MS;
    try {
      // This outer deadline includes discovery/runtime/client acquisition as well as the request.
      return await withBoundedTimeout(() => localMachine ? this.localSummary(machine) : this.remoteMachineSummary(machine), timeoutMs, `${localMachine ? "Local" : "Remote"} machine dashboard`);
    } catch (error) {
      return machineFailure(machine, error, localMachine);
    }
  }

  private async remoteMachineSummary(machine: Awaited<ReturnType<MachineService["list"]>>[number]): Promise<SessionDashboardMachineOutcome> {
    const runtime = await this.deps.machines.runtime(machine.id);
    if (runtime === undefined) return { machine, outcome: "error", error: "Machine runtime was unavailable" };
    if (!runtime.ok) return { machine, outcome: "offline", ...(runtime.error === undefined ? {} : { error: runtime.error }) };
    if (!supportsPiWebCapability(runtime, PI_WEB_CAPABILITIES.sessionsSummarySnapshot)) return { machine, outcome: "unsupported", error: "Machine does not support session summaries" };
    const client = await this.deps.machines.remoteClient(machine.id);
    if (client === undefined) return { machine, outcome: "error", error: "Machine client was unavailable" };
    return remoteSummary(machine, client, runtime.capabilities);
  }

  private async localSummary(machine: Awaited<ReturnType<MachineService["list"]>>[number]): Promise<SessionDashboardMachineOutcome> {
    let runtime: Awaited<ReturnType<MachineService["runtime"]>>;
    try {
      runtime = await withBoundedTimeout(() => this.deps.machines.runtime(machine.id), this.deps.localTimeoutMs ?? SESSION_DASHBOARD_LOCAL_TIMEOUT_MS, "Local machine runtime");
    } catch (error) {
      return localFailure(machine, error);
    }
    if (runtime === undefined) return { machine, outcome: "error", error: "Local machine runtime was unavailable" };
    if (!runtime.ok) return { machine, outcome: "offline", error: runtime.error ?? "Local machine runtime was unavailable" };
    if (!supportsPiWebCapability(runtime, PI_WEB_CAPABILITIES.sessionsSummarySnapshot)) return { machine, outcome: "unsupported", error: "Machine does not support session summaries" };

    try {
      const summary = await withBoundedTimeout(() => this.deps.local.summary(), this.deps.localTimeoutMs ?? SESSION_DASHBOARD_LOCAL_TIMEOUT_MS, "Local machine session summary");
      return { machine, outcome: "available", sessions: summary.sessions, ...(runtime.capabilities === undefined ? {} : { capabilities: runtime.capabilities }) };
    } catch (error) {
      return localFailure(machine, error);
    }
  }
}

async function remoteSummary(machine: Awaited<ReturnType<MachineService["list"]>>[number], client: MachineClient, capabilities: PiWebCapability[] | undefined): Promise<SessionDashboardMachineOutcome> {
  try {
    const response = await client.requestJson("GET", "/api/session-summaries", undefined, { timeoutMs: SESSION_DASHBOARD_REMOTE_TIMEOUT_MS });
    if (response.statusCode < 200 || response.statusCode >= 300) return { machine, outcome: "error", error: `Machine summary request returned HTTP ${String(response.statusCode)}` };
    const summary = parseLocalSessionDashboardResponse(response.body);
    if (summary === undefined) return { machine, outcome: "error", error: "Machine summary response was invalid" };
    return { machine, outcome: "available", sessions: summary.sessions, ...(capabilities === undefined ? {} : { capabilities }) };
  } catch (error) {
    const message = errorMessage(error);
    return { machine, outcome: message.toLowerCase().includes("timeout") ? "offline" : "error", error: message };
  }
}

function localFailure(machine: Awaited<ReturnType<MachineService["list"]>>[number], error: unknown): SessionDashboardMachineOutcome {
  return machineFailure(machine, error, true);
}

function machineFailure(machine: Awaited<ReturnType<MachineService["list"]>>[number], error: unknown, localMachine: boolean): SessionDashboardMachineOutcome {
  const message = errorMessage(error);
  const prefix = localMachine ? "Local machine" : "Remote machine";
  return {
    machine,
    outcome: isUnavailable(error, message) ? "offline" : "error",
    error: message.startsWith(prefix) ? message : `${prefix} dashboard request failed: ${message}`,
  };
}

function isUnavailable(error: unknown, message: string): boolean {
  return error instanceof SessionDashboardTimeoutError
    || /(?:timeout|unavailable|econnrefused|enotfound|socket hang up|fetch failed)/iu.test(message);
}

/**
 * Bounds APIs that do not yet expose AbortSignal. The operation always has a
 * rejection handler, including after the deadline wins, so a late failure is
 * contained rather than becoming an unhandled rejection.
 */
function withBoundedTimeout<T>(operation: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new SessionDashboardTimeoutError(`${label} timed out after ${String(timeoutMs)}ms`));
    }, timeoutMs);
    void Promise.resolve().then(operation).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

class SessionDashboardTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionDashboardTimeoutError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
