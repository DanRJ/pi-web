import type { FastifyInstance } from "fastify";
import type { SessionDashboardSnapshotResponse } from "../../shared/sessionDashboard.js";
import { normalizeRequestCwd } from "../workingDirectory.js";

/** Maximum CWDs accepted by one bounded sessiond summary request. */
export const MAX_SESSION_SUMMARY_CWDS = 100;

export interface SessionSummaryRouteService {
  sessionSummaries(cwds: readonly string[]): Promise<SessionDashboardSnapshotResponse>;
}

/** Sessiond-only, read-only metadata query used by the web dashboard composer. */
export function registerSessionSummaryRoutes(app: FastifyInstance, sessions: SessionSummaryRouteService, prefix = ""): void {
  app.post<{ Body: unknown }>(`${prefix}/session-summaries`, async (request, reply) => {
    try {
      return await sessions.sessionSummaries(parseSessionSummaryCwds(request.body));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

export function parseSessionSummaryCwds(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value["cwds"])) throw new Error("cwds must be an array");
  if (value["cwds"].length > MAX_SESSION_SUMMARY_CWDS) throw new Error(`cwds must contain at most ${String(MAX_SESSION_SUMMARY_CWDS)} entries`);
  return [...new Set(value["cwds"].map(normalizeRequestCwd))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
