import { describe, expect, it } from "vitest";
import { initialMobileKeyboardFocusState, keyboardDismissedWhileComposerFocused, updateMobileKeyboardFocus, type MobileKeyboardFocusInput, type MobileKeyboardFocusState, type VisualViewportSnapshot } from "./mobileKeyboardFocus";

const activeState: MobileKeyboardFocusState = { baselineWidth: 390, baselineHeight: 800, active: true };
const inactiveState: MobileKeyboardFocusState = { baselineWidth: 390, baselineHeight: 800, active: false };

const stableViewport: VisualViewportSnapshot = { hasVisualViewport: true, width: 390, height: 800, offsetTop: 0, scale: 1 };

function update(state: MobileKeyboardFocusState, overrides: Partial<MobileKeyboardFocusInput> = {}): MobileKeyboardFocusState {
  return updateMobileKeyboardFocus(state, {
    isMobile: true,
    isChatDestination: true,
    composerFocused: false,
    viewport: stableViewport,
    ...overrides,
  });
}

describe("keyboardDismissedWhileComposerFocused", () => {
  it("fires only when a recognized keyboard closes while the composer still holds focus", () => {
    expect(keyboardDismissedWhileComposerFocused(activeState, inactiveState, true)).toBe(true);
    expect(keyboardDismissedWhileComposerFocused(activeState, inactiveState, false)).toBe(false);
    expect(keyboardDismissedWhileComposerFocused(inactiveState, inactiveState, true)).toBe(false);
    expect(keyboardDismissedWhileComposerFocused(activeState, activeState, true)).toBe(false);
  });
});

describe("mobile keyboard focus classifier", () => {
  it("requires focused mobile Chat plus a real, unzoomed viewport height reduction at both boundaries", () => {
    let state = update(initialMobileKeyboardFocusState);
    state = update(state, { composerFocused: true, viewport: { ...stableViewport, height: 640 } });
    expect(state.active).toBe(true); // 160px is 20% of 800.

    state = update(state, { composerFocused: true, viewport: { ...stableViewport, height: 641 } });
    expect(state.active).toBe(false);
    state = update(state, { composerFocused: true, viewport: { ...stableViewport, height: 650 } });
    expect(state.active).toBe(false); // 150px alone is below the 20% threshold.
  });

  it("does not mistake focus alone, viewport change alone, browser toolbar movement, or a hardware keyboard for an IME", () => {
    const state = update(initialMobileKeyboardFocusState);
    expect(update(state, { composerFocused: true }).active).toBe(false);
    expect(update(state, { viewport: { ...stableViewport, height: 500 } }).active).toBe(false);
    expect(update(state, { composerFocused: true, viewport: { ...stableViewport, height: 710 } }).active).toBe(false);
    expect(update(state, { composerFocused: true, viewport: undefined }).active).toBe(false);
  });

  it("ignores iOS offsetTop and pinch zoom, then resets immediately for blur, restoration, destination, and disconnect", () => {
    let state = update(initialMobileKeyboardFocusState);
    state = update(state, { composerFocused: true, viewport: { ...stableViewport, height: 640, offsetTop: 84 } });
    expect(state.active).toBe(true);
    expect(update(state, { composerFocused: true, viewport: { ...stableViewport, height: 640, offsetTop: 0, scale: 1.1 } }).active).toBe(false);
    expect(update(state, { composerFocused: false, viewport: { ...stableViewport, height: 640 } }).active).toBe(false);
    expect(update(state, { composerFocused: true, viewport: stableViewport }).active).toBe(false);
    expect(update(state, { composerFocused: true, isChatDestination: false, viewport: { ...stableViewport, height: 640 } }).active).toBe(false);
    expect(update(state, { composerFocused: true, viewport: undefined }).active).toBe(false);
  });

  it("invalidates the baseline on material width changes and learns a new maximum only while unfocused and unzoomed", () => {
    let state = update(initialMobileKeyboardFocusState);
    state = update(state, { viewport: { ...stableViewport, height: 760 } });
    state = update(state, { viewport: { ...stableViewport, height: 800 } });
    expect(state.baselineHeight).toBe(800);

    state = update(state, { composerFocused: true, viewport: { ...stableViewport, width: 500, height: 640 } });
    expect(state.active).toBe(false);
    expect(state.baselineHeight).toBeUndefined();
    state = update(state, { viewport: { ...stableViewport, width: 500, height: 700 } });
    expect(state.baselineHeight).toBe(700);
    expect(update(state, { viewport: { ...stableViewport, width: 500, height: 900, scale: 1.1 } }).baselineHeight).toBe(700);
  });
});
