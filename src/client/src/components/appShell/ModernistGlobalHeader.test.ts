import { describe, expect, it, vi } from "vitest";
import { templateClickHandlerForText, templateEventHandlerAfterMarker, templateText } from "../../templateInspection.testSupport";
import { ModernistGlobalHeader } from "./ModernistGlobalHeader";

describe("ModernistGlobalHeader", () => {
  it("centers the global destinations and uses the PI WEB brand for Dashboard", () => {
    const header = new ModernistGlobalHeader();
    header.activeDestination = "tools";

    const markup = templateText(header.render());

    expect(markup).toContain('aria-label="Open dashboard"');
    expect(markup).toContain('href="?page=dashboard"');
    expect(markup).toContain("PI WEB");
    expect(markup).toContain('nav aria-label="Global destinations"');
    for (const label of ["Chat", "Tools", "Settings", "Actions"]) expect(markup).toContain(label);
    expect(markup).not.toContain(">Dashboard</button>");
    expect(markup).toContain('data-destination=tools');
    expect(markup).toContain('aria-current=page');
    expect(markup).not.toContain('aria-haspopup=dialog');
    expect(ModernistGlobalHeader.styles.cssText).toContain("grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)");
    expect(ModernistGlobalHeader.styles.cssText).toContain("font: 600 1rem");
  });

  it("forwards each semantic destination through its sole callback", () => {
    const header = new ModernistGlobalHeader();
    const onSelect = vi.fn();
    header.onSelect = onSelect;
    const template = header.render();

    // This narrow extraction tests Lit click wiring; the component has no DOM-independent action seam.
    for (const label of ["PI WEB", "Chat", "Tools", "Settings", "Actions"]) {
      templateClickHandlerForText(template, label)(new Event("click"));
    }

    expect(onSelect).toHaveBeenNthCalledWith(1, "dashboard");
    expect(onSelect).toHaveBeenNthCalledWith(2, "chat");
    expect(onSelect).toHaveBeenNthCalledWith(3, "tools");
    expect(onSelect).toHaveBeenNthCalledWith(4, "settings");
    expect(onSelect).toHaveBeenNthCalledWith(5, "actions");
  });

  it("shows the active-session pill only when sessions are active", () => {
    const header = new ModernistGlobalHeader();
    header.activeCount = 0;
    expect(templateText(header.render())).not.toContain("active-pill");

    header.activeCount = 3;
    const markup = templateText(header.render());
    expect(markup).toContain("active-pill");
    expect(markup).toContain("3 active");
  });

  it("renders the theme toggle only when a handler is provided", () => {
    const header = new ModernistGlobalHeader();
    expect(templateText(header.render())).not.toContain("Toggle light and dark theme");

    const onToggleTheme = vi.fn();
    header.onToggleTheme = onToggleTheme;
    const markup = templateText(header.render());
    expect(markup).toContain("theme-control");
    expect(markup).toContain("Toggle light and dark theme");
  });

  it("renders the account control only when an auth handler is provided", () => {
    const header = new ModernistGlobalHeader();
    expect(templateText(header.render())).not.toContain('aria-label="Account"');

    header.onConfigureAuth = vi.fn();
    expect(templateText(header.render())).toContain('aria-label="Account"');
  });

  it("keeps the account menu closed until the control is activated", () => {
    const header = new ModernistGlobalHeader();
    header.onConfigureAuth = vi.fn();
    expect(templateText(header.render())).not.toContain("Configure provider authentication");

    templateEventHandlerAfterMarker(header.render(), 'aria-label="Account"')(new Event("click"));
    const opened = templateText(header.render());
    expect(opened).toContain("Configure provider authentication");
    expect(opened).toContain("Remove provider authentication");
    expect(opened).toContain('role="menu"');
  });

  it("routes each account menu item to its owner and closes the menu", () => {
    const header = new ModernistGlobalHeader();
    const onConfigureAuth = vi.fn();
    const onRemoveAuth = vi.fn();
    const onSelect = vi.fn();
    header.onConfigureAuth = onConfigureAuth;
    header.onRemoveAuth = onRemoveAuth;
    header.onSelect = onSelect;

    templateEventHandlerAfterMarker(header.render(), 'aria-label="Account"')(new Event("click"));
    templateEventHandlerAfterMarker(header.render(), 'data-account-action="login"')(new Event("click"));
    expect(onConfigureAuth).toHaveBeenCalledTimes(1);
    expect(templateText(header.render())).not.toContain("Configure provider authentication");

    templateEventHandlerAfterMarker(header.render(), 'aria-label="Account"')(new Event("click"));
    templateEventHandlerAfterMarker(header.render(), 'data-account-action="logout"')(new Event("click"));
    expect(onRemoveAuth).toHaveBeenCalledTimes(1);

    templateEventHandlerAfterMarker(header.render(), 'aria-label="Account"')(new Event("click"));
    templateEventHandlerAfterMarker(header.render(), 'data-account-action="settings"')(new Event("click"));
    expect(onSelect).toHaveBeenCalledWith("settings");
  });
});
