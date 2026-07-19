import { describe, expect, it, vi } from "vitest";
import { templateClickHandlerForText, templateText } from "../../templateInspection.testSupport";
import { ModernistGlobalHeader } from "./ModernistGlobalHeader";

describe("ModernistGlobalHeader", () => {
  it("exposes the complete global destination set with one truthful active destination", () => {
    const header = new ModernistGlobalHeader();
    header.activeDestination = "tools";

    const markup = templateText(header.render());

    expect(markup).toContain('nav aria-label="Global destinations"');
    for (const label of ["Dashboard", "Chat", "Tools", "Settings", "Actions"]) expect(markup).toContain(label);
    expect(markup).toContain('data-destination=tools');
    expect(markup).toContain('aria-current=page');
    expect(markup).not.toContain('aria-haspopup=dialog');
  });

  it("forwards each semantic destination through its sole callback", () => {
    const header = new ModernistGlobalHeader();
    const onSelect = vi.fn();
    header.onSelect = onSelect;
    const template = header.render();

    // This narrow extraction tests Lit click wiring; the component has no DOM-independent action seam.
    for (const label of ["Dashboard", "Chat", "Tools", "Settings", "Actions"]) {
      templateClickHandlerForText(template, label)(new Event("click"));
    }

    expect(onSelect).toHaveBeenNthCalledWith(1, "dashboard");
    expect(onSelect).toHaveBeenNthCalledWith(2, "chat");
    expect(onSelect).toHaveBeenNthCalledWith(3, "tools");
    expect(onSelect).toHaveBeenNthCalledWith(4, "settings");
    expect(onSelect).toHaveBeenNthCalledWith(5, "actions");
  });
});
