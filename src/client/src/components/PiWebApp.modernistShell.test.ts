import type { TemplateResult } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { MODERNIST_NAVIGATION_PANEL_DEFAULT_WIDTH } from "../appShell/panelResizeController";
import { templateText } from "../templateInspection.testSupport";
import { PiWebApp } from "./PiWebApp";
import type { ModernistGlobalDestination } from "./appShell/ModernistGlobalHeader";
import { appStyles } from "./shared";

afterEach(() => vi.unstubAllGlobals());

describe("PiWebApp Modernist desktop shell", () => {
  it("wires the global destinations through the existing route and settings owners", () => {
    const app = createApp(true);
    Reflect.set(app, "activeThemeId", "themes:modernist-dark");

    const header = renderPrivateTemplate(app, "renderModernistGlobalHeader");
    const select = property(header, ".onSelect=");
    if (!isDestinationSelect(select)) throw new Error("Modernist global navigation callback unavailable");

    select("settings");
    expect(Reflect.get(app, "settingsSection")).toBe("sessiond");
    expect(property(renderPrivateTemplate(app, "renderModernistGlobalHeader"), ".activeDestination=")).toBe("settings");
    Reflect.set(app, "settingsFocusReturnTarget", { isConnected: true });

    select("chat");
    expect(Reflect.get(app, "settingsSection")).toBeUndefined();
    expect(Reflect.get(app, "settingsFocusReturnTarget")).toBeUndefined();

    select("dashboard");
    expect(Reflect.get(app, "topLevelPage")).toBe("dashboard");
    select("actions");
    expect(Reflect.get(app, "state")).toMatchObject({ actionPaletteOpen: true });
    expect(property(renderPrivateTemplate(app, "renderModernistGlobalHeader"), ".activeDestination=")).toBe("dashboard");
  });

  it("uses the global header and Modernist hierarchy only for the desktop composition", () => {
    const desktop = createApp(true);
    Reflect.set(desktop, "activeThemeId", "themes:modernist-light");

    expect(templateText(desktop.render())).toContain("<modernist-global-header");
    expect(templateText(desktop.render())).not.toContain('side="workspace"');
    expect(property(renderPrivateTemplate(desktop, "renderNavigationPanel"), ".hierarchy=")).toBe(true);
    expect(property(renderPrivateTemplate(desktop, "renderModernistGlobalHeader"), ".refreshControl=")).toBeUndefined();

    const classic = createApp(true);
    Reflect.set(classic, "activeThemeId", "themes:classic");
    expect(templateText(classic.render())).not.toContain("<modernist-global-header");
    expect(property(renderPrivateTemplate(classic, "renderNavigationPanel"), ".hierarchy=")).toBe(false);

    const mobile = createApp(false, true);
    Reflect.set(mobile, "activeThemeId", "themes:modernist-dark");
    expect(templateText(mobile.render())).not.toContain("<modernist-global-header");
    expect(property(renderPrivateTemplate(mobile, "renderNavigationPanel"), ".hierarchy=")).toBe(false);
  });

  it("keeps the Tools destination and its empty-state panel reachable before a workspace is selected", () => {
    const app = createApp(true);
    Reflect.set(app, "activeThemeId", "themes:modernist-dark");
    const select = property(renderPrivateTemplate(app, "renderModernistGlobalHeader"), ".onSelect=");
    if (!isDestinationSelect(select)) throw new Error("Modernist global navigation callback unavailable");

    select("tools");

    expect(Reflect.get(app, "state")).toMatchObject({ mainView: "core:workspace.files" });
    expect(templateText(app.render())).toContain("modernist-tools-expanded");
    expect(templateText(app.render())).toContain("<workspace-panel");
  });

  it("defines a 56px header, 264px Modernist default sidebar, and no Chat sidecar track in CSS structure", () => {
    // CSS structure is the testable layout contract; this does not claim browser geometry measurement.
    expect(MODERNIST_NAVIGATION_PANEL_DEFAULT_WIDTH).toBe(264);
    expect(appStyles.cssText).toContain("grid-template-rows: 56px minmax(0, 1fr)");
    expect(appStyles.cssText).toContain(".shell.modernist-desktop-shell:not(.modernist-tools-expanded):not([data-settings-destination]) > workspace-panel { display: none; }");
    expect(appStyles.cssText).toContain(".shell.modernist-desktop-shell > .workspace-panel-edge { display: none; }");
    expect(appStyles.cssText).toContain(".shell.modernist-desktop-shell main > app-session-header { min-width: 0; overflow: hidden;");
  });
});

function createApp(desktop: boolean, mobile = false): PiWebApp {
  const location = { href: "http://localhost/", pathname: "/", search: "", hash: "" };
  vi.stubGlobal("window", {
    location,
    history: { pushState: () => undefined, replaceState: () => undefined },
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    setInterval: () => 1,
    clearInterval: () => undefined,
    matchMedia: (query: string) => ({ matches: (desktop && query === "(min-width: 1181px)") || (mobile && query === "(max-width: 767px)"), addEventListener: () => undefined, removeEventListener: () => undefined }),
  });
  const app = new PiWebApp();
  Reflect.set(app, "getBoundingClientRect", () => ({ width: desktop ? 1440 : 390 }));
  Reflect.set(app, "state", initialAppState());
  return app;
}

function renderPrivateTemplate(app: PiWebApp, name: string): TemplateResult {
  const method: unknown = Reflect.get(app, name);
  if (typeof method !== "function") throw new Error(`Missing ${name}`);
  const value: unknown = method.call(app);
  if (!isTemplate(value)) throw new Error(`${name} did not render a template`);
  return value;
}

function property(template: TemplateResult, marker: string): unknown {
  const strings: unknown = Reflect.get(template, "strings");
  const values: unknown = Reflect.get(template, "values");
  if (!Array.isArray(strings) || !Array.isArray(values)) throw new Error("Template internals unavailable");
  const index = strings.findIndex((part) => typeof part === "string" && part.includes(marker));
  if (index < 0) throw new Error(`Missing ${marker}`);
  return values[index];
}

function isTemplate(value: unknown): value is TemplateResult {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "strings"));
}

function isDestinationSelect(value: unknown): value is (destination: ModernistGlobalDestination) => void {
  return typeof value === "function";
}
