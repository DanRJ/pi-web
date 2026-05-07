import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { Project, SessionInfo, Workspace } from "../api";
import { initialAppState, type AppState } from "../appState";
import { ProjectController } from "../controllers/projectController";
import { SessionController } from "../controllers/sessionController";
import { WorkspaceController } from "../controllers/workspaceController";
import { readRoute, writeRoute } from "../route";
import "./ProjectList";
import "./WorkspaceList";
import "./SessionList";
import "./ChatView";
import "./PromptEditor";
import "./StatusBar";
import "./CommandPicker";
import { appStyles } from "./shared";

@customElement("pi-web-poc")
export class PiWebApp extends LitElement {
  @state() private state: AppState = initialAppState();

  private readonly sessions = new SessionController(
    () => this.state,
    (patch) => this.setState(patch),
    () => this.updateUrl(),
  );
  private readonly workspaces = new WorkspaceController(
    () => this.state,
    (patch) => this.setState(patch),
    () => this.updateUrl(),
    this.sessions,
  );
  private readonly projects = new ProjectController(
    () => this.state,
    (patch) => this.setState(patch),
    this.workspaces,
  );
  private readonly onPopState = () => void this.restoreRoute(false);

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("popstate", this.onPopState);
    void this.loadProjectsAndRestoreRoute();
  }

  disconnectedCallback(): void {
    window.removeEventListener("popstate", this.onPopState);
    this.sessions.dispose();
    super.disconnectedCallback();
  }

  private setState(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
  }

  private async loadProjectsAndRestoreRoute() {
    await this.projects.loadProjects();
    await this.restoreRoute(false);
  }

  private async restoreRoute(updateUrl: boolean) {
    const route = readRoute();
    if (!route.projectId) return;
    const project = this.state.projects.find((p) => p.id === route.projectId);
    if (!project) return;
    await this.workspaces.selectProject(project, { workspaceId: route.workspaceId, sessionId: route.sessionId, updateUrl });
  }

  private updateUrl() {
    writeRoute({
      projectId: this.state.selectedProject?.id,
      workspaceId: this.state.selectedWorkspace?.id,
      sessionId: this.state.selectedSession?.id,
    });
  }

  render() {
    const state = this.state;
    return html`
      <div class="shell">
        <aside>
          <header>
            <strong>Pi Web POC</strong>
            <button @click=${() => this.projects.addProject()}>+ Project</button>
          </header>
          <project-list .projects=${state.projects} .selected=${state.selectedProject} .onSelect=${(project: Project) => this.workspaces.selectProject(project)}></project-list>
          <workspace-list .workspaces=${state.workspaces} .selected=${state.selectedWorkspace} .onSelect=${(workspace: Workspace) => this.workspaces.selectWorkspace(workspace)}></workspace-list>
          <session-list .sessions=${state.sessions} .selected=${state.selectedSession} .canStart=${!!state.selectedWorkspace} .onStart=${() => this.sessions.startSession()} .onSelect=${(session: SessionInfo) => this.sessions.selectSession(session)}></session-list>
        </aside>
        <main>
          ${state.error ? html`<div class="error">${state.error}</div>` : null}
          ${state.selectedSession ? html`
            <status-bar .status=${state.status} .workspace=${state.selectedWorkspace}></status-bar>
            <chat-view .messages=${state.messages}></chat-view>
            <prompt-editor .sessionId=${state.selectedSession.id} .cwd=${state.selectedWorkspace?.path} .onSend=${(text: string) => this.sessions.send(text)} .onCloseSession=${() => this.sessions.closeSession()}></prompt-editor>
            ${state.commandDialog ? html`<command-picker .title=${state.commandDialog.title} .options=${state.commandDialog.options} .onPick=${(value: string) => this.sessions.respondToCommand(state.commandDialog!.requestId, value)} .onCancel=${() => this.sessions.cancelCommand()}></command-picker>` : null}
          ` : html`<div class="empty">Select or start a session.</div>`}
        </main>
      </div>
    `;
  }

  static styles = appStyles;
}
