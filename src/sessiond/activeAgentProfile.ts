import { createHash } from "node:crypto";
import type { EffectivePiWebAgentConfig } from "../config.js";
import type { ActiveAgentProfileDescriptor } from "../shared/apiTypes.js";
import { ACTIVE_AGENT_PROFILE_SCHEMA_VERSION } from "../shared/activeAgentProfile.js";

export function createActiveAgentProfileDescriptor(agent: EffectivePiWebAgentConfig): ActiveAgentProfileDescriptor {
  const sessionDirEnvKeys = Object.freeze([...agent.sessionDirEnvKeys]);
  const revisionInput = JSON.stringify({
    schemaVersion: ACTIVE_AGENT_PROFILE_SCHEMA_VERSION,
    command: agent.command,
    dir: agent.dir,
    sessionDirEnvKeys,
  });

  return Object.freeze({
    schemaVersion: ACTIVE_AGENT_PROFILE_SCHEMA_VERSION,
    revision: `sha256:${createHash("sha256").update(revisionInput).digest("hex")}`,
    command: agent.command,
    dir: agent.dir,
    sessionDirEnvKeys,
  });
}
