# Modernist Settings

Modernist presents Settings as a full mobile and dashboard destination while retaining the existing URL-backed `settings` section and the same controller-owned configuration operations. It is not a second settings model: Classic and PI WEB themes keep the dialog presentation, and every presentation uses the same section, selected-machine, auth, package, plugin, and session-daemon contracts.

## Destination ownership

The destination navigation order is Agent, Plugins, Machines, Packages, General, and Keyboard. A destination renders stable section anchors so a Settings URL can restore or navigate to one section without remounting the others. The active anchor is scrolled into view; intentional navigation may focus that section, while passive URL restoration must not move focus.

On mobile, opening Settings records the currently visible Chat, Sessions, or Tools destination. Closing returns to that destination and restores the invoking control when it remains available. A model change from Agent Settings closes the destination before opening the existing picker and deliberately suppresses the Settings focus restoration, so focus cannot jump behind the picker. Authentication continues to use the existing selected-machine auth flow.

## Machine truth and configuration

Machines is a connection-management surface, not a host inventory. It shows only gateway-known endpoint data, the latest health/runtime result, and a reported PI WEB version when available; it never guesses an operating system or a machine capability.

Selecting Local takes the user to machine-scoped settings because the local gateway has no editable remote connection record. A remote row has Configure and Remove actions. Configure opens the shared machine dialog in edit mode:

- name and base URL are prefilled;
- stored bearer tokens are never returned to or displayed by the browser;
- an empty untouched token field omits `token`, preserving the stored token;
- a replacement token is sent normally; and
- **Clear stored token** sends `token: ""` explicitly.

A successful remote edit replaces only the matching machine record (and selected-machine reference when applicable). It preserves the active project, workspace, session, workspace tool, and drafts, then refreshes health and runtime for the revised endpoint. A failed update leaves the existing connection and dialog in place with its accessible error.

### Remote-write revision invariant

A remote machine ID is stable across endpoint and token edits, so it is never sufficient authority for a delayed machine-scoped write. Settings and authentication mutations capture the target's public `Machine.updatedAt` revision when they start and send it in the internal `x-pi-web-machine-revision` header. The gateway compares that value with its registered machine before it constructs a remote client; a mismatch is a conflict and is not forwarded. The header carries no URL or token and is gateway-only. Clients that do not send it remain compatible, but new mutation flows must preserve this bound revision rather than re-reading a machine after an await.

## Related shell invariants

Settings destination behavior is part of the [Modernist session shell](modernist-session-shell.md): it shares the mobile destination lifecycle, focus-return policy, and keyboard viewport constraints. The shell owns presentation and routing; Settings panels remain responsible for their own data loads and saves.
