import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createAskOptionsToolDefinition } from "./askOptionsTool.js";

function contextFor(select: ExtensionUIContext["select"]): ExtensionContext {
  // The tool only uses ctx.ui.select; keep the fixture limited to that SDK boundary.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return { ui: { select } } as unknown as ExtensionContext;
}

describe("createAskOptionsToolDefinition", () => {
  it("defines an explicit-choice question contract and model-use guidance", () => {
    const tool = createAskOptionsToolDefinition();

    expect(tool.name).toBe("ask_options");
    expect(tool.description).toBe("Ask the user to choose among explicit options when their preference or decision is needed. Do not use this for questions you can answer yourself.");
    expect(tool.promptSnippet).toBe("ask_options: ask the user to choose between explicit options when their decision is needed");
    expect(tool.parameters).toMatchObject({
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 240 },
        options: {
          type: "array",
          minItems: 2,
          maxItems: 12,
          items: { type: "string", minLength: 1, maxLength: 120 },
        },
      },
      required: ["title", "options"],
    });
  });

  it("returns the selected option to the model with typed details", async () => {
    const select = vi.fn(() => Promise.resolve("Ship now"));
    const tool = createAskOptionsToolDefinition();

    const result = await tool.execute("call-1", { title: "When should this ship?", options: ["Ship now", "Wait"] }, undefined, undefined, contextFor(select));

    expect(select).toHaveBeenCalledWith("When should this ship?", ["Ship now", "Wait"], undefined);
    expect(result.content).toEqual([{ type: "text", text: "User selected: Ship now" }]);
    expect(result.details).toEqual({
      outcome: "selected",
      title: "When should this ship?",
      options: ["Ship now", "Wait"],
      selected: "Ship now",
    });
  });

  it("returns cancellation as a normal tool result", async () => {
    const select = vi.fn(() => Promise.resolve(undefined));
    const tool = createAskOptionsToolDefinition();

    const result = await tool.execute("call-2", { title: "Choose a path", options: ["A", "B"] }, undefined, undefined, contextFor(select));

    expect(result.content).toEqual([{ type: "text", text: "The user cancelled the selection." }]);
    expect(result.details).toEqual({ outcome: "cancelled", title: "Choose a path", options: ["A", "B"] });
  });

  it("forwards the tool abort signal and reports its cancellation without throwing", async () => {
    const select = vi.fn((_title: string, _options: string[], options?: { signal?: AbortSignal }) => new Promise<string | undefined>((resolve) => {
      options?.signal?.addEventListener("abort", () => { resolve(undefined); }, { once: true });
    }));
    const tool = createAskOptionsToolDefinition();
    const controller = new AbortController();

    const resultPromise = tool.execute("call-3", { title: "Choose a path", options: ["A", "B"] }, controller.signal, undefined, contextFor(select));
    expect(select).toHaveBeenCalledWith("Choose a path", ["A", "B"], { signal: controller.signal });

    controller.abort();

    await expect(resultPromise).resolves.toMatchObject({
      content: [{ type: "text", text: "The selection was aborted." }],
      details: { outcome: "aborted", title: "Choose a path", options: ["A", "B"] },
    });
  });
});
