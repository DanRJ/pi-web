import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSessionSummaryRoutes, type SessionSummaryRouteService } from "./sessionSummaryRoutes.js";

let app: FastifyInstance;
const summaries = vi.fn<SessionSummaryRouteService["sessionSummaries"]>();
const repoPath = resolve("repo");

beforeEach(() => {
  app = Fastify({ logger: false });
  summaries.mockReset();
  summaries.mockResolvedValue({ sessions: [] });
  registerSessionSummaryRoutes(app, { sessionSummaries: summaries });
});

afterEach(async () => app.close());

describe("session summary route", () => {
  it("normalizes, deduplicates, and bounds cwd input", async () => {
    const response = await app.inject({ method: "POST", url: "/session-summaries", payload: { cwds: [repoPath, `${repoPath}${process.platform === "win32" ? "\\" : "/"}`] } });
    expect(response.statusCode).toBe(200);
    expect(summaries).toHaveBeenCalledWith([repoPath]);

    const malformed = await app.inject({ method: "POST", url: "/session-summaries", payload: { cwds: ["relative"] } });
    expect(malformed.statusCode).toBe(400);
    const bounded = await app.inject({ method: "POST", url: "/session-summaries", payload: { cwds: Array.from({ length: 101 }, (_, index) => resolve(repoPath, String(index))) } });
    expect(bounded.statusCode).toBe(400);
  });
});
