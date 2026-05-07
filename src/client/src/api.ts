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

export interface SessionInfo {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
}

export interface SessionStatus {
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

export interface SlashCommand {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill" | "builtin";
}

export interface FileSuggestion {
  path: string;
  kind: "tracked" | "untracked" | "other";
}

export interface CommandOption {
  value: string;
  label: string;
  description?: string;
}

export type CommandResult =
  | { type: "done"; message?: string; session?: SessionInfo }
  | { type: "select"; requestId: string; title: string; options: CommandOption[] }
  | { type: "unsupported"; message: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

export const api = {
  projects: () => request<Project[]>("/api/projects"),
  addProject: (path: string, name?: string) => request<Project>("/api/projects", { method: "POST", body: JSON.stringify({ path, name }) }),
  workspaces: (projectId: string) => request<Workspace[]>(`/api/projects/${projectId}/workspaces`),
  sessions: (cwd: string) => request<SessionInfo[]>(`/api/sessions?cwd=${encodeURIComponent(cwd)}`),
  startSession: (cwd: string) => request<SessionInfo>("/api/sessions", { method: "POST", body: JSON.stringify({ cwd }) }),
  messages: (sessionId: string) => request<any[]>(`/api/sessions/${sessionId}/messages`),
  status: (sessionId: string) => request<SessionStatus>(`/api/sessions/${sessionId}/status`),
  commands: (sessionId: string) => request<SlashCommand[]>(`/api/sessions/${sessionId}/commands`),
  files: (cwd: string, query: string, kind?: FileSuggestion["kind"]) => request<FileSuggestion[]>(`/api/files?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(query)}${kind ? `&kind=${encodeURIComponent(kind)}` : ""}`),
  prompt: (sessionId: string, text: string) => request<{ accepted: true }>(`/api/sessions/${sessionId}/prompt`, { method: "POST", body: JSON.stringify({ text }) }),
  runCommand: (sessionId: string, text: string) => request<CommandResult>(`/api/sessions/${sessionId}/commands/run`, { method: "POST", body: JSON.stringify({ text }) }),
  respondToCommand: (sessionId: string, requestId: string, value: string) => request<CommandResult>(`/api/sessions/${sessionId}/commands/respond`, { method: "POST", body: JSON.stringify({ requestId, value }) }),
  stop: (sessionId: string) => request<{ stopped: true }>(`/api/sessions/${sessionId}/stop`, { method: "POST" }),
};

export function sessionEvents(sessionId: string): WebSocket {
  return new WebSocket(`${webSocketBaseUrl()}/api/sessions/${sessionId}/events`);
}

export function globalSessionEvents(): WebSocket {
  return new WebSocket(`${webSocketBaseUrl()}/api/sessions/events`);
}

function webSocketBaseUrl(): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}`;
}
