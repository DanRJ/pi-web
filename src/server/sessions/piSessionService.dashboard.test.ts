import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { SessionEventHub } from "../realtime/sessionEventHub.js";
import { fakeRuntime, fakeSessionManager, runtimeCreator, sessionRecord, testModelRuntime } from "./piSessionService.testSupport.js";

let service: PiSessionService | undefined;
afterEach(async () => service?.dispose());

describe("PiSessionService dashboard snapshots", () => {
  it("lists persisted metadata without opening a runtime and excludes archived records", async () => {
    const list = vi.fn().mockResolvedValue([sessionRecord("visible"), sessionRecord("archived")]);
    const open = vi.fn(() => fakeSessionManager());
    service = new PiSessionService(new SessionEventHub(), {
      agentDir: "/tmp/pi-web-dashboard-test",
      modelRuntime: testModelRuntime,
      sessionManager: { list, open, create: () => fakeSessionManager() },
      archiveStore: {
        list: () => Promise.resolve([{ sessionId: "archived", cwd: "/workspace", archivedAt: "now" }]),
        get: () => Promise.resolve(undefined),
        archive: () => Promise.reject(new Error("not used")),
        restore: () => Promise.resolve(),
        isArchived: () => Promise.resolve(false),
      },
    });

    await expect(service.sessionSummaries(["/workspace"])).resolves.toEqual({
      sessions: [expect.objectContaining({ id: "visible", displayStatus: "idle", runtimeStatus: "idle", needsAttention: false })],
    });
    expect(list).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("derives a compact first-user-message fallback for active transient sessions without opening or persisting them", async () => {
    const transient = fakeRuntime("transient", { messages: [{ role: "user", content: "  Build\n the dashboard summary with tests.  " }] });
    service = new PiSessionService(new SessionEventHub(), {
      agentDir: "/tmp/pi-web-dashboard-test",
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(transient.runtime),
      sessionManager: { list: () => Promise.resolve([]), open: () => fakeSessionManager(), create: () => fakeSessionManager() },
    });
    await service.start("/workspace");

    await expect(service.sessionSummaries(["/workspace"])).resolves.toEqual({
      sessions: [expect.objectContaining({ id: "transient", persisted: false, firstMessage: "Build the dashboard summary with tests." })],
    });
  });

  it("normalizes multi-CWD requests before listing and excluding archived sessions", async () => {
    const list = vi.fn().mockResolvedValue([sessionRecord("archived")]);
    service = new PiSessionService(new SessionEventHub(), {
      agentDir: "/tmp/pi-web-dashboard-test",
      modelRuntime: testModelRuntime,
      sessionManager: { list, open: () => fakeSessionManager(), create: () => fakeSessionManager() },
      archiveStore: {
        list: () => Promise.resolve([{ sessionId: "archived", cwd: "/workspace", archivedAt: "now" }]),
        get: () => Promise.resolve(undefined),
        archive: () => Promise.reject(new Error("not used")),
        restore: () => Promise.resolve(),
        isArchived: () => Promise.resolve(false),
      },
    });

    await expect(service.sessionSummaries(["/workspace", "/workspace/"])).resolves.toEqual({ sessions: [] });
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith(resolve("/workspace"));
  });
});
