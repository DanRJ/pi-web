import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";

let app: FastifyInstance;
const localSummary = vi.fn();
const federatedSummary = vi.fn();

beforeEach(async () => {
  localSummary.mockReset();
  federatedSummary.mockReset();
  localSummary.mockResolvedValue({ sessions: [] });
  federatedSummary.mockResolvedValue({ machines: [] });
  app = await buildApp({
    clientDist: false,
    logger: false,
    localSessionDashboard: { summary: localSummary },
    federatedSessionDashboard: { summary: federatedSummary },
  });
});

afterEach(async () => app.close());

describe("session dashboard app routes", () => {
  it("wires local summaries, the static local-machine alias before generic proxying, and the aggregate dashboard", async () => {
    const summary = await app.inject({ method: "GET", url: "/api/session-summaries" });
    const localAlias = await app.inject({ method: "GET", url: "/api/machines/local/session-summaries" });
    const dashboard = await app.inject({ method: "GET", url: "/api/session-dashboard" });

    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toEqual({ sessions: [] });
    expect(localAlias.statusCode).toBe(200);
    expect(localAlias.json()).toEqual({ sessions: [] });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json()).toEqual({ machines: [] });
    expect(localSummary).toHaveBeenCalledTimes(2);
    expect(federatedSummary).toHaveBeenCalledTimes(1);
  });
});
