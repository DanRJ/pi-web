export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface Workspace {
  id: string;
  projectId: string;
  path: string;
  label: string;
  branch?: string;
  isMain: boolean;
  isGitWorktree: boolean;
}

export interface ClientSession {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
}

export interface ClientSessionStatus {
  sessionId: string;
  model?: { provider?: string; id?: string; name?: string; contextWindow?: number; reasoning?: unknown };
  thinkingLevel?: string;
  isStreaming: boolean;
  isCompacting: boolean;
  isBashRunning: boolean;
  pendingMessageCount: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}

export interface ClientCommand {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill" | "builtin";
}

export interface ClientFileSuggestion {
  path: string;
  kind: "tracked" | "untracked" | "other";
}

export interface ClientCommandOption {
  value: string;
  label: string;
  description?: string;
}

export type ClientCommandResult =
  | { type: "done"; message?: string; session?: ClientSession }
  | { type: "select"; requestId: string; title: string; options: ClientCommandOption[] }
  | { type: "unsupported"; message: string };
