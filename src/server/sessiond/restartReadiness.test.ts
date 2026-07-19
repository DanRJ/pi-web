import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerRestartReadinessRoute } from "./restartReadiness.js";

let app: FastifyInstance;
let sessions: FakeSessions;
let terminals: FakeTerminals;

beforeEach(() => {
  app = Fastify({ logger: false });
  sessions = new FakeSessions();
  terminals = new FakeTerminals();
  registerRestartReadinessRoute(app, sessions, terminals);
});

afterEach(async () => app.close());

describe("sessiond restart readiness route", () => {
  it("reports an idle loaded session as safe using aggregate-only fields", async () => {
    sessions.loaded = 1;

    const response = await app.inject({ method: "GET", url: "/restart-readiness" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      safeToRestart: true,
      loadedSessions: 1,
      busySessions: 0,
      runningTerminals: 0,
      reasons: [],
    });
  });

  it("blocks restart for busy sessions and live PTYs without exposing runtime details", async () => {
    sessions.loaded = 3;
    sessions.busy = 2;
    terminals.running = 1;

    const response = await app.inject({ method: "GET", url: "/restart-readiness" });
    const readiness = response.json<Record<string, unknown>>();

    expect(response.statusCode).toBe(200);
    expect(readiness).toEqual({
      safeToRestart: false,
      loadedSessions: 3,
      busySessions: 2,
      runningTerminals: 1,
      reasons: ["busy-sessions", "running-terminals"],
    });
    expect(Object.keys(readiness)).toEqual(["safeToRestart", "loadedSessions", "busySessions", "runningTerminals", "reasons"]);
    expect(JSON.stringify(readiness)).not.toContain("session-id");
    expect(JSON.stringify(readiness)).not.toContain("/private/workspace");
    expect(JSON.stringify(readiness)).not.toContain("sensitive prompt");
    expect(JSON.stringify(readiness)).not.toContain("dangerous-command");
  });
});

class FakeSessions {
  loaded = 0;
  busy = 0;
  readonly sessionId = "session-id";
  readonly workspacePath = "/private/workspace";
  readonly prompt = "sensitive prompt";

  activeCount(): number {
    return this.loaded;
  }

  activeWorkCount(): number {
    return this.busy;
  }
}

class FakeTerminals {
  running = 0;
  readonly command = "dangerous-command";

  runningCount(): number {
    return this.running;
  }
}
