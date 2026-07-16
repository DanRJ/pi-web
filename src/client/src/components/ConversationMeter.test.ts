import { describe, expect, it } from "vitest";
import { ConversationMeter } from "./ConversationMeter";

describe("ConversationMeter theme boundaries", () => {
  it("uses its semantic marker-border token rather than the global divider width", () => {
    const styles = ConversationMeter.styles.cssText;
    expect(styles).toContain("border: var(--pi-meter-marker-border-width, 2px) solid var(--pi-bg);");
    expect(styles).not.toContain("border: var(--pi-divider-width, 2px) solid var(--pi-bg);");
  });
});
