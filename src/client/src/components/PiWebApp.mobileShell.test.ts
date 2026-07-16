import type { TemplateResult } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../api";
import { initialAppState, type AppState } from "../appState";
import { PiWebApp } from "./PiWebApp";
import { appStyles } from "./shared";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PiWebApp mobile shell", () => {
  it("keeps header and content before the bottom destination tab bar", () => {
    const app = createApp();
    setState(app, { ...initialAppState(), selectedSession: session() });

    const markup = templateMarkup(app.render());
    expect(markup.indexOf("<app-session-header")).toBeLessThan(markup.indexOf("<app-mobile-destination-tabs"));
    expect(markup.indexOf("<chat-view")).toBeLessThan(markup.indexOf("<app-mobile-destination-tabs"));
  });

  it("keeps the selected tool mounted while Chat becomes the authoritative mobile destination", () => {
    const app = createApp();
    setMobileLayout(app);
    setState(app, { ...initialAppState(), selectedSession: session(), selectedWorkspace: workspace(), mainView: "chat", workspaceTool: "core:workspace.files" });

    call(app, "handleMobileNavigationLayoutChange", true);
    expect(Reflect.get(app, "mobileDestination")).toBe("chat");

    call(app, "openWorkspaceTool", "core:workspace.terminal");
    expect(Reflect.get(app, "mobileDestination")).toBe("tools");
    expect(Reflect.get(app, "state")).toMatchObject({ workspaceTool: "core:workspace.terminal", mainView: "core:workspace.terminal" });

    call(app, "selectMobileDestination", "chat");
    expect(Reflect.get(app, "mobileDestination")).toBe("chat");
    expect(Reflect.get(app, "state")).toMatchObject({ workspaceTool: "core:workspace.terminal", mainView: "core:workspace.terminal" });

    const rendered = app.render();
    expect(values(rendered)).toContain("shell workspace-view mobile-destination-chat");
    expect(templateMarkup(rendered)).toContain("<chat-view");
    expect(templateMarkup(rendered)).toContain("<prompt-editor");
    expect(appStyles.cssText).toContain(".shell.mobile-destination-chat main.workspace-view chat-view");
    expect(appStyles.cssText).toContain(".shell.mobile-destination-chat main.workspace-view prompt-editor");
  });

  it("opens Settings for a tool route and restores Tools after explicit close and URL close", () => {
    const app = createApp();
    setMobileLayout(app);
    setState(app, { ...initialAppState(), selectedSession: session(), selectedWorkspace: workspace(), mainView: "plugin:workspace.review", workspaceTool: "plugin:workspace.review" });
    call(app, "handleMobileNavigationLayoutChange", true);

    call(app, "openSettings");
    expect(Reflect.get(app, "settingsSection")).toBe("general");
    expect(Reflect.get(app, "mobileDestination")).toBe("settings");

    call(app, "closeSettings");
    expect(Reflect.get(app, "settingsSection")).toBeUndefined();
    expect(Reflect.get(app, "mobileDestination")).toBe("tools");

    call(app, "openSettings");
    call(app, "reconcileSettingsRoute", undefined, { restoreFocus: true });
    expect(Reflect.get(app, "settingsSection")).toBeUndefined();
    expect(Reflect.get(app, "mobileDestination")).toBe("tools");
  });

  it("synchronizes Chat with the desktop view after a mobile tool selection", () => {
    const app = createApp();
    setMobileLayout(app);
    setState(app, { ...initialAppState(), selectedSession: session(), selectedWorkspace: workspace(), mainView: "chat", workspaceTool: "core:workspace.files" });

    call(app, "openWorkspaceTool", "core:workspace.terminal");
    call(app, "selectMobileDestination", "chat");
    setDesktopLayout(app);

    expect(Reflect.get(app, "state")).toMatchObject({ mainView: "chat", workspaceTool: "core:workspace.terminal" });
  });

  it("synchronizes Sessions with canonical desktop navigation after a mobile tool selection", () => {
    const app = createApp();
    setMobileLayout(app);
    setState(app, { ...initialAppState(), selectedSession: session(), selectedWorkspace: workspace(), mainView: "chat", workspaceTool: "core:workspace.files" });

    call(app, "openWorkspaceTool", "core:workspace.terminal");
    call(app, "selectMobileDestination", "sessions");
    setDesktopLayout(app);

    expect(Reflect.get(app, "state")).toMatchObject({ mainView: "navigation", workspaceTool: "core:workspace.terminal" });
  });

  it("keeps the selected workspace tool when leaving the mobile Tools destination", () => {
    const app = createApp();
    setMobileLayout(app);
    setState(app, { ...initialAppState(), selectedSession: session(), selectedWorkspace: workspace(), mainView: "chat", workspaceTool: "core:workspace.files" });

    call(app, "openWorkspaceTool", "core:workspace.terminal");
    setDesktopLayout(app);

    expect(Reflect.get(app, "state")).toMatchObject({ mainView: "core:workspace.terminal", workspaceTool: "core:workspace.terminal" });
  });

  it("derives Tools or Chat when the media query enters the mobile layout", () => {
    const tools = createApp();
    setState(tools, { ...initialAppState(), selectedWorkspace: workspace(), mainView: "plugin:workspace.review", workspaceTool: "plugin:workspace.review" });
    call(tools, "handleMobileNavigationLayoutChange", true);
    expect(Reflect.get(tools, "mobileDestination")).toBe("tools");

    const chat = createApp();
    setState(chat, { ...initialAppState(), selectedSession: session(), mainView: "chat" });
    call(chat, "handleMobileNavigationLayoutChange", true);
    expect(Reflect.get(chat, "mobileDestination")).toBe("chat");
  });

  it("restores the deepest pre-settings control on close and the selected destination after popstate removes it", async () => {
    vi.stubGlobal("HTMLElement", FakeHTMLElement);
    const app = createApp();
    const settingsButton = nestedSettingsButton();
    setRenderRoot(app, settingsButton.host);

    call(app, "openSettings");
    expect(Reflect.get(app, "settingsFocusReturnTarget")).toBe(settingsButton.control);
    call(app, "closeSettings");
    await flushFocus();
    expect(settingsButton.control.focus).toHaveBeenCalledOnce();

    const popstateApp = createApp();
    const staleSettingsButton = nestedSettingsButton();
    const focusSelected = vi.fn();
    setMobileLayout(popstateApp);
    setRenderRoot(popstateApp, staleSettingsButton.host);
    Object.defineProperty(popstateApp, "mobileDestinationTabs", { configurable: true, value: { focusSelected } });
    Reflect.set(popstateApp, "restoreRoute", () => Promise.resolve());
    call(popstateApp, "openSettings");
    staleSettingsButton.control.isConnected = false;
    call(popstateApp, "onPopState");
    await flushFocus();
    expect(staleSettingsButton.control.focus).not.toHaveBeenCalled();
    expect(focusSelected).toHaveBeenCalledOnce();
  });

  it("returns direct settings routes to a visible mobile destination or desktop main landmark", async () => {
    const mobileApp = createApp("?settings=general");
    const focusSelected = vi.fn();
    setMobileLayout(mobileApp);
    setRenderRoot(mobileApp, nestedSettingsButton().host);
    Object.defineProperty(mobileApp, "mobileDestinationTabs", { configurable: true, value: { focusSelected } });
    call(mobileApp, "restoreSettingsRoute");
    call(mobileApp, "closeSettings");
    await flushFocus();
    expect(focusSelected).toHaveBeenCalledOnce();

    const desktopApp = createApp("?settings=general");
    const main = new FakeHTMLElement();
    setRenderRoot(desktopApp, nestedSettingsButton().host);
    Object.defineProperty(desktopApp, "mainContent", { configurable: true, value: main });
    call(desktopApp, "restoreSettingsRoute");
    call(desktopApp, "closeSettings");
    await flushFocus();
    expect(main.focus).toHaveBeenCalledOnce();
  });
});

class FakeHTMLElement {
  isConnected = true;
  shadowRoot: { activeElement: FakeHTMLElement | null } | null = null;
  readonly focus = vi.fn();

  matches(selector: string): boolean {
    return selector.includes("button");
  }
}

function nestedSettingsButton(): { host: FakeHTMLElement; control: FakeHTMLElement } {
  const host = new FakeHTMLElement();
  const nestedHost = new FakeHTMLElement();
  const control = new FakeHTMLElement();
  nestedHost.shadowRoot = { activeElement: control };
  host.shadowRoot = { activeElement: nestedHost };
  return { host, control };
}

function setRenderRoot(app: PiWebApp, activeElement: FakeHTMLElement): void {
  Object.defineProperty(app, "renderRoot", { configurable: true, value: { activeElement, querySelector: () => undefined } });
  Object.defineProperty(app, "updateComplete", { configurable: true, value: Promise.resolve(true) });
}

async function flushFocus(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createApp(search = ""): PiWebApp {
  const location = { href: `http://localhost/${search}`, pathname: "/", search, hash: "" };
  const media = { matches: false, addEventListener: () => undefined, removeEventListener: () => undefined };
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("window", {
    location,
    history: { pushState: () => undefined, replaceState: () => undefined },
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    matchMedia: () => media,
  });
  const app = new PiWebApp();
  Reflect.set(app, "getBoundingClientRect", () => ({ width: 0 }));
  return app;
}

function setState(app: PiWebApp, state: AppState): void {
  if (!Reflect.set(app, "state", state)) throw new Error("Could not set application state");
}

function setMobileLayout(app: PiWebApp): void {
  const shell: unknown = Reflect.get(app, "appShell");
  if (typeof shell !== "object" || shell === null || !("isMobileNavigationLayout" in shell)) throw new Error("App shell unavailable");
  Reflect.set(shell, "isMobileNavigationLayout", true);
}

function setDesktopLayout(app: PiWebApp): void {
  const shell: unknown = Reflect.get(app, "appShell");
  const onMediaChange: unknown = typeof shell === "object" && shell !== null ? Reflect.get(shell, "onMobileNavigationMediaChange") : undefined;
  if (!isVoidMethod(onMediaChange)) throw new Error("App shell media handler unavailable");
  onMediaChange.call(shell, { matches: false });
}

function call(app: PiWebApp, name: string, ...args: unknown[]): void {
  const method: unknown = Reflect.get(app, name);
  if (!isVoidMethod(method)) throw new Error(`Expected ${name} method`);
  method.call(app, ...args);
}

function session(): SessionInfo {
  return {
    id: "session-1",
    cwd: "/repo",
    path: "/repo/session-1.jsonl",
    created: "2026-07-14T00:00:00.000Z",
    modified: "2026-07-14T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "Mobile shell",
  };
}

function workspace() {
  return { id: "workspace-1", projectId: "project-1", path: "/repo", label: "Repo", isMain: true, isGitRepo: true, isGitWorktree: false };
}

function templateMarkup(template: TemplateResult): string {
  return `${strings(template).join("")}${values(template).map((value) => nestedMarkup(value)).join("")}`;
}

function nestedMarkup(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => nestedMarkup(item)).join("");
  return isTemplate(value) ? templateMarkup(value) : "";
}

function strings(template: TemplateResult): readonly string[] {
  const value: unknown = Reflect.get(template, "strings");
  if (!isStringArray(value)) throw new Error("Template strings unavailable");
  return value;
}

function values(template: TemplateResult): readonly unknown[] {
  const value = Reflect.get(template, "values");
  if (!Array.isArray(value)) throw new Error("Template values unavailable");
  return value;
}

function isTemplate(value: unknown): value is TemplateResult {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "strings"));
}

function isVoidMethod(value: unknown): value is { call(thisArg: unknown, ...args: unknown[]): void } {
  return typeof value === "function";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
