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

describe("SessionList header actions menu", () => {
  it("folds New session, Select, and Clean up behind the header + menu and closes after an action", async () => {
    const list = document.createElement("session-list");
    if (!(list instanceof SessionList)) throw new Error("Expected session list");
    const onStart = vi.fn();
    list.sessions = [session("current")];
    list.canStart = true;
    list.canCleanup = true;
    list.onStart = onStart;
    document.body.append(list);
    await list.updateComplete;

    expect(list.shadowRoot?.querySelector(".session-actions-menu")).toBeNull();

    button(list, ".session-actions-toggle").click();
    await list.updateComplete;

    const items = [...(list.shadowRoot?.querySelectorAll<HTMLButtonElement>(".session-actions-menu button") ?? [])].map((item) => item.textContent.trim());
    expect(items).toEqual(["New session", "Select sessions", "Clean up"]);

    button(list, ".session-actions-menu button").click();
    expect(onStart).toHaveBeenCalledOnce();
    await list.updateComplete;
    expect(list.shadowRoot?.querySelector(".session-actions-menu")).toBeNull();
  });

  it("omits Select when there are no current sessions to select", async () => {
    const list = document.createElement("session-list");
    if (!(list instanceof SessionList)) throw new Error("Expected session list");
    list.sessions = [{ ...session("archived"), archived: true, archivedAt: "2026-06-09T00:00:00.000Z" }];
    list.canStart = true;
    document.body.append(list);
    await list.updateComplete;

    button(list, ".session-actions-toggle").click();
    await list.updateComplete;

    const items = [...(list.shadowRoot?.querySelectorAll<HTMLButtonElement>(".session-actions-menu button") ?? [])].map((item) => item.textContent.trim());
    expect(items).toEqual(["New session", "Clean up"]);
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
