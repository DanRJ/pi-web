import type { SessionActivity, SessionStatus } from "./api";

export type SessionStatusPresentationKind = "waiting" | "compacting" | "shell" | "tool" | "working" | "error" | "idle";

export interface SessionStatusPresentation {
  kind: SessionStatusPresentationKind;
  label: string;
  shortLabel: string;
  /** Only server/client-supplied activity detail; never inferred prose. */
  detail?: string;
}

export interface SessionStatusPresentationInput {
  status?: SessionStatus | undefined;
  activity?: SessionActivity | undefined;
  waitingForUser?: boolean;
  isSendingPrompt?: boolean;
}

/**
 * Presents the one current session state. The order is intentional: an input
 * request must not be hidden by stale runtime activity, and a current unit of
 * work must not be obscured by an earlier error event.
 */
export function sessionStatusPresentation({
  status,
  activity,
  waitingForUser = false,
  isSendingPrompt = false,
}: SessionStatusPresentationInput): SessionStatusPresentation {
  if (waitingForUser) return presentation("waiting", "Waiting", "Wait");
  if (status?.isCompacting === true) return presentation("compacting", "Compacting", "Compact");
  if (status?.isBashRunning === true) return presentation("shell", "Shell", "Shell", activityDetail(activity));
  if (isRunningTool(activity)) return presentation("tool", "Tool running", "Tool", activityDetail(activity));

  const hasCurrentWork = isSendingPrompt
    || status?.isStreaming === true
    || activity?.phase === "active"
    || (status?.pendingMessageCount ?? 0) > 0;
  if (hasCurrentWork) return presentation("working", "Working", "Work", activity?.phase === "active" ? activityDetail(activity) : undefined);

  if (activity?.phase === "error") return presentation("error", "Error", "Error", activityDetail(activity));
  return presentation("idle", "Idle", "Idle");
}

function presentation(kind: SessionStatusPresentationKind, label: string, shortLabel: string, detail?: string): SessionStatusPresentation {
  return detail === undefined ? { kind, label, shortLabel } : { kind, label, shortLabel, detail };
}

function isRunningTool(activity: SessionActivity | undefined): boolean {
  return activity?.phase === "active" && activity.label === "running tool";
}

function activityDetail(activity: SessionActivity | undefined): string | undefined {
  if (activity === undefined) return undefined;
  if (activity.detail !== undefined && activity.detail !== "") return activity.detail;
  return activity.label === "" ? undefined : activity.label;
}
