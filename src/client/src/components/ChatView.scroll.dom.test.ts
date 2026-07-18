// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { chatScrollStorageKey } from "../chatScrollPosition";
import { ChatView } from "./ChatView";

if (customElements.get("chat-view") === undefined) customElements.define("chat-view", ChatView);

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("ChatView Jump to latest", () => {
  it("renders an accessible 44px control after the show threshold and follows latest smoothly", async () => {
    const view = await mountedView();
    const chat = chatViewport(view, 300, 1000, 400);
    const scrollTo = vi.fn();
    Object.defineProperty(chat, "scrollTo", { configurable: true, value: scrollTo });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));

    refreshJump(view);
    await view.updateComplete;

    const button = view.shadowRoot?.querySelector<HTMLButtonElement>(".jump-to-latest");
    expect(button?.getAttribute("aria-label")).toBe("Jump to latest message");
    expect(button?.textContent).toContain("Latest");
    expect(ChatView.styles.cssText).toContain("min-height: 2.75rem");
    button?.click();

    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
    expect(Reflect.get(view, "pinnedToBottom")).toBe(true);
    expect(Reflect.get(view, "showJumpToLatest")).toBe(false);
  });

  it("uses an immediate non-animated scroll when reduced motion is requested", async () => {
    const view = await mountedView();
    const chat = chatViewport(view, 300, 1000, 400);
    const scrollTo = vi.fn();
    Object.defineProperty(chat, "scrollTo", { configurable: true, value: scrollTo });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));

    refreshJump(view);
    await view.updateComplete;
    view.shadowRoot?.querySelector<HTMLButtonElement>(".jump-to-latest")?.click();

    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "auto" });
    expect(Reflect.get(view, "followingLatestUntilBottom")).toBe(false);
  });

  it("renders one mounted Waiting strip instead of conflicting catch-up or shell status", async () => {
    const view = await mountedView();
    view.waitingForUser = true;
    view.isReceivingPartialStream = true;
    view.status = status({ isBashRunning: true });
    await view.updateComplete;

    const strips = view.shadowRoot?.querySelectorAll<HTMLElement>(".live-strip") ?? [];
    expect(strips).toHaveLength(1);
    expect(strips[0]?.textContent).toContain("Waiting");
    expect(strips[0]?.textContent).not.toContain("Catching up");
    expect(strips[0]?.textContent).not.toContain("Shell");
    expect(view.shadowRoot?.querySelector(".session-activity")).toBeNull();
  });

  it("renders Catching up once in the mounted live strip, not in the transcript", async () => {
    const view = await mountedView();
    view.isReceivingPartialStream = true;
    await view.updateComplete;

    const strips = view.shadowRoot?.querySelectorAll<HTMLElement>(".live-strip") ?? [];
    expect(strips).toHaveLength(1);
    expect(strips[0]?.textContent).toContain("Catching up");
    expect(view.shadowRoot?.querySelector(".session-activity")).toBeNull();
  });

  it("does not pull a reader at an older message to the tail while streaming", async () => {
    const view = await mountedView();
    const chat = chatViewport(view, 120, 1000, 400);
    Reflect.set(view, "pinnedToBottom", false);
    view.status = status({ isStreaming: true });
    view.messages = [{ role: "assistant", parts: [{ type: "text", text: "The stream grew." }] }];
    await view.updateComplete;

    expect(chat.scrollTop).toBe(120);
    expect(Reflect.get(view, "pinnedToBottom")).toBe(false);
  });

  it("keeps following Latest through a transcript update, but cancels on upward reader intent", async () => {
    const view = await mountedView();
    const chat = chatViewport(view, 300, 1000, 400);
    const scrollTo = vi.fn();
    Object.defineProperty(chat, "scrollTo", { configurable: true, value: scrollTo });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    refreshJump(view);
    await view.updateComplete;

    view.shadowRoot?.querySelector<HTMLButtonElement>(".jump-to-latest")?.click();
    // A smooth scroll emits ordinary scroll events without reader intent.
    chat.scrollTop = 450;
    chat.dispatchEvent(new Event("scroll"));
    Object.defineProperty(chat, "scrollHeight", { configurable: true, value: 1100 });
    view.messages = [{ role: "assistant", parts: [{ type: "text", text: "A streamed update arrived before smooth scrolling settled." }] }];
    await view.updateComplete;

    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1100, behavior: "smooth" });
    expect(Reflect.get(view, "followingLatestUntilBottom")).toBe(true);
    expect(Reflect.get(view, "pinnedToBottom")).toBe(true);

    chat.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -1 }));
    expect(Reflect.get(view, "followingLatestUntilBottom")).toBe(false);
    expect(Reflect.get(view, "pinnedToBottom")).toBe(false);
  });

  it("cancels smooth Latest follow when a scrollbar pointer drag scrolls away", async () => {
    const view = await mountedView();
    const chat = chatViewport(view, 300, 1000, 400);
    const scrollTo = vi.fn();
    Object.defineProperty(chat, "scrollTo", { configurable: true, value: scrollTo });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    refreshJump(view);
    await view.updateComplete;

    view.shadowRoot?.querySelector<HTMLButtonElement>(".jump-to-latest")?.click();
    const pointerDown = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(pointerDown, "isPrimary", { value: true });
    chat.dispatchEvent(pointerDown);
    chat.scrollTop = 200;
    chat.dispatchEvent(new Event("scroll"));

    expect(Reflect.get(view, "followingLatestUntilBottom")).toBe(false);
    expect(Reflect.get(view, "pinnedToBottom")).toBe(false);

    Object.defineProperty(chat, "scrollHeight", { configurable: true, value: 1100 });
    view.messages = [{ role: "assistant", parts: [{ type: "text", text: "The transcript grew after the reader dragged the scrollbar." }] }];
    await view.updateComplete;

    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("cancels smooth Latest follow when keyboard scrolling moves away", async () => {
    const view = await mountedView();
    const chat = chatViewport(view, 300, 1000, 400);
    const scrollTo = vi.fn();
    Object.defineProperty(chat, "scrollTo", { configurable: true, value: scrollTo });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    refreshJump(view);
    await view.updateComplete;

    view.shadowRoot?.querySelector<HTMLButtonElement>(".jump-to-latest")?.click();
    chat.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }));
    chat.scrollTop = 200;
    chat.dispatchEvent(new Event("scroll"));

    expect(Reflect.get(view, "followingLatestUntilBottom")).toBe(false);
    expect(Reflect.get(view, "pinnedToBottom")).toBe(false);

    Object.defineProperty(chat, "scrollHeight", { configurable: true, value: 1100 });
    view.messages = [{ role: "assistant", parts: [{ type: "text", text: "The transcript grew after keyboard scrolling." }] }];
    await view.updateComplete;

    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("persists explicit bottom intent before a smooth Latest scroll finishes", async () => {
    const view = await mountedView();
    const chat = chatViewport(view, 300, 1000, 400);
    Object.defineProperty(chat, "scrollTo", { configurable: true, value: vi.fn() });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    localStorage.setItem(chatScrollStorageKey("session-1"), JSON.stringify({ mode: "anchor", anchorId: "m:4", offset: 20 }));
    refreshJump(view);
    await view.updateComplete;

    view.shadowRoot?.querySelector<HTMLButtonElement>(".jump-to-latest")?.click();
    expect(JSON.parse(localStorage.getItem(chatScrollStorageKey("session-1")) ?? "{}")).toEqual({ mode: "bottom" });

    view.sessionId = "session-2";
    await view.updateComplete;
    view.sessionId = "session-1";
    await view.updateComplete;
    await nextFrame();

    expect(chat.scrollTop).toBe(1000);
  });

  it("resets the overlay state when switching sessions and keeps dynamic bottom clearance in CSS", async () => {
    const view = await mountedView();
    chatViewport(view, 300, 1000, 400);
    refreshJump(view);
    await view.updateComplete;
    expect(Reflect.get(view, "showJumpToLatest")).toBe(true);

    view.sessionId = "session-2";
    await view.updateComplete;

    expect(Reflect.get(view, "showJumpToLatest")).toBe(false);
    expect(ChatView.styles.cssText).toContain(".chat.has-live-strip.has-jump-to-latest");
  });
});

async function mountedView(): Promise<ChatView> {
  const view = document.createElement("chat-view");
  if (!(view instanceof ChatView)) throw new Error("Expected ChatView to be registered");
  view.sessionId = "session-1";
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function chatViewport(view: ChatView, scrollTop: number, scrollHeight: number, clientHeight: number): HTMLDivElement {
  const chat = view.shadowRoot?.querySelector<HTMLDivElement>(".chat");
  if (chat === null || chat === undefined) throw new Error("Expected chat viewport");
  Object.defineProperties(chat, {
    scrollTop: { configurable: true, writable: true, value: scrollTop },
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight },
  });
  return chat;
}

function refreshJump(view: ChatView): void {
  const refresh: unknown = Reflect.get(view, "refreshJumpToLatest");
  if (typeof refresh !== "function") throw new Error("Expected jump visibility helper");
  refresh.call(view);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => { requestAnimationFrame(() => { resolve(); }); });
}

function status(overrides: Partial<import("../api").SessionStatus> = {}): import("../api").SessionStatus {
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
