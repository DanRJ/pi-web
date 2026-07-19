import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLASSIC_THEME_ID, DEFAULT_THEME_PREFERENCE, MODERNIST_DARK_THEME_ID, MODERNIST_LIGHT_THEME_ID, findThemePairForTheme, readStoredThemePreference, resolveThemePreference, toggleThemePreference, writeStoredThemePreference } from "./theme";
import { themePackPlugin } from "./plugins/themes";
import { chatStyles } from "./components/shared";
import type { PluginActivationContext, QualifiedContributionId, QualifiedThemeContribution, QualifiedThemePairContribution, ThemeColorScheme, ThemeTokens } from "./plugins/types";

const tokens = {
  "--pi-bg": "#000000",
  "--pi-surface": "#000000",
  "--pi-surface-hover": "#000000",
  "--pi-terminal-bg": "#000000",
  "--pi-terminal-text": "#000000",
  "--pi-border": "#000000",
  "--pi-border-muted": "#000000",
  "--pi-text": "#000000",
  "--pi-text-secondary": "#000000",
  "--pi-text-bright": "#000000",
  "--pi-muted": "#000000",
  "--pi-dim": "#000000",
  "--pi-accent": "#000000",
  "--pi-accent-border": "#000000",
  "--pi-selection-bg": "#000000",
  "--pi-success": "#000000",
  "--pi-success-border": "#000000",
  "--pi-success-bg": "#000000",
  "--pi-success-surface": "#000000",
  "--pi-success-ring": "#000000",
  "--pi-warning": "#000000",
  "--pi-warning-border": "#000000",
  "--pi-warning-surface": "#000000",
  "--pi-danger": "#000000",
  "--pi-purple": "#000000",
  "--pi-purple-border": "#000000",
  "--pi-purple-surface": "#000000",
  "--pi-overlay": "#000000",
  "--pi-shadow-soft": "#000000",
  "--pi-shadow": "#000000",
  "--pi-shadow-strong": "#000000",
  "--pi-bg-overlay-soft": "#000000",
  "--pi-bg-overlay": "#000000",
  "--pi-success-bg-overlay": "#000000",
  "--pi-terminal-selection": "#000000",
} satisfies ThemeTokens;

const themeActivationContext: PluginActivationContext = {
  apiVersion: 1,
  pluginId: "themes",
  html: unavailableTemplate,
  svg: unavailableTemplate,
};

const themes = [
  theme("modernist-dark", "Modernist Dark", "dark"),
  theme("modernist-light", "Modernist Light", "light"),
  theme("pi-web-dark", "PI WEB Dark", "dark"),
  theme("pi-web-light", "PI WEB Light", "light"),
  theme("classic", "PI WEB Classic", "dark"),
];

const themePairs: QualifiedThemePairContribution[] = [
  {
    id: "themes:modernist",
    pluginId: "themes",
    localId: "modernist",
    name: "Modernist",
    light: MODERNIST_LIGHT_THEME_ID,
    dark: MODERNIST_DARK_THEME_ID,
  },
  {
    id: "themes:pi-web",
    pluginId: "themes",
    localId: "pi-web",
    name: "PI WEB",
    light: "themes:pi-web-light",
    dark: "themes:pi-web-dark",
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Modernist structural token boundaries", () => {
  const shellThemeCss = readFileSync(new URL("../index.html", import.meta.url), "utf8");

  it("uses the approved AA accent ramp for Modernist Light semantic text", () => {
    const themes = themePackPlugin.activate(themeActivationContext).contributions.themes;
    const modernistLight = themes?.find((theme) => theme.id === "modernist-light");
    expect(modernistLight?.tokens["--pi-accent"]).toBe("#d1270d");
    expect(modernistLight?.tokens["--pi-success"]).toBe("#d1270d");
  });

  it("keeps Classic and PI WEB on the exact legacy structural defaults", () => {
    expect(shellThemeCss).toContain("--pi-pill-radius: 999px;");
    expect(shellThemeCss).toContain("--pi-chat-card-radius: 10px;");
    expect(shellThemeCss).toContain("--pi-chat-inline-card-radius: 8px;");
    expect(shellThemeCss).toContain("--pi-inline-code-radius: 4px;");
    expect(shellThemeCss).toContain("--pi-code-block-radius: 8px;");
    expect(shellThemeCss).toContain("--pi-diff-inline-radius: 2px;");
    expect(shellThemeCss).toContain("--pi-diff-panel-radius: 7px;");
    expect(shellThemeCss).toContain("--pi-meter-marker-border-width: 2px;");
    expect(shellThemeCss).toContain("--pi-tool-running-indicator-glyph-font-size: inherit;");
    expect(shellThemeCss).toContain("--pi-tool-running-indicator-display: inline;");
    expect(shellThemeCss).toContain("--pi-tool-running-indicator-spinner-size: auto;");
    expect(shellThemeCss).toContain("--pi-tool-running-indicator-spinner-border-width: 0px;");
    expect(shellThemeCss).toContain("--pi-tool-running-indicator-animation: none;");
    expect(shellThemeCss).toContain("--pi-selected-nav-color: var(--pi-text);");
    expect(shellThemeCss).toContain("--pi-selected-nav-font-weight: 400;");
    expect(shellThemeCss).toContain("--pi-tool-error-card-border: var(--pi-danger);");
    expect(shellThemeCss).toContain("--pi-tool-error-card-background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-bg));");
    expect(shellThemeCss).toContain("--pi-tool-error-icon-color: var(--pi-muted);");
    expect(shellThemeCss).toContain("--pi-tool-error-icon-stroke-width: 0px;");
    expect(shellThemeCss).not.toMatch(/data-pi-web-theme\^="themes:(?:classic|pi-web-)"/u);
  });

  it("keeps assistant prose and sticky headers scoped to Modernist", () => {
    expect(chatStyles.cssText).toContain(':host-context(:root[data-pi-web-theme^="themes:modernist-"]) .msg.assistant { padding-inline: 0; }');
    expect(chatStyles.cssText).toContain(':host-context(:root[data-pi-web-theme^="themes:modernist-"]) .msg.assistant > .msg-header { margin: 0 0 0.5rem; padding: 0.4375rem 0 0.375rem; }');
    expect(chatStyles.cssText).toContain('.msg.event-group > summary { position: sticky; top: -26px;');
    expect(chatStyles.cssText).not.toContain('.msg.assistant { padding-inline: 0; }\n  .msg.user');
  });

  it("limits flat and ink error overrides to Modernist", () => {
    const modernistSelector = shellThemeCss.split(':root[data-pi-web-theme^="themes:modernist-"] {')[1]?.split("\n      }")[0];
    expect(modernistSelector).toBeDefined();
    expect(modernistSelector).toContain("--pi-pill-radius: 0px;");
    expect(modernistSelector).toContain("--pi-chat-card-radius: 0px;");
    expect(modernistSelector).toContain("--pi-inline-code-radius: 0px;");
    expect(modernistSelector).toContain("--pi-meter-marker-border-width: 2px;");
    expect(modernistSelector).toContain("--pi-tool-running-indicator-glyph-font-size: 0px;");
    expect(modernistSelector).toContain("--pi-tool-running-indicator-display: inline-grid;");
    expect(modernistSelector).toContain("--pi-tool-running-indicator-spinner-size: 0.75rem;");
    expect(modernistSelector).toContain("--pi-tool-running-indicator-spinner-border-width: 2px;");
    expect(modernistSelector).toContain("--pi-tool-running-indicator-spinner-border-right-color: transparent;");
    expect(modernistSelector).toContain("--pi-tool-running-indicator-animation: tool-spin 0.8s linear infinite;");
    expect(modernistSelector).toContain("--pi-selected-nav-color: var(--pi-accent-border);");
    expect(modernistSelector).toContain("--pi-selected-nav-font-weight: 600;");
    expect(modernistSelector).toContain("--pi-tool-error-card-border: var(--pi-text);");
    expect(modernistSelector).toContain("--pi-tool-error-card-background: transparent;");
    expect(modernistSelector).toContain("--pi-tool-error-card-border-width: 2px;");
    expect(modernistSelector).toContain("--pi-tool-error-header-rule-width: 2px;");
    expect(modernistSelector).toContain("--pi-tool-error-icon-color: var(--pi-text);");
    expect(modernistSelector).toContain("--pi-tool-error-icon-stroke-width: 2px;");
    expect(modernistSelector).toContain("--pi-tool-error-text-color: var(--pi-text);");
  });
});

describe("resolveThemePreference", () => {
  it("resolves the no-preference default to the Modernist dark member when the system is dark", () => {
    expect(resolveThemePreference({ themes, themePairs, preference: DEFAULT_THEME_PREFERENCE, prefersLight: false }).activeTheme?.id)
      .toBe(MODERNIST_DARK_THEME_ID);
  });

  it("resolves the no-preference default to the Modernist light member when the system is light", () => {
    expect(resolveThemePreference({ themes, themePairs, preference: DEFAULT_THEME_PREFERENCE, prefersLight: true }).activeTheme?.id)
      .toBe(MODERNIST_LIGHT_THEME_ID);
  });

  it("keeps an unpaired theme selected when auto is enabled", () => {
    const resolution = resolveThemePreference({
      themes,
      themePairs,
      preference: { themeId: CLASSIC_THEME_ID, auto: true },
      prefersLight: true,
    });

    expect(resolution.selectedTheme?.id).toBe("themes:classic");
    expect(resolution.activeTheme?.id).toBe("themes:classic");
    expect(resolution.selectedThemePair).toBeUndefined();
  });

  it("falls back to Classic when the selected theme does not exist", () => {
    const resolution = resolveThemePreference({
      themes,
      themePairs,
      preference: { themeId: "plugin:missing", auto: false },
      prefersLight: true,
    });

    expect(resolution.selectedTheme?.id).toBe("themes:classic");
    expect(resolution.activeTheme?.id).toBe("themes:classic");
  });

  it("falls back to Classic without mutating a missing selected theme preference", () => {
    const preference = {
      themeId: "plugin:missing",
      auto: true,
    } satisfies { themeId: QualifiedContributionId; auto: boolean };
    const resolution = resolveThemePreference({
      themes,
      themePairs,
      preference,
      prefersLight: false,
    });

    expect(resolution.selectedTheme?.id).toBe("themes:classic");
    expect(resolution.activeTheme?.id).toBe("themes:classic");
    expect(preference).toEqual({ themeId: "plugin:missing", auto: true });
  });

  it("can look up a pair from either member theme", () => {
    expect(findThemePairForTheme(themePairs, MODERNIST_LIGHT_THEME_ID)?.id).toBe("themes:modernist");
    expect(findThemePairForTheme(themePairs, MODERNIST_DARK_THEME_ID)?.id).toBe("themes:modernist");
  });

  it("keeps a saved user choice rather than replacing it with the Modernist default", () => {
    const storage = { getItem: vi.fn(() => JSON.stringify({ themeId: "themes:classic", auto: false })), setItem: vi.fn() };
    vi.stubGlobal("window", { localStorage: storage });

    expect(readStoredThemePreference()).toEqual({ themeId: CLASSIC_THEME_ID, auto: false });
    writeStoredThemePreference({ themeId: MODERNIST_DARK_THEME_ID, auto: false });
    expect(storage.setItem).toHaveBeenCalledWith("pi-web-app-theme", JSON.stringify({ themeId: MODERNIST_DARK_THEME_ID, auto: false }));
  });

  it("toggles the visible Modernist appearance and turns auto into an explicit preference", () => {
    expect(toggleThemePreference({
      themes,
      themePairs,
      preference: { themeId: MODERNIST_LIGHT_THEME_ID, auto: true },
      prefersLight: true,
    })).toEqual({ themeId: MODERNIST_DARK_THEME_ID, auto: false });
  });

  it("toggles from the system-selected dark appearance when auto follows a dark system", () => {
    expect(toggleThemePreference({
      themes,
      themePairs,
      preference: { themeId: MODERNIST_LIGHT_THEME_ID, auto: true },
      prefersLight: false,
    })).toEqual({ themeId: MODERNIST_LIGHT_THEME_ID, auto: false });
  });
});

function unavailableTemplate(): never {
  throw new Error("Theme registration does not render templates");
}

function theme(localId: string, name: string, colorScheme: ThemeColorScheme): QualifiedThemeContribution {
  return {
    id: `themes:${localId}`,
    pluginId: "themes",
    localId,
    name,
    colorScheme,
    tokens,
  };
}
