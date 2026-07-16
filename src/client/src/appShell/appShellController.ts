import type { ReactiveController } from "lit";
import type { AppState } from "../appState";
import { createPwaDisplayModeMedia, detectPwaDisplayMode } from "../pwaDisplayMode";
import { ViewportPositionRepairer } from "./viewportPositionRepair";

export const MOBILE_NAVIGATION_MEDIA_QUERY = "(max-width: 767px)";

export interface MobileNavigationMedia {
  readonly matches: boolean;
  addEventListener(type: "change", listener: (event: MobileNavigationMediaEvent) => void): void;
  removeEventListener(type: "change", listener: (event: MobileNavigationMediaEvent) => void): void;
}

export interface MobileNavigationMediaEvent {
  readonly matches: boolean;
}

export interface AppShellControllerHost {
  addController(controller: ReactiveController): void;
  requestUpdate(): void;
}

export interface AppShellControllerOptions {
  mobileNavigationMedia?: MobileNavigationMedia | undefined;
  pwaDisplayModeMedia?: MediaQueryList[] | undefined;
  viewportPositionRepairer?: ViewportPositionRepairer | undefined;
  onMobileNavigationLayoutChange?: ((isMobile: boolean) => void) | undefined;
}

export class AppShellController implements ReactiveController {
  private readonly mobileNavigationMedia: MobileNavigationMedia | undefined;
  private readonly pwaDisplayModeMedia: MediaQueryList[];
  private readonly viewportPositionRepairer: ViewportPositionRepairer;
  private readonly onMobileNavigationLayoutChange: ((isMobile: boolean) => void) | undefined;
  isMobileNavigationLayout: boolean;
  isPwaDisplayMode: boolean;

  constructor(private readonly host: AppShellControllerHost, options: AppShellControllerOptions = {}) {
    host.addController(this);
    this.mobileNavigationMedia = options.mobileNavigationMedia ?? createMobileNavigationMedia();
    this.pwaDisplayModeMedia = options.pwaDisplayModeMedia ?? createPwaDisplayModeMedia();
    this.viewportPositionRepairer = options.viewportPositionRepairer ?? new ViewportPositionRepairer();
    this.onMobileNavigationLayoutChange = options.onMobileNavigationLayoutChange;
    this.isMobileNavigationLayout = this.mobileNavigationMedia?.matches ?? false;
    this.isPwaDisplayMode = detectPwaDisplayMode(this.pwaDisplayModeMedia);
  }

  hostConnected(): void {
    this.mobileNavigationMedia?.addEventListener("change", this.onMobileNavigationMediaChange);
    for (const media of this.pwaDisplayModeMedia) media.addEventListener("change", this.onPwaDisplayModeChange);
  }

  hostDisconnected(): void {
    this.mobileNavigationMedia?.removeEventListener("change", this.onMobileNavigationMediaChange);
    for (const media of this.pwaDisplayModeMedia) media.removeEventListener("change", this.onPwaDisplayModeChange);
    this.viewportPositionRepairer.clear();
  }

  shouldAutoFocusPrompt(): boolean {
    return !this.isMobileNavigationLayout && !this.isPwaDisplayMode;
  }

  shouldShowAppRefreshInHeader(): boolean {
    return this.isPwaDisplayMode && !this.isMobileNavigationLayout;
  }

  shouldShowAppRefreshInContextBar(): boolean {
    return this.isPwaDisplayMode && this.isMobileNavigationLayout;
  }

  defaultRouteView(): AppState["mainView"] {
    return this.isMobileNavigationLayout ? "navigation" : "chat";
  }

  repairViewportPosition(): void {
    this.viewportPositionRepairer.repair(this.shouldRepairViewportPosition());
  }

  private shouldRepairViewportPosition(): boolean {
    return this.isMobileNavigationLayout || this.isPwaDisplayMode;
  }

  private readonly onMobileNavigationMediaChange = (event: MobileNavigationMediaEvent) => {
    if (this.isMobileNavigationLayout === event.matches) return;
    this.isMobileNavigationLayout = event.matches;
    this.onMobileNavigationLayoutChange?.(event.matches);
    this.host.requestUpdate();
  };

  private readonly onPwaDisplayModeChange = () => {
    const isPwaDisplayMode = detectPwaDisplayMode(this.pwaDisplayModeMedia);
    if (this.isPwaDisplayMode === isPwaDisplayMode) return;
    this.isPwaDisplayMode = isPwaDisplayMode;
    this.host.requestUpdate();
  };
}

function createMobileNavigationMedia(): MobileNavigationMedia | undefined {
  if (typeof window === "undefined" || !("matchMedia" in window)) return undefined;
  return window.matchMedia(MOBILE_NAVIGATION_MEDIA_QUERY);
}
