import { describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, testModelRuntime } from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";

describe("PiSessionService restart readiness counts", () => {
  it("keeps idle loaded runtimes out of the active-work count", async () => {
    const { service } = await startedService({});
    try {
      expect(service.activeCount()).toBe(1);
      expect(service.activeWorkCount()).toBe(0);
    } finally {
      await service.dispose();
    }
  });

  it.each([
    ["streaming", { isStreaming: true }],
    ["compacting", { isCompacting: true }],
    ["running bash", { isBashRunning: true }],
    ["queued prompt", { pendingMessageCount: 1 }],
    ["runtime with every active-work signal", { isStreaming: true, isCompacting: true, isBashRunning: true, pendingMessageCount: 1 }],
  ])("counts a %s runtime as active work", async (_label, state) => {
    const { service } = await startedService(state);
    try {
      expect(service.activeCount()).toBe(1);
      expect(service.activeWorkCount()).toBe(1);
    } finally {
      await service.dispose();
    }
  });
});

async function startedService(state: { isStreaming?: boolean; isCompacting?: boolean; isBashRunning?: boolean; pendingMessageCount?: number }) {
  const runtime = fakeRuntime("session-1", state);
  const service = new PiSessionService(new CapturingSessionEventHub(), {
    agentDir: TEST_AGENT_DIR,
    modelRuntime: testModelRuntime,
    createAgentRuntime: runtimeCreator(runtime.runtime),
    sessionManager: sessionGateway([]),
    heartbeatIntervalMs: 60_000,
  });
  await service.start("/workspace");
  return { service };
}
