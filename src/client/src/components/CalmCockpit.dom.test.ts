// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo, SessionStatus } from "../api";
import { AppSessionHeader } from "./AppSessionHeader";
import { ChatView } from "./ChatView";
import { PromptEditor } from "./PromptEditor";
import { saveDraft } from "../promptDraftStorage";
import { machineSessionKey } from "../machineKeys";

const longTitle = "Modernize the session shell while retaining queue ownership and accessible controls";

// The node-environment tests import these modules first, so register their
// already-imported constructors with this file's jsdom custom-element registry.
registerElement("app-session-header", AppSessionHeader);
registerElement("chat-view", ChatView);
registerElement("prompt-editor", PromptEditor);

// jsdom does not implement this browser layout API; keep queued animation-frame
// callbacks from surfacing an unrelated unhandled error after DOM cleanup.
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-pi-web-theme");
  try { localStorage.clear(); } catch { /* jsdom localStorage may be unavailable */ }
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
    expect(AppSessionHeader.styles.cssText).toContain("width: 100%; max-width: 100%; min-width: 0; overflow: hidden;");
    expect(AppSessionHeader.styles.cssText).toContain(":host-context(:root[data-pi-web-theme^=\"themes:modernist-\"]) .rename-control { display: none; }");
  });

  it.each(["themes:classic", "themes:pi-web-dark", "themes:modernist-light", "themes:modernist-dark"])("keeps %s mobile header controls at a 2.75rem touch target", async (theme) => {
    document.documentElement.dataset["piWebTheme"] = theme;
    const header = createRegisteredElement("app-session-header", AppSessionHeader);
    header.session = session("Mobile touch targets");
    header.canStop = true;
    document.body.append(header);
    await header.updateComplete;

    expect(header.shadowRoot?.querySelectorAll(".session-actions button")).toHaveLength(2);
    expect(AppSessionHeader.styles.cssText).toContain("button { min-width: 2.75rem; min-height: 2.75rem; height: 2.75rem; }");
  });

  it("keeps a textual header status through waiting and working transitions", async () => {
    const header = createRegisteredElement("app-session-header", AppSessionHeader);
    header.session = session("Status transitions");
    header.status = status({ isStreaming: true });
    header.waitingForUser = true;
    document.body.append(header);
    await header.updateComplete;

    const badge = () => header.shadowRoot?.querySelector<HTMLElement>(".status-badge");
    expect(badge()?.className).toContain("waiting");
    expect(badge()?.textContent).toContain("Waiting");
    expect(badge()?.getAttribute("aria-label")).toBe("Waiting");

    header.waitingForUser = false;
    await header.updateComplete;
    expect(badge()?.className).toContain("working");
    expect(badge()?.textContent).toContain("Working");
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

  it.each(["themes:modernist-light", "themes:modernist-dark"])("renders the %s grouped composer in visible DOM order", async (theme) => {
    document.documentElement.dataset["piWebTheme"] = theme;
    const editor = await mountedPromptEditor();
    const modernist = editor.shadowRoot?.querySelector<HTMLElement>(".modernist-actions");
    const legacyActions = editor.shadowRoot?.querySelector<HTMLElement>(".legacy-actions");
    const legacyAttach = editor.shadowRoot?.querySelector<HTMLElement>(".editor-wrap > .legacy-composer.editor-attach");
    if (modernist === null || modernist === undefined || legacyActions === null || legacyActions === undefined || legacyAttach === null || legacyAttach === undefined) throw new Error("Expected both scoped composer templates");

    expect(modernist.classList.contains("modernist-composer")).toBe(true);
    expect(legacyActions.classList.contains("legacy-composer")).toBe(true);
    expect(legacyAttach.classList.contains("legacy-composer")).toBe(true);
    expect(Array.from(modernist.querySelectorAll<HTMLButtonElement>(".action-context button")).map((button) => button.getAttribute("aria-label") ?? button.title)).toEqual([
      "Attach files", "Select model", "Thinking level: medium",
    ]);
    expect(Array.from(modernist.querySelectorAll<HTMLButtonElement>(".action-execution button")).map((button) => button.getAttribute("aria-label"))).toEqual([
      "Steer current response", "Stop current work and clear queued server messages", "Queue message",
    ]);
    expect(modernist.querySelector(".action-execution button:last-child")?.classList.contains("send-button")).toBe(true);
  });

  it.each(["themes:classic", "themes:pi-web-dark"])("preserves the %s legacy composer attachment and action order", async (theme) => {
    document.documentElement.dataset["piWebTheme"] = theme;
    const editor = await mountedPromptEditor();
    const legacyActions = editor.shadowRoot?.querySelector<HTMLElement>(".legacy-actions");
    const modernist = editor.shadowRoot?.querySelector<HTMLElement>(".modernist-actions");
    const attach = editor.shadowRoot?.querySelector<HTMLButtonElement>(".editor-wrap > .legacy-composer.editor-attach");
    if (legacyActions === null || legacyActions === undefined || modernist === null || modernist === undefined || attach === null || attach === undefined) throw new Error("Expected both scoped composer templates");

    expect(legacyActions.classList.contains("legacy-composer")).toBe(true);
    expect(modernist.classList.contains("modernist-composer")).toBe(true);
    expect(attach.closest(".editor-wrap")).toBeTruthy();
    expect(attach.closest(".legacy-actions")).toBeNull();
    expect(Array.from(legacyActions.children).map((child) => child.className)).toEqual([
      "compact-status", "icon-button send-button", "icon-button steer-button", "icon-button stop-button",
    ]);
  });

  it("wires one visible Modernist control set to the existing callbacks", async () => {
    document.documentElement.dataset["piWebTheme"] = "themes:modernist-light";
    const onStop = vi.fn();
    const onSend = vi.fn();
    const onSelectModel = vi.fn();
    const onSelectThinking = vi.fn();
    const editor = await mountedPromptEditor({ onStop, onSend, onSelectModel, onSelectThinking });
    const modernist = editor.shadowRoot?.querySelector<HTMLElement>(".modernist-actions");
    const fileInput = editor.shadowRoot?.querySelector<HTMLInputElement>(".attachment-input");
    if (modernist === null || modernist === undefined || fileInput === null || fileInput === undefined) throw new Error("Expected Modernist controls and attachment input");

    const clickFileInput = vi.spyOn(fileInput, "click");
    modernist.querySelector<HTMLButtonElement>(".editor-attach")?.click();
    modernist.querySelector<HTMLButtonElement>(".select-model")?.click();
    modernist.querySelector<HTMLButtonElement>(".select-thinking")?.click();
    modernist.querySelector<HTMLButtonElement>(".stop-button")?.click();
    Reflect.set(editor, "draft", "follow up");
    modernist.querySelector<HTMLButtonElement>(".send-button")?.click();
    expect(clickFileInput).toHaveBeenCalledOnce();
    expect(onSelectModel).toHaveBeenCalledOnce();
    expect(onSelectThinking).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith("follow up", "followUp", undefined, undefined);
  });

  it("reports CodeMirror focus changes and clears mobile focus when blurred or disconnected", async () => {
    const onFocusChange = vi.fn();
    const editor = await mountedPromptEditor();
    editor.onFocusChange = onFocusChange;
    editor.view?.contentDOM.dispatchEvent(new FocusEvent("focus"));
    expect(onFocusChange).toHaveBeenCalledWith(true);

    editor.blurInput();
    expect(onFocusChange).toHaveBeenLastCalledWith(false);
    editor.remove();
    expect(onFocusChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps the mounted CodeMirror editor and view through token-only status updates", async () => {
    document.documentElement.dataset["piWebTheme"] = "themes:modernist-dark";
    const editor = await mountedPromptEditor();
    const cmEditor = editor.shadowRoot?.querySelector(".cm-editor");
    const view = editor.view;
    expect(cmEditor).toBeTruthy();
    expect(view).toBeTruthy();
    if (view === undefined) throw new Error("Expected CodeMirror view");
    view.dispatch({ changes: { from: 0, insert: "keep this draft" } });
    const completions = [{ kind: "command" as const, replaceFrom: 0, replaceTo: 0, insertText: "/help", detail: "built-in" }];
    Reflect.set(editor, "completions", completions);

    editor.status = status({ model: { provider: "provider", id: "model" }, thinkingLevel: "medium", tokens: { input: 99, output: 101, cacheRead: 0, cacheWrite: 0, total: 200 } });
    await editor.updateComplete;
    expect(editor.shadowRoot?.querySelector(".cm-editor")).toBe(cmEditor);
    expect(editor.view).toBe(view);
    expect(editor.view?.state.doc.toString()).toBe("keep this draft");
    expect(Reflect.get(editor, "completions")).toBe(completions);
  });

  it("places the cursor at the end of a restored draft when the editor mounts", async () => {
    const draft = "half-written message";
    saveDraft(machineSessionKey("local", "draft-session"), draft);
    const editor = createRegisteredElement("prompt-editor", PromptEditor);
    editor.machineId = "local";
    editor.sessionId = "draft-session";
    document.body.append(editor);
    await editor.updateComplete;

    expect(editor.view?.state.doc.toString()).toBe(draft);
    expect(editor.view?.state.selection.main.head).toBe(draft.length);
  });

  it("keeps idle, streaming, compacting, sending, disabled, and delivery states truthful", async () => {
    document.documentElement.dataset["piWebTheme"] = "themes:modernist-light";
    const editor = createRegisteredElement("prompt-editor", PromptEditor);
    editor.status = status({ model: { provider: "provider", id: "a-model-name-that-can-yield" }, thinkingLevel: "medium" });
    document.body.append(editor);
    await editor.updateComplete;

    const actionLabels = () => Array.from(editor.shadowRoot?.querySelectorAll<HTMLButtonElement>(".modernist-actions .action-execution button") ?? []).map((button) => button.getAttribute("aria-label"));
    expect(actionLabels()).toEqual(["Stop current work", "Send message"]);
    expect(editor.shadowRoot?.querySelector(".steer-button")).toBeNull();

    editor.canSteer = true;
    editor.canStop = true;
    await editor.updateComplete;
    expect(actionLabels()).toEqual(["Steer current response", "Stop current work", "Queue message"]);

    editor.isCompacting = true;
    await editor.updateComplete;
    expect(editor.shadowRoot?.querySelector(".steer-button")).toBeNull();
    expect(editor.shadowRoot?.textContent).toContain("Compacting history · message will be queued");

    editor.sending = true;
    await editor.updateComplete;
    expect(editor.shadowRoot?.querySelector<HTMLButtonElement>(".editor-attach")?.disabled).toBe(true);
    expect(editor.shadowRoot?.querySelector<HTMLButtonElement>(".send-button")?.disabled).toBe(true);

    editor.sending = false;
    editor.disabled = true;
    await editor.updateComplete;
    expect(editor.shadowRoot?.querySelector(".markdown-editor")?.getAttribute("aria-disabled")).toBe("true");
    expect(editor.shadowRoot?.querySelector<HTMLButtonElement>(".send-button")?.disabled).toBe(true);

    Reflect.set(editor, "attachments", [{ id: "attachment-1", kind: "image", name: "shot.png", mimeType: "image/png", data: "UE5H", size: 3 }]);
    await editor.updateComplete;
    expect(editor.shadowRoot?.querySelector(".attachment-delivery select")).toBeTruthy();
    expect(editor.shadowRoot?.querySelector(".attachments")?.textContent).toContain("Attach to message");
  });
});

async function mountedPromptEditor(callbacks: Pick<PromptEditor, "onStop" | "onSend" | "onSelectModel" | "onSelectThinking"> = {}): Promise<PromptEditor> {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined }),
  });
  const editor = createRegisteredElement("prompt-editor", PromptEditor);
  editor.status = status({ model: { provider: "provider", id: "model" }, thinkingLevel: "medium" });
  editor.canSteer = true;
  editor.canStop = true;
  editor.clearsServerQueue = true;
  Object.assign(editor, callbacks);
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}

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
