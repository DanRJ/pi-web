import crypto from "node:crypto";
import {
  AuthStorage,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  type AgentSession,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
} from "@mariozechner/pi-coding-agent";
import type { ClientCommand, ClientCommandResult, ClientSession, ClientSessionStatus } from "../types.js";
import type { SessionEventHub } from "../realtime/sessionEventHub.js";

interface ActiveSession {
  runtime: AgentSessionRuntime;
  unsubscribe: () => void;
}

interface PendingCommandSelect {
  sessionId: string;
  command: "fork";
}

const BUILTIN_COMMANDS: ClientCommand[] = [
  { name: "settings", description: "Open settings menu", source: "builtin" },
  { name: "model", description: "Select model", source: "builtin" },
  { name: "scoped-models", description: "Enable/disable models for cycling", source: "builtin" },
  { name: "export", description: "Export session", source: "builtin" },
  { name: "import", description: "Import and resume a session from JSONL", source: "builtin" },
  { name: "share", description: "Share session as a secret GitHub gist", source: "builtin" },
  { name: "copy", description: "Copy last agent message", source: "builtin" },
  { name: "name", description: "Set session display name", source: "builtin" },
  { name: "session", description: "Show session info and stats", source: "builtin" },
  { name: "changelog", description: "Show changelog entries", source: "builtin" },
  { name: "hotkeys", description: "Show keyboard shortcuts", source: "builtin" },
  { name: "fork", description: "Create a new fork from a previous user message", source: "builtin" },
  { name: "clone", description: "Duplicate current session at current position", source: "builtin" },
  { name: "tree", description: "Navigate session tree", source: "builtin" },
  { name: "login", description: "Configure provider authentication", source: "builtin" },
  { name: "logout", description: "Remove provider authentication", source: "builtin" },
  { name: "new", description: "Start a new session", source: "builtin" },
  { name: "compact", description: "Manually compact session context", source: "builtin" },
  { name: "resume", description: "Resume a different session", source: "builtin" },
  { name: "reload", description: "Reload keybindings, extensions, skills, prompts, and themes", source: "builtin" },
  { name: "quit", description: "Quit pi", source: "builtin" },
];

export class PiSessionService {
  private readonly active = new Map<string, ActiveSession>();
  private readonly pendingSelects = new Map<string, PendingCommandSelect>();
  private readonly agentDir = getAgentDir();
  private readonly authStorage = AuthStorage.create();
  private readonly modelRegistry = ModelRegistry.create(this.authStorage);
  private readonly createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({ cwd, agentDir, authStorage: this.authStorage, modelRegistry: this.modelRegistry });
    const result = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent });
    return { ...result, services, diagnostics: services.diagnostics };
  };

  constructor(private readonly events: SessionEventHub) {}

  async list(cwd: string): Promise<ClientSession[]> {
    const sessions = await SessionManager.list(cwd);
    return sessions.map((s) => ({
      id: s.id,
      path: s.path,
      cwd: s.cwd,
      name: s.name,
      created: s.created.toISOString(),
      modified: s.modified.toISOString(),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage,
    }));
  }

  async start(cwd: string): Promise<ClientSession> {
    const active = await this.create(SessionManager.create(cwd), cwd);
    const { session } = active.runtime;
    return {
      id: session.sessionId,
      path: session.sessionFile ?? "",
      cwd,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      messageCount: session.messages.length,
      firstMessage: "",
    };
  }

  async messages(sessionId: string): Promise<unknown[]> {
    const session = await this.getOrOpen(sessionId);
    return session.messages;
  }

  async status(sessionId: string): Promise<ClientSessionStatus> {
    return this.statusFromSession(await this.getOrOpen(sessionId));
  }

  async commands(sessionId: string): Promise<ClientCommand[]> {
    const session = await this.getOrOpen(sessionId);
    const commands: ClientCommand[] = [...BUILTIN_COMMANDS];
    for (const command of session.extensionRunner.getRegisteredCommands()) {
      commands.push({ name: command.invocationName, description: command.description, source: "extension" });
    }
    for (const template of session.promptTemplates) {
      commands.push({ name: template.name, description: template.description, source: "prompt" });
    }
    for (const skill of session.resourceLoader.getSkills().skills) {
      commands.push({ name: `skill:${skill.name}`, description: skill.description, source: "skill" });
    }
    return commands.sort((a, b) => a.name.localeCompare(b.name));
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    const session = await this.getOrOpen(sessionId);
    void session.prompt(text).catch((error) => {
      this.events.publish(sessionId, { type: "session.error", message: error instanceof Error ? error.message : String(error) });
    });
  }

  async runCommand(sessionId: string, text: string): Promise<ClientCommandResult> {
    const active = await this.getActive(sessionId);
    const session = active.runtime.session;
    const [name = "", ...args] = text.trim().replace(/^\//, "").split(/\s+/);
    const rest = args.join(" ").trim();

    if (!BUILTIN_COMMANDS.some((command) => command.name === name)) {
      if (this.isRuntimeCommand(session, name)) {
        await this.prompt(sessionId, text);
        return { type: "done", message: `Accepted ${text}` };
      }
      return { type: "unsupported", message: `Unknown command: /${name}` };
    }

    if (name === "session") return { type: "done", message: this.formatSessionStats(session) };
    if (name === "name") {
      if (!rest) return { type: "unsupported", message: "Usage: /name <session name>" };
      session.setSessionName(rest);
      return { type: "done", message: `Session named ${rest}` };
    }
    if (name === "compact") {
      void session.compact(rest || undefined).catch((error) => {
        this.events.publish(session.sessionId, { type: "session.error", message: error instanceof Error ? error.message : String(error) });
      });
      return { type: "done", message: "Compaction started" };
    }
    if (name === "clone") {
      const leafId = session.sessionManager.getLeafId();
      if (!leafId) return { type: "unsupported", message: "Cannot clone: no current session entry" };
      const result = await active.runtime.fork(leafId, { position: "at" });
      if (result.cancelled) return { type: "done", message: "Clone cancelled" };
      return { type: "done", message: "Session cloned", session: this.clientSessionFromRuntime(active.runtime) };
    }
    if (name === "fork") {
      const messages = session.getUserMessagesForForking();
      if (!messages.length) return { type: "unsupported", message: "No user messages to fork from" };
      const requestId = crypto.randomUUID();
      this.pendingSelects.set(requestId, { sessionId: session.sessionId, command: "fork" });
      return {
        type: "select",
        requestId,
        title: "Fork from message",
        options: messages.map((message) => ({ value: message.entryId, label: truncate(message.text, 140) })),
      };
    }

    return { type: "unsupported", message: `/${name} is not implemented in the web UI yet` };
  }

  async respondToCommand(sessionId: string, requestId: string, value: string): Promise<ClientCommandResult> {
    const pending = this.pendingSelects.get(requestId);
    if (!pending || pending.sessionId !== sessionId) return { type: "unsupported", message: "Command request expired" };
    this.pendingSelects.delete(requestId);
    const active = await this.getActive(sessionId);
    if (pending.command === "fork") {
      const result = await active.runtime.fork(value);
      if (result.cancelled) return { type: "done", message: "Fork cancelled" };
      return { type: "done", message: "Session forked", session: this.clientSessionFromRuntime(active.runtime) };
    }
    return { type: "unsupported", message: "Unsupported command response" };
  }

  async abort(sessionId: string): Promise<void> {
    const active = this.active.get(sessionId);
    if (active) await active.runtime.session.abort();
  }

  close(sessionId: string): void {
    const active = this.active.get(sessionId);
    if (!active) return;
    active.unsubscribe();
    void active.runtime.dispose();
    this.active.delete(sessionId);
  }

  private async getOrOpen(sessionId: string): Promise<AgentSession> {
    return (await this.getActive(sessionId)).runtime.session;
  }

  private async getActive(sessionId: string): Promise<ActiveSession> {
    const active = this.active.get(sessionId);
    if (active) return active;

    const match = (await SessionManager.listAll()).find((s) => s.id === sessionId || s.id.startsWith(sessionId));
    if (!match) throw new Error("Session not found");
    return this.create(SessionManager.open(match.path), match.cwd);
  }

  private async create(sessionManager: SessionManager, cwd: string): Promise<ActiveSession> {
    const runtime = await createAgentSessionRuntime(this.createRuntime, { cwd, agentDir: this.agentDir, sessionManager });
    const active: ActiveSession = { runtime, unsubscribe: () => {} };
    this.bindRuntime(active);
    runtime.setRebindSession(async () => this.bindRuntime(active));
    this.active.set(runtime.session.sessionId, active);
    this.events.publish(runtime.session.sessionId, { type: "status.update", status: this.statusFromSession(runtime.session) });
    return active;
  }

  private bindRuntime(active: ActiveSession): void {
    active.unsubscribe();
    for (const [sessionId, candidate] of this.active.entries()) {
      if (candidate === active) this.active.delete(sessionId);
    }
    const { session } = active.runtime;
    active.unsubscribe = session.subscribe((event) => {
      this.events.publish(session.sessionId, toClientEvent(event));
      this.events.publish(session.sessionId, { type: "status.update", status: this.statusFromSession(session) });
    });
    this.active.set(session.sessionId, active);
  }

  private isRuntimeCommand(session: AgentSession, name: string): boolean {
    return session.extensionRunner.getRegisteredCommands().some((command) => command.invocationName === name)
      || session.promptTemplates.some((template) => template.name === name)
      || session.resourceLoader.getSkills().skills.some((skill) => `skill:${skill.name}` === name);
  }

  private clientSessionFromRuntime(runtime: AgentSessionRuntime): ClientSession {
    const session = runtime.session;
    return {
      id: session.sessionId,
      path: session.sessionFile ?? "",
      cwd: runtime.cwd,
      name: session.sessionName,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      messageCount: session.messages.length,
      firstMessage: "",
    };
  }

  private formatSessionStats(session: AgentSession): string {
    const stats = session.getSessionStats();
    return [
      `Session: ${stats.sessionId}`,
      `Messages: ${stats.totalMessages} (${stats.userMessages} user, ${stats.assistantMessages} assistant)`,
      `Tool calls: ${stats.toolCalls}`,
      `Tokens: ↑${stats.tokens.input} ↓${stats.tokens.output} total ${stats.tokens.total}`,
      `Cost: $${stats.cost.toFixed(4)}`,
    ].join("\n");
  }

  private statusFromSession(session: AgentSession): ClientSessionStatus {
    const stats = session.getSessionStats();
    return {
      sessionId: session.sessionId,
      model: session.model
        ? {
            provider: session.model.provider,
            id: session.model.id,
            name: (session.model as any).name,
            contextWindow: session.model.contextWindow,
            reasoning: (session.model as any).reasoning,
          }
        : undefined,
      thinkingLevel: session.thinkingLevel,
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      isBashRunning: session.isBashRunning,
      pendingMessageCount: session.pendingMessageCount,
      tokens: stats.tokens,
      cost: stats.cost,
      contextUsage: session.getContextUsage(),
    };
  }
}

function truncate(text: string, maxLength: number): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 1)}…`;
}

function toClientEvent(event: any): unknown {
  if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
    return { type: "assistant.delta", text: event.assistantMessageEvent.delta };
  }
  if (event.type === "tool_execution_start") {
    return { type: "tool.start", toolName: event.toolName, toolCallId: event.toolCallId };
  }
  if (event.type === "tool_execution_end") {
    return { type: "tool.end", toolName: event.toolName, toolCallId: event.toolCallId, isError: event.isError };
  }
  if (event.type === "agent_start") return { type: "agent.start" };
  if (event.type === "agent_end") return { type: "agent.end" };
  if (event.type === "message_end") return { type: "message.end" };
  return { type: "pi.event", eventType: event.type };
}
