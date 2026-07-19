# Native Windows local deployment

This repository does **not** currently support native Windows local deployment. The scripts in `scripts/maintenance/windows/` are retained only as read-only preflight tooling while a complete, dependency-injected transaction implementation is designed and independently tested.

## Supported commands

Only these commands are supported:

```powershell
powershell -NoProfile -File scripts/maintenance/windows/bootstrap-local.ps1 -Plan
powershell -NoProfile -File scripts/maintenance/windows/deploy-local.ps1 -Plan
```

They only inspect the checkout, remote `origin/main` via `git ls-remote`, existing listeners, and existing managed state. Each command emits its SHA-256-digested plan to stdout only and persists nothing: it does not write plans, releases, pointers, logs, tasks, services, process records, or temporary deployment state. They do not fetch, change source refs, modify ports, stop/adopt processes, modify Tailscale or WSL, or install global npm packages.

The source proof uses non-writing Git commands only, with `GIT_OPTIONAL_LOCKS=0` scoped to each Git invocation. It requires a clean `HEAD` exactly equal to the full SHA returned by read-only `git ls-remote --refs origin refs/heads/main`, and requires the configured origin identity to equal the deployment policy identity. A dirty checkout or stale remote proof is a refusal.

## Explicitly unsupported operations

`bootstrap-local.ps1 -Apply`, `deploy-local.ps1 -Apply`, `deploy-local.ps1 -Rollback`, and `run-component.ps1` always fail closed with exit code `2`. They do not create, update, delete, start, stop, or adopt Scheduled Tasks; start or stop processes; change an active pointer; create a release; or alter network/system configuration. Restart approval flags are unavailable for the same reason.

A current manual or prior managed-looking installation is **not adoptable**. Do not use these scripts to take ownership of it. Manage or remove it manually using its own documented procedure.

## Plan status and exit values

`bootstrap-local.ps1 -Plan` reports source and unmanaged-listener discovery. It exits `0` when the read-only preflight is clear and `4` when it finds unmanaged/busy listeners or Tailscale; either result still persists nothing.

`deploy-local.ps1 -Plan` validates the source and may report the discovered active state, but intentionally exits `2`: without a supported bootstrap it refuses adoption, and with one present deployment mutation remains unsupported. It persists nothing in either case.

The included PowerShell self-test uses disposable source and managed roots. It fingerprints the source `.git/index` bytes/mtime and the managed-root tree before and after both Plan commands, proving the plans do not mutate either location. Exit values are `0` (clear bootstrap Plan), `2` (unsupported/unmet prerequisite), `3` (validation refusal), `4` (unmanaged/busy discovery), `5` (reserved deployment failure), and `6` (reserved rollback failure).

Do not represent this tooling as a deployer until it has an audited implementation covering immutable task definitions, task/process ownership, staged-process cleanup, pointer rollback/readiness, and injected transaction tests.
