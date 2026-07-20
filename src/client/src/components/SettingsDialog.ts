import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppAction } from "../actions";
import { configApi, piPackagesApi, pluginsApi, type Machine, type MachineHealth, type MachineRuntime, type PiPackageMutationResponse, type PiPackageScope, type PiPackagesResponse, type PiWebConfigResponse, type PiWebConfigValues, type PiWebPluginsResponse, type SessionInfo, type SessionStatus } from "../api";
import { settingsSectionAnchor, type SettingsSection } from "../settingsRoute";
import "./settings/SettingsGeneralPanel";
import "./settings/SettingsSessiondPanel";
import "./settings/SettingsPackagesPanel";
import "./settings/SettingsPluginsPanel";
import "./settings/SettingsMachinesPanel";
import "./settings/SettingsShortcutsPanel";
import { friendlyPiPackageErrorMessage, isPiPackageManagementUnsupported, piPackageManagementSupport, piPackageManagementSupportKey, piPackageMutationFollowUpMessage, piPackageTargetLabel, shouldRefreshGatewayPluginsAfterPiPackageMutation, type PiPackageManagementSupport, type PiPackageOperationState, type PiPackageTargetContext } from "./settings/piPackageSettings";
import { loadGatewaySettingsData, loadPiPackagesData } from "./settings/settingsDataLoading";
import { mergeSelectedMachineAccessConfig } from "./settings/settingsMachineAccessConfig";
import { agentProfileSettingsSupport, friendlySelectedMachineSettingsErrorMessage, isAgentProfileSettingsSupported, isSelectedMachineSettingsUnsupported, selectedMachineSettingsSupport, selectedMachineSettingsSupportKey, settingsMachineTarget, settingsMachineTargetLabel, type AgentProfileSettingsSupport, type SelectedMachineSettingsSupport, type SettingsMachineTarget } from "./settings/settingsMachineTarget";
import { mergeSelectedMachinePluginConfig, pluginEnabledConfigPatch } from "./settings/settingsPluginConfig";
import { mergeSelectedMachineSessiondConfig } from "./settings/settingsSessiondConfig";

@customElement("settings-dialog")
export class SettingsDialog extends LitElement {
  @property({ attribute: false }) section: SettingsSection = "general";
  @property({ attribute: false }) actions: AppAction[] = [];
  @property({ attribute: false }) machine: Machine | undefined;
  @property({ attribute: false }) machineRuntime: MachineRuntime | undefined;
  @property({ attribute: false }) machines: readonly Machine[] = [];
  @property({ attribute: false }) machineStatuses: Record<string, MachineHealth> = {};
  @property({ attribute: false }) machineRuntimes: Record<string, MachineRuntime> = {};
  @property({ attribute: false }) session: SessionInfo | undefined;
  @property({ attribute: false }) sessionStatus: SessionStatus | undefined;
  @property({ reflect: true }) presentation: "dialog" | "destination" = "dialog";
  @property({ attribute: false }) onNavigate?: (section: SettingsSection) => void;
  @property({ attribute: false }) onClose?: () => void;
  @property({ attribute: false }) onSelectMachine?: (machine: Machine) => void | Promise<void>;
  @property({ attribute: false }) onAddMachine?: () => void;
  @property({ attribute: false }) onConfigureMachine?: (machine: Machine) => void;
  @property({ attribute: false }) onRemoveMachine?: (machine: Machine) => void | Promise<void>;
  @property({ attribute: false }) onSelectModel?: () => void;
  @property({ attribute: false }) onConfigureAuth?: () => void;
  @property({ attribute: false }) onLogoutAuth?: () => void;
  @property({ attribute: false }) onConfigSaved?: (config: PiWebConfigValues) => void;
  @property({ attribute: false }) onRefreshMachineRuntime?: (machineId: string) => void | Promise<void>;
  @state() private configResponse: PiWebConfigResponse | undefined;
  @state() private accessConfigResponse: PiWebConfigResponse | undefined;
  @state() private sessiondConfigResponse: PiWebConfigResponse | undefined;
  @state() private pluginsResponse: PiWebPluginsResponse | undefined;
  @state() private selectedPluginConfigResponse: PiWebConfigResponse | undefined;
  @state() private selectedPluginsResponse: PiWebPluginsResponse | undefined;
  @state() private packagesResponse: PiPackagesResponse | undefined;
  @state() private loading = true;
  @state() private accessLoading = true;
  @state() private sessiondLoading = true;
  @state() private pluginLoading = true;
  @state() private packageLoading = true;
  @state() private saving = false;
  @state() private packageOperation: PiPackageOperationState | undefined;
  @state() private error = "";
  @state() private accessError = "";
  @state() private sessiondError = "";
  @state() private pluginError = "";
  @state() private packageError = "";
  @state() private savedMessage = "";
  @state() private packageMessage = "";
  private savedMessageTimer: number | undefined;
  private savingTargetKey: string | undefined;
  private loadRequestSeq = 0;
  private accessLoadRequestSeq = 0;
  private sessiondLoadRequestSeq = 0;
  private pluginLoadRequestSeq = 0;
  private packageLoadRequestSeq = 0;
  private packageMutationSeq = 0;
  private gatewaySaveRequestSeq = 0;
  private hasPresentedDestination = false;
  private hasFinishedFirstUpdate = false;
  private skipNextDestinationSectionScroll = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.loadConfig();
    void this.loadAccessConfigForTarget();
    void this.reloadSessiondState();
    void this.loadPluginsForTarget();
    void this.loadPackagesForTarget();
  }

  override firstUpdated(): void {
    this.hasFinishedFirstUpdate = true;
    if (this.presentation === "dialog") {
      this.focusInitialControl();
      return;
    }
    this.hasPresentedDestination = true;
    // Lit invokes firstUpdated and updated in differing order depending on the
    // initial property set, so consume the first section update in either case.
    this.skipNextDestinationSectionScroll = true;
    this.scrollToSection(this.section, false);
    void this.updateComplete.then(() => { this.skipNextDestinationSectionScroll = false; });
  }

  /** Lets the shell hand focus into this modal after it has rendered. */
  focusInitialControl(): void {
    if (this.presentation === "dialog") this.renderRoot.querySelector<HTMLButtonElement>(".close-button")?.focus();
  }

  override disconnectedCallback(): void {
    if (this.savedMessageTimer !== undefined) window.clearTimeout(this.savedMessageTimer);
    this.savedMessageTimer = undefined;
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (this.presentation !== "destination") {
      this.hasPresentedDestination = false;
      this.skipNextDestinationSectionScroll = false;
    } else if (!this.hasFinishedFirstUpdate) {
      // firstUpdated performs the initial passive scroll.
    } else if (changed.has("section") && this.skipNextDestinationSectionScroll) {
      this.skipNextDestinationSectionScroll = false;
    } else if (changed.has("section") && this.hasPresentedDestination) {
      this.scrollToSection(this.section, false);
    } else if (changed.has("presentation") && !this.hasPresentedDestination) {
      this.hasPresentedDestination = true;
      this.scrollToSection(this.section, false);
    }
    const currentTarget = this.settingsTarget();
    if (changed.has("machine")) {
      const previousTarget = settingsMachineTarget(changed.get("machine"));
      if (previousTarget.requestKey !== currentTarget.requestKey) {
        // An edited remote retains its ID. Treat its endpoint/token revision as
        // a new request target so no old connection can populate this surface.
        this.invalidateRequestSequencesForTargetChange();
        this.resetAccessStateForTargetChange();
        this.resetSessiondStateForTargetChange();
        this.resetPluginStateForTargetChange();
        this.resetPackageStateForTargetChange();
        // A gateway save has no machine target and must remain locked until its
        // own response settles. Only release a save owned by the old target.
        if (this.savingTargetKey === previousTarget.requestKey) {
          this.saving = false;
          this.savingTargetKey = undefined;
        }
        if (this.isConnected) {
          void this.loadConfig();
          void this.loadAccessConfigForTarget(currentTarget);
          void this.reloadSessiondState(currentTarget);
          void this.loadPluginsForTarget(currentTarget);
          void this.loadPackagesForTarget(currentTarget);
        }
        return;
      }
    }

    if (!changed.has("machineRuntime")) return;
    if (this.selectedMachineSettingsSupportNeedsReload(changed.get("machineRuntime"), currentTarget)) {
      this.resetAccessStateForTargetChange();
      if (this.isConnected) void this.loadAccessConfigForTarget(currentTarget);
      this.resetSessiondStateForTargetChange();
      if (this.isConnected) void this.loadSessiondConfigForTarget(currentTarget);
      this.resetPluginStateForTargetChange();
      if (this.isConnected) void this.loadPluginsForTarget(currentTarget);
    }
    if (!this.packageManagementSupportNeedsReload(changed.get("machineRuntime"), currentTarget)) return;
    this.resetPackageStateForTargetChange();
    if (this.isConnected) void this.loadPackagesForTarget(currentTarget);
  }

  override render(): TemplateResult {
    return this.presentation === "destination" ? this.renderDestination() : this.renderDialog();
  }

  private renderDialog(): TemplateResult {
    return html`
      <div class="backdrop" @mousedown=${() => this.onClose?.()}>
        <section class="settings-shell" role="dialog" aria-modal="true" aria-label="PI WEB settings" @mousedown=${(event: MouseEvent) => { event.stopPropagation(); }} @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event); }}>
          <header class="settings-header">
            <div><span class="eyebrow">Settings</span><h1>PI WEB</h1></div>
            <button class="close-button" title="Close settings" aria-label="Close settings" @click=${() => this.onClose?.()}>×</button>
          </header>
          <div class="settings-body"><nav class="settings-nav" aria-label="Settings sections">${this.renderLegacyNav()}</nav><main class="settings-content">${this.renderActiveSection()}</main></div>
        </section>
      </div>
    `;
  }

  private renderDestination(): TemplateResult {
    return html`
      <section class="destination-shell" aria-label="PI WEB settings">
        <button class="close-button destination-close" title="Close settings" aria-label="Close settings" @click=${() => this.onClose?.()}>×</button>
        <main class="settings-content destination-content" aria-label="Settings">
          <div class="settings-page-header">
            <h1>Settings</h1>
            <p class="settings-scope">Machine: <strong>${settingsMachineTargetLabel(this.settingsTarget())}</strong> — some settings only apply here</p>
          </div>
          ${this.renderDestinationSections()}
        </main>
      </section>
    `;
  }

  private renderLegacyNav(): TemplateResult[] {
    return [
      this.renderNavButton("general", "General", "Gateway + selected machine"),
      this.renderNavButton("sessiond", "Session daemon", "Selected machine"),
      this.renderNavButton("packages", "Pi packages", "Selected machine"),
      this.renderNavButton("plugins", "PI WEB plugins", "Selected machine"),
      this.renderNavButton("shortcuts", "Keyboard", "Gateway shortcuts"),
    ];
  }

  private renderDestinationSections(): TemplateResult[] {
    return [
      this.renderDestinationSection("sessiond", this.renderActiveSection("sessiond")),
      this.renderDestinationSection("plugins", this.renderActiveSection("plugins")),
      this.renderDestinationSection("machines", this.renderActiveSection("machines")),
      this.renderDestinationSection("packages", this.renderActiveSection("packages")),
      this.renderDestinationSection("general", this.renderActiveSection("general")),
      this.renderDestinationSection("shortcuts", this.renderActiveSection("shortcuts")),
    ];
  }

  private renderDestinationSection(section: SettingsSection, content: TemplateResult): TemplateResult {
    return html`<section id=${settingsSectionAnchor(section)} class="destination-section" tabindex="-1">${content}</section>`;
  }

  private renderActiveSection(section = this.section): TemplateResult {
    // Keep the section -> panel routing in sync with the public
    // `activeSettingsPanelTag` seam below, which tests assert against instead of
    // scraping this template's markup.
    if (section === "sessiond") {
      return html`
        <settings-sessiond-panel
          .configResponse=${this.sessiondConfigResponse}
          .loading=${this.sessiondLoading}
          .saving=${this.saving}
          .error=${this.sessiondError}
          .savedMessage=${this.savedMessage}
          .targetLabel=${settingsMachineTargetLabel(this.settingsTarget())}
          .activeAgentProfile=${this.machineRuntime?.components?.sessiond.activeAgentProfile}
          .agentProfileSupport=${this.agentProfileSettingsSupport()}
          .session=${this.session}
          .sessionStatus=${this.sessionStatus}
          .onSelectModel=${this.onSelectModel}
          .onConfigureAuth=${this.onConfigureAuth}
          .onLogoutAuth=${this.onLogoutAuth}
          .onReload=${() => this.reloadSessiondState()}
          .onSave=${(config: PiWebConfigValues) => this.saveSessiondConfig(config)}
        ></settings-sessiond-panel>
      `;
    }
    if (section === "shortcuts") {
      return html`
        <settings-shortcuts-panel
          .actions=${this.actions}
          .configResponse=${this.configResponse}
          .loading=${this.loading}
          .saving=${this.saving}
          .error=${this.error}
          .savedMessage=${this.savedMessage}
          .onReload=${() => this.loadConfig()}
          .onSave=${(config: PiWebConfigValues) => this.saveConfig(config)}
        ></settings-shortcuts-panel>
      `;
    }
    if (section === "machines") {
      return html`
        <settings-machines-panel
          .machines=${this.machines}
          .selectedMachine=${this.machine}
          .machineStatuses=${this.machineStatuses}
          .machineRuntimes=${this.machineRuntimes}
          .onSelectMachine=${this.onSelectMachine}
          .onAddMachine=${this.onAddMachine}
          .onConfigureMachine=${this.onConfigureMachine}
          .onRemoveMachine=${this.onRemoveMachine}
          .configureDisabled=${this.saving && this.savingTargetKey !== undefined}
        ></settings-machines-panel>
      `;
    }
    if (section === "packages") {
      return html`
        <settings-packages-panel
          .packagesResponse=${this.packagesResponse}
          .targetMachine=${this.packageTarget()}
          .managementSupport=${this.packageManagementSupport()}
          .loading=${this.packageLoading}
          .operation=${this.packageOperation}
          .error=${this.packageError}
          .operationMessage=${this.packageMessage}
          .onReload=${() => this.loadPackagesForTarget()}
          .onInstallPackage=${(source: string) => this.installPiPackage(source)}
          .onRemovePackage=${(source: string, scope: PiPackageScope) => this.removePiPackage(source, scope)}
          .onUpdatePackage=${(source?: string) => this.updatePiPackage(source)}
        ></settings-packages-panel>
      `;
    }
    if (section === "plugins") {
      return html`
        <settings-plugins-panel
          .configResponse=${this.selectedPluginConfigResponse}
          .pluginsResponse=${this.selectedPluginsResponse}
          .loading=${this.pluginLoading}
          .saving=${this.saving}
          .error=${this.pluginError}
          .savedMessage=${this.savedMessage}
          .targetLabel=${settingsMachineTargetLabel(this.settingsTarget())}
          .onReload=${() => this.loadPluginsForTarget()}
          .onTogglePlugin=${(pluginId: string, enabled: boolean) => this.togglePlugin(pluginId, enabled)}
        ></settings-plugins-panel>
      `;
    }
    return html`
      <settings-general-panel
        .configResponse=${this.configResponse}
        .machineConfigResponse=${this.accessConfigResponse}
        .loading=${this.loading}
        .machineLoading=${this.accessLoading}
        .saving=${this.saving}
        .error=${this.error}
        .machineError=${this.accessError}
        .savedMessage=${this.savedMessage}
        .targetLabel=${settingsMachineTargetLabel(this.settingsTarget())}
        .onReload=${() => this.loadConfig()}
        .onReloadMachine=${() => this.loadAccessConfigForTarget()}
        .onSave=${(config: PiWebConfigValues) => this.saveConfig(config)}
        .onSaveMachineConfig=${(config: PiWebConfigValues) => this.saveMachineAccessConfig(config)}
      ></settings-general-panel>
    `;
  }

  private renderNavButton(section: SettingsSection, label: string, detail: string): TemplateResult {
    const selected = this.section === section;
    return html`
      <button class=${selected ? "selected" : ""} aria-current=${selected ? "page" : "false"} @click=${() => { this.navigate(section); }}>
        <strong>${label}</strong>
        <small>${detail}</small>
      </button>
    `;
  }

  private navigate(section: SettingsSection): void {
    if (this.presentation !== "destination") {
      this.onNavigate?.(section);
      return;
    }
    // Sections are all mounted in the destination, so an intentional jump can
    // scroll immediately. Suppress the matching property-update scroll.
    this.skipNextDestinationSectionScroll = true;
    this.onNavigate?.(section);
    this.scrollToSection(section, true);
    void this.updateComplete.then(() => { this.skipNextDestinationSectionScroll = false; });
  }

  private scrollToSection(section: SettingsSection, focus: boolean): void {
    void this.updateComplete.then(() => {
      const content = this.renderRoot.querySelector<HTMLElement>(".destination-content");
      const target = this.renderRoot.querySelector<HTMLElement>(`#${settingsSectionAnchor(section)}`);
      if (content === null || target === null) return;
      const top = content.scrollTop + target.getBoundingClientRect().top - content.getBoundingClientRect().top;
      content.scrollTo({ top, behavior: focus ? "smooth" : "auto" });
      if (focus) target.focus({ preventScroll: true });
    });
  }

  private async loadConfig(): Promise<void> {
    const requestSeq = ++this.loadRequestSeq;
    this.loading = true;
    this.error = "";
    try {
      const result = await loadGatewaySettingsData({
        loadConfig: () => configApi.config(),
        loadPlugins: () => pluginsApi.plugins(),
      });
      if (!this.isCurrentLoad(requestSeq)) return;

      if (result.config !== undefined) this.configResponse = result.config;
      if (result.plugins !== undefined) this.pluginsResponse = result.plugins;
      this.error = result.error;
    } finally {
      if (this.isCurrentLoad(requestSeq)) this.loading = false;
    }
  }

  private async loadAccessConfigForTarget(target = this.settingsTarget()): Promise<void> {
    const requestSeq = ++this.accessLoadRequestSeq;
    const support = this.selectedMachineSettingsSupport(target);
    if (isSelectedMachineSettingsUnsupported(support)) {
      this.accessConfigResponse = undefined;
      this.accessLoading = false;
      this.accessError = support.message ?? `Selected-machine settings are not available on ${settingsMachineTargetLabel(target)}.`;
      return;
    }
    this.accessLoading = true;
    this.accessError = "";
    try {
      const response = await configApi.config(target.id);
      if (!this.isCurrentAccessLoad(requestSeq, target)) return;
      this.accessConfigResponse = response;
    } catch (error) {
      if (this.isCurrentAccessLoad(requestSeq, target)) {
        this.accessError = `Failed to load file access/upload config from ${settingsMachineTargetLabel(target)}: ${friendlySelectedMachineSettingsErrorMessage(errorMessage(error), target)}`;
      }
    } finally {
      if (this.isCurrentAccessLoad(requestSeq, target)) this.accessLoading = false;
    }
  }

  private async reloadSessiondState(target = this.settingsTarget()): Promise<void> {
    await Promise.all([
      this.loadSessiondConfigForTarget(target),
      this.onRefreshMachineRuntime?.(target.id),
    ]);
  }

  private async loadSessiondConfigForTarget(target = this.settingsTarget()): Promise<void> {
    const requestSeq = ++this.sessiondLoadRequestSeq;
    const support = this.selectedMachineSettingsSupport(target);
    if (isSelectedMachineSettingsUnsupported(support)) {
      this.sessiondConfigResponse = undefined;
      this.sessiondLoading = false;
      this.sessiondError = support.message ?? `Selected-machine settings are not available on ${settingsMachineTargetLabel(target)}.`;
      return;
    }
    this.sessiondLoading = true;
    this.sessiondError = "";
    try {
      const response = await configApi.config(target.id);
      if (!this.isCurrentSessiondLoad(requestSeq, target)) return;
      this.sessiondConfigResponse = response;
    } catch (error) {
      if (this.isCurrentSessiondLoad(requestSeq, target)) {
        this.sessiondError = `Failed to load session-daemon config from ${settingsMachineTargetLabel(target)}: ${friendlySelectedMachineSettingsErrorMessage(errorMessage(error), target)}`;
      }
    } finally {
      if (this.isCurrentSessiondLoad(requestSeq, target)) this.sessiondLoading = false;
    }
  }

  private async loadPluginsForTarget(target = this.settingsTarget()): Promise<void> {
    const requestSeq = ++this.pluginLoadRequestSeq;
    const support = this.selectedMachineSettingsSupport(target);
    if (isSelectedMachineSettingsUnsupported(support)) {
      this.selectedPluginConfigResponse = undefined;
      this.selectedPluginsResponse = undefined;
      this.pluginLoading = false;
      this.pluginError = support.message ?? `Selected-machine settings are not available on ${settingsMachineTargetLabel(target)}.`;
      return;
    }
    this.pluginLoading = true;
    this.pluginError = "";
    try {
      const [config, plugins] = await Promise.allSettled([configApi.config(target.id), pluginsApi.plugins(target.id)]);
      if (!this.isCurrentPluginLoad(requestSeq, target)) return;

      const errors: string[] = [];
      if (config.status === "fulfilled") this.selectedPluginConfigResponse = config.value;
      else errors.push(`config: ${friendlySelectedMachineSettingsErrorMessage(errorMessage(config.reason), target)}`);

      if (plugins.status === "fulfilled") this.selectedPluginsResponse = plugins.value;
      else errors.push(`PI WEB plugins: ${friendlySelectedMachineSettingsErrorMessage(errorMessage(plugins.reason), target)}`);

      this.pluginError = errors.length === 0 ? "" : `Failed to load PI WEB plugin settings from ${settingsMachineTargetLabel(target)}: ${errors.join("; ")}`;
    } finally {
      if (this.isCurrentPluginLoad(requestSeq, target)) this.pluginLoading = false;
    }
  }

  private async loadPackagesForTarget(target = this.packageTarget()): Promise<void> {
    const requestSeq = ++this.packageLoadRequestSeq;
    this.packageLoading = true;
    this.packageError = "";
    this.packageMessage = "";
    try {
      const result = await loadPiPackagesData(target, (targetId) => piPackagesApi.packages(targetId), this.packageManagementSupport(target));
      if (!this.isCurrentPackageLoad(requestSeq, target)) return;

      this.packagesResponse = result.packagesResponse;
      this.packageError = result.error;
    } finally {
      if (this.isCurrentPackageLoad(requestSeq, target)) this.packageLoading = false;
    }
  }

  private async togglePlugin(pluginId: string, enabled: boolean): Promise<void> {
    if (this.saving) return;
    const target = this.settingsTarget();
    const support = this.selectedMachineSettingsSupport(target);
    if (isSelectedMachineSettingsUnsupported(support)) {
      this.pluginError = support.message ?? `Selected-machine settings are not available on ${settingsMachineTargetLabel(target)}.`;
      return;
    }
    if (this.selectedPluginConfigResponse === undefined) {
      this.pluginError = `Plugin config is not loaded for ${settingsMachineTargetLabel(target)}. Reload before changing plugin enablement.`;
      return;
    }
    const patch = pluginEnabledConfigPatch(this.selectedPluginConfigResponse.config, pluginId, enabled);
    this.saving = true;
    this.savingTargetKey = target.requestKey;
    this.pluginError = "";
    this.savedMessage = "";
    try {
      const response = await this.saveConfigForTarget(patch, target);
      if (!this.isCurrentSettingsTarget(target)) return;
      this.selectedPluginConfigResponse = response;
      if (target.kind === "local" && this.configResponse !== undefined) {
        this.configResponse = mergeSelectedMachinePluginConfig(this.configResponse, response);
        this.onConfigSaved?.(this.configResponse.effectiveConfig);
      }
      const pluginRefreshError = await this.refreshPluginsForTarget(target);
      if (!this.isCurrentSettingsTarget(target)) return;
      if (pluginRefreshError !== undefined) this.pluginError = pluginRefreshError;
      this.showSavedMessage();
    } catch (error) {
      if (this.isCurrentSettingsTarget(target)) {
        this.pluginError = `Failed to save PI WEB plugin config on ${settingsMachineTargetLabel(target)}: ${friendlySelectedMachineSettingsErrorMessage(errorMessage(error), target)}`;
      }
    } finally {
      this.finishTargetSave(target);
    }
  }

  private async saveConfig(config: PiWebConfigValues): Promise<void> {
    if (this.saving) return;
    // Gateway configuration is global rather than machine-scoped. Keep its
    // lock independent of selection changes until this request settles.
    const saveSeq = ++this.gatewaySaveRequestSeq;
    this.saving = true;
    this.savingTargetKey = undefined;
    this.error = "";
    this.savedMessage = "";
    try {
      const response = await configApi.saveConfig(config);
      if (saveSeq !== this.gatewaySaveRequestSeq) return;
      // A config reload may have started while this save was in flight (for
      // example after a machine switch). It must not overwrite this response.
      this.loadRequestSeq += 1;
      this.configResponse = response;
      this.onConfigSaved?.(response.effectiveConfig);
      this.showSavedMessage();
    } catch (error) {
      if (saveSeq === this.gatewaySaveRequestSeq) this.error = `Failed to save config: ${errorMessage(error)}`;
    } finally {
      if (saveSeq === this.gatewaySaveRequestSeq) this.saving = false;
    }
  }

  private async saveMachineAccessConfig(config: PiWebConfigValues): Promise<void> {
    if (this.saving) return;
    const target = this.settingsTarget();
    const support = this.selectedMachineSettingsSupport(target);
    if (isSelectedMachineSettingsUnsupported(support)) {
      this.accessError = support.message ?? `Selected-machine settings are not available on ${settingsMachineTargetLabel(target)}.`;
      return;
    }
    this.saving = true;
    this.savingTargetKey = target.requestKey;
    this.accessError = "";
    this.savedMessage = "";
    try {
      const response = await this.saveConfigForTarget(config, target);
      if (!this.isCurrentSettingsTarget(target)) return;
      this.accessConfigResponse = response;
      if (target.kind === "local" && this.configResponse !== undefined) {
        this.configResponse = mergeSelectedMachineAccessConfig(this.configResponse, response);
        this.onConfigSaved?.(this.configResponse.effectiveConfig);
      }
      this.showSavedMessage();
    } catch (error) {
      if (this.isCurrentSettingsTarget(target)) {
        this.accessError = `Failed to save file access/upload config on ${settingsMachineTargetLabel(target)}: ${friendlySelectedMachineSettingsErrorMessage(errorMessage(error), target)}`;
      }
    } finally {
      this.finishTargetSave(target);
    }
  }

  private async saveSessiondConfig(config: PiWebConfigValues): Promise<void> {
    if (this.saving) return;
    const target = this.settingsTarget();
    const support = this.selectedMachineSettingsSupport(target);
    if (isSelectedMachineSettingsUnsupported(support)) {
      this.sessiondError = support.message ?? `Selected-machine settings are not available on ${settingsMachineTargetLabel(target)}.`;
      return;
    }
    if (config.agent !== undefined) {
      const profileSupport = this.agentProfileSettingsSupport(target);
      if (!isAgentProfileSettingsSupported(profileSupport)) {
        this.sessiondError = profileSupport.message ?? `Pi-compatible agent profile settings are not available on ${settingsMachineTargetLabel(target)}.`;
        return;
      }
    }
    this.saving = true;
    this.savingTargetKey = target.requestKey;
    this.sessiondError = "";
    this.savedMessage = "";
    try {
      const response = await this.saveConfigForTarget(config, target);
      if (!this.isCurrentSettingsTarget(target)) return;
      this.sessiondConfigResponse = response;
      if (target.kind === "local" && this.configResponse !== undefined) this.configResponse = mergeSelectedMachineSessiondConfig(this.configResponse, response);
      this.showSavedMessage();
    } catch (error) {
      if (this.isCurrentSettingsTarget(target)) {
        this.sessiondError = `Failed to save session-daemon config on ${settingsMachineTargetLabel(target)}: ${friendlySelectedMachineSettingsErrorMessage(errorMessage(error), target)}`;
      }
    } finally {
      this.finishTargetSave(target);
    }
  }

  private async installPiPackage(source: string): Promise<void> {
    const target = this.packageTarget();
    await this.runPiPackageMutation({ kind: "install", source }, "install Pi package", target, () => piPackagesApi.install(source, target.id));
  }

  private async removePiPackage(source: string, scope: PiPackageScope): Promise<void> {
    const target = this.packageTarget();
    await this.runPiPackageMutation({ kind: "remove", source }, "remove Pi package", target, () => piPackagesApi.remove(source, scope, target.id));
  }

  private async updatePiPackage(source?: string): Promise<void> {
    const target = this.packageTarget();
    await this.runPiPackageMutation(source === undefined ? { kind: "update-all" } : { kind: "update", source }, "update Pi packages", target, () => piPackagesApi.update(source, target.id));
  }

  private async runPiPackageMutation(operation: PiPackageOperationState, label: string, target: PiPackageTargetContext, mutate: () => Promise<PiPackageMutationResponse>): Promise<void> {
    const support = this.packageManagementSupport(target);
    if (isPiPackageManagementUnsupported(support)) {
      this.packageError = support.message ?? `Pi package management is not available on ${piPackageTargetLabel(target)}.`;
      throw new Error(this.packageError);
    }
    if (this.saving) throw new Error("A settings operation is already running.");
    const requestSeq = ++this.packageMutationSeq;
    this.packageLoadRequestSeq += 1;
    this.packageLoading = false;
    this.saving = true;
    this.savingTargetKey = target.requestKey;
    this.packageOperation = operation;
    this.packageError = "";
    this.packageMessage = "";
    try {
      const response = await mutate();
      if (!this.isCurrentPackageMutation(requestSeq, target)) return;
      this.packagesResponse = { packages: response.packages };
      const pluginRefreshError = shouldRefreshGatewayPluginsAfterPiPackageMutation(target) ? await this.refreshGatewayPlugins() : undefined;
      if (!this.isCurrentPackageMutation(requestSeq, target)) return;
      if (pluginRefreshError !== undefined) this.packageError = pluginRefreshError;
      this.packageMessage = piPackageMutationFollowUpMessage(response.action, target);
    } catch (error) {
      if (this.isCurrentPackageMutation(requestSeq, target)) this.packageError = `Failed to ${label} on ${piPackageTargetLabel(target)}: ${friendlyPiPackageErrorMessage(errorMessage(error), target)}`;
      throw error;
    } finally {
      if (this.packageMutationSeq === requestSeq && this.isCurrentPackageTarget(target)) this.packageOperation = undefined;
      this.finishTargetSave(target);
    }
  }

  private async refreshGatewayPlugins(): Promise<string | undefined> {
    try {
      this.pluginsResponse = await pluginsApi.plugins();
      return undefined;
    } catch (error) {
      return `Failed to refresh gateway PI WEB plugins: ${errorMessage(error)}`;
    }
  }

  private async refreshPluginsForTarget(target: SettingsMachineTarget): Promise<string | undefined> {
    try {
      const response = await pluginsApi.plugins(target.id);
      if (this.isCurrentSettingsTarget(target)) this.selectedPluginsResponse = response;
      return undefined;
    } catch (error) {
      return `Config saved, but failed to refresh PI WEB plugins from ${settingsMachineTargetLabel(target)}: ${friendlySelectedMachineSettingsErrorMessage(errorMessage(error), target)}`;
    }
  }

  /** Keeps legacy local calls header-free while binding remote writes to their captured revision. */
  private saveConfigForTarget(config: PiWebConfigValues, target: SettingsMachineTarget): Promise<PiWebConfigResponse> {
    return target.revision === undefined
      ? configApi.saveConfig(config, target.id)
      : configApi.saveConfig(config, target.id, target.revision);
  }

  private settingsTarget(): SettingsMachineTarget {
    return settingsMachineTarget(this.machine);
  }

  private packageTarget(): PiPackageTargetContext {
    return this.settingsTarget();
  }

  private selectedMachineSettingsSupport(target = this.settingsTarget()): SelectedMachineSettingsSupport {
    return selectedMachineSettingsSupport(target, this.machineRuntime);
  }

  private agentProfileSettingsSupport(target = this.settingsTarget()): AgentProfileSettingsSupport {
    return agentProfileSettingsSupport(target, this.machineRuntime);
  }

  private selectedMachineSettingsSupportNeedsReload(previousRuntime: MachineRuntime | undefined, target: SettingsMachineTarget): boolean {
    const previousSupport = selectedMachineSettingsSupport(target, previousRuntime);
    const currentSupport = this.selectedMachineSettingsSupport(target);
    return selectedMachineSettingsSupportKey(previousSupport) !== selectedMachineSettingsSupportKey(currentSupport);
  }

  private packageManagementSupport(target = this.packageTarget()): PiPackageManagementSupport {
    return piPackageManagementSupport(target, this.machineRuntime);
  }

  private packageManagementSupportNeedsReload(previousRuntime: MachineRuntime | undefined, target: PiPackageTargetContext): boolean {
    const previousSupport = piPackageManagementSupport(target, previousRuntime);
    const currentSupport = this.packageManagementSupport(target);
    if (piPackageManagementSupportKey(previousSupport) === piPackageManagementSupportKey(currentSupport)) return false;
    return previousSupport.state === "unsupported" || currentSupport.state === "unsupported";
  }

  private finishTargetSave(target: SettingsMachineTarget | PiPackageTargetContext): void {
    if (this.savingTargetKey !== target.requestKey) return;
    this.saving = false;
    this.savingTargetKey = undefined;
  }

  private isCurrentLoad(requestSeq: number): boolean {
    return requestSeq === this.loadRequestSeq;
  }

  private isCurrentAccessLoad(requestSeq: number, target: SettingsMachineTarget): boolean {
    return requestSeq === this.accessLoadRequestSeq && this.isCurrentSettingsTarget(target);
  }

  private isCurrentSessiondLoad(requestSeq: number, target: SettingsMachineTarget): boolean {
    return requestSeq === this.sessiondLoadRequestSeq && this.isCurrentSettingsTarget(target);
  }

  private isCurrentPluginLoad(requestSeq: number, target: SettingsMachineTarget): boolean {
    return requestSeq === this.pluginLoadRequestSeq && this.isCurrentSettingsTarget(target);
  }

  private isCurrentPackageLoad(requestSeq: number, target: PiPackageTargetContext): boolean {
    return requestSeq === this.packageLoadRequestSeq && this.isCurrentPackageTarget(target);
  }

  private isCurrentPackageMutation(requestSeq: number, target: PiPackageTargetContext): boolean {
    return requestSeq === this.packageMutationSeq && this.isCurrentPackageTarget(target);
  }

  private isCurrentPackageTarget(target: PiPackageTargetContext): boolean {
    return this.packageTarget().requestKey === target.requestKey;
  }

  private isCurrentSettingsTarget(target: SettingsMachineTarget): boolean {
    return this.settingsTarget().requestKey === target.requestKey;
  }

  /** Invalidates every in-flight request tied to the previous machine connection. */
  private invalidateRequestSequencesForTargetChange(): void {
    this.loadRequestSeq += 1;
    this.accessLoadRequestSeq += 1;
    this.sessiondLoadRequestSeq += 1;
    this.pluginLoadRequestSeq += 1;
    this.packageLoadRequestSeq += 1;
    this.packageMutationSeq += 1;
  }

  private resetAccessStateForTargetChange(): void {
    this.accessLoading = false;
    this.accessError = "";
    this.accessConfigResponse = undefined;
    this.savedMessage = "";
  }

  private resetSessiondStateForTargetChange(): void {
    this.sessiondLoading = false;
    this.sessiondError = "";
    this.sessiondConfigResponse = undefined;
    this.savedMessage = "";
  }

  private resetPluginStateForTargetChange(): void {
    this.pluginLoading = false;
    this.pluginError = "";
    this.selectedPluginConfigResponse = undefined;
    this.selectedPluginsResponse = undefined;
    this.savedMessage = "";
  }

  private resetPackageStateForTargetChange(): void {
    const hadPackageOperation = this.packageOperation !== undefined;
    this.packageLoading = false;
    this.packageOperation = undefined;
    this.packageMessage = "";
    this.packageError = "";
    this.packagesResponse = undefined;
    if (hadPackageOperation && this.savingTargetKey !== undefined) this.saving = false;
  }

  private showSavedMessage(): void {
    this.savedMessage = "Config saved.";
    if (this.savedMessageTimer !== undefined) window.clearTimeout(this.savedMessageTimer);
    this.savedMessageTimer = window.setTimeout(() => {
      if (this.savedMessage === "Config saved.") this.savedMessage = "";
      this.savedMessageTimer = undefined;
    }, 3000);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.onClose?.();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialogFocusableElements(this.renderRoot);
    if (focusable.length === 0) return;
    const next = nextDialogFocus(focusable, deepActiveElement(this.renderRoot), event.shiftKey);
    event.preventDefault();
    next?.focus();
  }

  static override styles = css`
    :host { position: fixed; inset: 0; z-index: 30; color: var(--pi-text); font: 14px var(--pi-body-font-family, system-ui, sans-serif); }
    :host([presentation="destination"]) { position: static; inset: auto; z-index: auto; display: block; min-width: 0; min-height: 0; height: 100%; }
    .backdrop { box-sizing: border-box; width: 100%; height: 100dvh; display: grid; place-items: center; padding: max(20px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); background: var(--pi-overlay); overflow: hidden; }
    .settings-shell { width: min(980px, 100%); max-height: min(760px, 100%); min-height: min(620px, 100%); display: grid; grid-template-rows: auto minmax(0, 1fr); border: var(--pi-divider-width, 1px) solid var(--pi-border); border-radius: var(--pi-radius-control, 14px); background: var(--pi-bg); box-shadow: 0 20px 60px var(--pi-shadow-strong); overflow: hidden; }
    .settings-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: var(--pi-divider-width, 1px) solid var(--pi-border); }
    .eyebrow { display: block; color: var(--pi-muted); font-family: var(--pi-heading-font-family, inherit); font-size: 11px; font-weight: var(--pi-heading-font-weight, 700); letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 0; font-family: var(--pi-heading-font-family, inherit); font-size: 20px; font-weight: var(--pi-heading-font-weight, 700); line-height: 1.2; }
    button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control, 8px); background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; font-family: var(--pi-control-font-family, system-ui, sans-serif); cursor: pointer; }
    button:focus-visible { outline: var(--pi-focus-ring-width, 2px) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset, 2px); }
    .close-button { width: 34px; height: 34px; display: grid; place-items: center; border: 0; background: transparent; color: var(--pi-muted); padding: 0; font-size: 24px; }
    .close-button:hover, .close-button:focus { color: var(--pi-text); background: var(--pi-surface-hover); }
    .settings-body { min-height: 0; display: grid; grid-template-columns: 220px minmax(0, 1fr); }
    .settings-nav { min-height: 0; padding: 10px; border-right: var(--pi-divider-width, 1px) solid var(--pi-border); background: var(--pi-surface); overflow: auto; }
    .settings-nav button { display: grid; gap: 2px; width: 100%; margin: 0 0 6px; text-align: left; border-color: transparent; background: transparent; }
    .settings-nav button:hover, .settings-nav button:focus { background: var(--pi-surface-hover); }
    .settings-nav button.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    .settings-nav small { color: var(--pi-muted); }
    .settings-content { min-width: 0; min-height: 0; overflow: auto; padding: 18px; }
    .destination-shell { position: relative; display: grid; grid-template-rows: minmax(0, 1fr); height: 100%; min-height: 0; background: var(--pi-bg); }
    .destination-close { position: absolute; top: 1rem; right: 1rem; z-index: 1; }
    .destination-content { max-width: 760px; display: grid; align-content: start; gap: 2rem; padding: 2rem; scroll-behavior: smooth; }
    .settings-page-header { display: grid; gap: .25rem; }
    .settings-page-header h1 { font-size: 1.75rem; }
    .settings-scope { margin: 0; color: var(--pi-muted); line-height: 1.45; }
    .settings-scope strong { color: var(--pi-text); font-weight: var(--pi-heading-font-weight, 700); }
    .destination-section { min-width: 0; scroll-margin-top: 1rem; outline: none; }
    .destination-section:focus-visible { outline: var(--pi-focus-ring-width, 2px) solid var(--pi-accent); outline-offset: .5rem; }
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .destination-shell { font-size: 1rem; }
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .destination-shell button { border-radius: 0; min-height: 2.75rem; }

    @media (max-width: 767px) {
      .backdrop { padding: 0; place-items: stretch; }
      .settings-shell { width: 100%; height: 100dvh; max-height: none; min-height: 0; border: 0; border-radius: 0; }
      .settings-header { padding: max(12px, env(safe-area-inset-top)) 12px 12px; }
      .close-button { width: 2.75rem; height: 2.75rem; }
      .settings-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
      .settings-nav { display: flex; gap: 8px; padding: 8px; border-right: 0; border-bottom: var(--pi-divider-width, 1px) solid var(--pi-border); overflow-x: auto; overflow-y: hidden; }
      .settings-nav button { flex: 0 0 auto; width: auto; min-width: 128px; margin: 0; }
      .settings-content { padding: 14px 12px calc(18px + env(safe-area-inset-bottom)); }
      .destination-close { top: max(.5rem, env(safe-area-inset-top)); right: .5rem; }
      .destination-content { max-width: none; gap: 1.5rem; padding: max(1rem, env(safe-area-inset-top)) 1rem calc(1rem + env(safe-area-inset-bottom)); }
    }
  `;
}

const FOCUSABLE_SELECTOR = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable]:not([contenteditable='false']), [tabindex]:not([tabindex^='-'])";

interface FocusTraversalRoot {
  readonly children: ArrayLike<FocusTraversalNode>;
}

interface FocusTraversalNode extends FocusTraversalRoot {
  readonly shadowRoot: FocusTraversalRoot | null;
  matches(selectors: string): boolean;
}

export interface FocusableElement extends FocusTraversalNode {
  focus(options?: FocusOptions): void;
}

/** Returns keyboard-focusable controls, including controls in nested custom-element shadow roots. */
export function dialogFocusableElements(root: FocusTraversalRoot): FocusableElement[] {
  const focusable: FocusableElement[] = [];
  const visit = (node: FocusTraversalRoot): void => {
    for (const element of Array.from(node.children)) {
      if (isFocusableElement(element)) focusable.push(element);
      if (element.shadowRoot !== null) visit(element.shadowRoot);
      visit(element);
    }
  };
  visit(root);
  return focusable;
}

export function isFocusableElement(element: FocusTraversalNode): element is FocusableElement {
  return "focus" in element && typeof element.focus === "function" && element.matches(FOCUSABLE_SELECTOR);
}

export function nextDialogFocus(focusable: readonly FocusableElement[], current: FocusableElement | undefined, shiftKey: boolean): FocusableElement | undefined {
  if (focusable.length === 0) return undefined;
  const index = current === undefined ? -1 : focusable.indexOf(current);
  return shiftKey
    ? focusable[index <= 0 ? focusable.length - 1 : index - 1]
    : focusable[index === focusable.length - 1 ? 0 : index + 1];
}

function deepActiveElement(root: ParentNode): HTMLElement | undefined {
  let active = activeElementIn(root);
  while (active?.shadowRoot?.activeElement != null) active = active.shadowRoot.activeElement;
  return active instanceof HTMLElement ? active : undefined;
}

function activeElementIn(root: ParentNode): Element | null {
  if (root instanceof Document || root instanceof ShadowRoot) return root.activeElement;
  return root instanceof Node ? root.ownerDocument?.activeElement ?? null : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type SettingsPanelTag =
  | "settings-general-panel"
  | "settings-sessiond-panel"
  | "settings-machines-panel"
  | "settings-packages-panel"
  | "settings-plugins-panel"
  | "settings-shortcuts-panel";

/**
 * The single custom-element panel the settings dialog renders for a section.
 *
 * This is the public routing contract behind `renderActiveSection`: each section
 * maps to exactly one panel element and nothing else (no per-tab "scope note"
 * wrapper). Tests assert this mapping instead of inspecting the rendered
 * `TemplateResult`'s markup.
 */
export function activeSettingsPanelTag(section: SettingsSection): SettingsPanelTag {
  switch (section) {
    case "sessiond":
      return "settings-sessiond-panel";
    case "machines":
      return "settings-machines-panel";
    case "packages":
      return "settings-packages-panel";
    case "plugins":
      return "settings-plugins-panel";
    case "shortcuts":
      return "settings-shortcuts-panel";
    case "general":
      return "settings-general-panel";
  }
}
