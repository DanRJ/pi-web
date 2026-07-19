import type { FastifyInstance } from "fastify";
import type { SessionDashboardFederationService } from "../machines/sessionDashboardFederationService.js";
import type { LocalSessionDashboardService } from "./sessionDashboardService.js";

export function registerSessionDashboardRoutes(
  app: FastifyInstance,
  local: Pick<LocalSessionDashboardService, "summary">,
  federated: Pick<SessionDashboardFederationService, "summary">,
): void {
  app.get("/api/session-summaries", async () => local.summary());
  app.get("/api/machines/local/session-summaries", async () => local.summary());
  app.get("/api/session-dashboard", async () => federated.summary());
}
