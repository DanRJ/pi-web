// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo, SessionStatus } from "../api";
import { AppSessionHeader } from "./AppSessionHeader";
import { ChatView } from "./ChatView";
import { PromptEditor } from "./PromptEditor";

const longTitle = "Modernize the session shell while retaining queue ownership and accessible controls";

// The node-environment tests import these modules first, so register their
// already-imported constructors with this file's jsdom custom-element registry.
registerElement("app-session-header", AppSessionHeader);
registerElement("chat-view", ChatView);
registerElement("prompt-editor", PromptEditor);

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-pi-web-theme");
});

describe("Calm Cockpit rendered controls", () => {
  it("keeps a long compact-header title and Stop control named in the rendered DOM", async () => {
    document.documentElement.dataset["piWebTheme"] = "themes:modernist-dark";
    const header = createRegisteredElement("app-session-header", AppSessionHeader);
    header.session = session(longTitle);
    header.status = status({ isStreaming: true });
    header.canStop = true;
    header.clearsServerQueue = false;
    document.body.append(header);
    await header.updateComplete;

    const title = header.shadowRoot?.querySelector(".session-context strong");
    const stop = header.shadowRoot?.querySelector<HTMLButtonElement>(".session-stop-control");
    expect(title?.textContent).toContain(longTitle);
    expect(title?.getAttribute("title")).toBe(session(longTitle).path);
    expect(stop?.getAttribute("aria-label")).toBe("Stop session work");
  });

  it("renders queue ownership and native event disclosure semantics without fabricating rows", async () => {
    const view = createRegisteredElement("chat-view", ChatView);
    view.sessionId = "session-1";
    view.status = status({
      pendingMessageCount: 2,
      queuedMessages: [{ kind: "steer", text: "Focus on the review finding" }],
    });
    view.messages = [
      { role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary: "inspect the file" }] },
      { role: "tool", parts: [{ type: "toolExecution", toolName: "read", summary: "inspect the file", status: "success" }] },
    ];
    document.body.append(view);
    await view.updateComplete;

    const queue = view.shadowRoot?.querySelector<HTMLElement>('aside[aria-label="Queued messages"]');
    expect(queue?.textContent).toContain("1 listed; status says 2 pending");
    expect(queue?.querySelector('section[aria-label="Steering"]')).toBeTruthy();
    expect(queue?.textContent).not.toContain("Stop clears this queue.");

    const disclosure = view.shadowRoot?.querySelector<HTMLDetailsElement>("details.msg.event-group");
    const summary = disclosure?.querySelector("summary");
    expect(disclosure).toBeTruthy();
    expect(summary?.textContent).toContain("events");
    expect(disclosure?.open).toBe(false);
    if (disclosure === null || disclosure === undefined) throw new Error("Expected native event disclosure");
    disclosure.open = true;
    disclosure.dispatchEvent(new Event("toggle"));
    await view.updateComplete;
    expect(disclosure.querySelector(".group-body")).toBeTruthy();
  });

  it("renders prompt actions with accessible labels", async () => {
    const onStop = vi.fn();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined }),
    });
    const editor = createRegisteredElement("prompt-editor", PromptEditor);
    editor.status = status({ model: { provider: "provider", id: "model" }, thinkingLevel: "medium" });
    editor.canSteer = true;
    editor.canStop = true;
    editor.clearsServerQueue = true;
    editor.onStop = onStop;
    document.body.append(editor);
    await editor.updateComplete;

    expect(editor).toBeInstanceOf(PromptEditor);
    expect(editor.shadowRoot).toBeTruthy();
    const attach = editor.shadowRoot?.querySelector<HTMLButtonElement>(".editor-attach");
    const send = editor.shadowRoot?.querySelector<HTMLButtonElement>(".send-button");
    const steer = editor.shadowRoot?.querySelector<HTMLButtonElement>(".steer-button");
    const stop = editor.shadowRoot?.querySelector<HTMLButtonElement>(".stop-button");
    expect(attach?.getAttribute("aria-label")).toBe("Attach files");
    expect(send?.getAttribute("aria-label")).toBe("Queue message");
    expect(steer?.getAttribute("aria-label")).toBe("Steer current response");
    expect(stop?.getAttribute("aria-label")).toBe("Stop current work and clear queued server messages");
    stop?.click();
    expect(onStop).toHaveBeenCalledOnce();
  });
});

function registerElement(name: string, element: CustomElementConstructor): void {
  if (customElements.get(name) === undefined) customElements.define(name, element);
}

function createRegisteredElement<T extends HTMLElement>(name: string, elementType: abstract new () => T): T {
  const element = document.createElement(name);
  if (!(element instanceof elementType)) throw new Error(`Expected ${name} to be registered`);
  return element;
}

function session(firstMessage: string): SessionInfo {
  return {
    id: "session-1",
    cwd: "/repo",
    path: "/repo/session-1.jsonl",
    created: "2026-07-14T00:00:00.000Z",
    modified: "2026-07-14T00:00:00.000Z",
    messageCount: 1,
    firstMessage,
  };
}

function status(overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId: "session-1",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...overrides,
  };
}
