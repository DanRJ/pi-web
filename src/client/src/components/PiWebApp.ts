import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { configApi, dashboardApi, effectiveWorkspaceUploadFolder, sessionsApi, terminalsApi, workspacesApi, workspaceEffectiveUploadFolder, type LocalSessionDashboardSessionSummary, type Machine, type MachineHealth, type PiWebConfigValues, type PiWebShortcutConfig, type Project, type SessionCleanupExecuteResponse, type SessionCleanupPreviewResponse, type SessionCleanupRequest, type SessionInfo, type TerminalCommandRun, type TerminalUiEvent, type Workspace } from "../api";
import type { AppAction } from "../actions";
import { initialAppState, type AppState } from "../appState";
import { isSessionActive } from "../../../shared/activity";
import { PI_WEB_CAPABILITIES, supportsPiWebCapability } from "../../../shared/capabilities";
import { ActivityController } from "../controllers/activityController";
import { DashboardController, type DashboardControllerState } from "../controllers/dashboardController";
import { AuthController } from "../controllers/authController";
import { FileExplorerController } from "../controllers/fileExplorerController";
import { GitController } from "../controllers/gitController";
import { MachineController } from "../controllers/machineController";
import { ProjectController } from "../controllers/projectController";
import { ProjectActivityOwnershipCoordinator } from "../controllers/projectActivityOwnershipCoordinator";
import { PiWebStatusController } from "../controllers/piWebStatusController";
import { SessionController } from "../controllers/sessionController";
import { SessionNotificationController } from "../controllers/sessionNotificationController";
import { WorkspaceController, canDeleteWorkspace } from "../controllers/workspaceController";
import { emptyMachineNavigationSnapshot, machineNavigationSnapshotFromState, routeFromMachineNavigationSnapshot, SessionStorageMachineNavigationMemory, type MachineNavigationSnapshot, type WorkspaceRouteSurface } from "../controllers/machineNavigationMemory";
import { SessionStorageSessionSelectionMemory } from "../controllers/sessionSelection";
import { SessionStorageTerminalSelectionMemory } from "../controllers/terminalSelection";
import { SessionStorageWorkspaceSelectionMemory } from "../controllers/workspaceSelection";
import { KeyboardShortcutDispatcher } from "../keyboardShortcuts";
import { selectedMachineId } from "../controllers/types";
import { sessionCleanupRequestKey, sessionCleanupUnavailableMessage } from "../sessionCleanupUi";
import { selectedNotificationView } from "../sessionNotifications";
import { hasAuthoritativeSessionPersistence as runtimeHasAuthoritativeSessionPersistence } from "../sessionPersistence";
import { RealtimeSocket, type BrowserRealtimeEvent } from "../sessionSocket";
import type { PiWebPluginRegistration, PluginMachine, PluginPromptEditor, QualifiedContributionId, QualifiedThemeContribution, QualifiedThemePairContribution, QualifiedWorkspacePanelContribution, PluginRuntimeContext, TerminalCommandRunsInternalRuntime, WorkspaceFiles, WorkspaceHost, WorkspaceLabelContext, WorkspaceLabelItem, WorkspacePanelContext } from "../plugins/types";
import { CLASSIC_THEME_ID, DEFAULT_THEME_PREFERENCE, applyPiWebTheme, findThemePairForTheme, readStoredThemePreference, resolveThemePreference, toggleThemePreference, writeStoredThemePreference, type ThemePreference, type ThemePreferenceResolution } from "../theme";
import { corePlugin } from "../plugins/core";
import { isCoreWorkspacePanelId } from "../plugins/core/workspacePanelIds";
import { themePackPlugin } from "../plugins/themes";
import { loadExternalPlugins } from "../plugins/external";
import { PluginRegistry, installPluginRuntimeScope, installWorkspacePanelScope } from "../plugins/registry";
import { queryNamespace, readNamespacedString, setNamespacedQueryKey } from "../namespacedQueryArgs";
import { AppShellController } from "../appShell/appShellController";
import { initialMobileKeyboardFocusState, keyboardDismissedWhileComposerFocused, updateMobileKeyboardFocus, type VisualViewportSnapshot } from "../appShell/mobileKeyboardFocus";
import { BrowserResumeController } from "../appShell/browserResumeController";
import { mobileDestinationFromMainView, type MobileDestination } from "../appShell/mobileDestination";
import { NavigationSectionsController, type NavigationSection } from "../appShell/navigationState";
import { PanelCollapseController, mainViewClass } from "../appShell/panelCollapseController";
import { MODERNIST_NAVIGATION_PANEL_DEFAULT_WIDTH, PanelResizeController, type PanelResizeConstraints, type ResizablePanelSide } from "../appShell/panelResizeController";
import { readRoute, writeRoute, type AppRoute, type TopLevelPage } from "../route";
import { readSettingsSection, writeSettingsSection, type SettingsSection } from "../settingsRoute";
import { applyActiveShortcutPreferences } from "../shortcutPreferences";
import { createTerminalCommandRunsRuntime } from "../runtime/terminalRuntime";
import { isWorkspaceDeletionPending, isWorkspaceDeletionRunPending, latestWorkspaceDeletionRuns, pendingWorkspaceDeletionIds, targetWorkspaceIdForRun, workspaceDeletionRunFilter } from "../workspaceDeletion";
import "./MachineList";
import "./ProjectList";
import "./WorkspaceList";
import "./SessionList";
import "./SessionCleanupDialog";
import "./SessionRenameDialog";
import "./ChatView";
import type { ChatView } from "./ChatView";
import "./PromptEditor";
import type { PromptEditor } from "./PromptEditor";
import "./StatusBar";
import "./SessionDashboard";
import "./DashboardNewSessionChooser";
import "./AppSessionHeader";
import "./CommandPicker";
import "./ActionPalette";
import "./AuthDialog";
import "./ProjectDialog";
import "./MachineDialog";
import type { MachineDialogSubmit } from "./MachineDialog";
import { isFocusableElement, type SettingsDialog } from "./SettingsDialog";
import "./WorkspacePanel";
import type { WorkspacePanelEmptyState } from "./WorkspacePanel";
import "./appShell/AppContextBar";
import "./appShell/AppMobileMainTabs";
import "./appShell/AppMobileDestinationTabs";
import "./appShell/ModernistGlobalHeader";
import type { AppMobileDestinationTabs } from "./appShell/AppMobileDestinationTabs";
import type { AppMobileMainTab, AppMobileMainTabIcon } from "./appShell/AppMobileMainTabs";
import type { ModernistGlobalDestination } from "./appShell/ModernistGlobalHeader";
import { shouldShowMachinesSection, type AppNavigationPanel, type NavigationFocusTarget } from "./appShell/AppNavigationPanel";
import "./appShell/AppPanelEdgeControl";
import "./appShell/AppRefreshControl";
import { appStyles } from "./shared";


const PI_WEB_STATUS_REFRESH_MS = 15 * 60 * 1000;
const PI_WEB_STATUS_DEFER_MS = 750;
const REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS = [1_000, 3_000, 8_000, 15_000, 30_000] as const;
const GLOBAL_SHORTCUT_LISTENER_OPTIONS = { capture: true } as const;
const THEME_AUTO_ON_VALUE = "auto:on";
const THEME_AUTO_OFF_VALUE = "auto:off";
const THEME_OPTION_PREFIX = "theme:";
const FILES_ROUTE_NAMESPACE = queryNamespace("core:workspace.files");
const GIT_ROUTE_NAMESPACE = queryNamespace("core:workspace.git");
const TERMINAL_ROUTE_NAMESPACE = queryNamespace("core:workspace.terminal");
const MIN_RESIZABLE_CHAT_WIDTH_PX = 320;
const PANEL_EDGE_COLUMNS_WIDTH_PX = 2;
const DESKTOP_SIDE_BY_SIDE_MEDIA_QUERY = "(min-width: 1181px)";

interface SessionCleanupDialogState {
  preview?: SessionCleanupPreviewResponse | undefined;
  previewRequest?: SessionCleanupRequest | undefined;
  result?: SessionCleanupExecuteResponse | undefined;
  loading?: boolean | undefined;
  running?: boolean | undefined;
  error?: string | undefined;
}

interface SessionRenameDialogTarget {
  machineId: string;
  sessionId: string;
  cwd: string;
  oldName?: string;
  machineRevision?: string;
  /** Dashboard capabilities are already an effective web+sessiond snapshot. */
  capabilityVerified?: true;
  opener?: HTMLElement;
}

@customElement("pi-web-app")
export class PiWebApp extends LitElement {
  @state() private state: AppState = initialAppState();
  @query("chat-view") private chatView?: ChatView;
  @query("prompt-editor") private promptEditor?: PromptEditor;
  @query("app-navigation-panel") private navigationPanel?: AppNavigationPanel;
  @query("#navigation-panel") private navigationPanelFrame?: HTMLElement;
  @query("#workspace-panel") private workspacePanelFrame?: HTMLElement;
  @query("main") private mainContent?: HTMLElement;
  @query("app-mobile-destination-tabs") private mobileDestinationTabs?: AppMobileDestinationTabs;
  @query("settings-dialog") private settingsDialog?: SettingsDialog;

  private readonly notifications = new SessionNotificationController(
    () => this.state,
    (patch) => { this.setState(patch); },
    { onBackgroundError: (message, error) => { console.warn(message, error); } },
  );
  private readonly sessions = new SessionController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
    new SessionStorageSessionSelectionMemory(),
    { notifications: this.notifications },
  );
  private readonly projectActivityOwnership = new ProjectActivityOwnershipCoordinator(
    () => this.state,
    (patch) => { this.setState(patch); },
    {
      api: workspacesApi,
      onError: ({ machineId, projectId, error }) => {
        console.warn(`Failed to discover project activity ownership for ${projectId} on ${machineId}`, error);
      },
    },
  );
  @state() private topLevelPage: TopLevelPage = readRoute().page ?? "workspace";
  @state() private dashboardState: DashboardControllerState = { dashboard: undefined, loading: false, error: undefined };
  private readonly dashboard = new DashboardController(
    () => this.dashboardState,
    (dashboardState) => { this.dashboardState = dashboardState; },
    { load: (signal) => dashboardApi.dashboard(signal) },
  );
  private readonly activity = new ActivityController(
    () => this.state,
    (patch) => { this.setState(patch); },
    { onActivityApplied: (machineId) => { void this.projectActivityOwnership.handleActivityApplied(machineId); } },
  );
  private readonly auth = new AuthController(
    () => this.state,
    (patch) => { this.setState(patch); },
    (status) => { this.sessions.applySessionStatus(status); },
  );
  private readonly workspaces = new WorkspaceController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
    this.sessions,
    new SessionStorageWorkspaceSelectionMemory(),
  );
  private readonly projects = new ProjectController(
    () => this.state,
    (patch) => { this.setState(patch); },
    this.workspaces,
    { onProjectsApplied: (machineId) => { void this.projectActivityOwnership.handleProjectsApplied(machineId); } },
  );
  private readonly machines = new MachineController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
    this.projects,
  );
  private readonly piWebStatusController = new PiWebStatusController(
    () => this.state,
    (patch) => { this.setState(patch); },
    { onRefreshError: (machineId, error) => { console.warn(`Failed to refresh PI WEB status for ${machineId}`, error); } },
  );
  private readonly files = new FileExplorerController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
  );
  private readonly git = new GitController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
  );
  private readonly keyboard = new KeyboardShortcutDispatcher();
  private readonly realtime = new RealtimeSocket();
  private readonly machineRealtimeSockets = new Map<string, RealtimeSocket>();
  private readonly activeTerminalIds = new Set<string>();
  private readonly machineNavigation = new SessionStorageMachineNavigationMemory();
  private readonly terminalSelection = new SessionStorageTerminalSelectionMemory();
  private readonly appShell = new AppShellController(this, {
    onMobileNavigationLayoutChange: (isMobile) => { this.handleMobileNavigationLayoutChange(isMobile); },
    onVisualViewportSnapshotChange: (snapshot) => { this.handleVisualViewportSnapshot(snapshot); },
  });
  private readonly browserResume = new BrowserResumeController({
    onResumeSignal: () => { this.handleBrowserResumeSignal(); },
    refreshAfterResume: () => this.refreshAfterBrowserResume(),
    onRefreshError: (error) => { console.warn("Failed to refresh after browser resume", error); },
  });
  private readonly panelCollapse = new PanelCollapseController(this);
  private readonly panelResize = new PanelResizeController(this);
  private readonly navigationSections = new NavigationSectionsController(
    this,
    () => this.state,
    () => this.appShell.isMobileNavigationLayout,
  );
  private readonly systemLightThemeMedia = typeof window !== "undefined" && "matchMedia" in window ? window.matchMedia("(prefers-color-scheme: light)") : undefined;
  // The workbench uses an explicit desktop/tablet input, so observe this
  // boundary instead of relying on CSS to imply a composition change.
  private readonly desktopSideBySideMedia = typeof window !== "undefined" && "matchMedia" in window ? window.matchMedia(DESKTOP_SIDE_BY_SIDE_MEDIA_QUERY) : undefined;
  private terminalAutoStartWorkspaceId: string | undefined;
  private piWebStatusTimer: number | undefined;
  private piWebStatusDeferredTimer: number | undefined;
  private workspaceDeletionPollTimer: number | undefined;
  private refreshingWorkspaceDeletionRuns = false;
  private readonly handledWorkspaceDeletionRunIds = new Set<string>();
  private readonly terminalCommandRunRuntimes = new Map<string, TerminalCommandRunsInternalRuntime>();
  private machineNavigationRestoreSeq = 0;
  private navigationSelectionSeq = 0;
  private dashboardSessionOpenSeq = 0;
  private routeRestoreSeq = 0;
  private routeRestoreDepth = 0;
  private restoringRouteTerminalId: string | undefined;
  private pendingRemoteRouteRestore: AppRoute | undefined;
  private remoteRouteRestoreTimer: number | undefined;
  private remoteRouteRestoreAttempt = 0;
  private remoteRouteRestoreInProgress = false;
  private readonly plugins = createPluginRegistry();
  private readonly loadedMachinePluginIds = new Set<string>();
  private readonly machinePluginLoadPromises = new Map<string, Promise<void>>();
  private gatewayPluginLoadPromise: Promise<void> | undefined;
  private themePreference: ThemePreference = readStoredThemePreference() ?? DEFAULT_THEME_PREFERENCE;
  @state() private activeThemeId: QualifiedContributionId = CLASSIC_THEME_ID;
  @state() private isRefreshingApp = false;
  @state() private sessionCleanupDialog: SessionCleanupDialogState | undefined;
  @state() private sessionRenameTarget: SessionRenameDialogTarget | undefined;
  @state() private sessionRenameSaving = false;
  @state() private sessionRenameError = "";
  @state() private settingsSection: SettingsSection | undefined = readSettingsSection();
  @state() private shortcutConfig: PiWebShortcutConfig = {};
  @state() private workspaceUploadDefaultFolder = effectiveWorkspaceUploadFolder(undefined);
  @state() private mobileDestination: MobileDestination = "chat";
  @state() private mobileKeyboardFocus = initialMobileKeyboardFocusState;
  private mobileDestinationBeforeSettings: MobileDestination | undefined;
  private composerFocused = false;
  private visualViewportSnapshot: VisualViewportSnapshot | undefined;
  private settingsFocusReturnTarget: HTMLElement | undefined;
  private machineDialogMachine: Machine | undefined;
  private readonly onPopState = () => void this.withChatScrollTransition(async () => {
    // A browser history traversal owns the destination, even if a card restore is pending.
    this.invalidateDashboardSessionOpen();
    const dashboardWasVisible = this.topLevelPage === "dashboard";
    this.restoreSettingsRoute();
    const route = readRoute();
    this.topLevelPage = route.page ?? "workspace";
    if (this.topLevelPage === "dashboard") {
      // Closing a Settings destination is a same-page history traversal: retain
      // the already-mounted dashboard rather than replacing its live state.
      if (!dashboardWasVisible) void this.dashboard.refresh();
      return;
    }
    await this.restoreRoute(false);
  });
  private readonly onPageShow = () => {
    this.restoreSettingsRoute();
    this.appShell.repairViewportPosition();
    this.retryPendingRemoteRouteRestoreSoon();
  };
  private readonly onSystemLightThemeChange = () => {
    if (this.themePreference.auto) this.applyPreferredTheme(false);
  };
  private readonly onDesktopSideBySideChange = () => { this.requestUpdate(); this.updateGitPolling(); };
  private get routeRestoreInProgress(): boolean {
    return this.routeRestoreDepth > 0;
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (this.settingsSection !== undefined) return;
    if (this.keyboard.handle(event, this.getDefaultActions(), { shortcuts: this.shortcutConfig })) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  protected override willUpdate(): void {
    this.toggleAttribute("pwa-display-mode", this.appShell.isPwaDisplayMode);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("popstate", this.onPopState);
    window.addEventListener("pageshow", this.onPageShow);
    this.browserResume.connect();
    this.restoreSettingsRoute();
    window.addEventListener("keydown", this.onKeyDown, GLOBAL_SHORTCUT_LISTENER_OPTIONS);
    this.systemLightThemeMedia?.addEventListener("change", this.onSystemLightThemeChange);
    this.desktopSideBySideMedia?.addEventListener("change", this.onDesktopSideBySideChange);
    this.applyPreferredTheme(false);
    this.connectRealtime();
    this.piWebStatusTimer = window.setInterval(() => { this.schedulePiWebStatusRefresh(); }, PI_WEB_STATUS_REFRESH_MS);
    void this.refreshWorkspaceActivity();
    void this.loadClientConfig();
    void this.ensureGatewayPluginsLoaded();
    void this.loadProjectsAndRestoreRoute().finally(() => { this.schedulePiWebStatusRefresh(); });
  }

  override disconnectedCallback(): void {
    window.removeEventListener("popstate", this.onPopState);
    window.removeEventListener("pageshow", this.onPageShow);
    this.browserResume.disconnect();
    window.removeEventListener("keydown", this.onKeyDown, GLOBAL_SHORTCUT_LISTENER_OPTIONS);
    this.systemLightThemeMedia?.removeEventListener("change", this.onSystemLightThemeChange);
    this.desktopSideBySideMedia?.removeEventListener("change", this.onDesktopSideBySideChange);
    this.keyboard.reset();
    this.auth.dispose();
    this.sessions.dispose();
    this.dashboard.dispose();
    this.notifications.dispose();
    this.realtime.close();
    this.closeMachineActivitySockets();
    this.git.dispose();
    if (this.piWebStatusTimer !== undefined) window.clearInterval(this.piWebStatusTimer);
    this.piWebStatusTimer = undefined;
    this.clearScheduledPiWebStatusRefresh();
    if (this.workspaceDeletionPollTimer !== undefined) window.clearInterval(this.workspaceDeletionPollTimer);
    this.workspaceDeletionPollTimer = undefined;
    this.clearPendingRemoteRouteRestore();
    super.disconnectedCallback();
  }

  private setState(patch: Partial<AppState>) {
    if (!patchChangesState(this.state, patch)) return;
    const previous = this.state;
    this.state = { ...this.state, ...patch };
    this.ensureMobileDestination();
    this.handleActivityTransition(previous, this.state);
    this.handleWorkspaceChange(previous, this.state);
    if (machineTargetKey(previous.selectedMachine) !== machineTargetKey(this.state.selectedMachine)) this.auth.handleMachineTargetChange();
    this.handleMachineChange(previous, this.state);
    if (machineActivitySubscriptionInputsChanged(previous, this.state)) this.syncMachineActivitySubscriptions();
    this.notifications.syncEnvironment(previous, this.state);
  }

  private async loadProjectsAndRestoreRoute() {
    this.restoreSettingsRoute();
    const route = readRoute();
    this.topLevelPage = route.page ?? "workspace";
    await this.machines.loadMachines(route.machineId);
    const effectiveRoute = this.routeForSelectedMachine(route);
    const initialRouteMachineHealth = this.state.machineStatuses[effectiveRoute.machineId ?? "local"];
    if (effectiveRoute !== route) this.replaceRouteAndClearWorkspaceQuery(effectiveRoute);
    await this.projects.loadProjects();
    if (this.topLevelPage === "dashboard") {
      void this.dashboard.refresh();
      return;
    }
    await this.withChatScrollTransition(() => this.restoreRouteFor(effectiveRoute, false));
    if (this.shouldDeferRemoteRouteRestore(effectiveRoute, initialRouteMachineHealth)) this.deferRemoteRouteRestore(effectiveRoute);
    else {
      this.clearPendingRemoteRouteRestore();
      this.rememberCurrentMachineNavigation();
    }
    await this.refreshWorkspaceDeletionRuns();
  }

  private handleBrowserResumeSignal(): void {
    this.restoreSettingsRoute();
    this.appShell.repairViewportPosition();
    this.schedulePiWebStatusRefresh();
    this.retryPendingRemoteRouteRestoreSoon();
  }

  private async refreshAfterBrowserResume(): Promise<void> {
    await Promise.all([
      this.sessions.refreshSelectedSession(),
      this.refreshMachineActivities(),
      this.refreshWorkspaceDeletionRuns(),
    ]);
  }

  private schedulePiWebStatusRefresh(delayMs = PI_WEB_STATUS_DEFER_MS): void {
    this.clearScheduledPiWebStatusRefresh();
    this.piWebStatusDeferredTimer = window.setTimeout(() => {
      this.piWebStatusDeferredTimer = undefined;
      void this.piWebStatusController.refresh();
    }, delayMs);
  }

  private clearScheduledPiWebStatusRefresh(): void {
    if (this.piWebStatusDeferredTimer === undefined) return;
    window.clearTimeout(this.piWebStatusDeferredTimer);
    this.piWebStatusDeferredTimer = undefined;
  }

  private async refreshWorkspaceActivity(machineId = selectedMachineId(this.state)): Promise<void> {
    try {
      await this.activity.refresh(machineId);
    } catch (error) {
      console.warn(`Failed to refresh workspace activity for ${machineId}`, error);
    }
  }

  private async refreshMachineActivities(): Promise<void> {
    const machineIds = this.state.machines.length === 0
      ? [selectedMachineId(this.state)]
      : this.state.machines
        .filter((machine) => shouldRefreshMachineActivity(machine, this.state.machineStatuses[machine.id]))
        .map((machine) => machine.id);
    await Promise.all(machineIds.map((machineId) => this.refreshWorkspaceActivity(machineId)));
  }

  private async loadClientConfig(): Promise<void> {
    try {
      this.applyClientConfig((await configApi.config()).effectiveConfig);
    } catch (error) {
      console.warn("Failed to load PI WEB config", error);
    }
  }

  private applyClientConfig(config: PiWebConfigValues): void {
    this.shortcutConfig = config.shortcuts ?? {};
    this.workspaceUploadDefaultFolder = effectiveWorkspaceUploadFolder(config);
  }

  private async refreshAppData(): Promise<void> {
    if (this.isRefreshingApp) return;
    this.isRefreshingApp = true;
    try {
      await Promise.all([
        this.sessions.refreshSelectedSession(),
        this.refreshMachineActivities(),
        this.loadClientConfig(),
        this.refreshWorkspaceDeletionRuns(),
        this.refreshCurrentWorkspaceSurface(),
      ]);
      this.schedulePiWebStatusRefresh();
    } finally {
      this.isRefreshingApp = false;
    }
  }

  private async refreshCurrentWorkspaceSurface(): Promise<void> {
    const workspace = this.state.selectedWorkspace;
    const tool = this.state.mainView !== "chat" && this.state.mainView !== "navigation" ? this.state.mainView : this.state.workspaceTool;
    if (tool === "core:workspace.files") await this.files.refreshFiles();
    else if (tool === "core:workspace.git") await this.git.refreshGit();
    else if (tool === "core:workspace.terminal" && workspace !== undefined) await this.refreshActiveTerminals(workspace);
  }

  private hardReloadApp(): void {
    window.location.reload();
  }

  private async restoreRoute(updateUrl: boolean) {
    await this.restoreRouteFor(readRoute(), updateUrl);
    this.rememberCurrentMachineNavigation();
  }

  private async restoreRouteFor(route: AppRoute, updateUrl: boolean, surface = this.readWorkspaceRouteSurface(route), restoredMainView?: AppState["mainView"]) {
    const machineBeforeRestore = selectedMachineId(this.state);
    const routeSurface = route.projectId === undefined || route.projectId === "" ? emptyWorkspaceRouteSurface() : surface;
    const restoreSeq = ++this.routeRestoreSeq;
    this.routeRestoreDepth += 1;
    this.restoringRouteTerminalId = routeSurface.selectedTerminalId;
    try {
      await this.restoreRouteMachine(route, false);
      const selectedMachinePluginLoad = this.loadPluginsForSelectedMachine();
      if (route.tool?.startsWith("machine.") === true) await selectedMachinePluginLoad;
      if (!this.isCurrentRouteRestore(restoreSeq)) return;
      this.setState({
        workspaceTool: route.tool ?? this.state.workspaceTool,
        mainView: restoredMainView ?? route.view ?? this.defaultRouteView(),
        selectedFilePath: routeSurface.selectedFilePath,
        selectedDiffPath: routeSurface.selectedDiffPath,
        selectedTerminalId: routeSurface.selectedTerminalId,
      });
      if (this.appShell.isMobileNavigationLayout) {
        const destination = mobileDestinationFromMainView(restoredMainView ?? route.view ?? this.defaultRouteView());
        if (this.settingsSection === undefined) {
          this.mobileDestination = destination;
          this.resetKeyboardFocusForDestination();
        } else this.mobileDestinationBeforeSettings = destination;
      }
      if (route.projectId === undefined || route.projectId === "") {
        if (updateUrl) this.updateUrl();
        return;
      }
      if (this.routeMatchesCurrentSelection(route)) {
        if (routeSurface.selectedTerminalId !== undefined) this.rememberSelectedTerminal(routeSurface.selectedTerminalId);
        await this.refreshRestoredWorkspaceTool(route.tool, routeSurface.selectedFilePath);
        this.updateGitPolling();
        if (updateUrl) this.updateUrl();
        return;
      }
      const project = this.state.projects.find((p) => p.id === route.projectId);
      if (!project) {
        this.setState({ selectedFilePath: undefined, selectedDiffPath: undefined, selectedTerminalId: undefined });
        if (updateUrl) this.updateUrl();
        return;
      }
      await this.workspaces.selectProject(project, { workspaceId: route.workspaceId, sessionId: route.sessionId, updateUrl: false });
      if (!this.isCurrentRouteRestore(restoreSeq)) return;
      this.setState({ selectedFilePath: routeSurface.selectedFilePath, selectedDiffPath: routeSurface.selectedDiffPath, selectedTerminalId: routeSurface.selectedTerminalId });
      if (routeSurface.selectedTerminalId !== undefined) this.rememberSelectedTerminal(routeSurface.selectedTerminalId);
      await this.refreshRestoredWorkspaceTool(route.tool, routeSurface.selectedFilePath);
      this.updateGitPolling();
      if (updateUrl) this.updateUrl();
    } finally {
      this.routeRestoreDepth = Math.max(0, this.routeRestoreDepth - 1);
      if (this.routeRestoreDepth === 0) this.restoringRouteTerminalId = undefined;
      if (selectedMachineId(this.state) !== machineBeforeRestore) this.schedulePiWebStatusRefresh();
    }
  }

  private isCurrentRouteRestore(restoreSeq: number): boolean {
    return restoreSeq === this.routeRestoreSeq;
  }

  private readWorkspaceRouteSurface(route: AppRoute): WorkspaceRouteSurface {
    if (route.projectId === undefined || route.projectId === "") return emptyWorkspaceRouteSurface();
    return {
      selectedFilePath: readNamespacedString(FILES_ROUTE_NAMESPACE, "file"),
      selectedDiffPath: readNamespacedString(GIT_ROUTE_NAMESPACE, "diff"),
      selectedTerminalId: readNamespacedString(TERMINAL_ROUTE_NAMESPACE, "terminal"),
    };
  }

  private routeForSelectedMachine(route: AppRoute): AppRoute {
    const currentMachineId = this.state.selectedMachine?.id ?? "local";
    if ((route.machineId ?? "local") === currentMachineId) return route;
    return { machineId: currentMachineId, projectId: undefined, workspaceId: undefined, sessionId: undefined, tool: undefined, view: undefined };
  }

  private replaceRouteAndClearWorkspaceQuery(route: AppRoute): void {
    writeRoute(route, { replace: true });
    setNamespacedQueryKey(FILES_ROUTE_NAMESPACE, "file", undefined, { replace: true });
    setNamespacedQueryKey(GIT_ROUTE_NAMESPACE, "diff", undefined, { replace: true });
    setNamespacedQueryKey(TERMINAL_ROUTE_NAMESPACE, "terminal", undefined, { replace: true });
  }

  private shouldDeferRemoteRouteRestore(route: AppRoute, routeMachineHealth = this.state.machineStatuses[route.machineId ?? "local"]): boolean {
    const machineId = route.machineId ?? "local";
    const machine = this.state.selectedMachine;
    if (machineId === "local" || machine?.id !== machineId || machine.kind !== "remote") return false;
    if (routeMachineHealth?.ok !== false) return false;
    if (route.projectId === undefined || route.projectId === "") return this.state.projects.length === 0;
    return this.state.selectedProject?.id !== route.projectId;
  }

  private deferRemoteRouteRestore(route: AppRoute): void {
    this.pendingRemoteRouteRestore = route;
    this.remoteRouteRestoreAttempt = 0;
    this.setRemoteRouteRestoreMessage(route);
    this.schedulePendingRemoteRouteRestore();
  }

  private retryPendingRemoteRouteRestoreSoon(): void {
    if (this.pendingRemoteRouteRestore === undefined) return;
    this.schedulePendingRemoteRouteRestore(0);
  }

  private schedulePendingRemoteRouteRestore(delayMs = remoteRouteRestoreRetryDelay(this.remoteRouteRestoreAttempt)): void {
    if (this.pendingRemoteRouteRestore === undefined) return;
    this.clearPendingRemoteRouteRestoreTimer();
    this.remoteRouteRestoreTimer = window.setTimeout(() => {
      this.remoteRouteRestoreTimer = undefined;
      void this.retryPendingRemoteRouteRestore();
    }, delayMs);
  }

  private async retryPendingRemoteRouteRestore(): Promise<void> {
    if (this.remoteRouteRestoreInProgress) return;
    const route = this.pendingRemoteRouteRestore;
    if (route === undefined) return;
    if (!this.pendingRemoteRouteRestoreStillCurrent(route)) {
      this.clearPendingRemoteRouteRestore();
      return;
    }

    this.remoteRouteRestoreInProgress = true;
    try {
      const machineId = route.machineId ?? "local";
      const health = await this.machines.refreshMachineHealth(machineId);
      if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;
      if (health?.ok !== true) {
        this.scheduleNextRemoteRouteRestoreAttempt(route);
        return;
      }

      await this.machines.refreshMachineRuntime(machineId);
      if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;
      await this.projects.loadProjects();
      if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;
      if (this.state.error !== "") {
        this.scheduleNextRemoteRouteRestoreAttempt(route);
        return;
      }

      await this.withChatScrollTransition(() => this.restoreRouteFor(route, false));
      if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;
      this.clearPendingRemoteRouteRestore();
      this.rememberCurrentMachineNavigation();
      await this.refreshWorkspaceDeletionRuns();
    } finally {
      this.remoteRouteRestoreInProgress = false;
    }
  }

  private scheduleNextRemoteRouteRestoreAttempt(route: AppRoute): void {
    this.remoteRouteRestoreAttempt += 1;
    if (this.remoteRouteRestoreAttempt >= REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS.length) {
      this.setRemoteRouteRestoreMessage(route, { exhausted: true });
      this.clearPendingRemoteRouteRestore();
      return;
    }
    this.setRemoteRouteRestoreMessage(route);
    this.schedulePendingRemoteRouteRestore();
  }

  private setRemoteRouteRestoreMessage(route: AppRoute, options: { exhausted?: boolean } = {}): void {
    const machineId = route.machineId ?? "local";
    const machineName = this.state.machines.find((machine) => machine.id === machineId)?.name ?? this.state.selectedMachine?.name ?? "Remote machine";
    const health = this.state.machineStatuses[machineId];
    const detail = health?.error ?? (this.state.error === "" ? undefined : this.state.error);
    const prefix = options.exhausted === true
      ? `${machineName} is still unavailable.`
      : `${machineName} is unavailable; reconnecting…`;
    this.setState({ error: `${prefix}${detail === undefined ? "" : ` ${detail}`}` });
  }

  private pendingRemoteRouteRestoreStillCurrent(route: AppRoute): boolean {
    const machineId = route.machineId ?? "local";
    return machineId !== "local"
      && this.pendingRemoteRouteRestore === route
      && this.state.selectedMachine?.id === machineId
      && this.state.machines.some((machine) => machine.id === machineId);
  }

  private clearPendingRemoteRouteRestore(): void {
    this.clearPendingRemoteRouteRestoreTimer();
    this.pendingRemoteRouteRestore = undefined;
    this.remoteRouteRestoreAttempt = 0;
  }

  private clearPendingRemoteRouteRestoreTimer(): void {
    if (this.remoteRouteRestoreTimer === undefined) return;
    window.clearTimeout(this.remoteRouteRestoreTimer);
    this.remoteRouteRestoreTimer = undefined;
  }

  private async restoreRouteMachine(route: AppRoute, updateUrl: boolean): Promise<void> {
    const routeMachineId = route.machineId ?? "local";
    if (this.state.selectedMachine?.id === routeMachineId) return;
    const machine = this.state.machines.find((candidate) => candidate.id === routeMachineId);
    if (machine === undefined) return;
    await this.machines.selectMachine(machine, { updateUrl });
  }

  private routeMatchesCurrentSelection(route: AppRoute): boolean {
    return (route.machineId ?? "local") === (this.state.selectedMachine?.id ?? "local")
      && route.workspaceId !== undefined
      && route.workspaceId !== ""
      && this.state.selectedProject?.id === route.projectId
      && this.state.selectedWorkspace?.id === route.workspaceId
      && this.state.selectedSession?.id === route.sessionId;
  }

  private async refreshRestoredWorkspaceTool(tool: QualifiedContributionId | undefined, selectedFilePath: string | undefined): Promise<void> {
    if (tool === "core:workspace.files") await this.files.refreshFiles();
    if (tool === "core:workspace.files" && selectedFilePath !== undefined) await this.files.restoreFile(selectedFilePath);
    if (tool === "core:workspace.git") await this.git.refreshGit();
    else if (this.isModernistCoreWorkbenchVisible()) await this.git.refreshGit();
  }

  private async withChatScrollTransition(action: () => Promise<void>, shouldComplete: () => boolean = () => true) {
    this.chatView?.saveScrollPosition();
    await action();
    if (!shouldComplete()) return;
    await this.updateComplete;
    if (!shouldComplete()) return;
    await this.chatView?.updateComplete;
    if (!shouldComplete()) return;
    await nextFrame();
    if (!shouldComplete()) return;
    this.chatView?.restoreScrollPosition();
    if (this.shouldAutoFocusPrompt()) this.promptEditor?.focusInput();
  }

  private shouldAutoFocusPrompt(): boolean {
    return this.appShell.shouldAutoFocusPrompt();
  }

  private async withChatPrependTransition(action: () => Promise<void>) {
    await action();
    await this.updateComplete;
    await this.chatView?.updateComplete;
  }

  private defaultRouteView(): AppState["mainView"] {
    return this.appShell.defaultRouteView();
  }

  private updateUrl(options?: { replace?: boolean | undefined }) {
    this.rememberCurrentMachineNavigation();
    writeRoute({
      page: this.topLevelPage,
      machineId: this.state.selectedMachine?.id,
      projectId: this.state.selectedProject?.id,
      workspaceId: this.state.selectedWorkspace?.id,
      sessionId: this.state.selectedSession?.id,
      tool: this.state.workspaceTool,
      view: this.state.mainView === "navigation" ? undefined : this.state.mainView,
    }, options);
    this.syncWorkspaceRouteSurfaceToUrl();
  }

  private rememberCurrentMachineNavigation(): void {
    this.machineNavigation.remember(machineNavigationSnapshotFromState(this.state));
  }

  private syncWorkspaceRouteSurfaceToUrl(): void {
    this.writeWorkspaceRouteSurfaceToUrl(machineNavigationSnapshotFromState(this.state).surface);
  }

  private writeMachineNavigationSnapshotToUrl(snapshot: MachineNavigationSnapshot, options?: { replace?: boolean | undefined }): void {
    writeRoute(routeFromMachineNavigationSnapshot(snapshot), options);
    this.writeWorkspaceRouteSurfaceToUrl(snapshot.surface);
  }

  private writeWorkspaceRouteSurfaceToUrl(surface: WorkspaceRouteSurface): void {
    setNamespacedQueryKey(FILES_ROUTE_NAMESPACE, "file", surface.selectedFilePath, { replace: true });
    setNamespacedQueryKey(GIT_ROUTE_NAMESPACE, "diff", surface.selectedDiffPath, { replace: true });
    setNamespacedQueryKey(TERMINAL_ROUTE_NAMESPACE, "terminal", surface.selectedTerminalId, { replace: true });
  }

  private async selectMachineWithMemory(machine: Machine, options: { rememberCurrent?: boolean } = {}): Promise<void> {
    if (this.state.selectedMachine?.id === machine.id) return;
    if (options.rememberCurrent !== false && !this.routeRestoreInProgress) this.rememberCurrentMachineNavigation();
    const seq = ++this.machineNavigationRestoreSeq;
    const snapshot = this.machineNavigation.latest(machine.id) ?? emptyMachineNavigationSnapshot(machine.id);
    await this.restoreRouteFor(routeFromMachineNavigationSnapshot(snapshot), false, snapshot.surface, snapshot.view);
    if (seq !== this.machineNavigationRestoreSeq || this.state.selectedMachine?.id !== machine.id) return;
    if (this.shouldPreserveUnrestoredMachineNavigation(snapshot)) {
      this.machineNavigation.remember(snapshot);
      this.writeMachineNavigationSnapshotToUrl(snapshot);
      return;
    }
    this.updateUrl();
  }

  private shouldPreserveUnrestoredMachineNavigation(snapshot: MachineNavigationSnapshot): boolean {
    return snapshot.projectId !== undefined && this.state.selectedProject?.id !== snapshot.projectId && this.state.error !== "";
  }

  private openWorkspaceTool(tool: QualifiedContributionId) {
    if (this.topLevelPage === "dashboard") this.leaveDashboard("tools");
    if (tool === "core:workspace.terminal") this.terminalAutoStartWorkspaceId = this.state.selectedWorkspace?.id;
    if (this.appShell.isMobileNavigationLayout) {
      this.mobileDestination = "tools";
      this.resetKeyboardFocusForDestination();
    }
    this.setState({ workspaceTool: tool, mainView: tool });
    this.updateUrl();
    this.refreshSelectedWorkspaceTool(tool);
    this.updateGitPolling();
  }

  private openTerminal(options?: { terminalId?: string | undefined }): void {
    if (options?.terminalId !== undefined) this.selectTerminal(options.terminalId, { replace: true });
    this.openWorkspaceTool("core:workspace.terminal");
  }

  private terminalCommandRunsForOrigin(origin: string, machineId = selectedMachineId(this.state)): TerminalCommandRunsInternalRuntime {
    const key = machineScopedKey(machineId, origin);
    const existing = this.terminalCommandRunRuntimes.get(key);
    if (existing !== undefined) return existing;
    const runtime = createTerminalCommandRunsRuntime(origin, {
      api: {
        runTerminalCommand: (runtimeOrigin, input) => terminalsApi.runTerminalCommand(runtimeOrigin, input, machineId),
        listCommandRuns: (filter) => terminalsApi.listCommandRuns(filter, machineId),
        getCommandRun: (runId) => terminalsApi.getCommandRun(runId, machineId),
      },
      openTerminal: (workspace, options) => { void this.openRuntimeTerminal(machineId, workspace, options); },
    });
    this.terminalCommandRunRuntimes.set(key, runtime);
    return runtime;
  }

  private async openRuntimeTerminal(machineId: string, workspace: Workspace | undefined, options?: { terminalId?: string | undefined }): Promise<void> {
    if (selectedMachineId(this.state) !== machineId || (workspace !== undefined && (this.state.selectedWorkspace?.id !== workspace.id || this.state.selectedProject?.id !== workspace.projectId))) {
      if (!this.routeRestoreInProgress) this.rememberCurrentMachineNavigation();
      await this.restoreRouteFor({
        machineId,
        projectId: workspace?.projectId,
        workspaceId: workspace?.id,
        sessionId: undefined,
        tool: "core:workspace.terminal",
        view: "core:workspace.terminal",
      }, false, { selectedTerminalId: options?.terminalId }, "core:workspace.terminal");
      if (selectedMachineId(this.state) !== machineId) {
        this.setState({ error: "Machine not found for terminal command run" });
        return;
      }
    }
    this.openTerminal(options);
  }

  private selectTerminal(terminalId: string | undefined, options?: { replace?: boolean | undefined }): void {
    this.rememberSelectedTerminal(terminalId);
    this.setState({ selectedTerminalId: terminalId });
    this.rememberCurrentMachineNavigation();
    this.writeSelectedTerminalToUrl(terminalId, options);
  }

  private rememberSelectedTerminal(terminalId: string | undefined): void {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return;
    if (terminalId === undefined) this.terminalSelection.forgetWorkspace(this.terminalWorkspaceKey(workspace));
    else this.terminalSelection.rememberTerminal(this.terminalWorkspaceKey(workspace), terminalId);
  }

  private writeSelectedTerminalToUrl(terminalId: string | undefined, options?: { replace?: boolean | undefined }): void {
    setNamespacedQueryKey(TERMINAL_ROUTE_NAMESPACE, "terminal", terminalId, options);
  }

  private terminalWorkspaceKey(workspace: Workspace): string {
    return `${selectedMachineId(this.state)}:${workspace.path}`;
  }

  private selectMainView(view: AppState["mainView"]) {
    if (this.topLevelPage === "dashboard") this.leaveDashboard();
    if (view !== "navigation" && view !== "chat") {
      this.openWorkspaceTool(view);
      return;
    }
    this.setState({ mainView: view });
    this.updateUrl();
    this.updateGitPolling();
  }

  private openDashboard(): void {
    this.invalidateDashboardSessionOpen();
    if (this.topLevelPage === "dashboard") return;
    this.rememberCurrentMachineNavigation();
    this.topLevelPage = "dashboard";
    this.updateUrl();
    void this.dashboard.refresh();
  }

  /** Return to the already-mounted workspace surface without inventing a new session route. */
  private leaveDashboard(destination?: MobileDestination): void {
    if (this.topLevelPage !== "dashboard") return;
    this.invalidateDashboardSessionOpen();
    this.topLevelPage = "workspace";
    if (destination === "chat") this.setState({ mainView: "chat" });
    else if (destination === "sessions") this.setState({ mainView: "navigation" });
    else if (destination === "tools") this.setState({ mainView: this.state.workspaceTool });
    this.updateUrl();
  }

  private dashboardSessionHref(session: LocalSessionDashboardSessionSummary, machineId: string): string {
    const url = new URL(window.location.href);
    for (const key of ["page", "machine", "project", "workspace", "session", "tool", "view"]) url.searchParams.delete(key);
    for (const namespace of [FILES_ROUTE_NAMESPACE, GIT_ROUTE_NAMESPACE, TERMINAL_ROUTE_NAMESPACE]) {
      for (const key of [...url.searchParams.keys()]) {
        if (key.startsWith(`${namespace}--`)) url.searchParams.delete(key);
      }
    }
    if (machineId !== "local") url.searchParams.set("machine", machineId);
    url.searchParams.set("project", session.project.id);
    url.searchParams.set("workspace", session.workspace.id);
    url.searchParams.set("session", session.id);
    url.searchParams.set("view", "chat");
    return `${url.pathname}${url.search}${url.hash}`;
  }

  private async openDashboardSession(session: LocalSessionDashboardSessionSummary, machineId: string): Promise<void> {
    // Do not navigate away from the dashboard until every target identity has restored.
    // Selecting a stale card can mutate workspace/session state, so retain the canonical
    // route/surface first and put it back on any failed target restore.
    const seq = ++this.dashboardSessionOpenSeq;
    const isCurrentOpen = () => this.topLevelPage === "dashboard" && seq === this.dashboardSessionOpenSeq;
    const previous = machineNavigationSnapshotFromState(this.state);
    const route: AppRoute = { machineId, projectId: session.project.id, workspaceId: session.workspace.id, sessionId: session.id, tool: this.state.workspaceTool, view: "chat" };
    try {
      await this.withChatScrollTransition(() => this.restoreRouteFor(route, false), isCurrentOpen);
      if (!isCurrentOpen()) return;
      const selected = this.state;
      const restored = (selected.selectedMachine?.id ?? "local") === machineId
        && selected.selectedProject?.id === session.project.id
        && selected.selectedWorkspace?.id === session.workspace.id
        && selected.selectedSession?.id === session.id;
      if (!restored) throw new Error("That session is no longer available.");
    } catch (error) {
      if (!isCurrentOpen()) return;
      await this.restoreDashboardSelection(previous, isCurrentOpen);
      if (!isCurrentOpen()) return;
      this.dashboard.reportError(`Could not open session: ${errorMessage(error)}`);
      return;
    }
    if (!isCurrentOpen()) return;
    this.topLevelPage = "workspace";
    this.updateUrl();
  }

  private invalidateDashboardSessionOpen(): void {
    this.dashboardSessionOpenSeq += 1;
  }

  private async restoreDashboardSelection(previous: MachineNavigationSnapshot, isCurrent: () => boolean = () => true): Promise<boolean> {
    if (!isCurrent()) return false;
    try {
      await this.withChatScrollTransition(() => this.restoreRouteFor(routeFromMachineNavigationSnapshot(previous), false, previous.surface, previous.view), isCurrent);
    } catch {
      // Keep the action error. There is no safer recovery than the controller's
      // normal route restorer when a previously-selected resource disappeared.
    }
    if (!isCurrent()) return false;
    if (previous.projectId === undefined) {
      if (!isCurrent()) return false;
      this.workspaces.clearSelection({ updateUrl: false });
    } else if (previous.workspaceId === undefined) {
      if (!isCurrent()) return false;
      this.workspaces.clearWorkspaceSelection({ updateUrl: false });
    } else if (previous.sessionId === undefined) {
      if (!isCurrent()) return false;
      this.sessions.deselectSession({ updateUrl: false });
    }
    return isCurrent();
  }

  private async startDashboardSession(workspace: Workspace): Promise<void> {
    this.invalidateDashboardSessionOpen();
    // The chooser has loaded an explicit workspace. Do not use remembered
    // project/workspace/session selection while switching to it.
    const previous = machineNavigationSnapshotFromState(this.state);
    this.setState({ error: "" });
    try {
      const project = this.state.projects.find((candidate) => candidate.id === workspace.projectId);
      if (project === undefined) throw new Error("That project is no longer available.");
      const selected = this.state.selectedProject?.id === project.id
        ? await this.workspaces.selectWorkspace(workspace, { updateUrl: false, selectSession: false })
        : await this.workspaces.selectProject(project, { workspaceId: workspace.id, selectSession: false, updateUrl: false });
      if (!selected || this.state.selectedWorkspace?.id !== workspace.id || this.state.selectedProject?.id !== workspace.projectId) {
        throw new Error(this.state.error || "That workspace is no longer available.");
      }
      const started = await this.sessions.startSession({ updateUrl: false });
      if (!started) throw new Error(this.state.error || "The backend could not create a session.");
    } catch (error) {
      const message = errorMessage(error);
      await this.restoreDashboardSelection(previous);
      // The chooser owns start errors; do not leave a duplicate dashboard-wide
      // alert after rolling the route back.
      this.setState({ error: "" });
      throw new Error(message, { cause: error });
    }
    this.leaveDashboard("chat");
    await this.focusChatComposer();
  }

  private selectMobileDestination(destination: MobileDestination): void {
    // Modernist Settings is a destination over the dashboard, not navigation
    // away from it. Other bottom destinations retain their existing behavior.
    if (this.topLevelPage === "dashboard" && destination !== "settings") this.leaveDashboard(destination === "sessions" ? undefined : destination);
    if (destination === "settings") {
      this.openSettings();
      return;
    }
    // A destination tab is a real navigation choice, not an overlay dismissal.
    // Close Modernist settings before exposing the selected mounted surface.
    if (this.settingsSection !== undefined) this.closeSettings({ restoreFocus: false });
    this.mobileDestination = destination;
    this.resetKeyboardFocusForDestination();
  }

  private mobileDestinationForCurrentSurface(): MobileDestination {
    return mobileDestinationFromMainView(this.state.mainView);
  }

  private ensureMobileDestination(): void {
    if (!this.appShell.isMobileNavigationLayout) return;
    if (this.settingsSection !== undefined) {
      if (this.mobileDestination !== "settings") this.mobileDestinationBeforeSettings ??= this.mobileDestination;
      this.mobileDestination = "settings";
      this.resetKeyboardFocusForDestination();
      return;
    }
    if (this.mobileDestination === "settings") {
      this.mobileDestination = this.mobileDestinationBeforeSettings ?? this.mobileDestinationForCurrentSurface();
      this.mobileDestinationBeforeSettings = undefined;
      this.resetKeyboardFocusForDestination();
    }
  }

  private handleMobileNavigationLayoutChange(isMobile: boolean): void {
    if (isMobile) {
      if (this.settingsSection !== undefined) {
        this.mobileDestinationBeforeSettings = this.mobileDestinationForCurrentSurface();
        this.mobileDestination = "settings";
        this.resetKeyboardFocusForDestination();
        return;
      }
      this.mobileDestination = this.mobileDestinationForCurrentSurface();
      this.resetKeyboardFocusForDestination();
      return;
    }

    this.resetKeyboardFocusForDestination();
    // Settings is a URL-backed dialog rather than a desktop main view.
    if (this.settingsSection !== undefined) return;
    const mainView = this.mainViewForMobileDestination();
    if (mainView === this.state.mainView) return;
    this.setState({ mainView });
    this.updateUrl({ replace: true });
    this.updateGitPolling();
  }

  private mainViewForMobileDestination(): AppState["mainView"] {
    if (this.mobileDestination === "sessions") return "navigation";
    if (this.mobileDestination === "tools") return this.state.workspaceTool;
    return "chat";
  }

  private openSettings(section?: SettingsSection): void {
    const resolvedSection = section ?? (this.isModernistSettingsDestination() ? "sessiond" : "general");
    // The legacy modal keeps its existing dashboard-to-workspace handoff.
    if (this.topLevelPage === "dashboard" && !this.isModernistSettingsDestination()) this.leaveDashboard();
    this.settingsFocusReturnTarget = deepActiveElement(this.renderRoot);
    this.reconcileSettingsRoute(resolvedSection, { focusDialog: !this.isModernistSettingsDestination() });
    writeSettingsSection(resolvedSection);
  }

  private closeSettings(options: { restoreFocus?: boolean } = {}): void {
    const restoreFocus = options.restoreFocus !== false;
    this.reconcileSettingsRoute(undefined, { restoreFocus });
    if (!restoreFocus) this.settingsFocusReturnTarget = undefined;
    writeSettingsSection(undefined);
  }

  private navigateSettings(section: SettingsSection): void {
    this.reconcileSettingsRoute(section);
    writeSettingsSection(section);
  }

  private restoreSettingsRoute(): void {
    this.reconcileSettingsRoute(readSettingsSection(), { restoreFocus: this.settingsSection !== undefined && readSettingsSection() === undefined });
  }

  /** Keeps the URL-backed dialog and the independent mobile destination in one state transition. */
  private reconcileSettingsRoute(section: SettingsSection | undefined, options: { focusDialog?: boolean; restoreFocus?: boolean } = {}): void {
    const wasOpen = this.settingsSection !== undefined;
    this.settingsSection = section;
    if (this.appShell.isMobileNavigationLayout) {
      if (section !== undefined) {
        if (this.mobileDestination !== "settings") this.mobileDestinationBeforeSettings = this.mobileDestination;
        else this.mobileDestinationBeforeSettings ??= this.mobileDestinationForCurrentSurface();
        this.mobileDestination = "settings";
      } else if (wasOpen || this.mobileDestination === "settings") {
        this.mobileDestination = this.mobileDestinationBeforeSettings ?? this.mobileDestinationForCurrentSurface();
        this.mobileDestinationBeforeSettings = undefined;
      }
    }
    this.resetKeyboardFocusForDestination();
    if (section !== undefined && options.focusDialog === true) {
      void this.updateComplete.then(() => { this.settingsDialog?.focusInitialControl(); });
    }
    if (section === undefined && options.restoreFocus === true) this.restoreSettingsFocus();
  }

  private isModernistSettingsDestination(): boolean {
    return this.activeThemeId.startsWith("themes:modernist-");
  }

  private isModernistDesktopComposition(): boolean {
    return this.isModernistSettingsDestination()
      && !this.appShell.isMobileNavigationLayout
      && this.isDesktopSideBySideLayout();
  }

  private modernistGlobalDestination(): ModernistGlobalDestination | undefined {
    if (this.settingsSection !== undefined) return "settings";
    if (this.topLevelPage === "dashboard") return "dashboard";
    if (this.state.mainView !== "chat" && this.state.mainView !== "navigation") return "tools";
    return this.state.mainView === "chat" ? "chat" : undefined;
  }

  private selectModernistGlobalDestination(destination: ModernistGlobalDestination): void {
    if (destination === "settings") {
      this.openSettings();
      return;
    }
    // A global destination replaces Settings rather than dismissing it back to
    // its old opener; the new destination owns any subsequent focus.
    if (this.settingsSection !== undefined) this.closeSettings({ restoreFocus: false });
    if (destination === "dashboard") {
      this.openDashboard();
      return;
    }
    if (destination === "actions") {
      this.setState({ actionPaletteOpen: true });
      return;
    }
    if (destination === "chat") {
      this.selectMainView("chat");
      return;
    }
    this.selectMainView(this.state.workspaceTool);
  }

  private renderModernistGlobalHeader() {
    if (!this.isModernistDesktopComposition()) return null;
    return html`<modernist-global-header
      .activeDestination=${this.modernistGlobalDestination()}
      .refreshControl=${this.appShell.shouldShowAppRefreshInHeader() ? this.renderAppRefresh() : undefined}
      .activeCount=${this.activeSessionCount()}
      .onSelect=${(destination: ModernistGlobalDestination) => { this.selectModernistGlobalDestination(destination); }}
      .onToggleTheme=${this.handleToggleThemeAppearance}
      .onConfigureAuth=${() => { void this.auth.openLogin(); }}
      .onRemoveAuth=${() => { void this.auth.openLogout(); }}
    ></modernist-global-header>`;
  }

  private activeSessionCount(): number {
    const statuses = this.state.sessionStatuses;
    const activities = this.state.sessionActivities;
    let count = 0;
    for (const id of Object.keys(statuses)) {
      if (isSessionActive(statuses[id], activities[id])) count += 1;
    }
    return count;
  }

  private restoreSettingsFocus(): void {
    const target = this.settingsFocusReturnTarget;
    this.settingsFocusReturnTarget = undefined;
    void this.updateComplete.then(() => {
      if (target?.isConnected === true && isFocusableElement(target)) {
        target.focus();
        return;
      }
      if (this.appShell.isMobileNavigationLayout) {
        this.mobileDestinationTabs?.focusSelected();
        return;
      }
      this.mainContent?.focus();
    });
  }

  private handleWorkspaceChange(previous: AppState, next: AppState) {
    if (previous.selectedWorkspace?.id === next.selectedWorkspace?.id) return;
    this.terminalAutoStartWorkspaceId = undefined;
    this.activeTerminalIds.clear();
    const selectedTerminalId = this.routeRestoreInProgress ? this.restoringRouteTerminalId : next.selectedWorkspace === undefined ? undefined : this.terminalSelection.latestTerminalId(this.terminalWorkspaceKey(next.selectedWorkspace));
    this.setState({ activeTerminalCount: 0, selectedTerminalId });
    if (!this.routeRestoreInProgress) {
      this.rememberCurrentMachineNavigation();
      this.writeSelectedTerminalToUrl(selectedTerminalId, { replace: true });
    }
    if (next.selectedWorkspace === undefined) return;
    void this.refreshActiveTerminals(next.selectedWorkspace);
    void this.refreshWorkspaceDeletionRuns();
    this.refreshSelectedWorkspaceTool(next.workspaceTool);
    this.updateGitPolling();
  }

  private connectRealtime(): void {
    const machineId = selectedMachineId(this.state);
    this.realtime.connect(
      (event) => { this.handleRealtimeEvent(event); },
      () => {
        const workspace = this.state.selectedWorkspace;
        if (workspace !== undefined) void this.refreshActiveTerminals(workspace);
        void this.refreshWorkspaceActivity(machineId);
        if (this.topLevelPage === "dashboard") this.dashboard.scheduleRefresh();
      },
      machineId,
    );
  }

  private syncMachineActivitySubscriptions(): void {
    const desiredMachineIds = this.machineActivitySubscriptionIds();
    for (const [machineId, socket] of this.machineRealtimeSockets.entries()) {
      if (desiredMachineIds.has(machineId)) continue;
      socket.close();
      this.machineRealtimeSockets.delete(machineId);
    }
    for (const machineId of desiredMachineIds) {
      if (this.machineRealtimeSockets.has(machineId)) continue;
      const socket = new RealtimeSocket();
      socket.connect(
        (event) => { this.handleMachineActivityEvent(machineId, event); },
        () => {
          void this.refreshWorkspaceActivity(machineId);
          if (this.topLevelPage === "dashboard") this.dashboard.scheduleRefresh();
        },
        machineId,
      );
      this.machineRealtimeSockets.set(machineId, socket);
    }
  }

  private closeMachineActivitySockets(): void {
    for (const socket of this.machineRealtimeSockets.values()) socket.close();
    this.machineRealtimeSockets.clear();
  }

  private machineActivitySubscriptionIds(): Set<string> {
    const selected = selectedMachineId(this.state);
    return new Set(this.state.machines
      .filter((machine) => machine.id !== selected)
      .filter((machine) => shouldSubscribeToMachineActivity(machine, this.state.machineStatuses[machine.id]))
      .map((machine) => machine.id));
  }

  private handleMachineActivityEvent(machineId: string, event: BrowserRealtimeEvent): void {
    if (event.type === "workspace.activity") this.activity.applyWorkspaceActivity(event.activity, machineId);
    if (this.topLevelPage === "dashboard") this.dashboard.applyRealtimeEvent(machineId, event);
  }

  private handleRealtimeEvent(event: BrowserRealtimeEvent): void {
    if (this.topLevelPage === "dashboard") this.dashboard.applyRealtimeEvent(selectedMachineId(this.state), event);
    if (event.type === "workspace.activity") this.activity.applyWorkspaceActivity(event.activity);
    else if (isTerminalEvent(event)) {
      this.applyTerminalEvent(event);
      if (event.type === "terminal.exited") void this.refreshWorkspaceDeletionRuns();
    } else if (event.type !== "session.attention") this.sessions.applyGlobalEvent(event);
  }

  private applyTerminalEvent(event: TerminalUiEvent): void {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return;
    const cwd = event.type === "terminal.closed" ? event.cwd : event.terminal.cwd;
    if (cwd !== workspace.path) return;
    if (event.type === "terminal.created" && !event.terminal.exited) this.activeTerminalIds.add(event.terminal.id);
    else this.activeTerminalIds.delete(event.type === "terminal.closed" ? event.terminalId : event.terminal.id);
    if (event.type === "terminal.closed") {
      this.terminalSelection.forgetTerminal(event.terminalId);
      if (this.state.selectedTerminalId === event.terminalId) this.selectTerminal(undefined, { replace: true });
    }
    this.setState({ activeTerminalCount: this.activeTerminalIds.size });
  }

  private async refreshActiveTerminals(workspace: Workspace): Promise<void> {
    const machineId = selectedMachineId(this.state);
    try {
      const terminals = await terminalsApi.terminals(workspace.projectId, workspace.id, machineId);
      if (selectedMachineId(this.state) !== machineId || this.state.selectedWorkspace?.id !== workspace.id) return;
      this.activeTerminalIds.clear();
      for (const terminal of terminals) {
        if (!terminal.exited) this.activeTerminalIds.add(terminal.id);
      }
      this.setState({ activeTerminalCount: this.activeTerminalIds.size });
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  private handleActivityTransition(previous: AppState, next: AppState) {
    const wasActive = isActive(previous);
    const nowActive = isActive(next);
    if (wasActive && !nowActive) {
      this.setState({ fileTreeStale: true, gitStale: true });
      this.refreshSelectedWorkspaceTool(this.state.workspaceTool);
    }
  }

  private handleMachineChange(previous: AppState, next: AppState): void {
    if ((previous.selectedMachine?.id ?? "local") === (next.selectedMachine?.id ?? "local")) return;
    this.projectActivityOwnership.handleSelectedMachineChanged();
    const pendingMachineId = this.pendingRemoteRouteRestore?.machineId ?? "local";
    if (pendingMachineId !== (next.selectedMachine?.id ?? "local")) this.clearPendingRemoteRouteRestore();
    this.sessions.clearActiveSession();
    this.realtime.close();
    this.connectRealtime();
    this.activeTerminalIds.clear();
    this.sessionCleanupDialog = undefined;
    this.setState({ piWebStatus: undefined });
    this.updateGitPolling();
    void this.loadPluginsForSelectedMachine();
  }

  private refreshSelectedWorkspaceTool(tool: QualifiedContributionId): void {
    if (tool === "core:workspace.files") void this.files.refreshFiles();
    if (tool === "core:workspace.git") void this.git.refreshGit();
    else if (this.isModernistCoreWorkbenchVisible()) void this.git.refreshGit();
  }

  /** The Modernist workbench keeps Git status visible beside every core tool. */
  private updateGitPolling(): void {
    this.git.updatePolling({ workbenchGitVisible: this.isModernistCoreWorkbenchVisible() });
  }

  private isModernistWorkbenchExpanded(): boolean {
    return this.topLevelPage === "workspace"
      && this.activeThemeId.startsWith("themes:modernist-")
      && this.state.mainView !== "chat"
      && this.state.mainView !== "navigation";
  }

  private isModernistCoreWorkbenchVisible(): boolean {
    return this.isModernistWorkbenchExpanded()
      && this.state.selectedWorkspace !== undefined
      && isCoreWorkspacePanelId(this.state.workspaceTool);
  }

  private renderWorkspacePanel() {
    const workspace = this.state.selectedWorkspace;
    const panelContext = workspace === undefined ? undefined : this.createWorkspacePanelContext(workspace);
    const emptyState = workspace === undefined ? this.workspacePanelEmptyState() : undefined;
    return html`
      <workspace-panel
        id="workspace-panel"
        .workspace=${workspace}
        .panelContext=${panelContext}
        .emptyState=${emptyState}
        .tool=${this.state.workspaceTool}
        .panels=${this.visibleWorkspacePanels()}
        .mobileTools=${this.appShell.isMobileNavigationLayout}
        .presentation=${this.workspaceToolsPresentation()}
        .onSelectTool=${(tool: QualifiedContributionId) => { this.openWorkspaceTool(tool); }}
      ></workspace-panel>
    `;
  }

  private workspaceToolsPresentation(): "legacy" | "modernist-desktop" | "modernist-tablet" | "modernist-mobile" {
    // Keep the existing compact sidecar when Chat owns the main surface; the
    // workbench only replaces the shell while an active workspace tool owns it.
    if (!this.isModernistWorkbenchExpanded()) return "legacy";
    if (this.appShell.isMobileNavigationLayout) return "modernist-mobile";
    return this.isDesktopSideBySideLayout() ? "modernist-desktop" : "modernist-tablet";
  }

  private renderNavigationPanelEdgeControl() {
    const constraints = this.resizablePanelConstraints("navigation");
    return html`
      <app-panel-edge-control
        side="navigation"
        controls="navigation-panel"
        resizeLabel="Resize navigation panel"
        expandLabel="Expand navigation panel"
        collapseLabel="Collapse navigation panel"
        .collapsed=${this.panelCollapse.navigationPanelCollapsed}
        .resizable=${!this.appShell.isMobileNavigationLayout}
        .panelWidth=${this.panelResize.panelWidth("navigation", undefined, constraints)}
        .minWidth=${constraints.minWidth}
        .maxWidth=${constraints.maxWidth}
        .onToggle=${() => { this.panelCollapse.toggleNavigationPanel(); }}
        .onResizeStart=${() => this.startPanelResize("navigation")}
        .onResize=${(width: number) => { this.panelResize.resizePanel("navigation", width, { persist: false }); }}
        .onResizeEnd=${() => { this.panelResize.persistPanelSizes(); }}
        .onReset=${() => { this.resetResizablePanel("navigation"); }}
      ></app-panel-edge-control>
    `;
  }

  private renderWorkspacePanelEdgeControl() {
    if (this.isModernistWorkbenchExpanded() || this.isModernistDesktopComposition()) return null;
    const constraints = this.resizablePanelConstraints("workspace");
    return html`
      <app-panel-edge-control
        side="workspace"
        controls="workspace-panel"
        resizeLabel="Resize workspace panel"
        expandLabel="Expand workspace panel"
        collapseLabel="Collapse workspace panel"
        .collapsed=${this.panelCollapse.workspacePanelCollapsed}
        .resizable=${!this.appShell.isMobileNavigationLayout}
        .panelWidth=${this.panelResize.panelWidth("workspace", undefined, constraints)}
        .minWidth=${constraints.minWidth}
        .maxWidth=${constraints.maxWidth}
        .onToggle=${() => { this.panelCollapse.toggleWorkspacePanel(); }}
        .onResizeStart=${() => this.startPanelResize("workspace")}
        .onResize=${(width: number) => { this.panelResize.resizePanel("workspace", width, { persist: false }); }}
        .onResizeEnd=${() => { this.panelResize.persistPanelSizes(); }}
        .onReset=${() => { this.resetResizablePanel("workspace"); }}
      ></app-panel-edge-control>
    `;
  }

  private startPanelResize(side: ResizablePanelSide): number {
    if (side === "navigation") this.panelCollapse.expandNavigationPanel();
    else this.panelCollapse.expandWorkspacePanel();
    return this.measuredPanelWidth(side) ?? this.panelResize.panelWidth(side, undefined, this.resizablePanelConstraints(side));
  }

  private resizablePanelConstraints(side: ResizablePanelSide): PanelResizeConstraints {
    const constraints = this.effectivePanelResizeConstraints(side);
    return {
      ...constraints,
      maxWidth: this.resizablePanelMaxWidth(side, constraints),
    };
  }

  private effectivePanelResizeConstraints(side: ResizablePanelSide): PanelResizeConstraints {
    return this.panelResize.constraints(side, side === "navigation" && this.activeThemeId.startsWith("themes:modernist-")
      ? { defaultWidth: MODERNIST_NAVIGATION_PANEL_DEFAULT_WIDTH }
      : {});
  }

  private resizablePanelMaxWidth(side: ResizablePanelSide, constraints: PanelResizeConstraints): number {
    const shellWidth = this.getBoundingClientRect().width || (typeof window === "undefined" ? 0 : window.innerWidth);
    if (shellWidth <= 0) return constraints.maxWidth;

    const otherPanelWidth = this.oppositeResizablePanelWidth(side);
    const maxWidth = Math.floor(shellWidth - otherPanelWidth - PANEL_EDGE_COLUMNS_WIDTH_PX - MIN_RESIZABLE_CHAT_WIDTH_PX);
    return Math.max(constraints.minWidth, Math.min(constraints.maxWidth, maxWidth));
  }

  private oppositeResizablePanelWidth(side: ResizablePanelSide): number {
    const otherSide: ResizablePanelSide = side === "navigation" ? "workspace" : "navigation";
    if (this.isResizablePanelCollapsedOrStacked(otherSide)) return 0;
    return this.measuredPanelWidth(otherSide) ?? this.panelResize.panelWidth(otherSide, undefined, this.effectivePanelResizeConstraints(otherSide));
  }

  private isResizablePanelCollapsedOrStacked(side: ResizablePanelSide): boolean {
    if (side === "navigation") return this.panelCollapse.navigationPanelCollapsed;
    return this.panelCollapse.workspacePanelCollapsed || !this.isDesktopSideBySideLayout();
  }

  private isDesktopSideBySideLayout(): boolean {
    return this.desktopSideBySideMedia?.matches ?? true;
  }

  private measuredPanelWidth(side: ResizablePanelSide): number | undefined {
    const element = side === "navigation" ? this.navigationPanelFrame : this.workspacePanelFrame;
    const width = element?.getBoundingClientRect().width;
    return width === undefined || width <= 0 ? undefined : width;
  }

  private resetResizablePanel(side: ResizablePanelSide): void {
    this.panelResize.resetPanel(side);
  }

  private resetResizablePanels(): void {
    this.panelResize.resetPanels();
  }

  private canDeleteArchivedSessions(): boolean {
    const runtime = this.selectedMachineRuntime();
    // COMPAT-CAP sessions.deleteArchived: older federated machines may support
    // the legacy DELETE route without advertising runtime capabilities. Only
    // block when capability discovery succeeds and reports no support.
    return runtime?.ok !== true || supportsPiWebCapability(runtime, PI_WEB_CAPABILITIES.sessionsDeleteArchived);
  }

  private canReloadSessions(): boolean {
    const runtime = this.selectedMachineRuntime();
    return runtime?.ok === true && supportsPiWebCapability(runtime, PI_WEB_CAPABILITIES.sessionsReload);
  }

  private canRenameSessions(machineId = selectedMachineId(this.state)): boolean {
    const runtime = this.state.machineRuntimes[machineId];
    return runtime?.ok === true && supportsPiWebCapability(runtime, PI_WEB_CAPABILITIES.sessionsRename);
  }

  private renameUnavailableMessage(machineId = selectedMachineId(this.state)): string {
    const machine = this.state.machines.find((candidate) => candidate.id === machineId);
    return `Update and restart Pi-Web on ${machine?.name ?? "this machine"} to rename sessions.`;
  }

  private openSessionRenameDialog(session: Pick<SessionInfo, "id" | "cwd" | "name">, machineId: string, opener?: HTMLElement, capabilityVerified = false): void {
    if (!capabilityVerified && !this.canRenameSessions(machineId)) return;
    const machine = this.state.machines.find((candidate) => candidate.id === machineId);
    this.sessionRenameTarget = { machineId, sessionId: session.id, cwd: session.cwd, ...(session.name === undefined ? {} : { oldName: session.name }), ...(machineId === "local" || machine?.updatedAt === undefined ? {} : { machineRevision: machine.updatedAt }), ...(capabilityVerified ? { capabilityVerified: true } : {}), ...(opener === undefined ? {} : { opener }) };
    this.sessionRenameSaving = false;
    this.sessionRenameError = "";
  }

  private closeSessionRenameDialog(): void {
    const opener = this.sessionRenameTarget?.opener;
    this.sessionRenameTarget = undefined;
    this.sessionRenameSaving = false;
    this.sessionRenameError = "";
    void this.updateComplete.then(() => { if (opener?.isConnected === true) opener.focus(); });
  }

  private async submitSessionRename(name: string | null): Promise<void> {
    const target = this.sessionRenameTarget;
    if (target === undefined || this.sessionRenameSaving) return;
    const machine = this.state.machines.find((candidate) => candidate.id === target.machineId);
    if ((target.capabilityVerified !== true && !this.canRenameSessions(target.machineId)) || (target.machineId !== "local" && machine?.updatedAt !== target.machineRevision)) {
      // Keep the modal and its original title intact. A remote target can
      // change between opening it and saving; silently closing loses both the
      // user's draft and the clear reason the write was not attempted.
      this.sessionRenameSaving = false;
      this.sessionRenameError = "This machine changed. Reopen Rename and try again.";
      return;
    }
    this.sessionRenameSaving = true;
    this.sessionRenameError = "";
    try {
      const response = await sessionsApi.rename({ id: target.sessionId, cwd: target.cwd }, name, target.machineId, target.machineRevision);
      const currentMachine = this.state.machines.find((candidate) => candidate.id === target.machineId);
      if (this.sessionRenameTarget !== target) return;
      if (target.machineId !== "local" && currentMachine?.updatedAt !== target.machineRevision) {
        this.sessionRenameSaving = false;
        this.sessionRenameError = "This machine changed. Reopen Rename and try again.";
        return;
      }
      if (selectedMachineId(this.state) === target.machineId) this.sessions.applySessionName(response.sessionId, response.name);
      this.dashboard.applySessionName(target.machineId, response.sessionId, response.name);
      this.closeSessionRenameDialog();
    } catch (error) {
      if (this.sessionRenameTarget !== target) return;
      this.sessionRenameSaving = false;
      this.sessionRenameError = renameErrorMessage(error);
    }
  }

  private canClearServerQueue(): boolean {
    const runtime = this.selectedMachineRuntime();
    return runtime?.ok === true && supportsPiWebCapability(runtime, PI_WEB_CAPABILITIES.sessionsClearQueue);
  }

  private canStopActiveWork(status = this.state.status): boolean {
    return status?.isStreaming === true
      || status?.isBashRunning === true
      || status?.isCompacting === true
      // Abort is the compatible fallback for a server queue when the optional
      // queue-clear capability has not been advertised by that runtime.
      || (status?.pendingMessageCount ?? 0) > 0;
  }

  private stopClearsServerQueue(status = this.state.status): boolean {
    return this.canStopActiveWork(status) && (status?.pendingMessageCount ?? 0) > 0;
  }

  private canCleanupSessions(): boolean {
    const runtime = this.selectedMachineRuntime();
    return runtime?.ok === true && supportsPiWebCapability(runtime, PI_WEB_CAPABILITIES.sessionsCleanup);
  }

  private hasAuthoritativeSessionPersistence(): boolean {
    return runtimeHasAuthoritativeSessionPersistence(this.selectedMachineRuntime());
  }

  private supportsWorkspaceFileSuggestions(machineId = selectedMachineId(this.state)): boolean {
    if (machineId === "local") return true;
    // COMPAT-CAP workspace.fileSuggestions: remote machines without this
    // capability stay on the legacy cwd-based /files route.
    const runtime = this.state.machineRuntimes[machineId];
    return runtime?.ok === true && supportsPiWebCapability(runtime, PI_WEB_CAPABILITIES.workspaceFileSuggestions);
  }

  private archivedDeleteUnavailableMessage(): string {
    const machineName = this.state.selectedMachine?.name ?? "this machine";
    return `Update and restart Pi-Web on ${machineName} to delete archived sessions.`;
  }

  private sessionCleanupUnavailableMessage(): string {
    return sessionCleanupUnavailableMessage(this.state.selectedMachine?.name);
  }

  private selectedMachineRuntime() {
    return this.state.machineRuntimes[selectedMachineId(this.state)];
  }

  private openSessionCleanupDialog(): void {
    this.sessionCleanupDialog = { error: "" };
  }

  private closeSessionCleanupDialog(): void {
    this.sessionCleanupDialog = undefined;
  }

  private async previewSessionCleanup(request: SessionCleanupRequest): Promise<void> {
    if (!this.canCleanupSessions()) {
      this.sessionCleanupDialog = { ...(this.sessionCleanupDialog ?? {}), error: this.sessionCleanupUnavailableMessage(), preview: undefined, previewRequest: undefined, result: undefined, loading: false };
      return;
    }
    const machineId = selectedMachineId(this.state);
    this.sessionCleanupDialog = { ...(this.sessionCleanupDialog ?? {}), loading: true, error: "", preview: undefined, previewRequest: undefined, result: undefined };
    try {
      const preview = await sessionsApi.cleanupPreview(request, machineId);
      if (selectedMachineId(this.state) !== machineId) return;
      this.sessionCleanupDialog = { ...this.sessionCleanupDialog, preview, previewRequest: request, result: undefined, loading: false, error: "" };
    } catch (error) {
      if (selectedMachineId(this.state) === machineId) this.sessionCleanupDialog = { ...this.sessionCleanupDialog, loading: false, error: `Failed to preview cleanup: ${errorMessage(error)}` };
    }
  }

  private async runSessionCleanup(request: SessionCleanupRequest): Promise<void> {
    const dialog = this.sessionCleanupDialog;
    if (dialog?.preview === undefined || sessionCleanupRequestKey(dialog.previewRequest) !== sessionCleanupRequestKey(request)) {
      this.sessionCleanupDialog = { ...(dialog ?? {}), error: "Preview cleanup before running it." };
      return;
    }
    if (!this.canCleanupSessions()) {
      this.sessionCleanupDialog = { ...dialog, error: this.sessionCleanupUnavailableMessage(), running: false };
      return;
    }
    const machineId = selectedMachineId(this.state);
    this.sessionCleanupDialog = { ...dialog, running: true, error: "" };
    try {
      const result = await sessionsApi.cleanup(request, machineId);
      if (selectedMachineId(this.state) !== machineId) return;
      this.sessionCleanupDialog = { ...this.sessionCleanupDialog, preview: result, previewRequest: request, result, running: false, error: "" };
      await this.sessions.applySessionCleanupResult(result, machineId);
    } catch (error) {
      if (selectedMachineId(this.state) === machineId) this.sessionCleanupDialog = { ...this.sessionCleanupDialog, running: false, error: `Failed to run cleanup: ${errorMessage(error)}` };
    }
  }

  private renderNavigationPanel() {
    return html`
      <app-navigation-panel
        .machines=${this.state.machines}
        .selectedMachine=${this.state.selectedMachine}
        .machineStatuses=${this.state.machineStatuses}
        .machineActivities=${this.state.machineActivities}
        .machinesCollapsed=${this.navigationSections.isCollapsed("machines")}
        .onToggleMachines=${() => { this.navigationSections.toggle("machines"); }}
        .onSelectMachine=${(machine: Machine) => this.selectNavigationItem("machines", "projects", () => this.selectMachineWithMemory(machine), () => this.state.selectedMachine?.id === machine.id)}
        .onRemoveMachine=${(machine: Machine) => { void this.removeMachine(machine); }}
        .projects=${this.state.projects}
        .selectedProject=${this.state.selectedProject}
        .workspaceActivities=${this.state.workspaceActivities}
        .workspacesByProjectId=${this.state.workspacesByProjectId}
        .workspaces=${this.state.workspaces}
        .selectedWorkspace=${this.state.selectedWorkspace}
        .deletingWorkspaceIds=${pendingWorkspaceDeletionIds(this.state.workspaceDeletionRuns)}
        .sessions=${this.state.sessions}
        .sessionStatuses=${this.state.sessionStatuses}
        .sessionActivities=${this.state.sessionActivities}
        .sendingPrompts=${this.state.sendingPrompts}
        .selectedSession=${this.state.selectedSession}
        .startingSessionCount=${this.state.startingSessionCount}
        .canStartSession=${!!this.state.selectedWorkspace}
        .canDeleteArchivedSessions=${this.canDeleteArchivedSessions()}
        .canReloadSessions=${this.canReloadSessions()}
        .canCleanupSessions=${this.canCleanupSessions()}
        .canRenameSessions=${this.canRenameSessions()}
        .authoritativeSessionPersistence=${this.hasAuthoritativeSessionPersistence()}
        .dashboardActive=${this.topLevelPage === "dashboard"}
        .onOpenDashboard=${() => { this.openDashboard(); }}
        .archivedDeleteUnavailableMessage=${this.archivedDeleteUnavailableMessage()}
        .cleanupUnavailableMessage=${this.sessionCleanupUnavailableMessage()}
        .renameUnavailableMessage=${this.renameUnavailableMessage()}
        .collapsible=${true}
        .compact=${this.appShell.isMobileNavigationLayout}
        .hierarchy=${this.isModernistDesktopComposition()}
        .projectsCollapsed=${this.navigationSections.isCollapsed("projects")}
        .workspacesCollapsed=${this.navigationSections.isCollapsed("workspaces")}
        .sessionsCollapsed=${this.navigationSections.isCollapsed("sessions")}
        .workspaceLabelItems=${(workspace: Workspace) => this.workspaceLabelItems(workspace)}
        .refreshControl=${this.appShell.shouldShowAppRefreshInHeader() ? this.renderAppRefresh() : undefined}
        .onShowActions=${() => { this.setState({ actionPaletteOpen: true }); }}
        .onToggleProjects=${() => { this.navigationSections.toggle("projects"); }}
        .onToggleWorkspaces=${() => { this.navigationSections.toggle("workspaces"); }}
        .onToggleSessions=${() => { this.navigationSections.toggle("sessions"); }}
        .onSelectProject=${(project: Project) => this.selectNavigationItem("projects", "workspaces", () => this.workspaces.selectProject(project, { updateUrl: false }).then(() => undefined), () => this.state.selectedProject?.id === project.id && !this.state.isLoadingWorkspaces)}
        .onCloseProject=${(project: Project) => this.projects.closeProject(project.id)}
        .onSelectWorkspace=${(workspace: Workspace) => this.selectNavigationItem("workspaces", "sessions", () => this.workspaces.selectWorkspace(workspace, { updateUrl: false }).then(() => undefined), () => this.state.selectedWorkspace?.id === workspace.id)}
        .onDeleteWorkspace=${(workspace: Workspace) => { void this.deleteWorkspace(workspace); }}
        .onArchivedCollapsed=${() => { this.sessions.clearSelectionAfterArchivedCollapse(); }}
        .onStartSession=${() => this.startSessionFromNavigation()}
        .onSelectSession=${(session: SessionInfo) => this.selectNavigationItem("sessions", "chat", () => this.sessions.selectSession(session, { updateUrl: false }), () => this.state.selectedSession?.id === session.id)}
        .onArchiveSession=${(session: SessionInfo) => this.sessions.archiveSession(session)}
        .onArchiveSessionWithDescendants=${(session: SessionInfo) => this.sessions.archiveSessionWithDescendants(session)}
        .onArchiveSessions=${(sessions: SessionInfo[]) => this.sessions.archiveSessions(sessions)}
        .onRestoreSession=${(session: SessionInfo) => this.selectNavigationItem("sessions", "chat", () => this.sessions.restoreSession(session))}
        .onDeleteCachedNewSession=${(session: SessionInfo) => this.sessions.deleteCachedNewSession(session)}
        .onDeleteArchivedSession=${(session: SessionInfo) => this.sessions.deleteArchivedSessions([session])}
        .onDeleteArchivedSessions=${(sessions: SessionInfo[]) => this.sessions.deleteArchivedSessions(sessions)}
        .onDetachParentSession=${(session: SessionInfo) => this.sessions.detachParent(session)}
        .onReloadSession=${(session: SessionInfo) => this.sessions.reloadSession(session)}
        .onCleanupSessions=${() => { this.openSessionCleanupDialog(); }}
        .onRenameSession=${(session: SessionInfo, opener: HTMLElement) => { this.openSessionRenameDialog(session, selectedMachineId(this.state), opener); }}
        .onFocusNavigationTarget=${(target: NavigationFocusTarget) => { void this.focusNavigationTarget(target); }}
        .onCancelKeyboardNavigation=${() => { void this.focusChatComposer(); }}
      ></app-navigation-panel>
    `;
  }

  private openNavigationSection(section: NavigationSection): void {
    this.navigationSections.open(section, () => {
      if (this.appShell.isMobileNavigationLayout) this.selectMobileDestination("sessions");
      else this.selectMainView("navigation");
    });
  }

  private async selectNavigationItem(section: NavigationSection, nextTarget: NavigationFocusTarget, action: () => Promise<void>, didSelect: () => boolean = () => true): Promise<void> {
    const seq = ++this.navigationSelectionSeq;
    const isCurrentSelection = () => seq === this.navigationSelectionSeq;
    const dashboardWasVisible = this.topLevelPage === "dashboard";
    const previous = dashboardWasVisible ? machineNavigationSnapshotFromState(this.state) : undefined;
    if (dashboardWasVisible) {
      // A navigation-panel selection is a competing way to leave the dashboard.
      this.invalidateDashboardSessionOpen();
      this.setState({ error: "" });
    }

    let failure: unknown;
    try {
      await this.withChatScrollTransition(async () => {
        this.navigationSections.advanceAfterSelection(section);
        await action();
      }, isCurrentSelection);
    } catch (error) {
      failure = error;
    }

    if (!isCurrentSelection()) return;
    if (dashboardWasVisible && (failure !== undefined || this.state.error !== "" || !didSelect())) {
      const message = errorMessage(failure ?? (this.state.error || "The selection could not be changed."));
      if (previous !== undefined) await this.restoreDashboardSelection(previous, isCurrentSelection);
      if (!isCurrentSelection()) return;
      this.setState({ error: message });
      return;
    }
    if (failure !== undefined) throw asError(failure);
    if (dashboardWasVisible) {
      const destination: MobileDestination = nextTarget === "chat" ? "chat" : "sessions";
      this.leaveDashboard(destination);
      if (this.appShell.isMobileNavigationLayout) {
        this.mobileDestination = destination;
        this.resetKeyboardFocusForDestination();
      }
    }
    await this.focusNavigationTarget(nextTarget);
  }

  private async startSessionFromNavigation(): Promise<void> {
    const seq = ++this.navigationSelectionSeq;
    const isCurrentSelection = () => seq === this.navigationSelectionSeq;

    this.navigationSections.advanceAfterSelection("sessions");
    await this.startSessionAndOpenChat(isCurrentSelection);
  }

  private async startSessionAndOpenChat(shouldComplete: () => boolean = () => true): Promise<void> {
    // `startSession()` remains in flight until the backend session resolves;
    // open the chat as soon as the controller has inserted the temporary row.
    const start = this.sessions.startSession().catch((error: unknown) => {
      if (shouldComplete()) this.setState({ error: String(error) });
    });
    if (shouldComplete()) await this.focusChatComposer();
    void start;
  }

  private async focusNavigationTarget(target: NavigationFocusTarget): Promise<void> {
    if (target === "chat") {
      await this.focusChatComposer();
      return;
    }
    await this.focusNavigationSection(target);
  }

  private async focusNavigationSection(section: NavigationSection): Promise<void> {
    if (this.topLevelPage === "dashboard") this.leaveDashboard("sessions");
    if (section === "machines" && !shouldShowMachinesSection(this.state.machines, this.isModernistDesktopComposition())) {
      await this.focusNavigationSection("projects");
      return;
    }
    this.panelCollapse.expandNavigationPanel();
    if (this.appShell.isMobileNavigationLayout) this.selectMobileDestination("sessions");
    this.navigationSections.expand(section);
    await this.updateComplete;
    await nextFrame();
    await this.navigationPanel?.focusSection(section);
  }

  private async focusChatComposer(): Promise<void> {
    if (this.topLevelPage === "dashboard") this.leaveDashboard("chat");
    if (this.appShell.isMobileNavigationLayout) this.selectMobileDestination("chat");
    else if (this.state.mainView !== "chat") this.selectMainView("chat");
    await this.updateComplete;
    await nextFrame();
    this.promptEditor?.focusInput();
  }

  private visibleWorkspacePanels(): QualifiedWorkspacePanelContribution[] {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return [];
    const context = this.createWorkspacePanelContext(workspace);
    return this.plugins.getWorkspacePanels().filter((panel) => panel.visible?.(context) ?? true);
  }

  private workspacePanelEmptyState(): WorkspacePanelEmptyState {
    const project = this.state.selectedProject;
    if (this.state.isLoadingProjects) {
      return {
        title: "Loading projects…",
        body: "Looking for projects you have added to PI WEB.",
      };
    }
    if (project === undefined) {
      return this.state.projects.length === 0
        ? {
            title: "No projects yet",
            body: "Use Actions → Add Project to add a folder. Workspace tools will appear here after you choose a workspace.",
          }
        : {
            title: "Select a project",
            body: "Choose a project from the sidebar, then select a workspace to inspect files, Git, or terminals.",
          };
    }
    if (this.state.isLoadingWorkspaces) {
      return {
        title: "Loading workspaces…",
        body: `Preparing workspace tools for ${project.name}.`,
      };
    }
    if (this.state.workspaces.length === 0) {
      return {
        title: "No workspaces found",
        body: `${project.name} does not have any available workspaces. Try selecting the project again or re-adding it.`,
      };
    }
    return {
      title: "Select a workspace",
      body: `Choose a workspace in ${project.name} to inspect files, Git, or terminals.`,
    };
  }

  private sessionEmptyMessage(): string {
    if (this.state.isLoadingProjects) return "Loading projects…";
    if (this.state.selectedWorkspace !== undefined) return "Select or start a session.";
    if (this.state.selectedProject !== undefined) return "Select a workspace to start a session.";
    if (this.state.projects.length === 0) return "Add a project to start a session.";
    return "Select a project and workspace to start a session.";
  }

  private mobilePanelBadge(panel: QualifiedWorkspacePanelContribution): unknown {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return undefined;
    return panel.badge?.(this.createWorkspacePanelContext(workspace));
  }

  private mobilePanelIcon(panel: QualifiedWorkspacePanelContribution): AppMobileMainTabIcon | undefined {
    switch (panel.id) {
      case "core:workspace.files": return "files";
      case "core:workspace.git": return "git";
      case "core:workspace.terminal": return "terminal";
      default: return undefined;
    }
  }

  private workspaceLabelItems(workspace: Workspace): WorkspaceLabelItem[] {
    return this.plugins.getWorkspaceLabelItems(this.createWorkspaceLabelContext(workspace));
  }

  private createWorkspaceLabelContext(workspace: Workspace): WorkspaceLabelContext {
    const machine = pluginMachineFromState(this.state);
    return {
      machine,
      workspace,
      state: this.state,
      files: this.createWorkspaceFiles(workspace, machine.id),
      host: this.createWorkspaceHost(),
    };
  }

  private createWorkspaceFiles(workspace: Workspace, machineId: string): WorkspaceFiles {
    return {
      readFile: (path: string) => workspacesApi.workspaceFile(workspace.projectId, workspace.id, path, machineId),
      writeFile: async (path, content, options) => {
        const result = await workspacesApi.writeWorkspaceFile(workspace.projectId, workspace.id, path, content, options, machineId);
        void this.files.refreshFiles();
        return result;
      },
      deleteFile: async (path) => {
        const result = await workspacesApi.deleteWorkspaceFile(workspace.projectId, workspace.id, path, machineId);
        void this.files.refreshFiles();
        return result;
      },
      moveFile: async (fromPath, toPath, options) => {
        const result = await workspacesApi.moveWorkspaceFile(workspace.projectId, workspace.id, fromPath, toPath, options, machineId);
        void this.files.refreshFiles();
        return result;
      },
    };
  }

  private createWorkspaceHost(): WorkspaceHost {
    return {
      requestRender: () => { this.requestUpdate(); },
    };
  }

  private createWorkspacePanelContext(workspace: Workspace): WorkspacePanelContext {
    const machine = pluginMachineFromState(this.state);
    const machineId = machine.id;
    const createContext = (origin: string): WorkspacePanelContext => {
      const terminalCommandRuns = this.terminalCommandRunsForOrigin(origin, machineId);
      return installWorkspacePanelScope({
        machine,
        workspace,
        state: this.state,
        files: this.createWorkspaceFiles(workspace, machineId),
        prompt: this.createPromptEditor(),
        terminal: {
          open: (options) => { void this.openRuntimeTerminal(machineId, workspace, options); },
          runCommand: (input) => terminalCommandRuns.runCommand({ ...input, workspace }),
        },
        openTerminal: (options) => { void this.openRuntimeTerminal(machineId, workspace, options); },
        host: this.createWorkspaceHost(),
        piWebUnstable: { terminalCommandRuns },
        fileTree: this.state.fileTree,
        expandedDirs: this.state.expandedDirs,
        selectedFilePath: this.state.selectedFilePath,
        selectedFileContent: this.state.selectedFileContent,
        fileTreeStale: this.state.fileTreeStale,
        gitStatus: this.state.gitStatus,
        selectedDiffPath: this.state.selectedDiffPath,
        selectedDiff: this.state.selectedDiff,
        selectedStagedDiff: this.state.selectedStagedDiff,
        gitStale: this.state.gitStale,
        activeTerminalCount: this.state.activeTerminalCount,
        selectedTerminalId: this.state.selectedTerminalId,
        // A selected terminal is the durable acknowledgement of an auto-start.
        // This prevents a responsive workbench remount from starting another shell.
        terminalAutoStart: this.terminalAutoStartWorkspaceId === workspace.id && this.state.selectedTerminalId === undefined,
        workspaceUploadDefaultFolder: workspaceEffectiveUploadFolder(workspace.effectiveConfig, this.workspaceUploadDefaultFolder),
        onRefreshFiles: () => { void this.files.refreshFiles(); },
        onExpandDir: (path: string) => { void this.files.expandDir(path); },
        onSelectFile: (path: string) => { void this.files.selectFile(path); },
        onStartWorkspaceUpload: (files, options) => this.files.startWorkspaceUpload(files, options),
        onCancelWorkspaceUpload: (batchId) => { this.files.cancelWorkspaceUpload(batchId); },
        onClearWorkspaceUpload: (batchId) => { this.files.clearWorkspaceUpload(batchId); },
        onRefreshGit: () => { void this.git.refreshGit(); },
        onSelectDiff: (path: string) => { void this.git.selectDiff(path); },
        onSelectTerminal: (terminalId: string | undefined, options?: { replace?: boolean | undefined }) => { this.selectTerminal(terminalId, options); },
      }, createContext);
    };
    return createContext("core");
  }

  private getActions(): AppAction[] {
    return applyActiveShortcutPreferences(this.getDefaultActions(), this.shortcutConfig);
  }

  private getDefaultActions(): AppAction[] {
    return [...this.plugins.getActions(this.createPluginRuntimeContext()), ...this.sessionActions(), ...this.navigationFocusActions(), ...this.panelLayoutActions()];
  }

  private sessionActions(): AppAction[] {
    const canCleanup = this.canCleanupSessions();
    return [
      {
        id: "app.sessions.cleanup",
        title: "Clean Up Sessions",
        description: "Preview and manually clean up idle or archived sessions on the selected machine",
        group: "Sessions",
        ...(canCleanup ? {} : { enabled: false, disabledReason: this.sessionCleanupUnavailableMessage() }),
        run: () => { this.openSessionCleanupDialog(); },
      },
    ];
  }

  private panelLayoutActions(): AppAction[] {
    return [
      {
        id: "app.layout.reset-navigation-panel-size",
        title: "Reset Navigation Panel Size",
        description: "Restore the navigation panel to its default width",
        group: "View",
        run: () => { this.resetResizablePanel("navigation"); },
      },
      {
        id: "app.layout.reset-workspace-panel-size",
        title: "Reset Workspace Panel Size",
        description: "Restore the workspace panel to its default width",
        group: "View",
        run: () => { this.resetResizablePanel("workspace"); },
      },
      {
        id: "app.layout.reset-panel-sizes",
        title: "Reset Panel Sizes",
        description: "Restore all side panels to their default widths",
        group: "View",
        run: () => { this.resetResizablePanels(); },
      },
    ];
  }

  private navigationFocusActions(): AppAction[] {
    return [
      {
        id: "app.navigation.focus-machines",
        title: "Focus Machines",
        description: "Move keyboard focus to the machine selector",
        shortcut: "mod+g m",
        group: "Navigation",
        run: () => this.focusNavigationSection("machines"),
      },
      {
        id: "app.navigation.focus-projects",
        title: "Focus Projects",
        description: "Move keyboard focus to the projects list",
        shortcut: "mod+g p",
        group: "Navigation",
        run: () => this.focusNavigationSection("projects"),
      },
      {
        id: "app.navigation.focus-workspaces",
        title: "Focus Workspaces",
        description: "Move keyboard focus to the workspaces list",
        shortcut: "mod+g w",
        group: "Navigation",
        run: () => this.focusNavigationSection("workspaces"),
      },
      {
        id: "app.navigation.focus-sessions",
        title: "Focus Sessions",
        description: "Move keyboard focus to the sessions list",
        shortcut: "mod+g s",
        group: "Navigation",
        run: () => this.focusNavigationSection("sessions"),
      },
    ];
  }

  private ensureGatewayPluginsLoaded(): Promise<void> {
    this.gatewayPluginLoadPromise ??= this.loadExternalPlugins();
    return this.gatewayPluginLoadPromise;
  }

  private async loadExternalPlugins(): Promise<void> {
    await this.registerExternalPlugins("PI WEB plugins", () => loadExternalPlugins());
  }

  private async loadPluginsForSelectedMachine(): Promise<void> {
    const machine = this.state.selectedMachine;
    if (machine?.kind !== "remote") return;
    await this.loadPluginsForMachine(machine);
  }

  private async loadPluginsForMachine(machine: Machine): Promise<void> {
    await this.ensureGatewayPluginsLoaded();
    if (machine.kind !== "remote" || this.loadedMachinePluginIds.has(machine.id)) return;
    const existing = this.machinePluginLoadPromises.get(machine.id);
    if (existing !== undefined) return existing;

    const load = this.registerExternalPlugins(`PI WEB plugins from ${machine.name}`, () => loadExternalPlugins(`api/machines/${encodeURIComponent(machine.id)}/pi-web-plugins/manifest.json`, {
      machineId: machine.id,
      shouldLoadPlugin: (entry) => this.plugins.shouldLoadRemotePlugin(entry.id, entry.machineSpecific),
    }))
      .then((loaded) => { if (loaded) this.loadedMachinePluginIds.add(machine.id); })
      .finally(() => { this.machinePluginLoadPromises.delete(machine.id); });
    this.machinePluginLoadPromises.set(machine.id, load);
    await load;
  }

  private async registerExternalPlugins(label: string, load: () => Promise<PiWebPluginRegistration[]>): Promise<boolean> {
    try {
      const registrations = await load();
      for (const registration of registrations) {
        try {
          this.plugins.register(registration);
        } catch (error) {
          console.warn(`Failed to register PI WEB plugin ${registration.id}`, error);
        }
      }
      this.applyPreferredTheme(false);
      this.requestUpdate();
      return true;
    } catch (error) {
      console.warn(`Failed to load ${label}`, error);
      return false;
    }
  }

  private createPromptEditor(): PluginPromptEditor {
    return {
      insertText: (text: string) => {
        const editor = this.promptEditor?.view;
        if (!editor) return;
        if (!editor.hasFocus) editor.focus();
        const sel = editor.state.selection.main;
        editor.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          selection: { anchor: sel.from + text.length },
        });
      },
      send: () => {
        this.promptEditor?.send();
      },
      getText: () => {
        return this.promptEditor?.view?.state.doc.toString() ?? "";
      },
      getSelection: () => {
        const editor = this.promptEditor?.view;
        if (!editor) return null;
        const sel = editor.state.selection.main;
        if (sel.empty) return null;
        return { start: sel.from, end: sel.to, text: editor.state.sliceDoc(sel.from, sel.to) };
      },
    };
  }

  private createPluginRuntimeContext(): PluginRuntimeContext {
    const createContext = (origin: string): PluginRuntimeContext => installPluginRuntimeScope({
      state: this.state,
      prompt: this.createPromptEditor(),
      piWebUnstable: {
        terminalCommandRuns: this.terminalCommandRunsForOrigin(origin),
        openSettings: (section) => { this.openSettings(section); },
      },
      openActionPalette: () => { this.setState({ actionPaletteOpen: true }); },
      focusPrompt: () => { void this.focusChatComposer(); },
      addProject: () => { this.setState({ projectDialogOpen: true }); },
      addMachine: () => { this.openMachineDialog(); },
      refreshSelectedMachine: async () => {
        await Promise.all([this.machines.refreshMachineHealth(), this.machines.refreshMachineRuntime()]);
      },
      removeSelectedMachine: () => this.removeMachine(),
      openSelectedMachine: () => { this.openSelectedMachine(); },
      configureAuth: () => this.auth.openLogin(),
      logoutAuth: () => this.auth.openLogout(),
      openThemePicker: () => { this.openThemeDialog(); },
      selectMainView: (view) => { this.selectMainView(view); },
      selectWorkspaceTool: (tool) => { this.openWorkspaceTool(tool); },
      openTerminal: (options) => { this.openTerminal(options); },
      refreshFiles: () => this.files.refreshFiles(),
      refreshGit: () => this.git.refreshGit(),
      refreshAppData: () => this.refreshAppData(),
      checkForPiWebUpdates: () => this.piWebStatusController.checkForUpdates(),
      reloadPage: () => { this.hardReloadApp(); },
      deleteWorkspace: (workspace) => this.deleteWorkspace(workspace),
      startSession: () => this.withChatScrollTransition(() => this.startSessionAndOpenChat()),
      archiveSession: () => this.sessions.archiveSession(),
      reloadSession: () => this.sessions.reloadSession(),
      deleteCachedNewSession: () => this.sessions.deleteCachedNewSession(),
      stopActiveWork: () => this.sessions.stopActiveWork(),
    }, createContext);
    return createContext("core");
  }

  private async deleteWorkspace(workspace = this.state.selectedWorkspace): Promise<void> {
    if (workspace === undefined) return;
    if (!canDeleteWorkspace(workspace)) {
      this.setState({ error: "Only secondary Git worktrees can be deleted" });
      return;
    }
    if (isWorkspaceDeletionPending(this.state, workspace)) return;
    const label = workspace.branch ?? workspace.label;
    const confirmed = confirm(`Delete workspace ${label}?\n\nThis will run git worktree remove and delete:\n${workspace.path}\n\nThe Git branch will not be deleted.`);
    if (!confirmed) return;

    const machineId = selectedMachineId(this.state);
    try {
      const run = await workspacesApi.deleteWorkspace(workspace.projectId, workspace.id, machineId);
      if (selectedMachineId(this.state) !== machineId) return;
      this.recordWorkspaceDeletionRun(run, machineId);
      const commandWorkspace = await this.workspaceForCommandRun(run);
      if (selectedMachineId(this.state) !== machineId) return;
      if (commandWorkspace !== undefined) void this.openRuntimeTerminal(machineId, commandWorkspace, { terminalId: run.terminalId });
    } catch (error) {
      if (selectedMachineId(this.state) === machineId) this.setState({ error: `Failed to start workspace deletion: ${errorMessage(error)}` });
    }
  }

  private async workspaceForCommandRun(run: TerminalCommandRun): Promise<Workspace | undefined> {
    let workspaces = this.state.selectedProject?.id === run.projectId ? this.state.workspaces : this.state.workspacesByProjectId[run.projectId];
    if (workspaces === undefined || workspaces.length === 0) workspaces = await this.workspaces.refreshProjectWorkspaces(run.projectId);
    return workspaces.find((workspace) => workspace.id === run.workspaceId);
  }

  private recordWorkspaceDeletionRun(run: TerminalCommandRun, machineId: string): void {
    if (selectedMachineId(this.state) !== machineId) return;
    const workspaceId = targetWorkspaceIdForRun(run);
    if (workspaceId === undefined) return;
    this.setState({ workspaceDeletionRuns: { ...this.state.workspaceDeletionRuns, [workspaceId]: run } });
    this.updateWorkspaceDeletionPolling();
  }

  private async refreshWorkspaceDeletionRuns(): Promise<void> {
    if (this.refreshingWorkspaceDeletionRuns) return;
    const machineId = selectedMachineId(this.state);
    const project = this.state.selectedProject;
    if (project === undefined) {
      this.setState({ workspaceDeletionRuns: {} });
      this.updateWorkspaceDeletionPolling();
      return;
    }

    this.refreshingWorkspaceDeletionRuns = true;
    try {
      const runs = await this.terminalCommandRunsForOrigin("core", machineId).listCommandRuns(workspaceDeletionRunFilter(project.id));
      if (selectedMachineId(this.state) !== machineId) return;
      const latestRuns = latestWorkspaceDeletionRuns(runs);
      this.setState({ workspaceDeletionRuns: latestRuns });
      for (const run of Object.values(latestRuns)) {
        if (!isWorkspaceDeletionRunPending(run)) await this.handleCompletedWorkspaceDeletionRun(run, machineId);
      }
    } catch (error) {
      console.warn("Failed to refresh workspace deletion runs", error);
    } finally {
      this.refreshingWorkspaceDeletionRuns = false;
      this.updateWorkspaceDeletionPolling();
    }
  }

  private updateWorkspaceDeletionPolling(): void {
    const hasPendingDeletion = Object.values(this.state.workspaceDeletionRuns).some(isWorkspaceDeletionRunPending);
    if (hasPendingDeletion && this.workspaceDeletionPollTimer === undefined) {
      this.workspaceDeletionPollTimer = window.setInterval(() => { void this.refreshWorkspaceDeletionRuns(); }, 1000);
      return;
    }
    if (!hasPendingDeletion && this.workspaceDeletionPollTimer !== undefined) {
      window.clearInterval(this.workspaceDeletionPollTimer);
      this.workspaceDeletionPollTimer = undefined;
    }
  }

  private async handleCompletedWorkspaceDeletionRun(run: TerminalCommandRun, machineId = selectedMachineId(this.state)): Promise<void> {
    if (selectedMachineId(this.state) !== machineId) return;
    const runKey = machineScopedKey(machineId, run.id);
    if (this.handledWorkspaceDeletionRunIds.has(runKey)) return;
    const workspaceId = targetWorkspaceIdForRun(run);
    if (workspaceId === undefined) return;
    this.handledWorkspaceDeletionRunIds.add(runKey);

    if (run.status === "succeeded") {
      await this.workspaces.refreshAfterWorkspaceDeleted(run.projectId, workspaceId);
      if (selectedMachineId(this.state) !== machineId) return;
      this.setState({ workspaceDeletionRuns: omitWorkspaceDeletionRun(this.state.workspaceDeletionRuns, workspaceId) });
      this.updateWorkspaceDeletionPolling();
      return;
    }

    if (run.status === "failed") {
      this.setState({ error: "Workspace deletion failed. See terminal output." });
      this.updateWorkspaceDeletionPolling();
    }
  }

  private openMachineDialog(machine?: Machine): void {
    if (machine?.kind === "local") {
      this.setState({ error: "The local machine cannot be configured as a remote connection." });
      return;
    }
    this.machineDialogMachine = machine;
    this.setState({ machineDialogOpen: true, error: "" });
  }

  private closeMachineDialog(): void {
    this.machineDialogMachine = undefined;
    this.setState({ machineDialogOpen: false });
  }

  private async selectSettingsMachine(machine: Machine): Promise<void> {
    await this.selectMachineWithMemory(machine);
    // Local has no connection form. Selecting it takes the user straight to
    // the settings that are scoped to its gateway/session daemon.
    if (machine.kind === "local" && this.state.selectedMachine?.id === machine.id) this.navigateSettings("sessiond");
  }

  private openSettingsModelPicker(): void {
    const session = this.state.selectedSession;
    if (session === undefined || session.archived === true) return;
    // A destination must not schedule focus restoration back into its closed
    // Settings surface while the existing picker is opening.
    this.closeSettings({ restoreFocus: false });
    void this.openModelDialog();
  }

  private openSettingsAuth(mode: "login" | "logout"): void {
    // Auth replaces Settings. Restoring focus between the two overlays can put
    // it on an exposed background control before AuthDialog has rendered.
    this.closeSettings({ restoreFocus: false });
    if (mode === "login") void this.auth.openLogin();
    else void this.auth.openLogout();
  }

  private async submitMachineDialog(input: MachineDialogSubmit): Promise<void> {
    const editedMachine = this.machineDialogMachine;
    const machine = editedMachine === undefined
      ? await this.machines.addMachine(input)
      : await this.machines.updateMachine(editedMachine, input);
    if (machine !== undefined) {
      this.closeMachineDialog();
      this.schedulePiWebStatusRefresh();
    }
  }

  private async removeMachine(machine: Machine | undefined = this.state.selectedMachine): Promise<void> {
    if (machine === undefined || machine.kind === "local") return;
    if (!window.confirm(`Remove ${machine.name}?\n\nThis only removes it from this PI WEB gateway.`)) return;
    const wasSelected = this.state.selectedMachine?.id === machine.id;
    if (wasSelected) this.rememberCurrentMachineNavigation();
    const fallback = await this.machines.deleteMachine(machine, { selectFallback: !wasSelected });
    if (!this.state.machines.some((candidate) => candidate.id === machine.id)) this.machineNavigation.forget(machine.id);
    if (wasSelected && fallback !== undefined) await this.selectMachineWithMemory(fallback, { rememberCurrent: false });
  }

  private openSelectedMachine(): void {
    const machine = this.state.selectedMachine;
    if (machine?.kind !== "remote" || machine.baseUrl === undefined) return;
    window.open(machine.baseUrl, "_blank", "noopener,noreferrer");
  }

  private runAction(action: AppAction): void {
    void Promise.resolve()
      .then(() => action.run())
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Action failed: ${action.id}`, error);
        this.setState({ error: `Action failed: ${message}` });
      });
  }

  private async openModelDialog() {
    const models = await this.sessions.listModels();
    const currentProvider = this.state.status?.model?.provider;
    const currentId = this.state.status?.model?.id;
    this.setState({
      modelDialog: {
        title: "Select Model",
        ...(currentProvider !== undefined && currentId !== undefined ? { selectedValue: `${currentProvider}/${currentId}` } : {}),
        options: models.map((model) => {
          const provider = model.provider ?? "";
          const id = model.id ?? "";
          const isCurrent = provider === currentProvider && id === currentId;
          return { value: `${provider}/${id}`, label: `${id}${isCurrent ? " ✓ current" : ""}`, description: provider };
        }),
      },
    });
  }

  private async pickModel(value: string) {
    this.setState({ modelDialog: undefined });
    const slash = value.indexOf("/");
    if (slash <= 0) return;
    await this.sessions.setModel(value.slice(0, slash), value.slice(slash + 1));
  }

  private openThemeDialog() {
    const themes = this.plugins.getThemes();
    const resolution = this.resolveCurrentThemePreference(themes);
    const selectedThemeId = resolution.selectedTheme?.id;
    const autoValue = this.themePreference.auto ? THEME_AUTO_OFF_VALUE : THEME_AUTO_ON_VALUE;
    this.setState({
      themeDialog: {
        title: "Select Theme",
        selectedValue: selectedThemeId === undefined ? autoValue : `${THEME_OPTION_PREFIX}${selectedThemeId}`,
        options: [
          {
            value: autoValue,
            label: `Auto ${this.themePreference.auto ? "✓ on" : "off"}`,
            description: this.autoThemeDescription(resolution),
          },
          ...themes.map((theme) => ({
            value: `${THEME_OPTION_PREFIX}${theme.id}`,
            label: this.themeOptionLabel(theme, selectedThemeId),
            description: this.themeOptionDescription(theme),
          })),
        ],
      },
    });
  }

  private pickTheme(value: string) {
    this.setState({ themeDialog: undefined });
    if (value === THEME_AUTO_ON_VALUE || value === THEME_AUTO_OFF_VALUE) {
      const selectedThemeId = this.resolveCurrentThemePreference().selectedTheme?.id;
      if (selectedThemeId === undefined) return;
      this.themePreference = { themeId: selectedThemeId, auto: value === THEME_AUTO_ON_VALUE };
      this.applyPreferredTheme(true);
      return;
    }
    if (!value.startsWith(THEME_OPTION_PREFIX)) return;
    const themeId = value.slice(THEME_OPTION_PREFIX.length);
    const theme = this.plugins.getThemes().find((candidate) => candidate.id === themeId);
    if (theme === undefined) return;
    this.themePreference = { themeId: theme.id, auto: this.themePreference.auto };
    this.applyPreferredTheme(true);
  }

  private applyPreferredTheme(persist: boolean): void {
    const theme = this.resolveCurrentThemePreference().activeTheme;
    if (theme === undefined) return;
    this.activeThemeId = theme.id;
    applyPiWebTheme(theme);
    this.updateGitPolling();
    if (persist) writeStoredThemePreference(this.themePreference);
  }

  private toggleThemeAppearance(): void {
    const preference = toggleThemePreference({
      themes: this.plugins.getThemes(),
      themePairs: this.plugins.getThemePairs(),
      preference: this.themePreference,
      prefersLight: this.systemPrefersLight(),
    });
    if (preference === undefined) {
      this.openThemeDialog();
      return;
    }
    this.themePreference = preference;
    this.applyPreferredTheme(true);
  }

  private resolveCurrentThemePreference(themes = this.plugins.getThemes()): ThemePreferenceResolution {
    return resolveThemePreference({
      themes,
      themePairs: this.plugins.getThemePairs(),
      preference: this.themePreference,
      prefersLight: this.systemPrefersLight(),
    });
  }

  private themePairForTheme(themeId: QualifiedContributionId): QualifiedThemePairContribution | undefined {
    return findThemePairForTheme(this.plugins.getThemePairs(), themeId);
  }

  private systemPrefersLight(): boolean {
    return this.systemLightThemeMedia?.matches ?? false;
  }

  private autoThemeDescription(resolution: ThemePreferenceResolution): string {
    if (!this.themePreference.auto) return "Follow the system light/dark preference when the selected theme has a pair.";
    if (resolution.selectedTheme === undefined) return "Follow the system light/dark preference when the selected theme has a pair.";
    if (resolution.selectedThemePair === undefined) return "On, but the selected theme has no light/dark pair, so it will stay selected.";
    return `On · ${resolution.selectedThemePair.name} follows the system ${this.systemPrefersLight() ? "light" : "dark"} preference.`;
  }

  private themeOptionLabel(theme: QualifiedThemeContribution, selectedThemeId: QualifiedContributionId | undefined): string {
    const markers = [
      ...(theme.id === selectedThemeId ? ["selected"] : []),
      ...(theme.id === this.activeThemeId && theme.id !== selectedThemeId ? ["active"] : []),
    ];
    return markers.length === 0 ? theme.name : `${theme.name} ✓ ${markers.join(" · ")}`;
  }

  private themeOptionDescription(theme: QualifiedThemeContribution): string {
    const parts: string[] = [theme.colorScheme];
    if (this.themePairForTheme(theme.id) !== undefined) parts.push("auto pair");
    if (theme.description !== undefined) parts.push(theme.description);
    return parts.join(" · ");
  }

  private async openThinkingDialog() {
    const levels = await this.sessions.listThinkingLevels();
    const current = this.state.status?.thinkingLevel ?? "off";
    this.setState({
      thinkingDialog: {
        title: "Select Thinking Level",
        selectedValue: current,
        options: levels.map((level) => { const description = thinkingDescription(level); return { value: level, label: `${level}${level === current ? " ✓ current" : ""}`, ...(description === undefined ? {} : { description }) }; }),
      },
    });
  }

  private async pickThinking(value: string) {
    this.setState({ thinkingDialog: undefined });
    if (value !== "") await this.sessions.setThinkingLevel(value);
  }

  private sendPrompt(text: string, streamingBehavior?: "steer" | "followUp", attachments?: import("../api").PromptAttachment[], delivery?: import("../../../shared/apiTypes").PromptAttachmentDelivery): void {
    const hasAttachments = attachments !== undefined && attachments.length > 0;
    if (!hasAttachments && streamingBehavior === undefined && this.auth.handleSlashCommand(text)) return;
    void this.sessions.send(text, streamingBehavior, attachments, delivery);
  }

  // Stable handler identities for child components. Inlined arrow closures
  // would be a fresh reference on every render, forcing Lit to re-commit the
  // bindings each time the app re-renders; bound class fields keep them constant.
  private readonly handleSendPrompt = (text: string, streamingBehavior?: "steer" | "followUp", attachments?: import("../api").PromptAttachment[], delivery?: import("../../../shared/apiTypes").PromptAttachmentDelivery): void => {
    this.sendPrompt(text, streamingBehavior, attachments, delivery);
  };

  private readonly handlePromptFocusChange = (focused: boolean): void => {
    this.composerFocused = focused;
    this.refreshMobileKeyboardFocus();
  };

  private handleVisualViewportSnapshot(snapshot: VisualViewportSnapshot | undefined): void {
    this.visualViewportSnapshot = snapshot;
    this.refreshMobileKeyboardFocus();
  }

  private refreshMobileKeyboardFocus(): void {
    const previous = this.mobileKeyboardFocus;
    this.mobileKeyboardFocus = updateMobileKeyboardFocus(previous, {
      isMobile: this.appShell.isMobileNavigationLayout,
      isChatDestination: this.mobileDestination === "chat",
      composerFocused: this.composerFocused,
      viewport: this.visualViewportSnapshot,
    });
    // Android hides the soft keyboard without blurring CodeMirror, leaving a
    // lingering caret and focus ring. Release focus when the keyboard closes.
    if (keyboardDismissedWhileComposerFocused(previous, this.mobileKeyboardFocus, this.composerFocused)) {
      this.promptEditor?.blurInput();
    }
  }

  /** A hidden destination must never leave its CodeMirror input owning an IME. */
  private resetKeyboardFocusForDestination(): void {
    if (this.mobileDestination !== "chat") this.promptEditor?.blurInput();
    if (this.mobileDestination !== "chat" || !this.appShell.isMobileNavigationLayout) this.composerFocused = false;
    this.refreshMobileKeyboardFocus();
  }

  private readonly handleStopActiveWork = (): void => {
    void this.sessions.stopActiveWork();
  };

  private readonly handleClearServerQueue = (): void => {
    void this.sessions.clearServerQueue();
  };

  private readonly handleExtensionUiRespond = (response: import("../api").ExtensionUiResponse) => {
    return this.sessions.respondToExtensionUi(response);
  };

  private readonly handleDismissWarning = (dismissId: string): void => {
    void this.sessions.dismissWarning(dismissId);
  };

  private readonly handleDismissNotification = (notificationId: string): void => {
    void this.notifications.dismissNotification(notificationId);
  };

  private readonly handleDismissAllNotifications = (): void => {
    void this.notifications.dismissAll();
  };

  private readonly handleSelectModel = (): void => {
    void this.openModelDialog();
  };

  private readonly handleSelectThinking = (): void => {
    void this.openThinkingDialog();
  };

  private readonly handleToggleThemeAppearance = (): void => {
    this.toggleThemeAppearance();
  };

  private renderChatView(state: AppState, session: SessionInfo) {
    return html`
      <chat-view .sessionId=${session.id} .messages=${state.messages} .messageStart=${state.messagePageStart} .messageEnd=${state.messagePageEnd} .messageTotal=${state.messagePageTotal} .hasMore=${state.messagePageStart > 0} .loadingMore=${state.isLoadingEarlierMessages} .isSendingPrompt=${state.sendingPrompts[session.id] === true} .isCompacting=${state.status?.isCompacting === true} .waitingForUser=${state.extensionUiRequests.length > 0 || state.commandDialog !== undefined} .pendingMessageCount=${state.status?.pendingMessageCount ?? 0} .clientQueuedMessages=${state.clientQueuedSessionMessages[session.id] ?? []} .extensionUiRequests=${state.extensionUiRequests} .extensionUiResolutions=${state.extensionUiResolutions} .extensionUiNotifications=${state.extensionUiNotifications} .onExtensionUiRespond=${this.handleExtensionUiRespond} .status=${state.status} .activity=${state.activity} .notificationInbox=${selectedNotificationView(state.selectedNotificationInbox)} .canStop=${this.canStopActiveWork(state.status)} .clearsServerQueue=${this.stopClearsServerQueue(state.status)} .canClearServerQueue=${this.canClearServerQueue()} .mobileKeyboardFocusActive=${this.mobileKeyboardFocus.active} .onClearServerQueue=${this.handleClearServerQueue} .onDismissWarning=${this.handleDismissWarning} .onDismissNotification=${this.handleDismissNotification} .onDismissAllNotifications=${this.handleDismissAllNotifications} .onLoadMore=${() => this.withChatPrependTransition(() => this.sessions.loadEarlierMessages())}></chat-view>
    `;
  }

  private renderContextBar() {
    if (!this.appShell.isMobileNavigationLayout) return null;
    return html`
      <app-context-bar
        .machines=${this.state.machines}
        .machine=${this.state.selectedMachine}
        .project=${this.state.selectedProject}
        .workspace=${this.state.selectedWorkspace}
        .session=${this.state.selectedSession}
        .refreshControl=${this.appShell.shouldShowAppRefreshInContextBar() ? this.renderAppRefresh() : undefined}
        .onOpenSection=${(section: NavigationSection) => { this.openNavigationSection(section); }}
        .onShowActions=${() => { this.setState({ actionPaletteOpen: true }); }}
      ></app-context-bar>
    `;
  }

  private renderMobileMainTabs() {
    return html`
      <app-mobile-main-tabs
        .tabs=${this.mobileMainTabs()}
        .selectedView=${this.state.mainView}
        .onSelect=${(view: AppState["mainView"]) => { this.selectMainView(view); }}
      ></app-mobile-main-tabs>
    `;
  }

  private renderMobileDestinationTabs() {
    return html`
      <app-mobile-destination-tabs
        ?hidden=${this.mobileKeyboardFocus.active}
        .selected=${this.mobileDestination}
        .settingsPresentation=${this.isModernistSettingsDestination() ? "destination" : "dialog"}
        .onSelect=${(destination: MobileDestination) => { this.selectMobileDestination(destination); }}
      ></app-mobile-destination-tabs>
    `;
  }

  private mobileMainTabs(): AppMobileMainTab[] {
    return [
      { id: "navigation", label: "Sessions", icon: "navigation", className: "navigation-tab" },
      { id: "chat", label: "Chat", icon: "chat" },
      ...this.visibleWorkspacePanels().map((panel): AppMobileMainTab => {
        const icon = panel.icon ?? this.mobilePanelIcon(panel);
        return {
          id: panel.id,
          label: panel.title,
          ...(icon === undefined ? {} : { icon }),
          badge: this.mobilePanelBadge(panel),
        };
      }),
    ];
  }

  private renderAppRefresh() {
    return html`<app-refresh-control .onReload=${() => { this.hardReloadApp(); }}></app-refresh-control>`;
  }

  private renderSettings(presentation: "dialog" | "destination", state: AppState = this.state) {
    if (this.settingsSection === undefined) return null;
    return html`<settings-dialog
      .presentation=${presentation}
      .section=${this.settingsSection}
      .machine=${state.selectedMachine}
      .machineRuntime=${this.selectedMachineRuntime()}
      .machines=${state.machines}
      .machineStatuses=${state.machineStatuses}
      .machineRuntimes=${state.machineRuntimes}
      .session=${state.selectedSession}
      .sessionStatus=${state.status}
      .actions=${this.getDefaultActions()}
      .onNavigate=${(section: SettingsSection) => { this.navigateSettings(section); }}
      .onClose=${() => { this.closeSettings(); }}
      .onSelectMachine=${(machine: Machine) => this.selectSettingsMachine(machine)}
      .onAddMachine=${() => { this.openMachineDialog(); }}
      .onConfigureMachine=${(machine: Machine) => { this.openMachineDialog(machine); }}
      .onRemoveMachine=${(machine: Machine) => { void this.removeMachine(machine); }}
      .onSelectModel=${() => { this.openSettingsModelPicker(); }}
      .onConfigureAuth=${() => { this.openSettingsAuth("login"); }}
      .onLogoutAuth=${() => { this.openSettingsAuth("logout"); }}
      .onConfigSaved=${(config: PiWebConfigValues) => { this.applyClientConfig(config); }}
      .onRefreshMachineRuntime=${(machineId: string) => this.machines.refreshMachineRuntime(machineId)}
    ></settings-dialog>`;
  }

  private renderGlobalOverlays(state: AppState = this.state) {
    return html`
      ${state.actionPaletteOpen ? html`<action-palette .actions=${this.getActions()} .onRun=${(action: AppAction) => { this.setState({ actionPaletteOpen: false }); this.runAction(action); }} .onCancel=${() => { this.setState({ actionPaletteOpen: false }); }}></action-palette>` : null}
      ${state.projectDialogOpen ? html`<project-dialog .machineId=${selectedMachineId(state)} .onSubmit=${(path: string, create: boolean) => this.projects.addProject(path, create)} .onCancel=${() => { this.setState({ projectDialogOpen: false }); }}></project-dialog>` : null}
      ${state.machineDialogOpen ? html`<machine-dialog .machine=${this.machineDialogMachine} .error=${state.error} .onSubmit=${(input: MachineDialogSubmit) => this.submitMachineDialog(input)} .onCancel=${() => { this.closeMachineDialog(); }}></machine-dialog>` : null}
      ${state.authDialog !== undefined ? html`<auth-dialog .state=${state.authDialog} .onChooseMethod=${(authType: "oauth" | "api_key") => { void this.auth.chooseLoginMethod(authType); }} .onSelectProvider=${(providerId: string, authType: "oauth" | "api_key") => { void this.auth.selectLoginProvider(providerId, authType); }} .onApiKeyInput=${(value: string) => { this.auth.updateApiKey(value); }} .onSaveApiKey=${() => { void this.auth.saveApiKey(); }} .onLogoutProvider=${(providerId: string) => { void this.auth.logoutProvider(providerId); }} .onOAuthInput=${(value: string) => { this.auth.updateOAuthInput(value); }} .onOAuthRespond=${(value?: string) => { void this.auth.respondOAuth(value); }} .onOAuthCancel=${() => { void this.auth.cancelOAuth(); }} .onCancel=${() => { this.auth.closeDialog(); }}></auth-dialog>` : null}
      ${this.sessionRenameTarget !== undefined ? html`<session-rename-dialog .name=${this.sessionRenameTarget.oldName ?? ""} .saving=${this.sessionRenameSaving} .error=${this.sessionRenameError} .onSave=${(name: string | null) => this.submitSessionRename(name)} .onCancel=${() => { this.closeSessionRenameDialog(); }}></session-rename-dialog>` : null}
      ${this.sessionCleanupDialog !== undefined ? html`<session-cleanup-dialog .canCleanup=${this.canCleanupSessions()} .unavailableMessage=${this.sessionCleanupUnavailableMessage()} .preview=${this.sessionCleanupDialog.preview} .previewRequest=${this.sessionCleanupDialog.previewRequest} .result=${this.sessionCleanupDialog.result} .loading=${this.sessionCleanupDialog.loading === true} .running=${this.sessionCleanupDialog.running === true} .error=${this.sessionCleanupDialog.error ?? ""} .onPreview=${(request: SessionCleanupRequest) => { void this.previewSessionCleanup(request); }} .onRun=${(request: SessionCleanupRequest) => { void this.runSessionCleanup(request); }} .onClose=${() => { this.closeSessionCleanupDialog(); }}></session-cleanup-dialog>` : null}
      ${state.themeDialog !== undefined ? html`<command-picker title=${state.themeDialog.title} .options=${state.themeDialog.options} .selectedValue=${state.themeDialog.selectedValue} .onPick=${(value: string) => { this.pickTheme(value); }} .onCancel=${() => { this.setState({ themeDialog: undefined }); }}></command-picker>` : null}
      ${this.settingsSection !== undefined && !this.isModernistSettingsDestination() ? this.renderSettings("dialog", state) : null}
    `;
  }

  private renderDashboardPage() {
    return html`
      <div class=${`${this.panelCollapse.shellClass(this.state.mainView)} dashboard-page${this.isModernistDesktopComposition() ? " modernist-desktop-shell" : ""} mobile-destination-${this.mobileDestination}`} ?data-settings-destination=${this.settingsSection !== undefined && this.isModernistSettingsDestination()} style=${this.panelResize.shellStyle({ navigation: this.resizablePanelConstraints("navigation"), workspace: this.resizablePanelConstraints("workspace") })}>
        ${this.renderModernistGlobalHeader()}
        <aside id="navigation-panel">${this.appShell.isMobileNavigationLayout ? null : this.renderNavigationPanel()}</aside>
        ${this.renderNavigationPanelEdgeControl()}
        ${this.settingsSection !== undefined && this.isModernistSettingsDestination() ? this.renderSettings("destination") : null}
        <main class="dashboard-main" tabindex="-1" aria-label="Session dashboard">
          <session-dashboard
            .dashboard=${this.dashboardState.dashboard}
            .loading=${this.dashboardState.loading}
            .error=${this.dashboardState.error}
            .selectionError=${this.state.error}
            .hrefForSession=${(session: LocalSessionDashboardSessionSummary, machineId: string) => this.dashboardSessionHref(session, machineId)}
            .onOpenSession=${(session: LocalSessionDashboardSessionSummary, machineId: string) => this.openDashboardSession(session, machineId)}
            .onRenameSession=${(session: LocalSessionDashboardSessionSummary, machineId: string, opener: HTMLElement) => { this.openSessionRenameDialog(session, machineId, opener, true); }}
            .projects=${this.state.projects}
            .selectedProjectId=${this.state.selectedProject?.id}
            .selectedWorkspaceId=${this.state.selectedWorkspace?.id}
            .loadWorkspaces=${(project: Project) => workspacesApi.workspaces(project.id, selectedMachineId(this.state))}
            .onStartNewSession=${(workspace: Workspace) => this.startDashboardSession(workspace)}
            .onRetry=${() => this.dashboard.refresh()}
          ></session-dashboard>
        </main>
        ${this.renderMobileDestinationTabs()}
      </div>
    `;
  }

  override render() {
    if (this.topLevelPage === "dashboard") return html`${this.renderDashboardPage()}${this.renderGlobalOverlays()}`;
    const state = this.state;
    return html`
      <div class=${`${this.panelCollapse.shellClass(state.mainView)}${this.isModernistWorkbenchExpanded() ? " modernist-tools-expanded" : ""}${this.isModernistDesktopComposition() ? " modernist-desktop-shell" : ""} mobile-destination-${this.mobileDestination}${this.mobileKeyboardFocus.active ? " mobile-keyboard-focus" : ""}`} ?data-settings-destination=${this.settingsSection !== undefined && this.isModernistSettingsDestination()} style=${this.panelResize.shellStyle({ navigation: this.resizablePanelConstraints("navigation"), workspace: this.resizablePanelConstraints("workspace") })}>
        ${this.renderModernistGlobalHeader()}
        <aside id="navigation-panel">${this.appShell.isMobileNavigationLayout ? null : this.renderNavigationPanel()}</aside>
        ${this.renderNavigationPanelEdgeControl()}
        ${this.settingsSection !== undefined && this.isModernistSettingsDestination() ? this.renderSettings("destination", state) : null}
        <main class=${mainViewClass(state.mainView)} tabindex="-1" aria-label="PI WEB workspace">
          ${this.renderContextBar()}
          ${this.renderMobileMainTabs()}
          ${state.error ? html`<div class="error">${state.error}</div>` : null}
          <div class="mobile-navigation-panel">${this.appShell.isMobileNavigationLayout ? this.renderNavigationPanel() : null}</div>
          ${state.selectedSession ? html`
            <app-session-header
              .session=${state.selectedSession}
              .workspace=${state.selectedWorkspace}
              .status=${state.status}
              .activity=${state.activity}
              .waitingForUser=${state.extensionUiRequests.length > 0 || state.commandDialog !== undefined}
              .isSendingPrompt=${state.sendingPrompts[state.selectedSession.id] === true}
              .canStop=${this.canStopActiveWork(state.status)}
              .clearsServerQueue=${this.stopClearsServerQueue(state.status)}
              .canRename=${this.canRenameSessions()}
              .renameUnavailableMessage=${this.renameUnavailableMessage()}
              .onRename=${(opener: HTMLElement) => { const selected = state.selectedSession; if (selected !== undefined) this.openSessionRenameDialog(selected, selectedMachineId(state), opener); }}
              .onStop=${this.handleStopActiveWork}
            ></app-session-header>
            ${this.renderChatView(state, state.selectedSession)}
            <prompt-editor .sessionId=${state.selectedSession.id} .cwd=${state.selectedWorkspace?.path} .machineId=${selectedMachineId(state)} .projectId=${state.selectedWorkspace?.projectId} .workspaceId=${state.selectedWorkspace?.id} .workspaceScopedFileSuggestions=${this.supportsWorkspaceFileSuggestions()} .disabled=${state.selectedSession.archived === true} .canSteer=${state.status?.isStreaming === true} .isCompacting=${state.status?.isCompacting === true} .canStop=${this.canStopActiveWork(state.status)} .clearsServerQueue=${this.stopClearsServerQueue(state.status)} .status=${state.status} .availableThinkingLevels=${state.availableThinkingLevels} .sending=${state.sendingPrompts[state.selectedSession.id] === true} .onSend=${this.handleSendPrompt} .onStop=${this.handleStopActiveWork} .onSelectModel=${this.handleSelectModel} .onSelectThinking=${this.handleSelectThinking} .onFocusChange=${this.handlePromptFocusChange}></prompt-editor>
            <status-bar .status=${state.status}></status-bar>
            ${state.commandDialog !== undefined ? html`<command-picker .title=${state.commandDialog.title} .options=${state.commandDialog.options} .onPick=${(value: string) => this.sessions.respondToCommand(state.commandDialog?.requestId ?? "", value)} .onCancel=${() => { this.sessions.cancelCommand(); }}></command-picker>` : null}
            ${state.modelDialog !== undefined ? html`<command-picker title=${state.modelDialog.title} .searchable=${true} .options=${state.modelDialog.options} .selectedValue=${state.modelDialog.selectedValue} .onPick=${(value: string) => { void this.pickModel(value); }} .onCancel=${() => { this.setState({ modelDialog: undefined }); }}></command-picker>` : null}
            ${state.thinkingDialog !== undefined ? html`<command-picker title=${state.thinkingDialog.title} .options=${state.thinkingDialog.options} .selectedValue=${state.thinkingDialog.selectedValue} .onPick=${(value: string) => { void this.pickThinking(value); }} .onCancel=${() => { this.setState({ thinkingDialog: undefined }); }}></command-picker>` : null}
          ` : html`<div class="empty">${this.sessionEmptyMessage()}</div>`}
        </main>
        ${this.renderWorkspacePanelEdgeControl()}
        ${this.renderWorkspacePanel()}
        ${this.renderMobileDestinationTabs()}
      </div>
      ${this.renderGlobalOverlays(state)}
    `;
  }

  static override styles = appStyles;
}

function deepActiveElement(root: ParentNode | undefined): HTMLElement | undefined {
  if (root === undefined) return undefined;
  let active = activeElementIn(root);
  while (active?.shadowRoot?.activeElement != null) active = active.shadowRoot.activeElement;
  return active instanceof HTMLElement ? active : undefined;
}

function renameErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("archived") || lower.includes("409")) return "Restore this session before renaming.";
  if (lower.includes("not found") || lower.includes("404")) return "This session is no longer available.";
  if (lower.includes("machine connection changed")) return "This machine changed. Reopen Rename and try again.";
  if (lower.includes("offline") || lower.includes("network") || lower.includes("fetch")) return "This machine is offline. Check its connection and try again.";
  return `Could not rename session: ${message}`;
}

function activeElementIn(root: ParentNode): Element | null {
  if (hasActiveElement(root)) return root.activeElement;
  return root.ownerDocument?.activeElement ?? null;
}

function hasActiveElement(root: ParentNode): root is ParentNode & { activeElement: Element | null } {
  return "activeElement" in root;
}

function createPluginRegistry(): PluginRegistry {
  const registry = new PluginRegistry();
  registry.register({ id: "core", plugin: corePlugin });
  registry.register({ id: "themes", plugin: themePackPlugin });
  return registry;
}

function pluginMachineFromState(state: Pick<AppState, "selectedMachine">): PluginMachine {
  const machine = state.selectedMachine;
  if (machine !== undefined) return { id: machine.id, name: machine.name, kind: machine.kind };
  return { id: "local", name: "local", kind: "local" };
}

function machineActivitySubscriptionInputsChanged(previous: AppState, next: AppState): boolean {
  return previous.machines !== next.machines
    || previous.machineStatuses !== next.machineStatuses
    || (previous.selectedMachine?.id ?? "local") !== (next.selectedMachine?.id ?? "local");
}

function shouldSubscribeToMachineActivity(machine: Machine, health: MachineHealth | undefined): boolean {
  return shouldRefreshMachineActivity(machine, health);
}

function shouldRefreshMachineActivity(machine: Machine, health: MachineHealth | undefined): boolean {
  if (machine.kind === "local") return true;
  const status = health?.status ?? machine.status;
  return status === undefined || status === "unknown" || status === "online";
}

function patchChangesState(state: AppState, patch: Partial<AppState>): boolean {
  return Object.entries(patch).some(([key, value]) => Reflect.get(state, key) !== value);
}

function isActive(state: Pick<AppState, "status" | "activity">): boolean {
  return isSessionActive(state.status, state.activity);
}

function isTerminalEvent(event: BrowserRealtimeEvent): event is TerminalUiEvent {
  return event.type === "terminal.created" || event.type === "terminal.exited" || event.type === "terminal.closed";
}

function emptyWorkspaceRouteSurface(): WorkspaceRouteSurface {
  return {};
}

function machineScopedKey(machineId: string, value: string): string {
  return JSON.stringify([machineId, value]);
}

function remoteRouteRestoreRetryDelay(attempt: number): number {
  const index = Math.min(attempt, REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS.length - 1);
  return REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS[index] ?? 30_000;
}

function machineTargetKey(machine: Machine | undefined): string {
  return JSON.stringify(machine === undefined ? ["local"] : [machine.id, machine.kind, machine.name, machine.baseUrl ?? "", machine.createdAt, machine.updatedAt]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function omitWorkspaceDeletionRun(runs: Record<string, TerminalCommandRun>, workspaceId: string): Record<string, TerminalCommandRun> {
  return Object.fromEntries(Object.entries(runs).filter(([candidate]) => candidate !== workspaceId));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => { resolve(); }));
}

function thinkingDescription(level: string): string | undefined {
  switch (level) {
    case "off": return "No reasoning";
    case "minimal": return "Very brief reasoning (~1k tokens)";
    case "low": return "Light reasoning (~2k tokens)";
    case "medium": return "Moderate reasoning (~8k tokens)";
    case "high": return "Deep reasoning (~16k tokens)";
    case "xhigh": return "Maximum reasoning (~32k tokens)";
    default: return undefined; // unknown level from a newer pi: no description
  }
}
