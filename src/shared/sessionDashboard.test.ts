import { describe, expect, it } from "vitest";
import { deriveSessionDashboardDisplayStatus, deriveSessionDashboardRuntimeStatus, parseSessionDashboardSnapshotResponse } from "./sessionDashboard.js";

const status = { sessionId: "s", isStreaming: true, isCompacting: false, isBashRunning: false, pendingMessageCount: 0, queuedMessages: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };

describe("session dashboard status derivation", () => {
  it("uses attention, active work, and errors in the documented precedence order", () => {
    expect(deriveSessionDashboardDisplayStatus({ status, activity: { sessionId: "s", phase: "error", label: "failed", at: "now" }, pendingExtensionUi: true })).toBe("waiting");
    expect(deriveSessionDashboardDisplayStatus({ status, activity: { sessionId: "s", phase: "error", label: "failed", at: "now" }, pendingExtensionUi: false })).toBe("running");
    expect(deriveSessionDashboardDisplayStatus({ activity: { sessionId: "s", phase: "error", label: "failed", at: "now" }, pendingExtensionUi: false })).toBe("errored");
    expect(deriveSessionDashboardDisplayStatus({ pendingExtensionUi: false })).toBe("idle");
    expect(deriveSessionDashboardRuntimeStatus({ status, pendingExtensionUi: true })).toBe("active");
  });

  it("accepts only finite nonnegative counts and canonical ISO timestamps", () => {
    const valid = { id: "s", cwd: "/repo", firstMessage: "", created: "2026-01-01T00:00:00.000Z", modified: "2026-01-01T00:01:00.000Z", messageCount: 0, runtimeStatus: "idle", displayStatus: "idle", needsAttention: false };
    expect(parseSessionDashboardSnapshotResponse({ sessions: [valid] })).toEqual({ sessions: [valid] });
    expect(parseSessionDashboardSnapshotResponse({ sessions: [{ ...valid, messageCount: -1 }] })).toBeUndefined();
    expect(parseSessionDashboardSnapshotResponse({ sessions: [{ ...valid, messageCount: Number.NaN }] })).toBeUndefined();
    expect(parseSessionDashboardSnapshotResponse({ sessions: [{ ...valid, messageCount: Number.POSITIVE_INFINITY }] })).toBeUndefined();
    expect(parseSessionDashboardSnapshotResponse({ sessions: [{ ...valid, messageCount: 1.5 }] })).toBeUndefined();
    expect(parseSessionDashboardSnapshotResponse({ sessions: [{ ...valid, messageCount: Number.MAX_SAFE_INTEGER + 1 }] })).toBeUndefined();
    expect(parseSessionDashboardSnapshotResponse({ sessions: [{ ...valid, created: "2026-01-01" }] })).toBeUndefined();
    expect(parseSessionDashboardSnapshotResponse({ sessions: [{ ...valid, modified: "not-a-timestamp" }] })).toBeUndefined();
  });
});
