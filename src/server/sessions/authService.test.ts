import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Credential } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OAuthFlowState } from "../../shared/apiTypes.js";
import { AuthService, type AuthChange } from "./authService.js";
import { OAuthLoginFlowService } from "./oauthLoginFlowService.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AuthService", () => {
  it("saves API keys and emits a global auth change", async () => {
    const { auth, credentials, changes } = await createAuthService();

    await expect(auth.saveApiKey("anthropic", "sk-test")).resolves.toEqual({ accepted: true });

    await expect(credentials.read("anthropic")).resolves.toEqual({ type: "api_key", key: "sk-test" });
    expect(changes).toEqual([{}]);
    auth.dispose();
  });

  it("logs out providers and emits the removed provider id", async () => {
    const { auth, credentials, changes } = await createAuthService({ anthropic: { type: "api_key", key: "sk-test" } });

    await expect(auth.logoutProvider("anthropic")).resolves.toEqual({ accepted: true });

    await expect(credentials.read("anthropic")).resolves.toBeUndefined();
    expect(changes).toEqual([{ removedProviderId: "anthropic" }]);
    auth.dispose();
  });

  it("rejects blank API keys", async () => {
    const { auth, changes } = await createAuthService();

    await expect(auth.saveApiKey("anthropic", "   ")).rejects.toThrow("API key is required");
    expect(changes).toEqual([]);
    auth.dispose();
  });

  it("stores credentials in the configured agent directory", async () => {
    const agentDir = await tempAgentDir();
    const auth = await AuthService.create({ agentDir });

    await auth.saveApiKey("anthropic", "sk-test");

    await expect(readFile(join(agentDir, "auth.json"), "utf8")).resolves.toContain("sk-test");
    auth.dispose();
  });

  it("refreshes auth state after OAuth login completes", async () => {
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore() });
    const authFlows = new CapturingOAuthLoginFlowService();
    const auth = await AuthService.create({ runtime, authFlows });
    const changes: AuthChange[] = [];
    auth.subscribe((change) => { changes.push(change); });
    const refresh = vi.spyOn(runtime, "refresh");
    const provider = runtime.getProviders().find((option) => option.id === "anthropic" && option.auth.oauth !== undefined);
    if (provider === undefined) throw new Error("Expected built-in OAuth provider");

    await expect(auth.startOAuthLogin(provider.id)).resolves.toMatchObject({ providerId: provider.id, providerName: provider.name, status: "running" });

    const startOptions = authFlows.startCalls.at(0);
    if (startOptions === undefined) throw new Error("Expected OAuth flow to start");
    expect(startOptions.providerId).toBe(provider.id);
    expect(startOptions.providerName).toBe(provider.name);
    expect(startOptions.runtime).toBe(runtime);
    expect(changes).toEqual([]);

    refresh.mockClear();
    if (startOptions.onComplete === undefined) throw new Error("Expected OAuth completion callback");
    startOptions.onComplete();
    await vi.waitFor(() => { expect(changes).toEqual([{}]); });

    expect(refresh).toHaveBeenCalledOnce();
    auth.dispose();
    expect(authFlows.disposed).toBe(true);
  });
});

async function createAuthService(seed: Record<string, Credential> = {}) {
  const credentials = new InMemoryCredentialStore();
  for (const [providerId, credential] of Object.entries(seed)) {
    await credentials.modify(providerId, () => Promise.resolve(credential));
  }
  const runtime = await ModelRuntime.create({ credentials });
  const auth = await AuthService.create({ runtime });
  const changes: AuthChange[] = [];
  auth.subscribe((change) => { changes.push(change); });
  return { auth, credentials, changes };
}

async function tempAgentDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-auth-agent-"));
  tempDirs.push(dir);
  return dir;
}

class CapturingOAuthLoginFlowService extends OAuthLoginFlowService {
  readonly startCalls: Parameters<OAuthLoginFlowService["start"]>[0][] = [];
  disposed = false;

  override start(options: Parameters<OAuthLoginFlowService["start"]>[0]): OAuthFlowState {
    this.startCalls.push(options);
    return { flowId: "flow-1", providerId: options.providerId, providerName: options.providerName, status: "running", progress: [] };
  }

  override dispose(): void {
    this.disposed = true;
  }
}
