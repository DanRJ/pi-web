# Modernist session shell

Modernist is the built-in PI WEB visual direction for the application shell. It has light and dark themes plus an auto pair, registered through the same theme contribution registry and stored preference used by every other theme.

## Theme behavior

- A fresh browser with no saved theme preference starts with the Modernist auto pair. Existing `pi-web-app-theme` values are never migrated or overwritten.
- The pair follows `prefers-color-scheme` while Auto is enabled. The session-header toggle resolves the currently visible pair member, switches to its opposite, and records that explicit choice. This makes a click visibly change the interface even when the system preference is Auto.
- The handoff's base red, `#ec3013`, remains the design reference rather than an exact small-text token. Modernist Light semantic accent and success text use the contrast-safe `#d1270d` ramp value (4.69:1 against the `#f3f2f2` paper ground); Modernist Dark uses `#ff6a4a` where small text needs AA contrast.
- Only Archivo Latin 400, 600, and 800 WOFF2 faces are bundled from `@fontsource/archivo`; no network font request is made.

## Structural tokens

Theme colors continue to use the public 35-token theme API. The shell also consumes inherited structural hooks with stock fallbacks: body, heading and control fonts; heading weight; control radius; divider width; spacing; focus ring; and navigation width. Third-party themes do not need to define any of them.

Modernist supplies zero-radius controls, two-pixel dividers, Archivo, and a `16.5rem` navigation target through those hooks. Component-specific semantic hooks preserve legacy details that should not follow a global divider change: the conversation-meter marker keeps its `2px` border, and a running tool keeps the visible `●` glyph unless a theme opts into the Modernist spinner. The shell continues to own its grid tracks, breakpoints, panel resizing, and collapsed states; only its existing navigation-size variable is fed a different default.

## Component boundaries

`app-session-header` is a presentational Lit component. `PiWebApp` retains controller ownership and passes current session, workspace, model, activity/status, and callbacks for stop and theme selection. Navigation, Actions, and settings remain in their canonical navigation/context layouts; the header deliberately does not duplicate them or invent pause, elapsed-time, notifications, account controls, or composer modes.

Phase A covers shell chrome: the session header, context bar, mobile main tabs, panel edge controls, navigation and shared list styles, plus common machine/project/settings dialog shells.

Phase B extends the same structural hooks to the session surface. Chat uses readable transcript sizing, right-aligned user blocks, visually lighter assistant prose, a retained conversation meter/activity dock, and the existing history and reconnect behavior. Tool and extension interactions use flat bordered cards with state semantics; code and diff surfaces use flat dividers and tokenized addition/removal treatments. The composer and status bar remain the real controls owned by the existing controllers, including attachments, queue/steer/stop, drafts, and CodeMirror behavior.

## Mobile shell

The mobile slice is complete at `<=767px`. It replaces the former horizontal main-tab strip with a safe-area-aware bottom tablist in this fixed order: Chat, Sessions, Tools, Settings. The compact session header remains the real session title/status/theme control; Chat retains the existing transcript and composer rather than introducing a second prompt model.

Sessions reuses the canonical machine, project, workspace, and session navigation panel. Tools keeps one workspace-panel instance and exposes every visible core or plugin workspace contribution through its accessible tool sub-navigation, so terminals and extension panels do not restart merely because a user changes mobile destinations. Settings opens the existing dialog and returns focus to the prior available destination when closed. Desktop and tablet retain their existing session/workspace layouts.

### Keyboard viewport behavior

Mobile browsers that support it are asked to resize content for interactive widgets. The app shell also mirrors the visual viewport's height and layout-coordinate bottom into inherited CSS properties while it is connected. This covers browsers where the layout viewport still extends behind the keyboard and iOS cases where the visual viewport is panned (`offsetTop + height`). The fixed mobile shell uses that visible bottom with a `100dvh` fallback, so the existing bottom destination navigation remains in normal grid flow above the keyboard.

The composer is not fixed or conditionally hidden. On mobile, the bridge supplies a bounded editor height from the visible viewport; CodeMirror continues to scroll while its non-shrinking action row retains coarse-pointer targets. Safe-area padding remains a separate CSS concern and is not included in the keyboard measurement. Desktop, standalone PWA, and browsers without `VisualViewport` retain their existing layout, with `innerHeight` as the bridge fallback when available.

The next Modernist shell slice is the dashboard; it must not be folded into the mobile navigation work.
