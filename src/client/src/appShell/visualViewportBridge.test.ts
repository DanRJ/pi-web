import { describe, expect, it } from "vitest";
import { MOBILE_EDITOR_MAX_HEIGHT_PROPERTY, VISIBLE_VIEWPORT_BOTTOM_PROPERTY, VISIBLE_VIEWPORT_HEIGHT_PROPERTY, VisualViewportBridge, type CssPropertyTarget, type VisualViewportBridgeEnvironment, type VisualViewportLike, type VisualViewportWindow } from "./visualViewportBridge";

class FakeEventTarget {
  readonly listeners = new Map<"resize" | "scroll", Set<() => void>>();

  addEventListener(type: "resize" | "scroll", listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: "resize" | "scroll", listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: "resize" | "scroll"): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  listenerCount(type: "resize" | "scroll"): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakeVisualViewport extends FakeEventTarget implements VisualViewportLike {
  width = 390;
  height = 500;
  offsetTop = 0;
  scale = 1;
}

class FakeWindow extends FakeEventTarget implements VisualViewportWindow {
  innerWidth = 390;
  innerHeight = 800;
  visualViewport: VisualViewportLike | undefined;
}

class FakeStyle {
  readonly values = new Map<string, string>();
  readonly priorities = new Map<string, string>();

  getPropertyValue(name: string): string {
    return this.values.get(name) ?? "";
  }

  getPropertyPriority(name: string): string {
    return this.priorities.get(name) ?? "";
  }

  setProperty(name: string, value: string, priority = ""): void {
    this.values.set(name, value);
    this.priorities.set(name, priority);
  }

  removeProperty(name: string): string {
    const value = this.getPropertyValue(name);
    this.values.delete(name);
    this.priorities.delete(name);
    return value;
  }
}

class FakeEnvironment implements VisualViewportBridgeEnvironment {
  readonly styleTarget = new FakeStyle();
  readonly root: CssPropertyTarget = { style: this.styleTarget };
  readonly frames = new Map<number, () => void>();
  readonly canceledFrames: number[] = [];
  readonly window: FakeWindow;
  readonly documentElement: CssPropertyTarget | undefined;
  private nextFrame = 1;

  constructor(options: { visualViewport?: FakeVisualViewport | undefined; documentElement?: boolean | undefined } = {}) {
    this.window = new FakeWindow();
    this.window.visualViewport = options.visualViewport;
    this.documentElement = options.documentElement === false ? undefined : this.root;
  }

  requestAnimationFrame(callback: () => void): number {
    const id = this.nextFrame;
    this.nextFrame += 1;
    this.frames.set(id, callback);
    return id;
  }

  cancelAnimationFrame(id: number): void {
    this.canceledFrames.push(id);
    this.frames.delete(id);
  }

  runFrame(): void {
    const [id, callback] = this.frames.entries().next().value ?? [];
    if (id === undefined || callback === undefined) throw new Error("Expected an animation frame");
    this.frames.delete(id);
    callback();
  }

  style(): FakeStyle {
    return this.styleTarget;
  }
}

describe("VisualViewportBridge", () => {
  it("publishes visual viewport dimensions and includes iOS viewport panning in the bottom edge", () => {
    const viewport = new FakeVisualViewport();
    viewport.height = 500;
    viewport.offsetTop = 84;
    const environment = new FakeEnvironment({ visualViewport: viewport });
    const bridge = new VisualViewportBridge(environment);

    bridge.connect();
    environment.runFrame();

    expect(environment.style().getPropertyValue(VISIBLE_VIEWPORT_HEIGHT_PROPERTY)).toBe("500px");
    expect(environment.style().getPropertyValue(VISIBLE_VIEWPORT_BOTTOM_PROPERTY)).toBe("584px");
    expect(environment.style().getPropertyValue(MOBILE_EDITOR_MAX_HEIGHT_PROPERTY)).toBe("175px");
  });

  it("publishes typed real-viewport snapshots without changing iOS CSS bottom coordinates", () => {
    const viewport = new FakeVisualViewport();
    viewport.offsetTop = 84;
    const environment = new FakeEnvironment({ visualViewport: viewport });
    const bridge = new VisualViewportBridge(environment);
    const snapshots: unknown[] = [];
    bridge.setSnapshotListener((snapshot) => { snapshots.push(snapshot); });

    bridge.connect();
    environment.runFrame();

    expect(snapshots).toEqual([{ hasVisualViewport: true, width: 390, height: 500, offsetTop: 84, scale: 1 }]);
    expect(environment.style().getPropertyValue(VISIBLE_VIEWPORT_BOTTOM_PROPERTY)).toBe("584px");
    bridge.disconnect();
    expect(snapshots.at(-1)).toBeUndefined();
  });

  it("coalesces window and visual viewport resize/scroll notifications into one frame", () => {
    const viewport = new FakeVisualViewport();
    const environment = new FakeEnvironment({ visualViewport: viewport });
    const bridge = new VisualViewportBridge(environment);

    bridge.connect();
    environment.window.dispatch("resize");
    viewport.dispatch("resize");
    viewport.dispatch("scroll");

    expect(environment.frames.size).toBe(1);
    environment.runFrame();
    expect(environment.frames.size).toBe(0);
  });

  it("uses innerHeight when the VisualViewport API is unavailable", () => {
    const environment = new FakeEnvironment();
    environment.window.innerHeight = 640;
    const bridge = new VisualViewportBridge(environment);

    bridge.connect();
    environment.runFrame();

    expect(environment.style().getPropertyValue(VISIBLE_VIEWPORT_HEIGHT_PROPERTY)).toBe("640px");
    expect(environment.style().getPropertyValue(VISIBLE_VIEWPORT_BOTTOM_PROPERTY)).toBe("640px");
    expect(environment.style().getPropertyValue(MOBILE_EDITOR_MAX_HEIGHT_PROPERTY)).toBe("220px");
  });

  it("removes listeners, cancels pending work, and restores existing properties on disconnect", () => {
    const viewport = new FakeVisualViewport();
    const environment = new FakeEnvironment({ visualViewport: viewport });
    environment.style().setProperty(VISIBLE_VIEWPORT_HEIGHT_PROPERTY, "before", "important");
    const bridge = new VisualViewportBridge(environment);

    bridge.connect();
    environment.runFrame();
    viewport.dispatch("scroll");
    bridge.disconnect();

    expect(environment.canceledFrames).toHaveLength(1);
    expect(environment.window.listenerCount("resize")).toBe(0);
    expect(viewport.listenerCount("resize")).toBe(0);
    expect(viewport.listenerCount("scroll")).toBe(0);
    expect(environment.style().getPropertyValue(VISIBLE_VIEWPORT_HEIGHT_PROPERTY)).toBe("before");
    expect(environment.style().getPropertyPriority(VISIBLE_VIEWPORT_HEIGHT_PROPERTY)).toBe("important");
    expect(environment.style().getPropertyValue(VISIBLE_VIEWPORT_BOTTOM_PROPERTY)).toBe("");
    expect(environment.style().getPropertyValue(MOBILE_EDITOR_MAX_HEIGHT_PROPERTY)).toBe("");
  });
});
