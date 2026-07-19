// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../api";
import { SessionList } from "./SessionList";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("SessionList Rename menu", () => {
  it("closes the menu before opening Rename and uses its persistent toggle as the opener", async () => {
    const list = document.createElement("session-list");
    if (!(list instanceof SessionList)) throw new Error("Expected session list");
    const currentSession = session("current");
    const onRename = vi.fn(() => { expect(Reflect.get(list, "openMenuSessionId")).toBeUndefined(); });
    list.sessions = [currentSession];
    list.canRename = true;
    list.onRename = onRename;
    document.body.append(list);
    await list.updateComplete;

    const toggle = button(list, ".action-menu-toggle");
    toggle.click();
    await list.updateComplete;
    const rename = button(list, ".action-menu-panel button");

    rename.click();

    expect(onRename).toHaveBeenCalledOnce();
    expect(onRename).toHaveBeenCalledWith(currentSession, toggle);
    expect(toggle.isConnected).toBe(true);
    await list.updateComplete;
    expect(list.shadowRoot?.querySelector(".action-menu-panel")).toBeNull();
  });
});

function button(list: SessionList, selector: string): HTMLButtonElement {
  const element = list.shadowRoot?.querySelector<HTMLButtonElement>(selector);
  if (element === null || element === undefined) throw new Error(`Expected button: ${selector}`);
  return element;
}

function session(id: string): SessionInfo {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: "/workspace",
    created: "2026-06-09T00:00:00.000Z",
    modified: "2026-06-09T00:00:00.000Z",
    messageCount: 1,
    firstMessage: id,
  };
}
