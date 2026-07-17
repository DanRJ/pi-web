import { describe, expect, it } from "vitest";
import { getLoginProviderOptions, getLogoutProviderOptions, isApiKeyLoginProvider, type AuthProviderRuntime } from "./authProviderOptions";

function runtime(): AuthProviderRuntime {
  const credentials = [{ providerId: "openai", type: "api_key" as const }];
  const providers = [
    { id: "anthropic", name: "Anthropic", auth: { oauth: {}, apiKey: {} } },
    { id: "github-copilot", name: "GitHub Copilot", auth: { oauth: {} } },
    { id: "openai-codex", name: "ChatGPT Plus/Pro (Codex Subscription)", auth: { oauth: {}, apiKey: {} } },
    { id: "openai", name: "OpenAI", auth: { apiKey: {} } },
    { id: "custom", name: "Custom", auth: { apiKey: {} } },
  ];
  return {
    getProviders: () => providers,
    listCredentials: () => Promise.resolve(credentials),
    getProviderAuthStatus: (provider: string) => (provider === "openai" ? { configured: true, source: "stored" } : { configured: false }),
  };
}

describe("auth provider options", () => {
  it("keeps OAuth-only providers out of API key login options", () => {
    expect(isApiKeyLoginProvider("openai-codex", new Set(["openai-codex"]))).toBe(false);
    expect(isApiKeyLoginProvider("github-copilot", new Set(["github-copilot"]))).toBe(false);
    expect(isApiKeyLoginProvider("openai", new Set(["openai-codex"]))).toBe(true);
  });

  it("builds login options for OAuth-only, dual-auth, and API-key providers", async () => {
    const options = await getLoginProviderOptions(runtime());
    expect(options).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "anthropic", authType: "oauth" }),
      expect.objectContaining({ id: "anthropic", authType: "api_key" }),
      expect.objectContaining({ id: "openai", authType: "api_key", status: { configured: true, source: "stored" } }),
      expect.objectContaining({ id: "openai-codex", authType: "oauth" }),
    ]));
    expect(options).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "openai-codex", authType: "api_key" })]));
  });

  it("returns only currently stored credentials for logout", async () => {
    expect(await getLogoutProviderOptions(runtime())).toEqual([
      expect.objectContaining({ id: "openai", authType: "api_key" }),
    ]);
  });
});
