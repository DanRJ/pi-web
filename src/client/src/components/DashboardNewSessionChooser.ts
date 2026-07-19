import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { Project, Workspace } from "../api";

/** A dashboard-local, deliberately explicit project and workspace picker for a new session. */
@customElement("dashboard-new-session-chooser")
export class DashboardNewSessionChooser extends LitElement {
  @property({ attribute: false }) projects: Project[] = [];
  @property({ type: String }) selectedProjectId: string | undefined;
  @property({ type: String }) selectedWorkspaceId: string | undefined;
  @property({ attribute: false }) loadWorkspaces: (project: Project) => Promise<Workspace[]> = () => Promise.resolve([]);
  @property({ attribute: false }) onStart?: (workspace: Workspace) => Promise<void>;
  @query("#dashboard-project") private projectSelect?: HTMLSelectElement;
  @query(".dialog") private dialog?: HTMLElement;
  @state() private open = false;
  @state() private projectId: string | undefined;
  @state() private workspaceId: string | undefined;
  @state() private workspaces: Workspace[] = [];
  @state() private loading = false;
  @state() private starting = false;
  @state() private error: string | undefined;
  private workspaceRequest = 0;
  private startRequest = 0;
  private opener: HTMLElement | undefined;

  async openChooser(opener?: HTMLElement): Promise<void> {
    this.opener = opener;
    this.workspaceRequest += 1;
    this.open = true;
    this.error = undefined;
    this.workspaces = [];
    this.workspaceId = undefined;
    this.projectId = this.projects.some((project) => project.id === this.selectedProjectId) ? this.selectedProjectId : undefined;
    // Keep the dialog interactive while a retained project's workspaces load.
    // Starting the request without awaiting it lets Lit mount the modal and put
    // focus inside it before a slow workspace endpoint settles.
    const initialLoad = this.projectId === undefined ? undefined : this.loadProjectWorkspaces(this.projectId, this.selectedWorkspaceId);
    await this.updateComplete;
    this.focusProjectSelect();
    await initialLoad;
  }

  private focusProjectSelect(): void {
    if (!this.open) return;
    this.projectSelect?.focus();
  }

  private requestClose(completedStart = false): void {
    // Creation cannot be cancelled at the API boundary. Keeping the dialog
    // mounted prevents a late completion from navigating after a cancellation.
    if (this.starting && !completedStart) return;
    this.workspaceRequest += 1;
    this.startRequest += 1;
    this.open = false;
    this.loading = false;
    this.error = undefined;
    void this.restoreOpener();
  }

  // Kept as a narrow alias for callers/tests that close the chooser directly.
  private close(): void { this.requestClose(); }

  private async restoreOpener(): Promise<void> {
    await this.updateComplete;
    this.opener?.focus();
    this.opener = undefined;
  }

  private async chooseProject(event: Event): Promise<void> {
    const projectId = selectValue(event) || undefined;
    this.projectId = projectId;
    this.workspaceId = undefined;
    this.workspaces = [];
    this.error = undefined;
    if (projectId !== undefined) await this.loadProjectWorkspaces(projectId);
  }

  private async loadProjectWorkspaces(projectId: string, preferredWorkspaceId?: string): Promise<void> {
    const project = this.projects.find((candidate) => candidate.id === projectId);
    if (project === undefined) return;
    const request = ++this.workspaceRequest;
    this.loading = true;
    this.error = undefined;
    try {
      const workspaces = await this.loadWorkspaces(project);
      if (request !== this.workspaceRequest || this.projectId !== projectId) return;
      this.workspaces = workspaces;
      this.workspaceId = workspaces.some((workspace) => workspace.id === preferredWorkspaceId) ? preferredWorkspaceId : undefined;
    } catch (error) {
      if (request !== this.workspaceRequest || this.projectId !== projectId) return;
      this.workspaces = [];
      this.workspaceId = undefined;
      this.error = `Could not load workspaces: ${errorMessage(error)}`;
    } finally {
      if (request === this.workspaceRequest && this.projectId === projectId) this.loading = false;
    }
  }

  private chooseWorkspace(event: Event): void {
    this.workspaceId = selectValue(event) || undefined;
    this.error = undefined;
  }

  private async start(): Promise<void> {
    const workspace = this.workspaces.find((candidate) => candidate.id === this.workspaceId);
    if (workspace === undefined) {
      this.error = "Choose a workspace before starting a session.";
      return;
    }
    const request = ++this.startRequest;
    this.starting = true;
    this.error = undefined;
    try {
      if (this.onStart === undefined) throw new Error("New-session creation is unavailable.");
      await this.onStart(workspace);
      // Ignore completions from a stale/closed dialog. requestClose is normally
      // disabled while starting, but the guard also protects imperative closes.
      if (request !== this.startRequest || !this.open) return;
      this.requestClose(true);
    } catch (error) {
      if (request !== this.startRequest || !this.open) return;
      this.error = `Could not start session: ${errorMessage(error)}`;
    } finally {
      if (request === this.startRequest && this.open) this.starting = false;
    }
  }

  private readonly onDialogKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      this.requestClose();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = this.enabledControls();
    if (controls.length === 0) {
      event.preventDefault();
      return;
    }
    const active = this.shadowRoot?.activeElement;
    const current = active instanceof HTMLElement ? controls.indexOf(active) : -1;
    if (event.shiftKey && current <= 0) {
      event.preventDefault();
      controls.at(-1)?.focus();
    } else if (!event.shiftKey && (current === -1 || current === controls.length - 1)) {
      event.preventDefault();
      controls[0]?.focus();
    }
  };

  private enabledControls(): HTMLElement[] {
    return [...(this.dialog?.querySelectorAll<HTMLElement>("button:not([disabled]), select:not([disabled])") ?? [])]
      .filter((control) => !control.hasAttribute("disabled"));
  }

  override render() {
    if (!this.open) return nothing;
    const selectedProject = this.projects.find((project) => project.id === this.projectId);
    return html`
      <div class="scrim" @click=${() => { this.requestClose(); }}>
        <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dashboard-new-session-title" @click=${(event: Event) => { event.stopPropagation(); }} @keydown=${this.onDialogKeydown}>
          <header><div><p class="eyebrow">NEW SESSION</p><h2 id="dashboard-new-session-title">Choose a workspace</h2></div><button class="close" type="button" aria-label="Cancel new session" ?disabled=${this.starting} @click=${() => { this.requestClose(); }}>Cancel</button></header>
          <p>Choose a project, then the workspace where PI should start.</p>
          <label for="dashboard-project">Project</label>
          <select id="dashboard-project" .value=${this.projectId ?? ""} @change=${(event: Event) => { void this.chooseProject(event); }} ?disabled=${this.starting}>
            <option value="">Choose a project</option>
            ${this.projects.map((project) => html`<option value=${project.id}>${project.name}</option>`)}
          </select>
          ${selectedProject === undefined ? html`<p class="state">Choose a project to see its workspaces.</p>` : this.loading ? html`<p class="state" role="status">Loading workspaces…</p>` : html`
            <label for="dashboard-workspace">Workspace</label>
            <select id="dashboard-workspace" .value=${this.workspaceId ?? ""} @change=${(event: Event) => { this.chooseWorkspace(event); }} ?disabled=${this.starting || this.workspaces.length === 0}>
              <option value="">Choose a workspace</option>
              ${this.workspaces.map((workspace) => html`<option value=${workspace.id}>${workspace.label || workspace.path}</option>`)}
            </select>
            ${this.workspaces.length === 0 ? html`<p class="state">This project has no workspaces yet.</p>` : nothing}
          `}
          ${this.error === undefined ? nothing : html`<p class="error" role="alert">${this.error} ${selectedProject === undefined ? nothing : html`<button type="button" ?disabled=${this.starting} @click=${() => { void this.loadProjectWorkspaces(selectedProject.id, this.selectedWorkspaceId); }}>Retry</button>`}</p>`}
          <footer><button type="button" @click=${() => { this.requestClose(); }} ?disabled=${this.starting}>Cancel</button><button class="start" type="button" @click=${() => { void this.start(); }} ?disabled=${this.starting || this.loading || this.workspaceId === undefined}>${this.starting ? "Starting…" : "Start session"}</button></footer>
        </section>
      </div>
    `;
  }

  static override styles = css`
    :host { font-family: Archivo, var(--pi-body-font-family, system-ui, sans-serif); }
    .scrim { position: fixed; z-index: 10; inset: 0; display: grid; place-items: center; box-sizing: border-box; background: color-mix(in srgb, var(--pi-bg) 72%, transparent); padding: 1rem; }
    .dialog { box-sizing: border-box; width: min(100%, 38rem); max-height: 100%; overflow: auto; border: .1875rem solid var(--pi-text); background: var(--pi-bg); color: var(--pi-text); padding: 1.25rem; box-shadow: .5rem .5rem 0 var(--pi-text); }
    header, footer { display: flex; align-items: center; justify-content: space-between; gap: 1rem; } header { border-bottom: .125rem solid var(--pi-text); padding-bottom: .75rem; } footer { justify-content: flex-end; border-top: .125rem solid var(--pi-border); margin-top: 1.25rem; padding-top: .75rem; }
    h2, p { margin: 0; } h2 { font-size: 1.5rem; } .eyebrow { color: var(--pi-muted); font-size: .75rem; font-weight: 800; letter-spacing: .08em; } .dialog > p { margin-top: 1rem; color: var(--pi-text-secondary); }
    label { display: block; margin-top: 1rem; font-size: .8125rem; font-weight: 800; text-transform: uppercase; } select, button { min-height: 2.75rem; border: .125rem solid var(--pi-text); border-radius: 0; background: var(--pi-bg); color: var(--pi-text); font: inherit; font-weight: 700; } select { box-sizing: border-box; width: 100%; margin-top: .375rem; padding: .5rem; } button { padding: .5rem .75rem; cursor: pointer; } button:hover { background: var(--pi-text); color: var(--pi-bg); } button:disabled { opacity: .6; cursor: wait; } button:focus-visible, select:focus-visible { outline: .1875rem solid var(--pi-accent); outline-offset: .1875rem; } .start { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-bg); } .state, .error { border: .125rem solid var(--pi-border); padding: .75rem; } .error { border-color: var(--pi-text); color: var(--pi-text); } .error button { min-height: 2rem; margin-left: .5rem; } @media (max-width: 42rem) { .scrim { align-items: end; padding: 0; } .dialog { width: 100%; max-height: 90%; border-right: 0; border-bottom: 0; border-left: 0; box-shadow: none; } }
  `;
}

function selectValue(event: Event): string {
  const target = event.currentTarget;
  return target instanceof HTMLSelectElement ? target.value : "";
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
