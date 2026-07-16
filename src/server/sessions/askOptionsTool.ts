import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

const AskOptionsParams = Type.Object({
  title: Type.String({
    minLength: 1,
    maxLength: 240,
    description: "Concise question to show the user.",
  }),
  options: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), {
    minItems: 2,
    maxItems: 12,
    description: "Two to twelve explicit choices for the user.",
  }),
});

export type AskOptionsToolDetails =
  | { outcome: "selected"; title: string; options: string[]; selected: string }
  | { outcome: "cancelled" | "aborted"; title: string; options: string[] };

/**
 * Lets the model ask for a decision that only the user can make. The SDK's
 * session-bound UI context routes the select card through PI WEB's broker.
 */
export function createAskOptionsToolDefinition() {
  return defineTool<typeof AskOptionsParams, AskOptionsToolDetails>({
    name: "ask_options",
    label: "Ask options",
    description: "Ask the user to choose among explicit options when their preference or decision is needed. Do not use this for questions you can answer yourself.",
    promptSnippet: "ask_options: ask the user to choose between explicit options when their decision is needed",
    parameters: AskOptionsParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const selected = await ctx.ui.select(params.title, params.options, signal === undefined ? undefined : { signal });
      if (selected !== undefined) {
        const details: AskOptionsToolDetails = { outcome: "selected", title: params.title, options: params.options, selected };
        return {
          content: [{ type: "text", text: `User selected: ${selected}` }],
          details,
        };
      }

      const outcome = signal?.aborted === true ? "aborted" : "cancelled";
      const details: AskOptionsToolDetails = { outcome, title: params.title, options: params.options };
      return {
        content: [{ type: "text", text: outcome === "aborted" ? "The selection was aborted." : "The user cancelled the selection." }],
        details,
      };
    },
  });
}
