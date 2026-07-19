import { describe, expect, it, vi } from "vitest";
import { SessionDaemonClient, parseSessionDaemonRestartReadiness } from "./sessionDaemonClient.js";

const activeAgentProfile = {
  schemaVersion: 1,
  revision: `sha256:${"a".repeat(64)}`,
  command: "acme-agent",
  dir: "/opt/acme-agent/state",
  sessionDirEnvKeys: ["PI_WEB_AGENT_SESSION_DIR"],
};

describe("SessionDaemonClient active agent profile protocol", () => {
  it("returns the validated immutable profile from the daemon runtime endpoint", async () => {
    const client = new SessionDaemonClient();
    const request = vi.spyOn(client, "request").mockResolvedValue(runtimeResponse(activeAgentProfile));

    const result = await client.getActiveAgentProfile();

    expect(request).toHaveBeenCalledWith("GET", "/runtime");
    expect(result).toEqual({ status: "available", profile: activeAgentProfile });
    if (result.status === "available") {
      expect(Object.isFrozen(result.profile)).toBe(true);
      expect(Object.isFrozen(result.profile.sessionDirEnvKeys)).toBe(true);
    }
  });

  it("distinguishes invalid protocol responses from daemon unavailability", async () => {
    const invalidClient = new SessionDaemonClient();
    vi.spyOn(invalidClient, "request").mockResolvedValue(runtimeResponse({
      ...activeAgentProfile,
      token: "must-not-cross-the-protocol",
    }));
    const unavailableClient = new SessionDaemonClient();
    vi.spyOn(unavailableClient, "request").mockRejectedValue(new Error("connect ECONNREFUSED"));

    await expect(invalidClient.getActiveAgentProfile()).resolves.toEqual({
      status: "invalid",
      error: "session daemon runtime response was invalid",
    });
    await expect(unavailableClient.getActiveAgentProfile()).resolves.toEqual({
      status: "unavailable",
      error: "connect ECONNREFUSED",
    });
  });

  it.skipIf(process.platform === "win32")("rejects foreign-platform active state paths before local consumers use them", async () => {
    const client = new SessionDaemonClient();
    vi.spyOn(client, "request").mockResolvedValue(runtimeResponse({
      ...activeAgentProfile,
      dir: "C:\\agent-profiles\\acme",
    }));

    await expect(client.getActiveAgentProfile()).resolves.toEqual({
      status: "invalid",
      error: "session daemon active agent profile was not valid for this host",
    });
  });

  it("treats a legacy runtime response without a profile as invalid for profile-dependent work", async () => {
    const client = new SessionDaemonClient();
    vi.spyOn(client, "request").mockResolvedValue(runtimeResponse(undefined));

    await expect(client.getActiveAgentProfile()).resolves.toEqual({
      status: "invalid",
      error: "session daemon runtime response did not include an active agent profile",
    });
  });
});

describe("SessionDaemonClient restart readiness protocol", () => {
  it("returns the narrow aggregate readiness contract", async () => {
    const client = new SessionDaemonClient();
    const request = vi.spyOn(client, "request").mockResolvedValue(restartReadinessResponse({
      safeToRestart: false,
      loadedSessions: 4,
      busySessions: 2,
      runningTerminals: 1,
      reasons: ["busy-sessions", "running-terminals"],
    }));

    await expect(client.getRestartReadiness()).resolves.toEqual({
      status: "available",
      readiness: {
        safeToRestart: false,
        loadedSessions: 4,
        busySessions: 2,
        runningTerminals: 1,
        reasons: ["busy-sessions", "running-terminals"],
      },
    });
    expect(request).toHaveBeenCalledWith("GET", "/restart-readiness");
  });

  it("rejects malformed, contradictory, and detail-bearing readiness payloads", () => {
    const valid = {
      safeToRestart: true,
      loadedSessions: 1,
      busySessions: 0,
      runningTerminals: 0,
      reasons: [],
    };

    expect(parseSessionDaemonRestartReadiness(valid)).toEqual(valid);
    expect(parseSessionDaemonRestartReadiness({ ...valid, sessionId: "must-not-cross-the-protocol" })).toBeUndefined();
    expect(parseSessionDaemonRestartReadiness({ ...valid, safeToRestart: false })).toBeUndefined();
    expect(parseSessionDaemonRestartReadiness({ ...valid, busySessions: 2 })).toBeUndefined();
    expect(parseSessionDaemonRestartReadiness({ ...valid, reasons: ["running-terminals"] })).toBeUndefined();
    expect(parseSessionDaemonRestartReadiness({ ...valid, loadedSessions: -1 })).toBeUndefined();
  });

  it("distinguishes malformed readiness responses from daemon unavailability", async () => {
    const invalidClient = new SessionDaemonClient();
    vi.spyOn(invalidClient, "request").mockResolvedValue({ statusCode: 200, headers: {}, body: "not json" });
    const unavailableClient = new SessionDaemonClient();
    vi.spyOn(unavailableClient, "request").mockRejectedValue(new Error("connect ECONNREFUSED"));

    await expect(invalidClient.getRestartReadiness()).resolves.toEqual({
      status: "invalid",
      error: "session daemon restart readiness response was not valid JSON",
    });
    await expect(unavailableClient.getRestartReadiness()).resolves.toEqual({
      status: "unavailable",
      error: "connect ECONNREFUSED",
    });
  });
});

function restartReadinessResponse(readiness: unknown) {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(readiness),
  };
}

function runtimeResponse(profile: unknown) {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      component: "sessiond",
      label: "Session daemon",
      available: true,
      capabilities: [],
      ...(profile === undefined ? {} : { activeAgentProfile: profile }),
    }),
  };
}
