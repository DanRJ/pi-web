/**
 * Internal gateway-only optimistic-concurrency marker for a registered remote
 * machine connection. It contains only the public Machine.updatedAt revision.
 */
export const MACHINE_REVISION_HEADER = "x-pi-web-machine-revision";
export const MACHINE_REVISION_CONFLICT_ERROR = "Machine connection changed; reload settings and try again.";

/** Adds the internal revision marker without exposing connection credentials. */
export function machineRevisionHeaders(expectedRevision: string | undefined): Record<string, string> | undefined {
  return expectedRevision === undefined || expectedRevision === "" ? undefined : { [MACHINE_REVISION_HEADER]: expectedRevision };
}

/** Normalizes Fastify's optional/repeated header shape for revision matching. */
export function expectedMachineRevision(value: string | string[] | undefined): string | undefined {
  const revision = Array.isArray(value) ? value[0] : value;
  return revision === undefined || revision === "" ? undefined : revision;
}
