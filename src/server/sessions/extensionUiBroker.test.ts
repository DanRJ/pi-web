import { describe, expect, it, vi } from "vitest";
import { ExtensionUiBroker } from "./extensionUiBroker.js";

function brokerFixture() {
  const events = { request: vi.fn(), resolved: vi.fn(), notify: vi.fn() };
  let id = 0;
  return { events, broker: new ExtensionUiBroker({ events, createId: () => `req-${String(++id)}` }) };
}

describe("ExtensionUiBroker", () => {
  it("publishes a session-scoped dialog and resolves it only once", async () => {
    const { broker, events } = brokerFixture();
    const promise = broker.createUiContext("session-a").select("Choose", ["one", "two"]);

    expect(broker.pendingForSession("session-a")).toEqual([{ id: "req-1", state: "pending", method: "select", title: "Choose", options: ["one", "two"] }]);
    expect(events.request).toHaveBeenCalledWith("session-a", expect.objectContaining({ id: "req-1", method: "select" }));
    expect(broker.respond("session-a", { id: "req-1", value: "two" })).toMatchObject({ outcome: "accepted", resolution: { state: "submitted" } });
    expect(await promise).toBe("two");
    expect(broker.respond("session-a", { id: "req-1", value: "one" })).toMatchObject({ outcome: "already-resolved" });
    expect(events.resolved).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-session responses without touching the pending promise", async () => {
    const { broker } = brokerFixture();
    const promise = broker.createUiContext("session-a").confirm("Delete", "Really?");

    expect(broker.respond("session-b", { id: "req-1", confirmed: true })).toEqual({ outcome: "wrong-session" });
    expect(broker.pendingForSession("session-a")).toHaveLength(1);
    broker.cancelSession("session-a");
    expect(await promise).toBe(false);
  });

  it("rejects select values outside the offered options without settling the request", async () => {
    const { broker, events } = brokerFixture();
    const promise = broker.createUiContext("session-a").select("Choose", ["one", "two"]);

    expect(broker.respond("session-a", { id: "req-1", value: "other" })).toEqual({ outcome: "invalid-response" });
    expect(broker.pendingForSession("session-a")).toHaveLength(1);
    expect(events.resolved).not.toHaveBeenCalled();

    expect(broker.respond("session-a", { id: "req-1", value: "two" })).toMatchObject({ outcome: "accepted" });
    await expect(promise).resolves.toBe("two");
  });

  it("uses distinct random prefixes when an id factory is not supplied", () => {
    const first = new ExtensionUiBroker({ events: { request: vi.fn(), resolved: vi.fn(), notify: vi.fn() } });
    const second = new ExtensionUiBroker({ events: { request: vi.fn(), resolved: vi.fn(), notify: vi.fn() } });

    const firstRequest = first.createUiContext("session-a").input("Name");
    const secondRequest = second.createUiContext("session-a").input("Name");

    expect(first.pendingForSession("session-a")[0]?.id).toMatch(/^extension-ui-[\w-]+-1$/);
    expect(second.pendingForSession("session-a")[0]?.id).toMatch(/^extension-ui-[\w-]+-1$/);
    expect(first.pendingForSession("session-a")[0]?.id).not.toBe(second.pendingForSession("session-a")[0]?.id);
    first.cancelAll();
    second.cancelAll();
    void firstRequest;
    void secondRequest;
  });

  it("expires timed dialogs and clears their timeout", async () => {
    vi.useFakeTimers();
    try {
      const { broker, events } = brokerFixture();
      const promise = broker.createUiContext("session-a").input("Name", undefined, { timeout: 100 });

      await vi.advanceTimersByTimeAsync(100);

      await expect(promise).resolves.toBeUndefined();
      expect(broker.pendingForSession("session-a")).toEqual([]);
      expect(events.resolved).toHaveBeenCalledWith("session-a", { id: "req-1", state: "expired", reason: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves an already-aborted SDK signal without publishing interaction state", async () => {
    const { broker, events } = brokerFixture();
    const controller = new AbortController();
    controller.abort();

    await expect(broker.createUiContext("session-a").confirm("Delete", "Really?", { signal: controller.signal })).resolves.toBe(false);
    expect(broker.pendingForSession("session-a")).toEqual([]);
    expect(events.request).not.toHaveBeenCalled();
    expect(events.resolved).not.toHaveBeenCalled();
  });

  it("adapts editor, cancellation, and notifications without legacy command results", async () => {
    const { broker, events } = brokerFixture();
    const ui = broker.createUiContext("session-a");
    const editor = ui.editor("Edit", "draft");
    ui.notify("Saved", "warning");

    expect(events.request).toHaveBeenCalledWith("session-a", { id: "req-1", state: "pending", method: "editor", title: "Edit", prefill: "draft" });
    expect(events.notify).toHaveBeenCalledWith("session-a", { id: "req-2", method: "notify", message: "Saved", notifyType: "warning" });
    expect(broker.respond("session-a", { id: "req-1", cancelled: true })).toMatchObject({ outcome: "accepted", resolution: { state: "cancelled" } });
    await expect(editor).resolves.toBeUndefined();
  });

  it("cancels pending dialogs when the owning session ends", async () => {
    const { broker, events } = brokerFixture();
    const promise = broker.createUiContext("session-a").input("Name");

    broker.cancelSession("session-a");
    await expect(promise).resolves.toBeUndefined();
    expect(broker.pendingForSession("session-a")).toEqual([]);
    expect(events.resolved).toHaveBeenCalledWith("session-a", { id: "req-1", state: "cancelled", reason: "session-ended" });
  });
});
