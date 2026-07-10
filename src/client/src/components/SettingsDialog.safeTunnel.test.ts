import { describe, expect, it } from "vitest";
import { SettingsDialog } from "./SettingsDialog";
import { collectTemplateStrings } from "./SettingsDialog.testSupport";

describe("settings-dialog Safe Tunnel section", () => {
  it("renders the Safe Tunnel settings panel", () => {
    const dialog = new SettingsDialog();
    dialog.section = "safe-tunnel";

    const strings = collectTemplateStrings(dialog.render()).join("");

    expect(strings).toContain("<settings-safe-tunnel-panel");
  });
});
