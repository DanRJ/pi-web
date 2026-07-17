import type { AppState } from "../appState";
import { LOCAL_MACHINE_ID } from "../machineKeys";

export function selectedMachineId(state: Pick<AppState, "selectedMachine">): string {
  return state.selectedMachine?.id ?? LOCAL_MACHINE_ID;
}

export type GetState = () => AppState;
export type SetState = (patch: Partial<AppState>) => void;
export type UpdateUrl = (options?: { replace?: boolean | undefined }) => void;

export interface RouteTarget {
  workspaceId?: string | undefined;
  sessionId?: string | undefined;
  updateUrl?: boolean | undefined;
  /** Select only the explicit workspace, never a remembered fallback. */
  selectWorkspace?: boolean | undefined;
  /** Do not revive a remembered session after selecting a workspace. */
  selectSession?: boolean | undefined;
}
