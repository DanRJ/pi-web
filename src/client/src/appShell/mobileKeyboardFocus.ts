export const MOBILE_KEYBOARD_MIN_HEIGHT_REDUCTION_PX = 150;
export const MOBILE_KEYBOARD_MIN_HEIGHT_REDUCTION_RATIO = 0.2;
export const MOBILE_KEYBOARD_SCALE_MIN = 0.98;
export const MOBILE_KEYBOARD_SCALE_MAX = 1.02;
export const MOBILE_KEYBOARD_MATERIAL_WIDTH_CHANGE_RATIO = 0.15;

/** A browser-visible viewport measurement. CSS layout coordinates stay in the bridge. */
export interface VisualViewportSnapshot {
  readonly hasVisualViewport: boolean;
  readonly width: number;
  readonly height: number;
  readonly offsetTop: number;
  readonly scale: number;
}

export interface MobileKeyboardFocusInput {
  readonly isMobile: boolean;
  readonly isChatDestination: boolean;
  readonly composerFocused: boolean;
  readonly viewport: VisualViewportSnapshot | undefined;
}

export interface MobileKeyboardFocusState {
  readonly baselineWidth: number | undefined;
  readonly baselineHeight: number | undefined;
  readonly active: boolean;
}

export const initialMobileKeyboardFocusState: MobileKeyboardFocusState = {
  baselineWidth: undefined,
  baselineHeight: undefined,
  active: false,
};

/**
 * Recognizes an on-screen keyboard only from a focused mobile chat composer and
 * an unzoomed real VisualViewport that has lost a meaningful amount of height.
 * `offsetTop` is deliberately not part of this calculation: iOS scrolls it
 * while focusing inputs without changing how much vertical space an IME owns.
 */
export function updateMobileKeyboardFocus(
  previous: MobileKeyboardFocusState,
  input: MobileKeyboardFocusInput,
): MobileKeyboardFocusState {
  const viewport = input.viewport;
  if (viewport === undefined || !viewport.hasVisualViewport || !isUsableViewport(viewport)) {
    return { ...previous, active: false };
  }

  const unzoomed = isUnzoomed(viewport.scale);
  const widthChanged = previous.baselineWidth !== undefined
    && materialWidthChange(previous.baselineWidth, viewport.width);
  const baselineWidth = widthChanged ? undefined : previous.baselineWidth;
  const baselineHeight = widthChanged ? undefined : previous.baselineHeight;

  // A stable, unfocused, unzoomed viewport is the only trustworthy baseline.
  // Retain the largest height for this width so transient browser chrome cannot
  // become a keyboard-sized baseline on the next focus.
  if (!input.composerFocused && unzoomed) {
    return {
      baselineWidth: viewport.width,
      baselineHeight: baselineWidth === undefined || baselineHeight === undefined
        ? viewport.height
        : Math.max(baselineHeight, viewport.height),
      active: false,
    };
  }

  if (!input.isMobile || !input.isChatDestination || !input.composerFocused || !unzoomed || baselineHeight === undefined) {
    return { baselineWidth, baselineHeight, active: false };
  }

  const reduction = baselineHeight - viewport.height;
  const minimumReduction = Math.max(MOBILE_KEYBOARD_MIN_HEIGHT_REDUCTION_PX, baselineHeight * MOBILE_KEYBOARD_MIN_HEIGHT_REDUCTION_RATIO);
  return { baselineWidth, baselineHeight, active: reduction >= minimumReduction };
}

/**
 * True when a recognized keyboard just closed while the composer still holds
 * focus. Android hides the soft keyboard without blurring the editor, so the
 * caller releases focus to clear the lingering caret and focus ring.
 */
export function keyboardDismissedWhileComposerFocused(
  previous: MobileKeyboardFocusState,
  next: MobileKeyboardFocusState,
  composerFocused: boolean,
): boolean {
  return previous.active && !next.active && composerFocused;
}

function isUsableViewport(viewport: VisualViewportSnapshot): boolean {
  return Number.isFinite(viewport.width) && viewport.width > 0
    && Number.isFinite(viewport.height) && viewport.height > 0
    && Number.isFinite(viewport.scale) && viewport.scale > 0;
}

function isUnzoomed(scale: number): boolean {
  return scale >= MOBILE_KEYBOARD_SCALE_MIN && scale <= MOBILE_KEYBOARD_SCALE_MAX;
}

function materialWidthChange(baselineWidth: number, width: number): boolean {
  return Math.abs(width - baselineWidth) / baselineWidth >= MOBILE_KEYBOARD_MATERIAL_WIDTH_CHANGE_RATIO;
}
