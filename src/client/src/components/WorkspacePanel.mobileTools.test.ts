import { describe, expect, it } from "vitest";
import { selectedWorkspacePanel } from "./WorkspacePanel";

describe("mobile workspace tools", () => {
  it("selects visible plugin contributions instead of assuming only core panels", () => {
    const panels = [
      { id: "core:workspace.files", title: "Files" },
      { id: "review:workspace.audit", title: "Audit" },
      { id: "terminal:workspace.logs", title: "Logs" },
    ] as const;

    expect(selectedWorkspacePanel(panels, "review:workspace.audit")?.title).toBe("Audit");
    expect(selectedWorkspacePanel(panels, "missing:workspace.tool")?.title).toBe("Files");
  });
});
