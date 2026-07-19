import { describe, expect, it } from "vitest";
import { api as defaultApi, type AuthProviderOption, type OAuthFlowState, type SessionInfo, type SessionStatus } from "../api";
import { initialAppState, type AppState, type AuthMachineTarget } from "../appState";
import { AuthController, parseAuthSlashCommand } from "./authController";

describe("parseAuthSlashCommand", () => {
  it("parses login and logout commands", () => {
    expect(parseAuthSlashCommand("/login")).toEqual({ command: "login" });
    expect(parseAuthSlashCommand("/logout")).toEqual({ command: "logout" });
  });

  it("parses provider arguments", () => {
    expect(parseAuthSlashCommand("/login openai")).toEqual({ command: "login", providerId: "openai" });
    expect(parseAuthSlashCommand("/logout openai-codex ")).toEqual({ command: "logout", providerId: "openai-codex" });
  });

  it("ignores non-auth commands and extra arguments", () => {
    expect(parseAuthSlashCommand("/model")).toBeUndefined();
    expect(parseAuthSlashCommand("hello /login")).toBeUndefined();
    expect(parseAuthSlashCommand("/login openai extra")).toBeUndefined();
  });
});

describe("AuthController", () => {
  it("uses auth type to disambiguate provider options with the same id", async () => {
    const providers = [authProvider("anthropic", "oauth"), authProvider("anthropic", "api_key")];
    const { controller, getState } = createController({ authDialog: { step: "providers", mode: "login", providers } });

    await controller.selectLoginProvider("anthropic", "api_key");

    expect(getState().authDialog).toMatchObject({ step: "apiKey", provider: { id: "anthropic", authType: "api_key" } });
  });

  it("keeps OAuth prompt input and submit state across poll refreshes for the same request", async () => {
    const flow = oauthFlow({ prompt: { requestId: "request-1", message: "Paste callback", kind: "manual" } });
    const { controller, getState } = createController(
      { authDialog: { step: "oauth", flow, inputValue: "https://callback", responding: true } },
      { respondOAuthFlow: () => Promise.resolve(oauthFlow({ prompt: { requestId: "request-1", message: "Paste callback", kind: "manual" }, progress: ["Still waiting"] })) },
    );

    await controller.respondOAuth();

    expect(getState().authDialog).toMatchObject({ step: "oauth", inputValue: "https://callback", responding: true });
  });

  it("resets OAuth prompt input and submit state when the request id changes", async () => {
    const flow = oauthFlow({ prompt: { requestId: "request-1", message: "Paste callback", kind: "manual" } });
    const { controller, getState } = createController(
      { authDialog: { step: "oauth", flow, inputValue: "https://callback", responding: true } },
      {
        respondOAuthFlow: () => Promise.resolve(oauthFlow({
          select: { requestId: "request-2", message: "Choose an account", options: [{ value: "acct-1", label: "Account 1" }] },
          progress: ["Need account selection"],
        })),
      },
    );

    await controller.respondOAuth();

    expect(getState().authDialog).toMatchObject({
      step: "oauth",
      flow: { select: { requestId: "request-2" } },
      inputValue: "",
      responding: false,
    });
  });

  it("closes the OAuth dialog and refreshes selected session status when the flow completes", async () => {
    const flow = oauthFlow({ prompt: { requestId: "request-1", message: "Paste callback", kind: "manual" } });
    const session = sessionInfo("session-1");
    const refreshedStatus = sessionStatus(session.id);
    const respondCalls: { flowId: string; requestId: string; value: string; machineId: string | undefined }[] = [];
    const statusCalls: { session: Parameters<typeof defaultApi.status>[0]; machineId: string | undefined }[] = [];
    const appliedStatuses: SessionStatus[] = [];
    const { controller, getState } = createController(
      { selectedSession: session, authDialog: { step: "oauth", flow, inputValue: "https://callback" } },
      {
        respondOAuthFlow: (flowId, requestId, value, machineId) => {
          respondCalls.push({ flowId, requestId, value, machineId });
          return Promise.resolve(oauthFlow({ status: "complete" }));
        },
        status: (sessionArg, machineId) => {
          statusCalls.push({ session: sessionArg, machineId });
          return Promise.resolve(refreshedStatus);
        },
      },
      (status) => { appliedStatuses.push(status); },
    );

    await controller.respondOAuth();
    await flushMicrotasks();

    expect(respondCalls).toEqual([{ flowId: "flow-1", requestId: "request-1", value: "https://callback", machineId: "local" }]);
    expect(getState().authDialog).toBeUndefined();
    expect(statusCalls).toEqual([{ session, machineId: "local" }]);
    expect(appliedStatuses).toEqual([refreshedStatus]);
  });

  it("leaves the OAuth dialog ready to retry if responding fails", async () => {
    const flow = oauthFlow({ prompt: { requestId: "request-1", message: "Paste callback", kind: "manual" } });
    const { controller, getState } = createController(
      { authDialog: { step: "oauth", flow, inputValue: "https://callback", responding: true } },
      { respondOAuthFlow: () => Promise.reject(new Error("Invalid callback")) },
    );

    await controller.respondOAuth();

    expect(getState().authDialog).toMatchObject({
      step: "oauth",
      flow,
      inputValue: "https://callback",
      responding: false,
      error: "Error: Invalid callback",
    });
  });

  it("cancels the active OAuth flow and closes the dialog even when cancellation fails", async () => {
    const flow = oauthFlow({ prompt: { requestId: "request-1", message: "Paste callback", kind: "manual" } });
    const cancelCalls: { flowId: string; machineId: string | undefined }[] = [];
    const { controller, getState } = createController(
      { authDialog: { step: "oauth", flow } },
      {
        cancelOAuthFlow: (flowId, machineId) => {
          cancelCalls.push({ flowId, machineId });
          return Promise.reject(new Error("Cancel unavailable"));
        },
      },
    );

    await controller.cancelOAuth();

    expect(cancelCalls).toEqual([{ flowId: "flow-1", machineId: "local" }]);
    expect(getState().authDialog).toBeUndefined();
  });

  it("validates API key input before saving and clears the validation error when edited", async () => {
    const saveCalls: { providerId: string; key: string; machineId: string | undefined }[] = [];
    const provider = authProvider("openai", "api_key");
    const { controller, getState } = createController(
      { authDialog: { step: "apiKey", provider, value: "   " } },
      {
        saveApiKey: (providerId, key, machineId) => {
          saveCalls.push({ providerId, key, machineId });
          return Promise.resolve({ accepted: true });
        },
      },
    );

    await controller.saveApiKey();

    expect(saveCalls).toEqual([]);
    expect(getState().authDialog).toMatchObject({ step: "apiKey", error: "API key is required" });

    controller.updateApiKey("sk-live");

    expect(getState().authDialog).toMatchObject({ step: "apiKey", value: "sk-live" });
    expect(getState().authDialog).not.toHaveProperty("error");
  });

  it("saves a trimmed API key on the selected machine and refreshes selected session status", async () => {
    const saveCalls: { providerId: string; key: string; machineId: string | undefined }[] = [];
    const statusCalls: { session: Parameters<typeof defaultApi.status>[0]; machineId: string | undefined }[] = [];
    const appliedStatuses: SessionStatus[] = [];
    const provider = authProvider("openai", "api_key");
    const session = sessionInfo("session-1");
    const refreshedStatus = sessionStatus(session.id);
    const { controller, getState } = createController(
      {
        selectedMachine: remoteMachine("remote-1"),
        selectedSession: session,
        authDialog: { step: "apiKey", provider, value: "  sk-live  " },
      },
      {
        saveApiKey: (providerId, key, machineId) => {
          saveCalls.push({ providerId, key, machineId });
          return Promise.resolve({ accepted: true });
        },
        status: (sessionArg, machineId) => {
          statusCalls.push({ session: sessionArg, machineId });
          return Promise.resolve(refreshedStatus);
        },
      },
      (status) => { appliedStatuses.push(status); },
    );

    await controller.saveApiKey();
    await flushMicrotasks();

    expect(saveCalls).toEqual([{ providerId: "openai", key: "sk-live", machineId: "remote-1" }]);
    expect(getState().authDialog).toBeUndefined();
    expect(statusCalls).toEqual([{ session, machineId: "remote-1" }]);
    expect(appliedStatuses).toEqual([refreshedStatus]);
  });

  it("keeps the API key dialog open with an error if saving fails", async () => {
    const provider = authProvider("openai", "api_key");
    const { controller, getState } = createController(
      { authDialog: { step: "apiKey", provider, value: "sk-live" } },
      { saveApiKey: () => Promise.reject(new Error("Denied")) },
    );

    await controller.saveApiKey();

    expect(getState().authDialog).toMatchObject({ step: "apiKey", value: "sk-live", saving: false, error: "Error: Denied" });
  });

  it("discards a deferred provider response after switching from machine A to B", async () => {
    const providers = deferred<{ providers: AuthProviderOption[] }>();
    const { controller, getState, patchState } = createController(
      { selectedMachine: remoteMachine("a") },
      { authProviders: () => providers.promise },
    );

    await controller.openLogin();
    const loading = controller.chooseLoginMethod("api_key");
    patchState({ selectedMachine: remoteMachine("b") });
    controller.handleMachineTargetChange();
    providers.resolve({ providers: [authProvider("openai", "api_key")] });
    await loading;

    expect(getState().authDialog).toBeUndefined();
  });

  it("keeps API key requests bound to machine A when selection changes to B", async () => {
    const save = deferred<{ accepted: true }>();
    const calls: string[] = [];
    const provider = authProvider("openai", "api_key");
    const { controller, getState, patchState } = createController(
      { selectedMachine: remoteMachine("a"), authDialog: { step: "apiKey", provider, value: "key" } },
      { saveApiKey: (_provider, _key, machineId) => { calls.push(machineId ?? ""); return save.promise; } },
    );

    const saving = controller.saveApiKey();
    patchState({ selectedMachine: remoteMachine("b") });
    controller.handleMachineTargetChange();
    save.resolve({ accepted: true });
    await saving;

    expect(calls).toEqual(["a"]);
    expect(getState().authDialog).toBeUndefined();
  });

  it("keeps a deferred auth write bound to the captured revision after an endpoint patch", async () => {
    const save = deferred<{ accepted: true }>();
    const revisions: (string | undefined)[] = [];
    const provider = authProvider("openai", "api_key");
    const original = remoteMachine("a");
    const { controller, getState, patchState } = createController(
      { selectedMachine: original, authDialog: { step: "apiKey", provider, value: "key" } },
      { saveApiKey: (_provider, _key, _machineId, revision) => { revisions.push(revision); return save.promise; } },
    );

    const pending = controller.saveApiKey();
    patchState({ selectedMachine: { ...original, baseUrl: "https://new.example", updatedAt: "2026-02-01T00:00:00.000Z" } });
    controller.handleMachineTargetChange();
    save.resolve({ accepted: true });
    await pending;

    expect(revisions).toEqual(["2026-01-01T00:00:00.000Z"]);
    expect(getState().authDialog).toBeUndefined();
  });

  it("keeps logout requests bound to machine A when selection changes to B", async () => {
    const logout = deferred<{ accepted: true }>();
    const calls: string[] = [];
    const provider = authProvider("openai", "api_key");
    const { controller, getState, patchState } = createController(
      { selectedMachine: remoteMachine("a"), authDialog: { step: "logout", providers: [provider] } },
      { logoutProvider: (_provider, machineId) => { calls.push(machineId ?? ""); return logout.promise; } },
    );

    const pending = controller.logoutProvider(provider.id);
    patchState({ selectedMachine: remoteMachine("b") });
    controller.handleMachineTargetChange();
    logout.resolve({ accepted: true });
    await pending;

    expect(calls).toEqual(["a"]);
    expect(getState().authDialog).toBeUndefined();
  });

  it("discards a deferred OAuth continuation after switching from machine A to B", async () => {
    const continuation = deferred<OAuthFlowState>();
    const flow = oauthFlow({ prompt: { requestId: "request-1", message: "Paste callback", kind: "manual" } });
    const { controller, getState, patchState } = createController(
      { selectedMachine: remoteMachine("a"), authDialog: { step: "oauth", flow, inputValue: "callback" } },
      { respondOAuthFlow: () => continuation.promise },
    );

    const pending = controller.respondOAuth();
    patchState({ selectedMachine: remoteMachine("b") });
    controller.handleMachineTargetChange();
    continuation.resolve(oauthFlow({ status: "complete" }));
    await pending;

    expect(getState().authDialog).toBeUndefined();
  });
});

type AuthDialogInput =
  | { step: "method" }
  | Omit<Extract<NonNullable<AppState["authDialog"]>, { step: "providers" }>, "target">
  | Omit<Extract<NonNullable<AppState["authDialog"]>, { step: "apiKey" }>, "target">
  | Omit<Extract<NonNullable<AppState["authDialog"]>, { step: "oauth" }>, "target">
  | Omit<Extract<NonNullable<AppState["authDialog"]>, { step: "logout" }>, "target">;

function createController(
  statePatch: Omit<Partial<AppState>, "authDialog"> & { authDialog?: AuthDialogInput },
  apiPatch: Partial<typeof defaultApi> = {},
  applyStatus: (status: SessionStatus) => void = () => undefined,
) {
  const machine = statePatch.selectedMachine;
  const target: AuthMachineTarget = {
    id: machine?.id ?? "local",
    kind: machine?.kind ?? "local",
    ...(machine?.baseUrl === undefined ? {} : { baseUrl: machine.baseUrl }),
    ...(machine?.kind === "remote" ? { revision: machine.updatedAt } : {}),
    requestKey: JSON.stringify(machine === undefined ? ["local"] : [machine.id, machine.kind, machine.name, machine.baseUrl ?? "", machine.createdAt, machine.updatedAt]),
  };
  const authDialog = authDialogWithTarget(statePatch.authDialog, target);
  let state: AppState = { ...initialAppState(), ...statePatch, authDialog };
  const api = { ...defaultApi, ...apiPatch };
  const controller = new AuthController(
    () => state,
    (patch) => { state = { ...state, ...patch }; },
    applyStatus,
    { api },
  );
  return { controller, getState: () => state, patchState: (patch: Partial<AppState>) => { state = { ...state, ...patch }; } };
}

function authDialogWithTarget(dialog: AuthDialogInput | undefined, target: AuthMachineTarget): AppState["authDialog"] {
  if (dialog === undefined) return undefined;
  if (dialog.step === "method") return { step: "method", target };
  return { ...dialog, target };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function remoteMachine(id: string): NonNullable<AppState["selectedMachine"]> {
  return {
    id,
    name: "Remote",
    kind: "remote",
    baseUrl: "https://remote.example",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function sessionInfo(id: string): SessionInfo {
  return {
    id,
    cwd: "/repo",
    path: `/tmp/${id}.jsonl`,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 0,
    firstMessage: "",
  };
}

function sessionStatus(sessionId: string): SessionStatus {
  return {
    sessionId,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

function authProvider(id: string, authType: "oauth" | "api_key"): AuthProviderOption {
  return { id, authType, name: `${id} ${authType}`, status: { configured: false } };
}

function oauthFlow(patch: Partial<OAuthFlowState> = {}): OAuthFlowState {
  return {
    flowId: "flow-1",
    providerId: "anthropic",
    providerName: "Anthropic",
    status: "running",
    progress: [],
    ...patch,
  };
}
