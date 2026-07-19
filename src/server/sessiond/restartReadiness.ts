import type { FastifyInstance } from "fastify";

export const RESTART_READINESS_REASONS = ["busy-sessions", "running-terminals"] as const;
export type RestartReadinessReason = typeof RESTART_READINESS_REASONS[number];

export interface SessionDaemonRestartReadiness {
  safeToRestart: boolean;
  loadedSessions: number;
  busySessions: number;
  runningTerminals: number;
  reasons: RestartReadinessReason[];
}

export interface RestartReadinessSessions {
  activeCount(): number;
  activeWorkCount(): number;
}

export interface RestartReadinessTerminals {
  runningCount(): number;
}

/**
 * Produces the deliberately aggregate-only sessiond restart gate. A daemon
 * restart disposes loaded runtime state, so it is safe only when no loaded
 * session has work and no server-owned PTY is still live.
 */
export function sessionDaemonRestartReadiness(
  sessions: RestartReadinessSessions,
  terminals: RestartReadinessTerminals,
): SessionDaemonRestartReadiness {
  const loadedSessions = sessions.activeCount();
  const busySessions = sessions.activeWorkCount();
  const runningTerminals = terminals.runningCount();
  const reasons: RestartReadinessReason[] = [];
  if (busySessions > 0) reasons.push("busy-sessions");
  if (runningTerminals > 0) reasons.push("running-terminals");
  return {
    safeToRestart: reasons.length === 0,
    loadedSessions,
    busySessions,
    runningTerminals,
    reasons,
  };
}

/** Registers a local-only sessiond route; it is intentionally not proxied or federated. */
export function registerRestartReadinessRoute(
  app: FastifyInstance,
  sessions: RestartReadinessSessions,
  terminals: RestartReadinessTerminals,
): void {
  app.get("/restart-readiness", () => sessionDaemonRestartReadiness(sessions, terminals));
}
