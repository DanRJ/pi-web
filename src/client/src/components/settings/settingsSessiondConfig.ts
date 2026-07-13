import type { PiWebConfigResponse, PiWebConfigValues } from "../../api";

export function spawnSessionsConfigPatch(enabled: boolean): PiWebConfigValues {
  return { spawnSessions: enabled };
}

export function subsessionsConfigPatch(enabled: boolean): PiWebConfigValues {
  return { subsessions: enabled };
}

export function agentFieldConfigPatch(
  baseConfig: PiWebConfigValues,
  field: "command" | "dir",
  rawValue: string,
): PiWebConfigValues {
  const value = rawValue.trim();
  const agent: NonNullable<PiWebConfigValues["agent"]> = { ...(baseConfig.agent ?? {}) };
  if (field === "command") {
    if (value === "") delete agent.command;
    else agent.command = value;
  } else if (value === "") {
    delete agent.dir;
  } else {
    agent.dir = value;
  }
  return { agent };
}

export function mergeSelectedMachineSessiondConfig(base: PiWebConfigResponse, selectedMachine: PiWebConfigResponse): PiWebConfigResponse {
  return {
    ...base,
    config: { ...base.config, ...selectedMachine.config },
    effectiveConfig: { ...base.effectiveConfig, ...selectedMachine.effectiveConfig },
    envOverrides: {
      ...base.envOverrides,
      spawnSessions: selectedMachine.envOverrides.spawnSessions,
      subsessions: selectedMachine.envOverrides.subsessions,
      agentCommand: selectedMachine.envOverrides.agentCommand,
      agentDir: selectedMachine.envOverrides.agentDir,
      agentSessionDir: selectedMachine.envOverrides.agentSessionDir,
    },
  };
}
