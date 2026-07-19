import { api as defaultApi, type AuthProviderOption, type AuthType, type OAuthFlowState, type SessionStatus } from "../api";
import type { AppState, AuthDialogState, AuthMachineTarget } from "../appState";
import { type GetState, type SetState } from "./types";

type OAuthDialogState = Extract<AuthDialogState, { step: "oauth" }>;

export interface AuthControllerDependencies {
  api?: typeof defaultApi;
  pollIntervalMs?: number;
}

export class AuthController {
  private readonly api: typeof defaultApi;
  private readonly pollIntervalMs: number;
  private oauthOperationGeneration = 0;
  private pollGeneration = 0;
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
    this.oauthOperationGeneration += 1;
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
    if (provider.authType === "oauth" || provider.loginFlow === "interactive") await this.startLoginFlow(provider, dialog.target);
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
    const operationGeneration = this.oauthOperationGeneration;
    const flowId = dialog.flow.flowId;
    const requestId = request.requestId;
    const responseValue = value ?? dialog.inputValue ?? "";
    const clean = { ...dialog };
    delete clean.error;
    this.setState({ authDialog: { ...clean, responding: true } });
    try {
      const flow = await this.api.respondOAuthFlow(flowId, requestId, responseValue, dialog.target.id, dialog.target.revision);
      const current = this.currentOAuthDialog(operationGeneration, flowId, dialog.target);
      if (flow.flowId !== flowId || current === undefined || oauthRequestId(current.flow) !== requestId) return;
      this.updateOAuthFlow(flow, dialog.target);
    } catch (error) {
      const current = this.currentOAuthDialog(operationGeneration, flowId, dialog.target);
      if (current === undefined || oauthRequestId(current.flow) !== requestId) return;
      this.setState({ authDialog: { ...current, responding: false, error: String(error) } });
    }
  }

  async cancelOAuth(): Promise<void> {
    const dialog = this.getState().authDialog;
    if (dialog?.step !== "oauth") {
      this.closeDialog();
      return;
    }
    const flowId = dialog.flow.flowId;
    const target = dialog.target;
    this.closeDialog();
    try {
      await this.api.cancelOAuthFlow(flowId, target.id, target.revision);
    } catch {
      // Best-effort cancel. The dialog is already closed either way.
    }
  }

  closeDialog(): void {
    this.oauthOperationGeneration += 1;
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
      if (provider.authType === "oauth" || provider.loginFlow === "interactive") await this.startLoginFlow(provider, target);
      else this.setState({ authDialog: { step: "apiKey", target, provider, value: "" } });
    } catch (error) {
      if (this.isCurrentTarget(target)) this.setState({ error: String(error) });
    }
  }

  private async startLoginFlow(provider: AuthProviderOption, target: AuthMachineTarget): Promise<void> {
    if (!this.isCurrentTarget(target)) {
      this.closeDialog();
      return;
    }
    if (this.rejectRemoteOAuth("login", provider, target)) return;
    const operationGeneration = ++this.oauthOperationGeneration;
    this.stopPolling();
    try {
      const flow = provider.authType === "oauth"
        ? await this.api.startOAuthLogin(provider.id, target.id, target.revision)
        : await this.api.startInteractiveApiKeyLogin(provider.id, target.id, target.revision);
      if (operationGeneration !== this.oauthOperationGeneration || !this.isCurrentTarget(target)) {
        // A stale start must not leave a daemon-owned interactive flow running.
        if (flow.status === "running") void this.api.cancelOAuthFlow(flow.flowId, target.id, target.revision).catch(() => undefined);
        return;
      }
      this.updateOAuthFlow(flow, target);
      if (flow.status === "running") this.startPolling(flow.flowId, target, operationGeneration);
    } catch (error) {
      if (operationGeneration === this.oauthOperationGeneration && this.isCurrentTarget(target)) this.setState({ error: String(error) });
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
    if (flow.status === "error" || flow.status === "cancelled") {
      this.oauthOperationGeneration += 1;
      this.stopPolling();
    }
    const existing = this.getState().authDialog;
    const previousInput = existing?.step === "oauth" && existing.flow.flowId === flow.flowId ? existing.inputValue ?? "" : "";
    const previousRequestId = existing?.step === "oauth" ? oauthRequestId(existing.flow) : undefined;
    const newRequestId = oauthRequestId(flow);
    const sameRequest = previousRequestId !== undefined && previousRequestId === newRequestId;
    const inputValue = sameRequest ? previousInput : "";
    const responding = sameRequest && existing?.step === "oauth" ? existing.responding === true : false;
    this.setState({ authDialog: { step: "oauth", target, flow, inputValue, responding } });
  }

  private startPolling(flowId: string, target: AuthMachineTarget, operationGeneration = this.oauthOperationGeneration): void {
    this.stopPolling();
    const pollGeneration = this.pollGeneration;
    this.pollTimer = window.setInterval(() => { void this.poll(flowId, target, operationGeneration, pollGeneration); }, this.pollIntervalMs);
  }

  private stopPolling(): void {
    this.pollGeneration += 1;
    if (this.pollTimer === undefined) return;
    window.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  private async poll(flowId: string, target: AuthMachineTarget, operationGeneration: number, pollGeneration: number): Promise<void> {
    if (pollGeneration !== this.pollGeneration) return;
    const dialog = this.currentOAuthDialog(operationGeneration, flowId, target);
    if (dialog === undefined) {
      this.stopPolling();
      const current = this.getState().authDialog;
      if (current?.step === "oauth" && current.flow.flowId === flowId && current.target.requestKey === target.requestKey && !this.isCurrentTarget(target)) this.setState({ authDialog: undefined });
      return;
    }
    const requestId = oauthRequestId(dialog.flow);
    try {
      const flow = await this.api.oauthFlow(flowId, target.id);
      const current = this.currentOAuthDialog(operationGeneration, flowId, target);
      if (flow.flowId !== flowId || pollGeneration !== this.pollGeneration || current === undefined || oauthRequestId(current.flow) !== requestId) return;
      this.updateOAuthFlow(flow, target);
    } catch (error) {
      const current = this.currentOAuthDialog(operationGeneration, flowId, target);
      if (pollGeneration !== this.pollGeneration || current === undefined || oauthRequestId(current.flow) !== requestId) return;
      this.stopPolling();
      this.setState({ authDialog: { ...current, error: String(error) } });
    }
  }

  private currentOAuthDialog(operationGeneration: number, flowId: string, target: AuthMachineTarget): OAuthDialogState | undefined {
    if (operationGeneration !== this.oauthOperationGeneration || !this.isCurrentTarget(target)) return undefined;
    const dialog = this.getState().authDialog;
    return dialog?.step === "oauth" && dialog.flow.flowId === flowId && dialog.target.requestKey === target.requestKey ? dialog : undefined;
  }

  private async refreshStatus(target: AuthMachineTarget): Promise<void> {
    const session = this.session();
    if (session === undefined || !this.isCurrentTarget(target)) return;
    try {
      const status = await this.api.status(session, target.id);
      const current = this.session();
      if (!this.isCurrentTarget(target) || current?.id !== session.id || current.cwd !== session.cwd) return;
      this.applyStatus(status);
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

function oauthRequestId(flow: OAuthFlowState): string | undefined {
  return flow.prompt?.requestId ?? flow.select?.requestId;
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
