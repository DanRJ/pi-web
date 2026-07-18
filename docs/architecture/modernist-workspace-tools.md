# Modernist workspace tools

Modernist turns an active workspace tool into a workbench without changing workspace, session, route, or sidecar ownership. The existing sidecar width and collapse preference remain stored, so switching themes restores the legacy sidecar exactly as it was.

## Layout ownership

At desktop widths above 1180px, the workbench occupies the post-navigation area: a 15rem file tree, a flexible preview/diff and terminal center, and a 23.75rem Git status column. The old workspace-sidecar edge is not rendered while this composition is active.

From 768px through 1180px, it becomes two panes: Files or Terminal is the utility pane, while Preview/Diff or Git is the detail pane. At 767px and below, Tools remains the existing bottom-tab destination and uses an accessible Files, Preview, Git, Diff, and Terminal switcher. File Preview Back returns to Files; Diff Back returns to Git.

Each pane owns its scrolling surface. Code and diffs may scroll horizontally inside their own viewer; the shell never gains horizontal page overflow. Modernist structural tokens provide Archivo, zero-radius controls, and two-pixel rules. The terminal remains intentionally inverted.

## Controller and plugin boundaries

`PiWebApp` remains the only owner of routes, history, selected file/diff/terminal state, terminal lifecycle, and Git polling. The workbench is presentational: it consumes `WorkspacePanelContext` and delegates all mutations through the existing callbacks. It never starts a terminal until an explicit terminal activation or restored terminal deep link, preventing duplicate terminal starts and sockets.

Git status is visible beside every Modernist core tool, so the existing single Git poller is kept active while the expanded workbench is visible. It is still one controller-owned timer, not one poll per pane.

Built-in Files, Git, and Terminal use their stable qualified panel ids (`core:workspace.files`, `core:workspace.git`, and `core:workspace.terminal`). Non-core workspace panels remain opaque plugin-owned full surfaces: PI WEB does not place plugin markup inside a core pane or reinterpret plugin state. Their existing qualified ids, callbacks, route selection, and mobile tab presence remain stable.
