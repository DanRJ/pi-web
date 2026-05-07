import { api, type CommandResult, type SessionInfo, type SessionStatus } from "../api";
import { appendText, normalizeMessages, textMessage } from "../chatMessages";
import { GlobalSessionSocket, SessionSocket, type SessionUiEvent } from "../sessionSocket";
import type { GetState, SetState, UpdateUrl } from "./types";

export class SessionController {
  private readonly socket = new SessionSocket();
  private readonly globalSocket = new GlobalSessionSocket();

  constructor(private readonly getState: GetState, private readonly setState: SetState, private readonly updateUrl: UpdateUrl) {}

  connectStatusUpdates() {
    this.globalSocket.connect((event) => this.applyStatus(event.status));
  }

  dispose() {
    this.socket.close();
    this.globalSocket.close();
  }

  clearActiveSession() {
    this.socket.close();
    this.setState({ selectedSession: undefined, messages: [], status: undefined });
  }

  async startSession() {
    const workspace = this.getState().selectedWorkspace;
    if (!workspace) return;
    try {
      const session = await api.startSession(workspace.path);
      this.setState({ sessions: [session, ...this.getState().sessions] });
      await this.selectSession(session);
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async selectSession(session: SessionInfo, options?: { updateUrl?: boolean }) {
    this.socket.close();
    try {
      const buffered: SessionUiEvent[] = [];
      this.socket.connect(session.id, (event) => buffered.push(event));
      const [messages, status] = await Promise.all([api.messages(session.id), api.status(session.id)]);
      this.setState({ selectedSession: session, messages: normalizeMessages(messages), status });
      this.applyStatus(status);
      for (const event of buffered) this.applyEvent(event);
      this.socket.setHandler((event) => this.applyEvent(event));
      if (options?.updateUrl !== false) this.updateUrl();
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async send(text: string) {
    if (text.trim().startsWith("/")) return this.runCommand(text);
    const session = this.getState().selectedSession;
    if (!session) return;
    this.setState({ messages: [...this.getState().messages, textMessage("user", text)] });
    try {
      await api.prompt(session.id, text);
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async runCommand(text: string) {
    const session = this.getState().selectedSession;
    if (!session) return;
    try {
      this.applyCommandResult(await api.runCommand(session.id, text));
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async respondToCommand(requestId: string, value: string) {
    const session = this.getState().selectedSession;
    if (!session) return;
    this.setState({ commandDialog: undefined });
    try {
      this.applyCommandResult(await api.respondToCommand(session.id, requestId, value));
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  cancelCommand() {
    this.setState({ commandDialog: undefined });
  }

  async stopSession() {
    const session = this.getState().selectedSession;
    if (!session) return;
    try {
      await api.stop(session.id);
    } catch (error) {
      this.setState({ error: String(error) });
    } finally {
      this.clearActiveSession();
      this.updateUrl();
    }
  }

  private applyCommandResult(result: CommandResult) {
    if (result.type === "select") {
      this.setState({ commandDialog: result });
      return;
    }
    const message = result.type === "unsupported" ? result.message : result.message;
    if (message) this.setState({ messages: [...this.getState().messages, textMessage(result.type === "unsupported" ? "system" : "tool", message)] });
    if (result.type === "done" && result.session) {
      const sessions = [result.session, ...this.getState().sessions.filter((session) => session.id !== result.session?.id)];
      this.setState({ sessions });
      void this.selectSession(result.session);
    }
  }

  private applyStatus(status: SessionStatus) {
    this.setState({
      sessionStatuses: { ...this.getState().sessionStatuses, [status.sessionId]: status },
      status: this.getState().selectedSession?.id === status.sessionId ? status : this.getState().status,
    });
  }

  private applyEvent(event: SessionUiEvent) {
    const messages = this.getState().messages;
    if (event.type === "assistant.delta") {
      this.setState({ messages: appendText(messages, "assistant", event.text) });
    } else if (event.type === "tool.start") {
      this.setState({ messages: [...messages, { role: "tool", parts: [{ type: "toolCall", toolName: event.toolName, summary: "" }] }] });
    } else if (event.type === "tool.end") {
      this.setState({ messages: [...messages, textMessage("tool", `${event.isError ? "✖" : "✓"} ${event.toolName}`)] });
    } else if (event.type === "status.update") {
      this.applyStatus(event.status);
    } else if (event.type === "session.error") {
      this.setState({ messages: [...messages, textMessage("system", event.message)] });
    }
  }
}
