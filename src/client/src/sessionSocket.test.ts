import { describe, expect, it } from "vitest";
import { parseRealtimeSocketEvent, parseSessionSocketEvent } from "./sessionSocket";

function notification(order = 1) {
  return {
    id: `daemon-a:${String(order)}`,
    message: "notice",
    truncated: false,
    severity: "info",
    receivedAt: "2026-07-18T00:00:00.000Z",
    order,
  };
}

function summary() {
  return {
    sessionId: "session-1",
    cwd: "/repo",
    inboxRevision: 1,
    retainedCount: 1,
    discardedCount: 0,
    highestSeverity: "info",
  };
}

describe("notification socket guards", () => {
  it("accepts validated per-session and global notification events", () => {
    expect(parseSessionSocketEvent({
      type: "notifications.inbox",
      daemonInstanceId: "daemon-a",
      catalogRevision: 1,
      summary: summary(),
      dismissThrough: { order: 1, overflowWatermark: 0 },
      delta: { kind: "added", notification: notification() },
    })).toMatchObject({ type: "notifications.inbox", delta: { kind: "added" } });

    expect(parseRealtimeSocketEvent({
      type: "notifications.summary",
      daemonInstanceId: "daemon-a",
      catalogRevision: 1,
      summary: summary(),
    })).toMatchObject({ type: "notifications.summary", summary: { sessionId: "session-1" } });
  });

  it("ignores malformed notification events instead of widening type-only acceptance", () => {
    expect(parseSessionSocketEvent({
      type: "notifications.inbox",
      daemonInstanceId: "daemon-a",
      catalogRevision: 1,
      summary: { ...summary(), highestSeverity: "fatal" },
      dismissThrough: { order: 1, overflowWatermark: 0 },
      delta: { kind: "added", notification: notification() },
    })).toBeUndefined();
    expect(parseRealtimeSocketEvent({
      type: "notifications.summary",
      daemonInstanceId: "daemon-a",
      catalogRevision: Number.POSITIVE_INFINITY,
      summary: summary(),
    })).toBeUndefined();
  });

  it("preserves existing event acceptance without treating unknown types as realtime events", () => {
    expect(parseSessionSocketEvent({ type: "command.output", level: "info", message: "legacy" })).toMatchObject({ type: "command.output" });
    expect(parseRealtimeSocketEvent({ type: "future.notification", payload: {} })).toBeUndefined();
  });
});
