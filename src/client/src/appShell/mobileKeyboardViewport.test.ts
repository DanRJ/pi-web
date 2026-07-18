import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { appStyles, promptEditorStyles } from "../components/shared";

describe("mobile keyboard viewport contract", () => {
  it("asks supporting browsers to resize content for interactive widgets", () => {
    const indexHtml = readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8");

    expect(indexHtml).toContain('name="viewport"');
    expect(indexHtml).toContain("width=device-width");
    expect(indexHtml).toContain("initial-scale=1.0");
    expect(indexHtml).toContain("viewport-fit=cover");
    expect(indexHtml).toContain("interactive-widget=resizes-content");
  });

  it("sizes the mobile fixed shell from the visible viewport with a dynamic viewport fallback", () => {
    expect(appStyles.cssText).toContain("var(--pi-visible-viewport-bottom, var(--pi-visible-viewport-height, 100dvh))");
    expect(appStyles.cssText).toContain(".shell { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; height: 100%; }");
    // Safe-area padding is intentionally independent from the keyboard bridge.
    expect(appStyles.cssText).toContain("--pi-app-safe-area-bottom");
    expect(appStyles.cssText).toContain("env(safe-area-inset-bottom)");
  });

  it("keeps a scrolling, bounded editor and non-shrinking 44px action controls on mobile", () => {
    expect(promptEditorStyles.cssText).toContain("max-height: var(--pi-mobile-editor-max-height, 13.75rem)");
    expect(promptEditorStyles.cssText).toContain(".markdown-editor .cm-scroller { max-height: var(--pi-mobile-editor-max-height, 13.75rem); }");
    expect(promptEditorStyles.cssText).toContain(".actions { flex: 0 0 auto; flex-shrink: 0; min-height: 2.75rem; }");
    expect(promptEditorStyles.cssText).toContain(".icon-button, .editor-attach { width: 2.75rem; height: 2.75rem; min-width: 2.75rem; min-height: 2.75rem; }");
  });
});
