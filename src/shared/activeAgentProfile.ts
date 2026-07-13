import type { ActiveAgentProfileDescriptor } from "./apiTypes.js";

export const ACTIVE_AGENT_PROFILE_SCHEMA_VERSION = 1 as const;

const ACTIVE_AGENT_PROFILE_FIELDS = new Set([
  "schemaVersion",
  "revision",
  "command",
  "dir",
  "sessionDirEnvKeys",
]);
const SHA256_REVISION_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export function parseActiveAgentProfileDescriptor(value: unknown): ActiveAgentProfileDescriptor | undefined {
  if (!isRecord(value) || Object.keys(value).some((key) => !ACTIVE_AGENT_PROFILE_FIELDS.has(key))) return undefined;

  const schemaVersion = value["schemaVersion"];
  const revision = value["revision"];
  const command = value["command"];
  const dir = value["dir"];
  const sessionDirEnvKeys = value["sessionDirEnvKeys"];
  if (schemaVersion !== ACTIVE_AGENT_PROFILE_SCHEMA_VERSION) return undefined;
  if (typeof revision !== "string" || !SHA256_REVISION_PATTERN.test(revision)) return undefined;
  if (typeof command !== "string" || command === "" || typeof dir !== "string" || dir === "") return undefined;
  if (!isNonEmptyStringArray(sessionDirEnvKeys)) return undefined;
  if (new Set(sessionDirEnvKeys).size !== sessionDirEnvKeys.length) return undefined;

  return Object.freeze({
    schemaVersion,
    revision,
    command,
    dir,
    sessionDirEnvKeys: Object.freeze([...sessionDirEnvKeys]),
  });
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === "string" && entry !== "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
