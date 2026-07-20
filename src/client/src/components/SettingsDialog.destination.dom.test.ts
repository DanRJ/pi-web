// @vitest-environment jsdom

import { LitElement } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "./SettingsDialog";

class RenderOnlySettingsDialog extends SettingsDialog {
  override connectedCallback(): void {
    // Destination-scroll tests exercise Lit's real DOM lifecycle without
    // starting the settings data requests owned by the production connection.
    LitElement.prototype.connectedCallback.call(this);
  }
}

if (!customElements.get("settings-dialog-scroll-test")) customElements.define("settings-dialog-scroll-test", RenderOnlySettingsDialog);

const nativeScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  if (nativeScrollTo === undefined) Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  else Object.defineProperty(HTMLElement.prototype, "scrollTo", nativeScrollTo);
});

describe("SettingsDialog destination scrolling", () => {
  it("scrolls the stable wrapper to General on its first destination mount without moving focus", async () => {
    const scrollTo = installScrollSpy();
    const dialog = mountDestination();

    await settle(dialog);

    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 100, behavior: "auto" });
    expect(dialog.shadowRoot?.activeElement).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("scrolls a direct non-default destination link on first mount without moving focus", async () => {
    const scrollTo = installScrollSpy();
    const dialog = mountDestination("plugins");

    await settle(dialog);

    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 200, behavior: "auto" });
    expect(dialog.shadowRoot?.activeElement).toBeNull();
  });

  it("scrolls the current section when an existing dialog becomes a destination", async () => {
    const scrollTo = installScrollSpy();
    const dialog = mountDialog();
    await settle(dialog);
    scrollTo.mockClear();

    dialog.presentation = "destination";
    await settle(dialog);

    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 100, behavior: "auto" });
  });

  it("scrolls passively without moving focus on section change and renders no in-page section rail", async () => {
    const scrollTo = installScrollSpy();
    const dialog = mountDestination();
    await settle(dialog);
    scrollTo.mockClear();

    dialog.section = "plugins";
    await settle(dialog);

    const plugins = dialog.shadowRoot?.querySelector<HTMLElement>("#settings-plugins");
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 200, behavior: "auto" });
    expect(dialog.shadowRoot?.activeElement).not.toBe(plugins);

    const root = dialog.shadowRoot;
    if (root === null) throw new Error("Expected Settings destination shadow root");
    // The Modernist destination is one grouped page: no permanent section rail,
    // and a plain "Settings" heading with the machine-scope note.
    expect(root.querySelector(".settings-nav")).toBeNull();
    expect(root.querySelector(".settings-page-header h1")?.textContent).toBe("Settings");
  });
});

function mountDestination(section?: "general" | "plugins"): RenderOnlySettingsDialog {
  const dialog = mountDialog();
  dialog.presentation = "destination";
  if (section !== undefined) dialog.section = section;
  return dialog;
}

function mountDialog(): RenderOnlySettingsDialog {
  const dialog = document.createElement("settings-dialog-scroll-test");
  if (!(dialog instanceof RenderOnlySettingsDialog)) throw new Error("Expected test Settings destination");
  document.body.append(dialog);
  return dialog;
}

function installScrollSpy() {
  const scrollTo = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement): DOMRect {
    const top = this.id === "settings-general" ? 100 : this.id === "settings-plugins" ? 200 : 0;
    return new DOMRect(0, top, 0, 0);
  });
  return scrollTo;
}

async function settle(dialog: RenderOnlySettingsDialog): Promise<void> {
  await dialog.updateComplete;
  await Promise.resolve();
  await Promise.resolve();
}
