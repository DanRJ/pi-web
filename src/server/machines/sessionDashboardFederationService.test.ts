import { describe, expect, it, vi } from "vitest";
import { PI_WEB_CAPABILITIES } from "../../shared/capabilities.js";
import type { Machine, MachineRuntime } from "../../shared/apiTypes.js";
import { SessionDashboardFederationService } from "./sessionDashboardFederationService.js";

const local: Machine = { id: "local", name: "Local", kind: "local", createdAt: "0", updatedAt: "0" };
const remote: Machine = { id: "remote", name: "Remote", kind: "remote", baseUrl: "https://remote.test", createdAt: "0", updatedAt: "0" };
const supported = (machineId: string): MachineRuntime => ({ machineId, ok: true, checkedAt: "now", capabilities: [PI_WEB_CAPABILITIES.sessionsSummarySnapshot] });

describe("SessionDashboardFederationService", () => {
  it("returns partial results when a remote machine is unsupported or fails", async () => {
    const requestJson = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: { sessions: [] } });
    const machines = {
      list: () => Promise.resolve([local, remote]),
      runtime: (id: string) => Promise.resolve(id === "local" ? supported(id) : { machineId: id, ok: false, checkedAt: "now", error: "connection refused" }),
      remoteClient: () => Promise.resolve({ requestJson, request: vi.fn(), connectWebSocket: vi.fn() }),
    };
    const service = new SessionDashboardFederationService({ local: { summary: () => Promise.resolve({ sessions: [] }) }, machines });

    const response = await service.summary();
    expect(response.machines.map((result) => result.outcome)).toEqual(["available", "offline"]);
    expect(requestJson).not.toHaveBeenCalled();
  });

  it("checks capability then requests only the machine-scoped summary endpoint", async () => {
    const requestJson = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: { sessions: [] } });
    const machines = {
      list: () => Promise.resolve([remote]),
      runtime: () => Promise.resolve(supported("remote")),
      remoteClient: () => Promise.resolve({ requestJson, request: vi.fn(), connectWebSocket: vi.fn() }),
    };
    const service = new SessionDashboardFederationService({ local: { summary: () => Promise.resolve({ sessions: [] }) }, machines });

    await expect(service.summary()).resolves.toMatchObject({ machines: [{ outcome: "available" }] });
    expect(requestJson).toHaveBeenCalledWith("GET", "/api/session-summaries", undefined, { timeoutMs: 5000 });
  });

  it("exposes effective capabilities on available outcomes", async () => {
    const runtime = supported("remote");
    const service = new SessionDashboardFederationService({
      local: { summary: () => Promise.resolve({ sessions: [] }) },
      machines: { list: () => Promise.resolve([remote]), runtime: () => Promise.resolve(runtime), remoteClient: () => Promise.resolve({ requestJson: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: { sessions: [] } }), request: vi.fn(), connectWebSocket: vi.fn() }) },
    });
    await expect(service.summary()).resolves.toMatchObject({ machines: [{ outcome: "available", capabilities: [PI_WEB_CAPABILITIES.sessionsSummarySnapshot] }] });

  });

  it("returns a partial response when local runtime hangs", async () => {
    vi.useFakeTimers();
    try {
      const service = new SessionDashboardFederationService({
        local: { summary: () => Promise.resolve({ sessions: [] }) },
        machines: {
          list: () => Promise.resolve([local, remote]),
          runtime: (id: string) => id === "local" ? new Promise<MachineRuntime>(() => { /* intentionally unresolved */ }) : Promise.resolve(supported(id)),
          remoteClient: () => Promise.resolve({ requestJson: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: { sessions: [] } }), request: vi.fn(), connectWebSocket: vi.fn() }),
        },
        localTimeoutMs: 10,
      });

      const response = service.summary();
      await vi.advanceTimersByTimeAsync(10);
      await expect(response).resolves.toMatchObject({ machines: [
        { machine: { id: "local" }, outcome: "offline", error: "Local machine dashboard timed out after 10ms" },
        { machine: { id: "remote" }, outcome: "available" },
      ] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns a partial response when local session summaries hang", async () => {
    vi.useFakeTimers();
    try {
      const service = new SessionDashboardFederationService({
        local: { summary: () => new Promise(() => { /* intentionally unresolved */ }) },
        machines: {
          list: () => Promise.resolve([local]),
          runtime: () => Promise.resolve(supported("local")),
          remoteClient: () => Promise.resolve(undefined),
        },
        localTimeoutMs: 10,
      });

      const response = service.summary();
      await vi.advanceTimersByTimeAsync(10);
      await expect(response).resolves.toMatchObject({ machines: [{ outcome: "offline", error: "Local machine dashboard timed out after 10ms" }] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("contains remote runtime and client acquisition hangs as partial machine outcomes", async () => {
    vi.useFakeTimers();
    try {
      const service = new SessionDashboardFederationService({
        local: { summary: () => Promise.resolve({ sessions: [] }) },
        machines: {
          list: () => Promise.resolve([local, remote]),
          runtime: (id: string) => id === "remote" ? new Promise<MachineRuntime>(() => { /* intentionally unresolved */ }) : Promise.resolve(supported(id)),
          remoteClient: () => Promise.resolve(undefined),
        },
        remoteTimeoutMs: 10,
      });
      const response = service.summary();
      await vi.advanceTimersByTimeAsync(10);
      await expect(response).resolves.toMatchObject({ machines: [{ outcome: "available" }, { machine: { id: "remote" }, outcome: "offline" }] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns rejected remote client acquisition into an explicit partial outcome", async () => {
    const service = new SessionDashboardFederationService({
      local: { summary: () => Promise.resolve({ sessions: [] }) },
      machines: {
        list: () => Promise.resolve([remote]),
        runtime: () => Promise.resolve(supported("remote")),
        remoteClient: () => Promise.reject(new Error("client setup failed")),
      },
    });
    await expect(service.summary()).resolves.toMatchObject({ machines: [{ outcome: "error", error: "Remote machine dashboard request failed: client setup failed" }] });
  });

  it("turns malformed remote summary payloads into that machine's error", async () => {
    const requestJson = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: { sessions: [{ id: "bad", cwd: "/repo", firstMessage: "", created: "not-a-date", modified: "2026-01-01T00:00:00.000Z", messageCount: Number.POSITIVE_INFINITY, runtimeStatus: "idle", displayStatus: "idle", needsAttention: false }] },
    });
    const service = new SessionDashboardFederationService({
      local: { summary: () => Promise.resolve({ sessions: [] }) },
      machines: {
        list: () => Promise.resolve([remote]),
        runtime: () => Promise.resolve(supported("remote")),
        remoteClient: () => Promise.resolve({ requestJson, request: vi.fn(), connectWebSocket: vi.fn() }),
      },
    });

    await expect(service.summary()).resolves.toMatchObject({ machines: [{ outcome: "error", error: "Machine summary response was invalid" }] });
  });
});
