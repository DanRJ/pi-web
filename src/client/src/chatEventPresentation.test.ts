import { describe, expect, it } from "vitest";
import { presentChatEvents } from "./chatEventPresentation";
import type { ChatLine } from "./components/shared";

describe("presentChatEvents", () => {
  it("projects structural tool status without treating opaque details as progress", () => {
    const presentation = presentChatEvents([{ role: "tool", parts: [
      { type: "toolExecution", toolName: "edit", summary: "file.ts", status: "running", details: { progress: { completed: 2, total: 5 } } },
      { type: "toolExecution", toolName: "read", summary: "other", status: "success", details: { completed: 8, total: 3 } },
    ] }]);

    expect(presentation).toMatchObject({ count: 2, status: "running", text: "2 events running" });
    expect(presentation).not.toHaveProperty("progress");
    expect(presentation.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "edit", status: "running", icon: "◌" }),
      expect.objectContaining({ label: "read", status: "success" }),
    ]));
    expect(presentation.rows.every((row) => !Object.hasOwn(row, "progress"))).toBe(true);
  });

  it("does not treat unknown Agent-style details as tracked children or progress", () => {
    const messages: ChatLine[] = [{ role: "tool", parts: [{
      type: "toolExecution", toolName: "Agent", summary: "delegate", status: "running",
      details: { children: [{ sessionId: "invented", cwd: "/tmp", status: "working" }], progress: { completed: 1, total: 2 } },
    }] }];

    const row = presentChatEvents(messages).rows[0];
    expect(row).toMatchObject({ label: "Agent", status: "running" });
    expect(row).not.toHaveProperty("children");
    expect(row).not.toHaveProperty("progress");
  });

  it("recognizes only complete PI WEB tracked-subsessions details", () => {
    const tracked = presentChatEvents([{ role: "tool", parts: [{
      type: "toolExecution", toolName: "list_subsessions", summary: "children", status: "success",
      details: { subsessions: [{ sessionId: "child-1", cwd: "/repo", status: "working" }] },
    }] }]).rows[0];
    expect(tracked?.children).toEqual([{ sessionId: "child-1", cwd: "/repo", status: "working" }]);

    const malformed = presentChatEvents([{ role: "tool", parts: [{
      type: "toolExecution", toolName: "list_subsessions", summary: "children", status: "success",
      details: { subsessions: [{ sessionId: "child-1", status: "working" }] },
    }] }]).rows[0];
    expect(malformed).not.toHaveProperty("children");
  });

  it("never exposes determinate progress from tool details", () => {
    for (const details of [{ completed: 1, total: 2 }, { progress: { completed: 2, total: 5 } }, { percent: 50 }, { total: 2 }]) {
      const presentation = presentChatEvents([{ role: "tool", parts: [{ type: "toolExecution", toolName: "read", summary: "x", status: "running", details }] }]);
      expect(presentation).not.toHaveProperty("progress");
      expect(presentation.rows[0]).not.toHaveProperty("progress");
    }
  });
});
