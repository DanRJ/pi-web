# Modernist session shell

Modernist is the built-in PI WEB visual direction for the application shell. It has light and dark themes plus an auto pair, registered through the same theme contribution registry and stored preference used by every other theme.

## Theme behavior

- A fresh browser with no saved theme preference starts with the Modernist auto pair. Existing `pi-web-app-theme` values are never migrated or overwritten.
- The pair follows `prefers-color-scheme` while Auto is enabled. The session-header toggle resolves the currently visible pair member, switches to its opposite, and records that explicit choice.
- Modernist Light uses contrast-safe `#d1270d` for small semantic accent and success text against its paper ground. Modernist Dark uses `#ff6a4a` where small text needs AA contrast.
- Only bundled Archivo Latin 400, 600, and 800 WOFF2 faces are used; no network font request is made. Classic and PI WEB themes retain their existing structural defaults.

## Structural tokens and ownership

Theme colours continue to use the public 35-token theme API. The shell consumes optional structural hooks with stock fallbacks: body, heading and control fonts; heading weight; control radius; divider width; spacing; focus ring; and navigation width. Third-party themes do not need to define these hooks.

Modernist supplies zero-radius controls, two-pixel dividers, Archivo, and a `16.5rem` navigation target. Component-specific hooks preserve legacy details that should not follow a global divider change: conversation-meter markers retain their border and a running tool keeps its glyph unless a theme opts into the Modernist spinner. The shell owns grid tracks, breakpoints, panel resizing, and collapsed state; themes do not.

`app-session-header` is presentational. `PiWebApp` owns session/workspace/model/activity inputs and stop/theme callbacks. The compact header retains the current title, status, theme toggle, and Stop when available; it does not duplicate navigation, Actions, settings, pause, elapsed-time, notification, or account controls.

## Transcript hierarchy and truthfulness

The chat surface is a scrollable transcript with readable assistant prose, a distinct right-aligned user block, retained history/reconnect controls, and a small activity dock. Code, tables, tool results, paths, and diffs own horizontal scrolling inside their own surfaces; they must not widen the page.

Technical transcript runs are collapsed native disclosures until opened. Their summaries project only structural event state and explicitly recognized tracked-subsession state. They never invent completion percentages, inferred phases, or progress from opaque tool text. Subsession identifiers and paths wrap or ellipsize at narrow widths rather than forcing the transcript wider.

A catch-up notice is shown only while the session's partial-stream flag says that this browser joined an existing response late. It is not a generic loading or progress indicator, and final transcript refresh remains the source of the complete reply.

Server queue rows are split into Steering and Follow-ups lanes because that is the ownership and ordering supplied by the server payload; no cross-lane chronology is fabricated. A server status count remains authoritative when it disagrees with listed text. Client pending-start sends remain visibly separate. **Clear queue** clears only the supported server queue and leaves active work running. **Stop** is shown when work is stoppable; its title and queue note promise queue clearing only when that authoritative server count is positive.

The composer remains the existing controller-owned CodeMirror editor. Draft storage, slash and file completions, paste/drop/file capture, attachment delivery, model/thinking selection, shell mode, steer/follow-up behavior, send, and Stop are preserved. Streaming status updates avoid remounting the editor when their rendered model and thinking fields have not changed. On narrow screens, a yielding model label is the only action-row content allowed to truncate; attach, send, steer, and Stop controls retain their touch targets and labels.

Extension interaction cards stay in transcript flow and retain request/retry/removed reconciliation state. Their spacing, focus ring, and coarse-pointer target sizing are visual-only and do not change callback ownership.

## Mobile shell and keyboard viewport

At `<=767px`, the app uses a safe-area-aware bottom tablist in this fixed order: Chat, Sessions, Tools, Settings. Chat retains the real transcript and composer; Sessions uses the canonical navigation panel; Tools keeps a mounted workspace-panel instance and its accessible tool sub-navigation; Settings uses the existing dialog and restores focus to the prior visible destination. Dashboard and desktop/tablet workspace layouts remain distinct from those destinations.

The shell is one normal grid: header/transcript/composer are above the bottom destination tablist, not fixed independently. At phone widths, header details may collapse but title, status, theme, and Stop remain available. Transcript padding prevents the activity dock from obscuring the final event. Queue lanes, event summaries, metadata, and subsession rows have bounded text behavior, and every transcript/tool/code surface contains its own overflow.

### Manual mobile visual check

DOM tests cover control names and native disclosure semantics, but do not pretend to measure browser layout. Before shipping a mobile shell change, manually inspect Modernist Light and Dark at a 390×844 viewport with a long session title and active Stop control, then open a queued-message lane and an event disclosure. Confirm the controls remain reachable and no header, transcript, or composer surface overflows horizontally.

Mobile browsers that support it are asked to resize content for interactive widgets. While connected, the visual-viewport bridge mirrors the visual viewport height and layout-coordinate bottom (`offsetTop + height`) into inherited CSS properties. The shell uses that visible bottom, with `100dvh` fallback, so normal grid content rises with an IME even on iOS viewport panning.

The composer is never fixed or conditionally hidden. The bridge supplies a bounded editor height; CodeMirror itself scrolls while the non-shrinking action row keeps coarse-pointer targets. Safe-area padding is separate from keyboard measurement and is applied only where app display mode requires it. Desktop, standalone PWA, and browsers without `VisualViewport` retain their existing layout, using `innerHeight` as the bridge fallback when available. Reduced-motion preferences disable shell and activity animations rather than changing interaction state.

## Dashboard

The dashboard is a distinct top-level page rather than a workspace tool, panel, or mobile destination. It retains the Modernist structural language: Archivo, zero-radius controls, two-pixel rules, flat light/dark token surfaces, and a responsive three/two/one-column grid. Running, waiting, idle, and error states always include text or an icon in addition to visual treatment; errors use an ink rule and X rather than a red fill. The running spinner respects reduced-motion preferences.

On narrow screens the existing bottom navigation remains intact. Dashboard is entered from Sessions/navigation and leaving it restores Chat, Sessions, Tools, or Settings without changing their destination semantics or the keyboard viewport bridge.
