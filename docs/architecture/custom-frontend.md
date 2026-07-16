# Extension UI in the custom frontend

PI WEB embeds the Pi SDK and owns the browser transport. This page records the first delivery slice for extension UI so later work can grow it without confusing it with Pi's terminal RPC protocol or PI WEB's older command picker.

## Ownership and boundaries

- **Retained:** Pi remains responsible for extension discovery, lifecycle handlers, `ctx.ui` calls, agent execution, and session persistence. PI WEB retains its session daemon, transcript stream, session routes, and legacy `CommandResult` command picker.
- **Replaced:** Pi's terminal/RPC stdout dialog transport is not used. PI WEB binds an `ExtensionUIContext` directly with `session.bindExtensions({ mode: "rpc" })`; `rpc` communicates that dialog-capable SDK semantics are available, while PI WEB supplies the implementation.
- **New:** `ExtensionUiBroker` is the server-side boundary between SDK dialog promises and browser-visible request state. It assigns request IDs, holds pending promises, publishes request/resolution/notification events, validates typed browser responses, and makes duplicate responses idempotent.

`CommandResult` remains the result of PI WEB slash commands such as the existing command picker. It must not be used for `ctx.ui` traffic: extension UI has a separate type family and endpoints.

## Browser contract

For a session id, the additive HTTP routes are:

- `GET sessions/:sessionId/extension-ui?cwd=...` returns `{ requests }`, containing currently pending `select`, `confirm`, `input`, or `editor` dialogs.
- `POST sessions/:sessionId/extension-ui/respond` accepts `{ cwd?, response }`, where a response is `{ id, value }`, `{ id, confirmed }`, or `{ id, cancelled: true }`. It returns `accepted`, `already-resolved`, `not-found`, or `wrong-session`, optionally with the authoritative resolution. A response that does not match the pending request (including a select value outside its offered options) returns `invalid-response` with `400`; malformed payloads are also `400`, and a missing session is `404`.

The existing per-session WebSocket also emits `extension-ui.request`, `extension-ui.resolved`, and `extension-ui.notify`. HTTP discovery fills gaps after selection or reconnect, while WebSocket events keep the selected view live. The client treats requests by id as a set and removes them when a resolution arrives. It watermarks each discovery and replays later live mutations over the returned snapshot, so either transport may arrive first without a delayed snapshot erasing an interaction.

The initial browser component renders inline cards for `select`, `confirm`, `input`, and `editor`, plus transient notifications. It deliberately does not redesign the shell or introduce browser-persisted preferences.

## State and lifecycle

Pending and completed extension interactions are ephemeral runtime state, not transcript messages and not session-file data. A fresh browser can rediscover pending dialogs from the server. Completed entries only exist briefly in the connected client and as a bounded broker record to make retries safe.

A browser/WebSocket disconnect never cancels a dialog: the owning Pi session continues and a reconnect can discover it. In contrast, the broker resolves rather than rejects outstanding SDK promises when:

- the extension's abort signal fires;
- PI WEB aborts/stops or closes the owning session;
- the SDK replaces the runtime session during a rebind;
- PI WEB disposes its session service; or
- an optional dialog timeout elapses.

Cancellation returns the SDK's normal fallback (`undefined` for select/input/editor and `false` for confirm). This prevents extension handlers from hanging and avoids unhandled promise rejections during teardown. Rebind cancellation uses the previously bound session id because the SDK updates `runtime.session` before invoking its rebind callback.

## Compatibility

The adapter uses the public Pi SDK `ExtensionUIContext` and `bindExtensions` API, with the SDK's documented `rpc` mode. It does not require Pi's process-level RPC mode, change extension source code, or alter Pi/Pi Web session persistence. Older remote PI WEB daemons can still serve the chat: failed additive discovery leaves the current dialog state untouched. Remote use requires the two HTTP routes in the federation allowlist.

## Incremental delivery

1. This slice supports `ctx.ui.select`, `confirm`, `input`, `editor`, and `notify`, server-owned pending discovery, typed response submission, WebSocket convergence, reconnect reconciliation, and inline cards.
2. Future slices can add more non-terminal UI primitives only by extending the explicit shared protocol and broker tests.
3. Shell redesign, personal preferences, multi-agent experiences, and platform migration remain out of scope; they must not be coupled to this transport boundary.
