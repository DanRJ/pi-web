import { api as defaultApi, type AuthProviderOption, type AuthType, type OAuthFlowState, type SessionStatus } from "../api";
import type { AppState, AuthMachineTarget } from "../appState";
import { type GetState, type SetState } from "./types";

export interface AuthControllerDependencies {
  api?: typeof defaultApi;
  pollIntervalMs?: number;
}

export class AuthController {
  private readonly api: typeof defaultApi;
  private readonly pollIntervalMs: number;
  private pollTimer: number | undefined;

  constructor(
    private readonly getState: GetState,
    private readonly setState: SetState,
    private readonly applyStatus: (status: SessionStatus) => void,
    deps: AuthControllerDependencies = {},
  ) {
    this.api = deps.api ?? defaultApi;
    this.pollIntervalMs = deps.pollIntervalMs ?? 1000;
  }

  dispose(): void {
    this.stopPolling();
  }

  /** Closes auth immediately when selection or the selected connection revision changes. */
  handleMachineTargetChange(): void {
    const dialog = this.getState().authDialog;
    if (dialog === undefined || this.isCurrentTarget(dialog.target)) return;
    this.stopPolling();
    if (dialog.step === "oauth") void this.api.cancelOAuthFlow(dialog.flow.flowId, dialog.target.id, dialog.target.revision).catch(() => undefined);
    this.setState({ authDialog: undefined });
  }

  handleSlashCommand(text: string): boolean {
    const parsed = parseAuthSlashCommand(text);
    if (parsed === undefined) return false;
    if (parsed.command === "login") void this.openLogin(parsed.providerId);
    else void this.openLogout(parsed.providerId);
    return true;
  }

  async openLogin(providerId?: string): Promise<void> {
    const target = this.target();
    if (providerId !== undefined && providerId !== "") {
      await this.openLoginProvider(providerId, target);
      return;
    }
    this.setState({ authDialog: { step: "method", target } });
  }

  async chooseLoginMethod(authType: AuthType): Promise<void> {
    const dialog = this.getState().authDialog;
    if (dialog?.step !== "method" || !this.isCurrentTarget(dialog.target)) {
      this.closeDialog();
      return;
    }
    const target = dialog.target;
    try {
      const { providers } = await this.api.authProviders({ mode: "login", authType, machineId: target.id });
      if (!this.isCurrentTarget(target) || this.getState().authDialog !== dialog) return;
      this.setState({ authDialog: { step: "providers", target, mode: "login", authType, providers } });
    } catch (error) {
      if (this.isCurrentTarget(target) && this.getState().authDialog === dialog) this.setState({ error: String(error) });
    }
  }

  async selectLoginProvider(providerId: string, authType?: AuthType): Promise<void> {
    const dialog = this.getState().authDialog;
    if (dialog?.step !== "providers") return;
    if (!this.isCurrentTarget(dialog.target)) {
      this.closeDialog();
      return;
    }
    const provider = dialog.providers.find((candidate) => candidate.id === providerId && (authType === undefined || candidate.authType === authType));
    if (provider === undefined) return;
    if (provider.authType === "oauth") await this.startOAuth(provider, dialog.target);
    else this.setState({ authDialog: { step: "apiKey", target: dialog.target, provider, value: "" } });
  }

  updateApiKey(value: string): void {
    const dialog = this.getState().authDialog;
    if (dialog?.step !== "apiKey") return;
    const clean = { ...dialog };
    delete clean.error;
    this.setState({ authDialog: { ...clean, value } });
  }

  async saveApiKey(): Promise<void> {
    const dialog = this.getState().authDialog;
    if (dialog?.step !== "apiKey") return;
    if (!this.isCurrentTarget(dialog.target)) {
      this.closeDialog();
      return;
    }
    const key = dialog.value.trim();
    if (key === "") {
      this.setState({ authDialog: { ...dialog, error: "API key is required" } });
      return;
    }
    const clean = { ...dialog };
    delete clean.error;
    this.setState({ authDialog: { ...clean, saving: true } });
    try {
      await this.api.saveApiKey(dialog.provider.id, key, dialog.target.id, dialog.target.revision);
      const currentDialog = this.getState().authDialog;
      if (!this.isCurrentTarget(dialog.target) || currentDialog?.step !== "apiKey" || currentDialog.target.requestKey !== dialog.target.requestKey) return;
      this.closeDialog();
      void this.refreshStatus(dialog.target);
    } catch (error) {
      const currentDialog = this.getState().authDialog;
      if (this.isCurrentTarget(dialog.target) && currentDialog?.step === "apiKey" && currentDialog.target.requestKey === dialog.target.requestKey) this.setState({ authDialog: { ...dialog, saving: false, error: String(error) } });
    }
  }

  async openLogout(providerId?: string): Promise<void> {
    const target = this.target();
    try {
      const { providers } = await this.api.authProviders({ mode: "logout", machineId: target.id });
      if (!this.isCurrentTarget(target)) return;
      if (providerId !== undefined && providerId !== "") {
        const provider = providers.find((candidate) => candidate.id === providerId);
        if (provider !== undefined && !this.rejectRemoteOAuth("logout", provider, target)) await this.logoutProviderForTarget(provider.id, target);
        else if (provider === undefined) this.setState({ error: `No stored credentials for ${providerId}` });
        return;
      }
      this.setState({ authDialog: { step: "logout", target, providers } });
    } catch (error) {
      if (this.isCurrentTarget(target)) this.setState({ error: String(error) });
    }
  }

  async logoutProvider(providerId: string): Promise<void> {
    const dialog = this.getState().authDialog;
    if (dialog?.step !== "logout") return;
    if (!this.isCurrentTarget(dialog.target)) {
      this.closeDialog();
      return;
    }
    const provider = dialog.providers.find((candidate) => candidate.id === providerId);
    if (provider !== undefined && this.rejectRemoteOAuth("logout", provider, dialog.target)) return;
    await this.logoutProviderForTarget(providerId, dialog.target, dialog);
  }

  private async logoutProviderForTarget(providerId: string, target: AuthMachineTarget, dialog?: AppState["authDialog"]): Promise<void> {
    try {
      await this.api.logoutProvider(providerId, target.id, target.revision);
      if (!this.isCurrentTarget(target)) return;
      if (dialog !== undefined && this.getState().authDialog !== dialog) return;
      this.closeDialog();
      void this.refreshStatus(target);
    } catch (error) {
      if (this.isCurrentTarget(target) && (dialog === undefined || this.getState().authDialog === dialog)) this.setState({ error: String(error) });
    }
  }

  updateOAuthInput(value: string): void {
    const dialog = this.getState().authDialog;
    if (dialog?.step !== "oauth") return;
    const clean = { ...dialog };
    delete clean.error;
    this.setState({ authDialog: { ...clean, inputValue: value } });
  }

  async respondOAuth(value?: string): Promise<void> {
    const dialog = this.getState().authDialog;
    if (dialog?.step !== "oauth") return;
    if (!this.isCurrentTarget(dialog.target)) {
      this.closeDialog();
      return;
    }
    const request = dialog.flow.prompt ?? dialog.flow.select;
    if (request === undefined) return;
    const responseValue = value ?? dialog.inputValue ?? "";
    const clean = { ...dialog };
    delete clean.error;
    this.setState({ authDialog: { ...clean, responding: true } });
    try {
      const flow = await this.api.respondOAuthFlow(dialog.flow.flowId, request.requestId, responseValue, dialog.target.id, dialog.target.revision);
      const currentDialog = this.getState().authDialog;
      if (!this.isCurrentTarget(dialog.target) || currentDialog?.step !== "oauth" || currentDialog.flow.flowId !== dialog.flow.flowId) return;
      this.updateOAuthFlow(flow, dialog.target);
    } catch (error) {
      const currentDialog = this.getState().authDialog;
      if (this.isCurrentTarget(dialog.target) && currentDialog?.step === "oauth" && currentDialog.flow.flowId === dialog.flow.flowId) this.setState({ authDialog: { ...dialog, responding: false, error: String(error) } });
    }
  }

  async cancelOAuth(): Promise<void> {
    const dialog = this.getState().authDialog;
    if (dialog?.step !== "oauth") {
      this.closeDialog();
      return;
    }
    this.stopPolling();
    try {
      await this.api.cancelOAuthFlow(dialog.flow.flowId, dialog.target.id, dialog.target.revision);
    } catch {
      // Best-effort cancel. The dialog closes either way.
    }
    this.closeDialog();
  }

  closeDialog(): void {
    this.stopPolling();
    this.setState({ authDialog: undefined });
  }

  private async openLoginProvider(providerId: string, target: AuthMachineTarget): Promise<void> {
    try {
      const { providers } = await this.api.authProviders({ mode: "login", machineId: target.id });
      if (!this.isCurrentTarget(target)) return;
      const exact = providers.filter((provider) => provider.id === providerId);
      if (exact.length === 0) {
        this.setState({ error: `Auth provider not found: ${providerId}` });
        return;
      }
      if (exact.length > 1) {
        this.setState({ authDialog: { step: "providers", target, mode: "login", providers: exact } });
        return;
      }
      const provider = exact[0];
      if (provider === undefined) return;
      if (provider.authType === "oauth") await this.startOAuth(provider, target);
      else this.setState({ authDialog: { step: "apiKey", target, provider, value: "" } });
    } catch (error) {
      if (this.isCurrentTarget(target)) this.setState({ error: String(error) });
    }
  }

  private async startOAuth(provider: AuthProviderOption, target: AuthMachineTarget): Promise<void> {
    if (!this.isCurrentTarget(target)) {
      this.closeDialog();
      return;
    }
    if (this.rejectRemoteOAuth("login", provider, target)) return;
    try {
      const flow = await this.api.startOAuthLogin(provider.id, target.id, target.revision);
      if (!this.isCurrentTarget(target)) return;
      this.updateOAuthFlow(flow, target);
      this.startPolling(flow.flowId, target);
    } catch (error) {
      if (this.isCurrentTarget(target)) this.setState({ error: String(error) });
    }
  }

  private rejectRemoteOAuth(action: "login" | "logout", provider: AuthProviderOption, target: AuthMachineTarget): boolean {
    if (provider.authType !== "oauth" || target.kind !== "remote") return false;
    const where = target.baseUrl ?? "that remote PI WEB instance";
    this.setState({ error: `OAuth ${action} for remote machines must be configured directly on ${where}.` });
    return true;
  }

  private updateOAuthFlow(flow: OAuthFlowState, target: AuthMachineTarget): void {
    if (!this.isCurrentTarget(target)) return;
    if (flow.status === "complete") {
      this.stopPolling();
      this.closeDialog();
      void this.refreshStatus(target);
      return;
    }
    if (flow.status === "error" || flow.status === "cancelled") this.stopPolling();
    const existing = this.getState().authDialog;
    const previousInput = existing?.step === "oauth" && existing.flow.flowId === flow.flowId ? existing.inputValue ?? "" : "";
    const previousRequestId = existing?.step === "oauth" ? existing.flow.prompt?.requestId ?? existing.flow.select?.requestId : undefined;
    const newRequestId = flow.prompt?.requestId ?? flow.select?.requestId;
    const sameRequest = previousRequestId !== undefined && previousRequestId === newRequestId;
    const inputValue = sameRequest ? previousInput : "";
    const responding = sameRequest && existing?.step === "oauth" ? existing.responding === true : false;
    this.setState({ authDialog: { step: "oauth", target, flow, inputValue, responding } });
  }

  private startPolling(flowId: string, target: AuthMachineTarget): void {
    this.stopPolling();
    this.pollTimer = window.setInterval(() => { void this.poll(flowId, target); }, this.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer === undefined) return;
    window.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  private async poll(flowId: string, target: AuthMachineTarget): Promise<void> {
    const dialog = this.getState().authDialog;
    if (dialog?.step !== "oauth" || dialog.flow.flowId !== flowId || dialog.target.requestKey !== target.requestKey || !this.isCurrentTarget(target)) {
      this.stopPolling();
      if (dialog !== undefined && !this.isCurrentTarget(dialog.target)) this.setState({ authDialog: undefined });
      return;
    }
    try {
      const flow = await this.api.oauthFlow(flowId, target.id);
      const currentDialog = this.getState().authDialog;
      if (this.isCurrentTarget(target) && currentDialog?.step === "oauth" && currentDialog.flow.flowId === flowId) this.updateOAuthFlow(flow, target);
    } catch (error) {
      if (!this.isCurrentTarget(target)) return;
      this.stopPolling();
      const currentDialog = this.getState().authDialog;
      if (currentDialog?.step === "oauth" && currentDialog.flow.flowId === flowId) this.setState({ authDialog: { ...dialog, error: String(error) } });
    }
  }

  private async refreshStatus(target: AuthMachineTarget): Promise<void> {
    const session = this.session();
    if (session === undefined || !this.isCurrentTarget(target)) return;
    try {
      const status = await this.api.status(session, target.id);
      if (this.isCurrentTarget(target)) this.applyStatus(status);
    } catch {
      // Status refresh is opportunistic after login completes.
    }
  }

  private target(): AuthMachineTarget {
    const machine = this.getState().selectedMachine;
    return {
      id: machine?.id ?? "local",
      kind: machine?.kind ?? "local",
      ...(machine?.baseUrl === undefined ? {} : { baseUrl: machine.baseUrl }),
      ...(machine?.kind === "remote" ? { revision: machine.updatedAt } : {}),
      requestKey: JSON.stringify(machine === undefined ? ["local"] : [machine.id, machine.kind, machine.name, machine.baseUrl ?? "", machine.createdAt, machine.updatedAt]),
    };
  }

  private isCurrentTarget(target: AuthMachineTarget): boolean {
    return this.target().requestKey === target.requestKey;
  }

  private session() {
    const session = this.getState().selectedSession;
    if (session === undefined || session.archived === true) return undefined;
    return session;
  }
}

export function parseAuthSlashCommand(text: string): { command: "login" | "logout"; providerId?: string } | undefined {
  const trimmed = text.trim();
  const match = /^\/(login|logout)(?:\s+(\S+))?\s*$/u.exec(trimmed);
  if (match === null) return undefined;
  const command = match[1];
  if (command !== "login" && command !== "logout") return undefined;
  const providerId = match[2];
  return providerId === undefined || providerId === "" ? { command } : { command, providerId };
}

export type { AuthDialogState } from "../appState";
