import { describe, expect, it, vi } from "vitest";
import { dialogFocusableElements, nextDialogFocus, SettingsDialog } from "./SettingsDialog";

describe("SettingsDialog focus handoff", () => {
  it("focuses its close control when the shell opens the dialog", () => {
    const dialog = new SettingsDialog();
    const focusCloseControl = vi.fn();
    Object.defineProperty(dialog, "renderRoot", { configurable: true, value: { querySelector: () => ({ focus: focusCloseControl }) } });

    dialog.focusInitialControl();

    expect(focusCloseControl).toHaveBeenCalledOnce();
  });

  it("does not enter modal focus flow when presented as a destination", () => {
    const dialog = new SettingsDialog();
    const focusCloseControl = vi.fn();
    dialog.presentation = "destination";
    Object.defineProperty(dialog, "renderRoot", { configurable: true, value: { querySelector: () => ({ focus: focusCloseControl }) } });

    dialog.focusInitialControl();

    expect(focusCloseControl).not.toHaveBeenCalled();
    expect(SettingsDialog.elementProperties.get("presentation")).toMatchObject({ reflect: true });
  });

  it("cycles Tab and Shift+Tab within the modal controls", () => {
    const close = new SettingsDialog();
    const section = new SettingsDialog();
    const save = new SettingsDialog();

    expect(nextDialogFocus([close, section, save], save, false)).toBe(close);
    expect(nextDialogFocus([close, section, save], close, true)).toBe(save);
    expect(nextDialogFocus([close, section, save], section, false)).toBe(save);
  });

  it("includes controls inside non-focusable nested settings-panel shadow hosts in focus order", () => {
    const close = focusableNode("close");
    const settingsGeneralPanel = node("settings-general-panel");
    const reload = focusableNode("reload");
    const settingsPanelFrame = node("settings-panel-frame");
    const save = focusableNode("save");
    const trailing = focusableNode("trailing");
    settingsPanelFrame.shadowRoot = tree(save);
    settingsGeneralPanel.shadowRoot = tree(reload, settingsPanelFrame);

    const focusable = dialogFocusableElements(tree(close, settingsGeneralPanel, trailing));

    expect(focusable).toEqual([close, reload, save, trailing]);
    expect(nextDialogFocus(focusable, focusable[2], false)).toBe(trailing);
    expect(nextDialogFocus(focusable, focusable[3], false)).toBe(close);
    expect(nextDialogFocus(focusable, focusable[0], true)).toBe(trailing);
    expect(nextDialogFocus(focusable, focusable[1], true)).toBe(close);
  });
});

interface FocusNode {
  name: string;
  children: FocusNode[];
  shadowRoot: FocusTree | null;
  matches(selector: string): boolean;
  focus(): void;
}

interface FocusTree {
  children: FocusNode[];
}

function node(name: string): FocusNode {
  return {
    name,
    children: [],
    shadowRoot: null,
    matches: () => false,
    focus: () => undefined,
  };
}

function focusableNode(name: string): FocusNode {
  return {
    ...node(name),
    matches: (selector) => selector.includes("button"),
  };
}

function tree(...children: FocusNode[]): FocusTree {
  return { children };
}
