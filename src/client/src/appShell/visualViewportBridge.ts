import type { VisualViewportSnapshot } from "./mobileKeyboardFocus";

export const VISIBLE_VIEWPORT_HEIGHT_PROPERTY = "--pi-visible-viewport-height";
export const VISIBLE_VIEWPORT_BOTTOM_PROPERTY = "--pi-visible-viewport-bottom";
export const MOBILE_EDITOR_MAX_HEIGHT_PROPERTY = "--pi-mobile-editor-max-height";

const MOBILE_EDITOR_MAX_HEIGHT_RATIO = 0.35;
const MOBILE_EDITOR_MIN_HEIGHT_PX = 96;
const MOBILE_EDITOR_MAX_HEIGHT_PX = 220;

export interface VisualViewportEventTarget {
  addEventListener(type: "resize" | "scroll", listener: () => void): void;
  removeEventListener(type: "resize" | "scroll", listener: () => void): void;
}

export interface VisualViewportLike extends VisualViewportEventTarget {
  readonly width: number;
  readonly height: number;
  readonly offsetTop: number;
  readonly scale: number;
}

export interface VisualViewportWindow extends VisualViewportEventTarget {
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly visualViewport?: VisualViewportLike | null | undefined;
}

export interface CssPropertyTarget {
  style: {
    getPropertyValue(name: string): string;
    getPropertyPriority(name: string): string;
    setProperty(name: string, value: string, priority?: string): void;
    removeProperty(name: string): string;
  };
}

export interface VisualViewportBridgeEnvironment {
  readonly window: VisualViewportWindow | undefined;
  readonly documentElement: CssPropertyTarget | undefined;
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(id: number): void;
}

export interface ViewportBridge {
  connect(): void;
  disconnect(): void;
  setSnapshotListener(listener: ((snapshot: VisualViewportSnapshot | undefined) => void) | undefined): void;
}

interface SavedProperty {
  value: string;
  priority: string;
}

/**
 * Mirrors the browser's currently visible viewport into inherited CSS variables.
 *
 * The layout viewport can remain full-height behind an Android keyboard. The
 * visual viewport is the browser's authoritative visible rectangle. Its
 * offsetTop is part of its bottom edge on iOS while the browser pans focused
 * inputs, so consumers sizing a root fixed shell use the bottom value rather
 * than treating height alone as a layout coordinate.
 */
export class VisualViewportBridge implements ViewportBridge {
  private frame: number | undefined;
  private connected = false;
  private savedProperties = new Map<string, SavedProperty>();
  private appliedProperties = new Map<string, string>();
  private snapshotListener: ((snapshot: VisualViewportSnapshot | undefined) => void) | undefined;

  constructor(private readonly environment: VisualViewportBridgeEnvironment = createBrowserVisualViewportBridgeEnvironment()) {}

  setSnapshotListener(listener: ((snapshot: VisualViewportSnapshot | undefined) => void) | undefined): void {
    this.snapshotListener = listener;
  }

  connect(): void {
    if (this.connected) return;
    this.connected = true;
    this.environment.window?.addEventListener("resize", this.scheduleUpdate);
    const viewport = this.environment.window?.visualViewport;
    viewport?.addEventListener("resize", this.scheduleUpdate);
    viewport?.addEventListener("scroll", this.scheduleUpdate);
    this.scheduleUpdate();
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.environment.window?.removeEventListener("resize", this.scheduleUpdate);
    const viewport = this.environment.window?.visualViewport;
    viewport?.removeEventListener("resize", this.scheduleUpdate);
    viewport?.removeEventListener("scroll", this.scheduleUpdate);
    if (this.frame !== undefined) this.environment.cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.restoreProperties();
    this.snapshotListener?.(undefined);
  }

  private readonly scheduleUpdate = (): void => {
    if (!this.connected || this.frame !== undefined) return;
    this.frame = this.environment.requestAnimationFrame(() => {
      this.frame = undefined;
      this.publishViewport();
    });
  };

  private publishViewport(): void {
    if (!this.connected) return;
    const documentElement = this.environment.documentElement;
    const viewport = this.environment.window?.visualViewport;
    const fallbackHeight = positiveDimension(this.environment.window?.innerHeight) ?? 0;
    const fallbackWidth = positiveDimension(this.environment.window?.innerWidth) ?? 0;
    const viewportHeight = positiveDimension(viewport?.height);
    const viewportWidth = positiveDimension(viewport?.width);
    const visibleHeight = viewportHeight ?? fallbackHeight;
    const offsetTop = nonNegativeDimension(viewport?.offsetTop) ?? 0;
    const visibleBottom = visibleHeight + offsetTop;
    const editorMaxHeight = clamp(Math.round(visibleHeight * MOBILE_EDITOR_MAX_HEIGHT_RATIO), MOBILE_EDITOR_MIN_HEIGHT_PX, MOBILE_EDITOR_MAX_HEIGHT_PX);

    this.snapshotListener?.({
      hasVisualViewport: viewportHeight !== undefined && viewportWidth !== undefined,
      width: viewportWidth ?? fallbackWidth,
      height: visibleHeight,
      offsetTop,
      scale: positiveDimension(viewport?.scale) ?? 1,
    });
    if (documentElement === undefined) return;
    this.setProperty(documentElement, VISIBLE_VIEWPORT_HEIGHT_PROPERTY, `${String(visibleHeight)}px`);
    this.setProperty(documentElement, VISIBLE_VIEWPORT_BOTTOM_PROPERTY, `${String(visibleBottom)}px`);
    this.setProperty(documentElement, MOBILE_EDITOR_MAX_HEIGHT_PROPERTY, `${String(editorMaxHeight)}px`);
  }

  private setProperty(documentElement: CssPropertyTarget, name: string, value: string): void {
    if (!this.savedProperties.has(name)) {
      this.savedProperties.set(name, {
        value: documentElement.style.getPropertyValue(name),
        priority: documentElement.style.getPropertyPriority(name),
      });
    }
    if (this.appliedProperties.get(name) === value) return;
    documentElement.style.setProperty(name, value);
    this.appliedProperties.set(name, value);
  }

  private restoreProperties(): void {
    const documentElement = this.environment.documentElement;
    if (documentElement !== undefined) {
      for (const [name, saved] of this.savedProperties) {
        if (saved.value === "") documentElement.style.removeProperty(name);
        else documentElement.style.setProperty(name, saved.value, saved.priority);
      }
    }
    this.savedProperties.clear();
    this.appliedProperties.clear();
  }
}

export function createBrowserVisualViewportBridgeEnvironment(): VisualViewportBridgeEnvironment {
  const browserWindow = typeof window === "undefined" ? undefined : window;
  return {
    window: browserWindow,
    documentElement: typeof document === "undefined" ? undefined : document.documentElement,
    requestAnimationFrame(callback: () => void): number {
      return browserWindow?.requestAnimationFrame(callback) ?? 0;
    },
    cancelAnimationFrame(id: number): void {
      if (id !== 0) browserWindow?.cancelAnimationFrame(id);
    },
  };
}

function positiveDimension(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function nonNegativeDimension(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
