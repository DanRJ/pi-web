import { api, type Machine, type MachineHealth } from "../api";
import { resetWorkspaceScopedState } from "../appState";
import type { GetState, SetState, UpdateUrl } from "./types";
import type { ProjectController } from "./projectController";

export class MachineController {
  private readonly updateSequences = new Map<string, number>();

  constructor(private readonly getState: GetState, private readonly setState: SetState, private readonly updateUrl: UpdateUrl, private readonly projects: Pick<ProjectController, "loadProjects">) {}

  async loadMachines(routeMachineId?: string): Promise<void> {
    this.setState({ error: "", isLoadingMachines: true });
    try {
      const machines = await api.machines();
      const selectedMachine = await this.selectInitialMachine(machines, routeMachineId);
      const machineIds = new Set(machines.map((machine) => machine.id));
      this.setState({ machines, selectedMachine, machineActivities: filterKeys(this.getState().machineActivities, machineIds), machineRuntimes: filterKeys(this.getState().machineRuntimes, machineIds) });
      void this.refreshMachineHealthFor(machines);
      void this.refreshMachineRuntimeFor(machines);
    } catch (error) {
      this.setState({ error: String(error) });
    } finally {
      this.setState({ isLoadingMachines: false });
    }
  }

  async selectMachine(machine: Machine, options: { updateUrl?: boolean | undefined } = {}): Promise<void> {
    if (this.getState().selectedMachine?.id === machine.id) return;
    this.setState({
      selectedMachine: machine,
      projects: [],
      workspaces: [],
      isLoadingWorkspaces: false,
      selectedProject: undefined,
      selectedWorkspace: undefined,
      selectedSession: undefined,
      messages: [],
      messagePageStart: 0,
      messagePageTotal: 0,
      status: undefined,
      activity: undefined,
      sessionStatuses: {},
      sessionActivities: {},
      sendingPrompts: {},
      workspaceActivities: {},
      workspacesByProjectId: {},
      workspaceDeletionRuns: {},
      activeTerminalCount: 0,
      ...resetWorkspaceScopedState(),
    });
    if (options.updateUrl !== false) this.updateUrl();
    await this.projects.loadProjects();
    void this.refreshMachineHealth(machine.id);
    void this.refreshMachineRuntime(machine.id);
  }

  async addMachine(input: { name: string; baseUrl: string; token?: string }): Promise<Machine | undefined> {
    this.setState({ error: "" });
    try {
      const machine = await api.addMachine(input);
      this.setState({ machines: [...this.getState().machines.filter((candidate) => candidate.id !== machine.id), machine] });
      await this.selectMachine(machine);
      return machine;
    } catch (error) {
      this.setState({ error: String(error) });
      return undefined;
    }
  }

  /** Updates a registered remote without changing its selected project/workspace/session state. */
  async updateMachine(machine: Machine, input: { name?: string; baseUrl?: string; token?: string }): Promise<Machine | undefined> {
    if (machine.kind === "local") {
      this.setState({ error: "The local machine cannot be changed." });
      return undefined;
    }
    const sequence = (this.updateSequences.get(machine.id) ?? 0) + 1;
    this.updateSequences.set(machine.id, sequence);
    this.setState({ error: "" });
    try {
      const updated = await api.updateMachine(machine.id, input);
      if (!this.isCurrentUpdate(updated.id, sequence)) return updated;
      const state = this.getState();
      // Do not use selectMachine here: editing a connection must leave the
      // active project, workspace, session, tool, and drafts intact.
      this.setState({
        machines: state.machines.map((candidate) => candidate.id === updated.id ? updated : candidate),
        ...(state.selectedMachine?.id === updated.id ? { selectedMachine: updated } : {}),
        // The ID is stable across an endpoint/token edit. Remove old results
        // before polling the revised connection so a failed refresh is shown
        // as unknown rather than falsely online or versioned.
        machineStatuses: omitKey(state.machineStatuses, updated.id),
        machineRuntimes: omitKey(state.machineRuntimes, updated.id),
      });
      await this.refreshUpdatedMachine(updated, sequence);
      return updated;
    } catch (error) {
      if (this.isCurrentUpdate(machine.id, sequence)) this.setState({ error: String(error) });
      return undefined;
    }
  }

  async deleteMachine(machine: Machine | undefined = this.getState().selectedMachine, options: { selectFallback?: boolean } = {}): Promise<Machine | undefined> {
    if (machine === undefined) return undefined;
    if (machine.kind === "local") {
      this.setState({ error: "The local machine cannot be removed." });
      return undefined;
    }
    try {
      const wasSelected = this.getState().selectedMachine?.id === machine.id;
      await api.deleteMachine(machine.id);
      const machines = this.getState().machines.filter((candidate) => candidate.id !== machine.id);
      const local = machines.find((candidate) => candidate.id === "local") ?? machines[0];
      this.setState({ machines, machineStatuses: omitKey(this.getState().machineStatuses, machine.id), machineRuntimes: omitKey(this.getState().machineRuntimes, machine.id), machineActivities: omitKey(this.getState().machineActivities, machine.id) });
      if (wasSelected && local !== undefined) {
        if (options.selectFallback === false) return local;
        await this.selectMachine(local);
        return local;
      }
      return undefined;
    } catch (error) {
      this.setState({ error: String(error) });
      return undefined;
    }
  }

  async refreshMachineHealth(machineId = this.getState().selectedMachine?.id ?? "local"): Promise<MachineHealth | undefined> {
    const machine = this.machineSnapshot(machineId);
    if (machine === undefined) return undefined;
    try {
      const health = await api.health(machine.id);
      if (!this.isCurrentMachineSnapshot(machine)) return health;
      this.setState({ machineStatuses: { ...this.getState().machineStatuses, [health.machineId]: health } });
      return health;
    } catch (error) {
      if (this.isCurrentMachineSnapshot(machine)) this.setState({ error: String(error) });
      return undefined;
    }
  }

  async refreshMachineRuntime(machineId = this.getState().selectedMachine?.id ?? "local"): Promise<void> {
    const machine = this.machineSnapshot(machineId);
    if (machine === undefined) return;
    try {
      const runtime = await api.runtime(machine.id, true);
      if (!this.isCurrentMachineSnapshot(machine)) return;
      this.setState({ machineRuntimes: { ...this.getState().machineRuntimes, [runtime.machineId]: runtime } });
    } catch (error) {
      if (this.isCurrentMachineSnapshot(machine)) this.setState({ error: String(error) });
    }
  }

  private isCurrentUpdate(machineId: string, sequence: number): boolean {
    return this.updateSequences.get(machineId) === sequence && this.getState().machines.some((machine) => machine.id === machineId);
  }

  private async refreshUpdatedMachine(machine: Machine, sequence: number): Promise<void> {
    const [healthResult, runtimeResult] = await Promise.allSettled([
      api.health(machine.id),
      api.runtime(machine.id, true),
    ]);
    if (!this.isCurrentUpdate(machine.id, sequence) || !this.isCurrentMachineSnapshot(machine)) return;
    const state = this.getState();
    const patch: Partial<Parameters<SetState>[0]> = {};
    if (healthResult.status === "fulfilled") patch.machineStatuses = { ...state.machineStatuses, [machine.id]: healthResult.value };
    if (runtimeResult.status === "fulfilled") patch.machineRuntimes = { ...state.machineRuntimes, [machine.id]: runtimeResult.value };
    if (Object.keys(patch).length > 0) this.setState(patch);
  }

  private async selectInitialMachine(machines: Machine[], routeMachineId?: string): Promise<Machine | undefined> {
    const requestedMachine = machines.find((machine) => machine.id === (routeMachineId ?? "local"));
    if (requestedMachine === undefined) return this.localMachine(machines);
    if (requestedMachine.kind !== "remote") return requestedMachine;

    const health = await this.safeRemoteHealth(requestedMachine);
    this.setState({
      machineStatuses: { ...this.getState().machineStatuses, [health.machineId]: health },
      ...(health.ok ? {} : { error: `${requestedMachine.name} is unavailable; reconnecting…` }),
    });
    return requestedMachine;
  }

  private async safeRemoteHealth(machine: Machine): Promise<MachineHealth> {
    try {
      return await api.health(machine.id);
    } catch (error) {
      return {
        machineId: machine.id,
        ok: false,
        checkedAt: new Date().toISOString(),
        status: "offline",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private localMachine(machines: Machine[]): Machine | undefined {
    return machines.find((machine) => machine.id === "local") ?? machines[0];
  }

  private async refreshMachineHealthFor(machines: Machine[]): Promise<void> {
    const results = await Promise.allSettled(machines.map(async (machine) => ({ machine, health: await api.health(machine.id) })));
    const health = Object.fromEntries(results.flatMap((result) => result.status === "fulfilled" && this.isCurrentMachineSnapshot(result.value.machine) ? [[result.value.health.machineId, result.value.health] as const] : []));
    if (Object.keys(health).length > 0) this.setState({ machineStatuses: { ...this.getState().machineStatuses, ...health } });
  }

  private async refreshMachineRuntimeFor(machines: Machine[]): Promise<void> {
    const results = await Promise.allSettled(machines.map(async (machine) => ({ machine, runtime: await api.runtime(machine.id) })));
    const runtimes = Object.fromEntries(results.flatMap((result) => result.status === "fulfilled" && this.isCurrentMachineSnapshot(result.value.machine) ? [[result.value.runtime.machineId, result.value.runtime] as const] : []));
    if (Object.keys(runtimes).length > 0) this.setState({ machineRuntimes: { ...this.getState().machineRuntimes, ...runtimes } });
  }

  private machineSnapshot(machineId: string): Machine | undefined {
    return this.getState().machines.find((machine) => machine.id === machineId) ?? (machineId === "local" ? this.getState().selectedMachine?.id === "local" ? this.getState().selectedMachine : undefined : undefined);
  }

  private isCurrentMachineSnapshot(snapshot: Machine): boolean {
    const current = this.getState().machines.find((machine) => machine.id === snapshot.id) ?? (snapshot.id === "local" ? this.getState().selectedMachine?.id === "local" ? this.getState().selectedMachine : undefined : undefined);
    return current !== undefined && machineConnectionKey(current) === machineConnectionKey(snapshot);
  }
}

function omitKey<T>(record: Record<string, T>, keyToOmit: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== keyToOmit));
}

function filterKeys<T>(record: Record<string, T>, allowedKeys: Set<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => allowedKeys.has(key)));
}

/** Public identity plus the server's revision stamp; IDs alone survive endpoint edits. */
function machineConnectionKey(machine: Machine): string {
  return JSON.stringify([machine.id, machine.kind, machine.name, machine.baseUrl ?? "", machine.createdAt, machine.updatedAt]);
}
