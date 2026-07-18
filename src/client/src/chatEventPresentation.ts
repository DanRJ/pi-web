import type { ChatLine, ChatPart, ToolExecutionPart } from "./components/shared";

export type ChatEventStatus = "pending" | "running" | "success" | "error" | "neutral";

export interface ChatEventChild {
  sessionId: string;
  cwd: string;
  status: "working" | "idle" | "error" | "unknown";
}

export interface ChatEventRow {
  label: string;
  text?: string;
  status: ChatEventStatus;
  icon: string;
  children?: ChatEventChild[];
}

export interface ChatEventPresentation {
  count: number;
  status: ChatEventStatus;
  icon: string;
  text: string;
  rows: ChatEventRow[];
}

/**
 * A deliberately conservative view model for collapsed technical transcript
 * groups. It projects structural status and explicitly recognized tracked
 * children only; UI callers must not derive durations or completion here.
 */
export function presentChatEvents(messages: readonly ChatLine[]): ChatEventPresentation {
  const rows = messages.flatMap((message) => message.parts.flatMap(presentPart));
  const status = groupStatus(rows);
  return {
    count: rows.length,
    status,
    icon: eventStatusIcon(status),
    text: eventText(rows.length, status),
    rows,
  };
}

export function eventStatusIcon(status: ChatEventStatus): string {
  if (status === "success") return "✓";
  if (status === "error") return "×";
  if (status === "running") return "◌";
  if (status === "pending") return "○";
  return "·";
}

function presentPart(part: ChatPart): ChatEventRow[] {
  if (part.type === "thinking") return [{ label: "Thinking", text: part.text, status: "neutral", icon: eventStatusIcon("neutral") }];
  if (part.type === "toolCall") return [toolRow(part.toolName, part.summary, "pending", part.args)];
  if (part.type === "toolExecution") return [toolExecutionRow(part)];
  if (part.type === "toolResult") return [toolRow(part.toolName, part.text, part.isError ? "error" : "success", part.details)];
  if (part.type === "skillRead") return [{ label: "Skill read", text: part.name, status: "success", icon: eventStatusIcon("success") }];
  if (part.type === "skillInvocation") return [{ label: "Skill", text: part.name, status: "neutral", icon: eventStatusIcon("neutral") }];
  return [];
}

function toolExecutionRow(part: ToolExecutionPart): ChatEventRow {
  return toolRow(part.toolName, part.summary, part.status, part.details);
}

function toolRow(toolName: string, text: string, status: ChatEventStatus, details: unknown): ChatEventRow {
  const children = trackedSubsessionChildren(toolName, details);
  return {
    label: toolName === "" ? "Tool" : toolName,
    ...(text === "" ? {} : { text }),
    status,
    icon: eventStatusIcon(status),
    ...(children === undefined ? {} : { children }),
  };
}

function groupStatus(rows: readonly ChatEventRow[]): ChatEventStatus {
  if (rows.some((row) => row.status === "error")) return "error";
  if (rows.some((row) => row.status === "running")) return "running";
  if (rows.some((row) => row.status === "pending")) return "pending";
  if (rows.length > 0 && rows.every((row) => row.status === "success")) return "success";
  return "neutral";
}

function eventText(count: number, status: ChatEventStatus): string {
  const noun = count === 1 ? "event" : "events";
  if (status === "running") return `${String(count)} ${noun} running`;
  if (status === "pending") return `${String(count)} ${noun} pending`;
  if (status === "error") return `${String(count)} ${noun} with an error`;
  if (status === "success") return `${String(count)} ${noun} complete`;
  return `${String(count)} ${noun}`;
}

const trackedSubsessionTools = new Set(["spawn_subsession", "list_subsessions", "check_subsession", "read_subsession", "yield_to_subsessions"]);

function trackedSubsessionChildren(toolName: string, details: unknown): ChatEventChild[] | undefined {
  if (!trackedSubsessionTools.has(toolName) || !isRecord(details)) return undefined;
  if (Array.isArray(details["subsessions"])) {
    const children = details["subsessions"].map(parseTrackedChild);
    return children.every((child): child is ChatEventChild => child !== undefined) ? children : undefined;
  }
  const child = parseTrackedChild(details);
  return child === undefined ? undefined : [child];
}

function parseTrackedChild(value: unknown): ChatEventChild | undefined {
  if (!isRecord(value)) return undefined;
  const sessionId = value["sessionId"];
  const cwd = value["cwd"];
  const status = value["status"];
  if (typeof sessionId !== "string" || sessionId === "" || typeof cwd !== "string" || cwd === "") return undefined;
  if (status !== "working" && status !== "idle" && status !== "error" && status !== "unknown") return undefined;
  return { sessionId, cwd, status };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
