import { describe, expect, it, vi } from "vitest";
import type { AppShellControllerHost, MobileNavigationMedia, MobileNavigationMediaEvent } from "./appShellController";
import { AppShellController } from "./appShellController";

describe("AppShellController mobile layout lifecycle", () => {
  it("connects and disconnects the visual viewport bridge with the app shell", () => {
    const bridge = { connect: vi.fn(), disconnect: vi.fn(), setSnapshotListener: vi.fn() };
    const host: AppShellControllerHost = { addController: () => undefined, requestUpdate: () => undefined };
    const controller = new AppShellController(host, { pwaDisplayModeMedia: [], visualViewportBridge: bridge });

    controller.hostConnected();
    controller.hostDisconnected();

    expect(bridge.connect).toHaveBeenCalledOnce();
    expect(bridge.disconnect).toHaveBeenCalledOnce();
    expect(bridge.setSnapshotListener).toHaveBeenCalledWith(undefined);
  });

  it("notifies the app when the media query crosses the mobile breakpoint", () => {
    let listener: ((event: MobileNavigationMediaEvent) => void) | undefined;
    const media: MobileNavigationMedia = {
      matches: false,
      addEventListener: (_type, callback) => { listener = callback; },
      removeEventListener: () => undefined,
    };
    const onMobileNavigationLayoutChange = vi.fn();
    const requestUpdate = vi.fn();
    const host: AppShellControllerHost = { addController: () => undefined, requestUpdate };
    const controller = new AppShellController(host, { mobileNavigationMedia: media, pwaDisplayModeMedia: [], onMobileNavigationLayoutChange });

    controller.hostConnected();
    listener?.({ matches: true });
    listener?.({ matches: false });

    expect(controller.isMobileNavigationLayout).toBe(false);
    expect(onMobileNavigationLayoutChange).toHaveBeenNthCalledWith(1, true);
    expect(onMobileNavigationLayoutChange).toHaveBeenNthCalledWith(2, false);
    expect(requestUpdate).toHaveBeenCalledTimes(2);
  });
});
