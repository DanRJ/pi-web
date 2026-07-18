# Session dashboard backend

The session dashboard is a read-only, federated summary of sessions in registered project workspaces. The browser presents it as a top-level `?page=dashboard` surface, separate from the retained workspace/session route underneath it.

## Ownership and data flow

- `sessiond` owns live runtime state, extension UI attention, and the bounded `POST /session-summaries` query.
- The web service owns registered projects/workspaces and joins that context to one daemon snapshot in `GET /api/session-summaries` (also available as `/api/machines/local/session-summaries`).
- `GET /api/session-dashboard` aggregates the local result and configured remote machines. It is always a partial HTTP 200 response: each machine reports `available`, `unsupported`, `offline`, or `error` independently.
- The browser makes one aggregate read and reuses its existing per-machine realtime sockets. It does not open session sockets or poll each dashboard card. Reconnects and `session.created` debounce an aggregate refresh; content-free attention, status, activity, and name events patch visible cards.

Remote aggregation first verifies the `sessions.summarySnapshot` runtime capability, then requests only the remote machine's `/api/session-summaries` endpoint with a finite timeout. Local runtime and summary calls are also bounded; a local timeout or unavailable daemon becomes that machine's `offline`/`error` outcome while the aggregate remains HTTP 200. The aggregate `/api/session-dashboard` endpoint is deliberately not federated, preventing recursive dashboard requests.

## Invariants

- Dashboard reads do not mutate session, archive, or runtime state: they never call `getOrOpen`, create a runtime, bind extensions, or perform archive migration.
- The web service chunks local CWDs to sessiond's shared per-request limit, then merges, deduplicates, and deterministically sorts the snapshots. Sessiond lists each requested CWD at most once per snapshot, uses bounded concurrency, reads archive metadata once, and includes an already-active transient runtime when its CWD was requested.
- Archived session IDs are omitted without archive migration or persistence changes.
- Session summaries contain compact metadata only: IDs, registered CWD context, timestamps, message counts, name/first-message fallback, and derived state. They do not contain transcript bodies, session-file paths, credentials, or extension request payloads.
- Status precedence is fixed: pending extension UI is `waiting`; active work (via `isSessionActive`) is `running`; a current activity error is `errored`; otherwise it is `idle`.
- `session.attention` realtime events contain only the session ID and a boolean. Existing session-scoped extension request/resolution events remain the only mechanism that carries dialog content.

## Browser routing and presentation

`page=dashboard` is intentionally independent of `view`, workspace tools, plugin panel IDs, and mobile destinations. Entering a fresh dashboard route loads only the aggregate and does not restore or open a selected session. Leaving returns to the retained workspace surface. The dashboard's New session chooser reads project workspaces independently, preselects a still-valid retained project/workspace, and selects only the confirmed project and workspace before invoking the existing session-start endpoint; it deliberately does not revive a remembered session. The dashboard and chooser remain mounted until backend creation succeeds. A failed project/workspace/start action restores the retained selection and reports the error in the chooser; while creation is pending its cancellation controls are disabled. The modal contains Tab focus and returns focus to the exact New session trigger when it closes. A dashboard card keeps a canonical ordinary session deep link; primary in-app activation restores the target machine/project/workspace/session before leaving the dashboard, while modified clicks and new-tab activation retain normal browser behavior.

Dashboard cards show partial machine outcomes rather than hiding successful machines behind one unreachable machine. Any explicit desktop or mobile project, workspace, or session selection clears `page=dashboard` only after its target selection succeeds; failed selections leave the dashboard and its error visible rather than navigating to a partial route. If a card's target has become stale or cannot be restored, the dashboard remains visible, restores the prior canonical workspace selection where possible, and shows the restoration error with retry rather than navigating to a half-restored route. `waiting` is derived solely from `needsAttention`; extension content never enters the aggregate or realtime attention signal.

## Operations

`sessiond` advertises its capabilities only at startup. After upgrading to a version that supports `sessions.summarySnapshot`, manually restart the session daemon before expecting dashboard summaries to work. Restart the web service as well when deploying the complete feature.
