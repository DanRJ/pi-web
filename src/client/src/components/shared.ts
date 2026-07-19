import { css } from "lit";

export interface ToolPreview {
  diff?: string;
  firstChangedLine?: number;
  error?: string;
}

export interface ToolExecutionPart {
  type: "toolExecution";
  toolCallId?: string;
  toolName: string;
  summary: string;
  args?: unknown;
  status: "pending" | "running" | "success" | "error";
  resultText?: string;
  content?: unknown;
  details?: unknown;
  preview?: ToolPreview;
}

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
  | { type: "thinking"; text: string }
  | { type: "skillInvocation"; name: string; location: string; content: string }
  | { type: "skillRead"; name: string; path: string; toolCallId?: string }
  | { type: "toolCall"; toolCallId?: string; toolName: string; summary: string; args?: unknown }
  | ToolExecutionPart
  | { type: "toolResult"; toolCallId?: string; toolName: string; text: string; isError: boolean; content?: unknown; details?: unknown }
  | { type: "empty" };

export interface ChatLine {
  role: "user" | "assistant" | "tool" | "system" | "bash" | "skill";
  parts: ChatPart[];
  source?: "compaction" | "branch_summary";
  meta?: {
    timestamp?: string;
    model?: { provider?: string; id?: string; responseId?: string };
  };
}

export interface CompletionItem {
  kind: "command" | "file";
  replaceFrom: number;
  replaceTo: number;
  insertText: string;
  detail: string;
  description?: string;
  cursorOffset?: number;
}

export const appStyles = css`
  /* Mobile browsers already subtract browser controls from 100dvh; reserve bottom safe area only in standalone PWA modes. */
  :host { --pi-app-safe-area-bottom: 0px; position: fixed; top: 0; right: 0; left: 0; display: block; height: 100dvh; box-sizing: border-box; overflow: hidden; padding: env(safe-area-inset-top) env(safe-area-inset-right) var(--pi-app-safe-area-bottom) env(safe-area-inset-left); color: var(--pi-text); background: var(--pi-bg); font: 14px var(--pi-body-font-family, system-ui, sans-serif); }
  :host([pwa-display-mode]) { --pi-app-safe-area-bottom: env(safe-area-inset-bottom); }
  @media (display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui) {
    :host { --pi-app-safe-area-bottom: env(safe-area-inset-bottom); }
  }
  /* The bridge supplies visual-viewport coordinates only while connected. The
     fallback keeps desktop, PWA, and browsers without VisualViewport unchanged. */
  @media (max-width: 767px) {
    :host { height: var(--pi-visible-viewport-bottom, var(--pi-visible-viewport-height, 100dvh)); }
  }
  .shell { --navigation-panel-size: var(--pi-navigation-panel-size, 340px); --workspace-panel-size: minmax(360px, 42vw); --navigation-panel-width: var(--navigation-panel-size); --workspace-panel-width: var(--workspace-panel-size); display: grid; grid-template-columns: var(--navigation-panel-width) 1px minmax(320px, 1fr) 1px var(--workspace-panel-width); height: 100%; min-height: 0; }
  aside { grid-column: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  aside app-navigation-panel { flex: 1 1 auto; min-height: 0; }
  header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-2, 8px); padding: var(--pi-space-3, 12px); border-bottom: var(--pi-divider-width, 1px) solid var(--pi-border); }
  .header-actions { display: flex; align-items: center; gap: 8px; }
  project-list, workspace-list { flex: 0 0 auto; max-height: 26%; min-height: 0; overflow: hidden; border-bottom: var(--pi-divider-width, 1px) solid var(--pi-border-muted); }
  session-list { flex: 1 1 auto; min-height: 0; overflow: hidden; }
  main { grid-column: 3; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .context-bar { position: relative; flex: 0 0 auto; min-width: 0; display: none; align-items: center; gap: 0; padding: 6px 0; border-bottom: var(--pi-divider-width, 1px) solid var(--pi-border-muted); background: var(--pi-bg); }
  .context-bar::before, .context-bar::after { content: ""; position: absolute; top: 0; bottom: 0; z-index: 2; width: 20px; opacity: 0; pointer-events: none; transition: opacity .15s ease; }
  .context-bar::before { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .context-bar::after { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .context-bar.can-scroll-left::before, .context-bar.can-scroll-right::after { opacity: 1; }
  .context-bar-label { display: none; }
  .context-items { flex: 1 1 auto; min-width: 0; display: flex; align-items: stretch; gap: 5px; margin: 0; padding: 0 8px; list-style: none; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scroll-padding-inline: 8px; scrollbar-width: thin; }
  .context-bar.has-context-actions .context-items { padding-right: 52px; scroll-padding-inline: 8px 52px; }
  .context-item { flex: 0 0 auto; min-width: 0; display: flex; }
  .context-actions { position: absolute; top: 6px; right: 0; bottom: 6px; z-index: 3; display: flex; align-items: center; padding: 0 8px 0 0; pointer-events: none; }
  .context-actions::after { content: ""; position: absolute; top: 0; right: 0; bottom: 0; z-index: 0; width: 26px; background: var(--pi-bg); pointer-events: none; }
  .context-chip { flex: 0 0 auto; min-width: 0; display: inline-flex; align-items: baseline; gap: 5px; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-pill-radius, 999px); background: var(--pi-surface); color: var(--pi-text); padding: 4px 8px; font: inherit; text-align: left; }
  .context-chip:hover { background: var(--pi-surface-hover); }
  .context-chip:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
  .context-chip.empty { border-style: dashed; color: var(--pi-muted); }
  .context-kind { display: none; }
  .context-value { min-width: 0; overflow: visible; text-overflow: clip; white-space: nowrap; }
  app-mobile-main-tabs, app-mobile-destination-tabs { display: none; }
  /* Keep the tablist mounted for focus restoration, but let semantic hidden
     outrank every responsive display declaration. */
  app-mobile-destination-tabs[hidden] { display: none !important; }
  .mobile-tabs-frame { position: relative; display: none; flex: 0 0 auto; min-width: 0; border-bottom: var(--pi-divider-width, 1px) solid var(--pi-border); background: var(--pi-bg); }
  .mobile-tabs-frame::before, .mobile-tabs-frame::after { content: ""; position: absolute; top: 0; bottom: 0; z-index: 2; width: 20px; opacity: 0; pointer-events: none; transition: opacity .15s ease; }
  .mobile-tabs-frame::before { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .mobile-tabs-frame::after { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .mobile-tabs-frame.can-scroll-left::before, .mobile-tabs-frame.can-scroll-right::after { opacity: 1; }
  .mobile-tabs { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 8px; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; }
  .mobile-tabs button { flex: 0 0 auto; white-space: nowrap; }
  .mobile-navigation-tab, .mobile-navigation-panel { display: none; }
  .mobile-tabs button.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
  .tab-badge { display: inline-block; min-width: 14px; margin-left: 4px; border: 1px solid var(--pi-success-border); border-radius: var(--pi-pill-radius, 999px); background: var(--pi-success-surface); color: var(--pi-success); padding: 0 5px; font-size: 11px; line-height: 16px; text-align: center; }
  .navigation-panel-edge, .workspace-panel-edge { min-width: 0; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: visible; background: var(--pi-border-muted); z-index: 2; }
  .navigation-panel-edge { grid-column: 2; }
  .workspace-panel-edge { grid-column: 4; }
  .navigation-panel-edge-button, .workspace-panel-edge-button { position: relative; z-index: 1; box-sizing: border-box; display: grid; place-items: center; width: 18px; height: 48px; padding: 0; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-pill-radius, 999px); background: var(--pi-bg); color: var(--pi-muted); opacity: .75; cursor: pointer; }
  .navigation-panel-edge-button:hover, .navigation-panel-edge-button:focus-visible, .workspace-panel-edge-button:hover, .workspace-panel-edge-button:focus-visible { color: var(--pi-text); background: var(--pi-surface-hover); opacity: 1; }
  .shell.navigation-panel-collapsed .navigation-panel-edge-button { transform: translateX(calc(50% - .5px)); }
  .shell.workspace-panel-collapsed .workspace-panel-edge-button { transform: translateX(calc(-50% + .5px)); }
  .navigation-panel-edge-icon, .workspace-panel-edge-icon { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  workspace-panel { grid-column: 5; min-width: 0; min-height: 0; overflow: hidden; }
  .shell.dashboard-page { grid-template-columns: var(--navigation-panel-width) 1px minmax(0, 1fr); }
  .shell.dashboard-page main { grid-column: 3; }
  .dashboard-main session-dashboard { flex: 1 1 auto; min-height: 0; }
  modernist-global-header { display: none; }
  /* Settings is a Modernist destination, not a modal: leave every underlying
     surface mounted while the post-navigation track belongs to settings. */
  .shell[data-settings-destination] { grid-template-columns: var(--navigation-panel-width) var(--pi-divider-width, 2px) minmax(0, 1fr); }
  .shell[data-settings-destination] > settings-dialog { grid-column: 3; grid-row: 1; min-width: 0; min-height: 0; }
  .shell[data-settings-destination] > main,
  .shell[data-settings-destination] > workspace-panel,
  .shell[data-settings-destination] > .workspace-panel-edge { display: none; }
  /* Modernist turns an active workspace tool into the post-navigation workbench.
     The legacy workspace width/collapse values remain stored; this composition
     simply does not consume that sidecar track while it is expanded. */
  @media (min-width: 1181px) {
    /* Modernist desktop owns a separate 56px global row, a hierarchy sidebar,
       and one post-navigation content track. Workspace state stays mounted in
       Chat without creating an implicit sidecar grid track. */
    .shell.modernist-desktop-shell { grid-template-columns: var(--navigation-panel-width) var(--pi-divider-width, 2px) minmax(0, 1fr); grid-template-rows: 56px minmax(0, 1fr); }
    .shell.modernist-desktop-shell > modernist-global-header { grid-column: 1 / -1; grid-row: 1; display: block; min-width: 0; }
    .shell.modernist-desktop-shell > aside { grid-column: 1; grid-row: 2; }
    .shell.modernist-desktop-shell > .navigation-panel-edge { grid-column: 2; grid-row: 2; }
    .shell.modernist-desktop-shell > main,
    .shell.modernist-desktop-shell > settings-dialog,
    .shell.modernist-desktop-shell > workspace-panel { grid-column: 3; grid-row: 2; min-width: 0; }
    .shell.modernist-desktop-shell > .workspace-panel-edge { display: none; }
    .shell.modernist-desktop-shell:not(.modernist-tools-expanded):not([data-settings-destination]) > workspace-panel { display: none; }
    .shell.modernist-desktop-shell main > app-session-header { min-width: 0; overflow: hidden; padding-inline: var(--pi-space-2, 8px); }
    .shell.modernist-desktop-shell main > chat-view,
    .shell.modernist-desktop-shell main > prompt-editor,
    .shell.modernist-desktop-shell main > status-bar { min-width: 0; }
    .shell.modernist-tools-expanded { grid-template-columns: var(--navigation-panel-width) var(--pi-divider-width, 2px) minmax(0, 1fr); }
    .shell.modernist-tools-expanded main { display: none; }
    .shell.modernist-tools-expanded > workspace-panel { grid-column: 3; grid-row: 2; }
    .shell.modernist-tools-expanded > .workspace-panel-edge { display: none; }
    .shell.navigation-panel-collapsed { --navigation-panel-width: 0px; }
    .shell.navigation-panel-collapsed > aside { display: none; }
    .shell.workspace-panel-collapsed { --workspace-panel-width: 0px; }
    .shell.workspace-panel-collapsed > workspace-panel { display: none; }
    .shell.modernist-tools-expanded.workspace-panel-collapsed > workspace-panel { display: flex; }
  }
  @media (min-width: 768px) and (max-width: 1180px) {
    .shell.modernist-tools-expanded { grid-template-rows: minmax(0, 1fr); }
    .shell.modernist-tools-expanded main { display: none; }
    .shell[data-settings-destination] > settings-dialog { grid-column: 3; grid-row: 1; }
    .shell.modernist-tools-expanded > workspace-panel { grid-column: 3; grid-row: 1; }
    .shell.modernist-tools-expanded > .workspace-panel-edge { display: none; }
    .shell:not(.workspace-view):not(.modernist-tools-expanded) > workspace-panel { display: none; }
  }
  @media (max-width: 1180px) {
    .shell { grid-template-columns: var(--navigation-panel-width) 1px minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
    .shell.navigation-panel-collapsed { --navigation-panel-width: 0px; }
    .shell.navigation-panel-collapsed > aside { display: none; }
    aside { grid-row: 1 / 3; }
    .navigation-panel-edge { grid-row: 1 / 3; }
    main { grid-column: 3; grid-row: 1 / 3; }
    app-mobile-main-tabs { display: block; flex: 0 0 auto; min-width: 0; }
    .mobile-tabs-frame { display: flex; }
    .shell.workspace-view main { grid-row: 1; min-height: auto; }
    .shell.dashboard-page main { grid-column: 3; grid-row: 1 / 3; }
    .shell.workspace-view:not(.modernist-tools-expanded) > workspace-panel { grid-column: 3; grid-row: 2; display: flex; border-left: 0; }
    .workspace-panel-edge { display: none; }
    main.workspace-view chat-view, main.workspace-view prompt-editor, main.workspace-view status-bar,
    main.workspace-view .empty { display: none; }
    main.workspace-view { overflow: hidden; }
  }
  @media (max-width: 767px) {
    .shell { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; height: 100%; }
    /* Match the attribute selector's specificity so Settings cannot retain the desktop navigation tracks. */
    .shell[data-settings-destination] { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
    .shell.dashboard-page { grid-template-columns: minmax(0, 1fr); }
    aside, .navigation-panel-edge, .workspace-panel-edge { display: none; }
    main { grid-column: 1; grid-row: 1; }
    .shell > workspace-panel { grid-column: 1; grid-row: 1; display: none; min-height: 0; }
    .shell.dashboard-page main { grid-column: 1; grid-row: 1; display: flex; }
    .shell[data-settings-destination] > settings-dialog { grid-column: 1; grid-row: 1; display: block; min-width: 0; min-height: 0; }
    .shell[data-settings-destination] > main,
    .shell[data-settings-destination] > workspace-panel { display: none; }
    .shell.mobile-destination-chat > workspace-panel,
    .shell.mobile-destination-sessions > workspace-panel,
    .shell.mobile-destination-settings > workspace-panel { display: none; }
    .shell.mobile-destination-tools > main { display: none; }
    .shell.mobile-destination-tools > workspace-panel { grid-column: 1; grid-row: 1; display: flex; }
    /* Chat is an independent mobile destination: keep its transcript and composer visible after selecting a workspace tool. */
    .shell.mobile-destination-chat main.workspace-view chat-view { display: flex; }
    .shell.mobile-destination-chat main.workspace-view prompt-editor,
    .shell.mobile-destination-chat main.workspace-view status-bar,
    .shell.mobile-destination-chat main.workspace-view .empty { display: block; }
    app-mobile-main-tabs, .context-bar { display: none; }
    app-mobile-destination-tabs { grid-column: 1; grid-row: 2; display: block; min-width: 0; }
    .mobile-navigation-panel { display: none; }
    .shell.mobile-destination-sessions main app-session-header,
    .shell.mobile-destination-sessions main chat-view,
    .shell.mobile-destination-sessions main prompt-editor,
    .shell.mobile-destination-sessions main status-bar,
    .shell.mobile-destination-sessions main .empty { display: none; }
    .shell.mobile-destination-sessions .mobile-navigation-panel { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    .shell.mobile-destination-sessions .mobile-navigation-panel app-navigation-panel { flex: 1 1 auto; min-height: 0; }
    .shell.mobile-destination-sessions .mobile-navigation-panel project-list,
    .shell.mobile-destination-sessions .mobile-navigation-panel workspace-list,
    .shell.mobile-destination-sessions .mobile-navigation-panel session-list { flex: 1 1 auto; max-height: none; min-height: 0; overflow: hidden; }
    .shell.mobile-destination-sessions .mobile-navigation-panel project-list[collapsed],
    .shell.mobile-destination-sessions .mobile-navigation-panel workspace-list[collapsed],
    .shell.mobile-destination-sessions .mobile-navigation-panel session-list[collapsed] { flex: 0 0 auto; min-height: auto; overflow: hidden; }
    /* Header status remains available; only the duplicate status strip yields
       space to the normal-flow composer above the keyboard. */
    .shell.mobile-keyboard-focus status-bar,
    .shell.mobile-keyboard-focus.mobile-destination-chat main.workspace-view status-bar { display: none; }
  }
  status-bar { flex: 0 0 auto; }
  chat-view { flex: 1 1 auto; min-height: 0; overflow: hidden; }
  prompt-editor { flex: 0 0 auto; }
  button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control, 8px); background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; font-family: var(--pi-control-font-family, system-ui, sans-serif); }
  button:focus-visible { outline: var(--pi-focus-ring-width, 2px) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset, 2px); }
  .empty { margin: auto; color: var(--pi-muted); }
  .error { padding: 10px 16px; border-bottom: var(--pi-divider-width, 1px) solid var(--pi-border); color: var(--pi-danger); }
  @media (max-width: 767px) { .shell.mobile-destination-sessions main app-session-header { display: none; } }
`;

export const workspacePanelStyles = css`
  :host { display: flex; flex-direction: column; min-height: 0; color: var(--pi-text); background: var(--pi-bg); font: 13px system-ui, sans-serif; container-type: inline-size; }
  header { flex: 0 0 auto; min-width: 0; border-bottom: 1px solid var(--pi-border); }
  .workspace-header-scroll-frame { position: relative; min-width: 0; background: var(--pi-bg); }
  .workspace-header-scroll-frame::before, .workspace-header-scroll-frame::after { content: ""; position: absolute; top: 0; bottom: 0; z-index: 2; width: 18px; opacity: 0; pointer-events: none; transition: opacity .15s ease; }
  .workspace-header-scroll-frame::before { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .workspace-header-scroll-frame::after { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .workspace-header-scroll-frame.can-scroll-left::before, .workspace-header-scroll-frame.can-scroll-right::after { opacity: 1; }
  .workspace-header-strip { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-width: 0; padding: 8px; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; }
  .tabs { flex: 0 0 auto; display: flex; gap: 6px; align-items: center; }
  .tabs button { flex: 0 0 auto; white-space: nowrap; }
  .tabs button.icon-tab { min-width: 34px; }
  button { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--pi-border); border-radius: 7px; background: var(--pi-surface); color: var(--pi-text); padding: 5px 7px; cursor: pointer; }
  button.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
  .tab-icon { flex: 0 0 auto; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .tab-custom-icon { flex: 0 0 auto; width: 16px; height: 16px; display: inline-grid; place-items: center; color: currentColor; pointer-events: none; }
  .tab-custom-icon svg { width: 16px; height: 16px; pointer-events: none; }
  .tab-label { min-width: 0; }
  .tab-badge { flex: 0 0 auto; display: inline-block; min-width: 14px; border: 1px solid var(--pi-success-border); border-radius: var(--pi-pill-radius, 999px); background: var(--pi-success-surface); color: var(--pi-success); padding: 0 5px; font-size: 11px; line-height: 16px; text-align: center; }
  @container (max-width: 430px) {
    .tabs button.icon-tab { justify-content: center; padding-inline: 7px; }
    .tabs button.icon-tab .tab-label { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
  }
  .panel-content { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: auto; }
  .empty-state { box-sizing: border-box; width: min(100%, 380px); margin: auto; padding: 24px; display: grid; gap: 8px; color: var(--pi-muted); text-align: center; }
  .empty-state h2 { margin: 0; color: var(--pi-text); font-size: 15px; line-height: 1.3; }
  .empty-state p { margin: 0; line-height: 1.45; }
  small, .muted { color: var(--pi-muted); }
  @media (max-width: 1180px) { :host(:not([mobileTools])) header { display: none; } }
  /* Tablet workbenches need the existing registered-panel switcher; mobile and desktop already have their own visible controls. */
  @media (min-width: 768px) and (max-width: 1180px) { :host([presentation="modernist-tablet"]) header { display: block; } }
  @media (max-width: 767px) { :host([mobileTools]) .workspace-header-strip { min-height: 2.75rem; padding: 0.25rem 0.5rem; } :host([mobileTools]) button { min-height: 2.75rem; } }
  .workspace-label { min-width: 0; display: inline-flex; align-items: baseline; gap: 5px; max-width: 100%; overflow: hidden; white-space: nowrap; }
  .workspace-label-base, .workspace-label-item, .workspace-label-render { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .workspace-label-item, .workspace-label-render, .workspace-label-separator { color: var(--pi-muted); }
  .workspace-label-link { color: var(--pi-accent); text-decoration: none; }
  .workspace-label-link:hover, .workspace-label-link:focus { text-decoration: underline; }
  .toolbar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 8px; border-bottom: 1px solid var(--pi-border-muted); }
  .toolbar button { margin-left: auto; }
  .stale { border: 1px solid var(--pi-warning-border); border-radius: var(--pi-pill-radius, 999px); color: var(--pi-warning); padding: 1px 6px; font-size: 12px; }
  .git-review { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  .git-review > .split { flex: 1 1 auto; min-height: 0; overflow: hidden; }
  .split { flex: 1 1 auto; min-height: 0; display: grid; grid-template-rows: minmax(160px, 34%) minmax(0, 1fr); }
  .split.status-only { grid-template-rows: minmax(0, 1fr); }
  .list { min-height: 0; overflow: auto; border-bottom: 1px solid var(--pi-border); padding: 6px; }
  .row { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 4px; width: 100%; border: 0; border-radius: 5px; background: transparent; text-align: left; padding: 4px 6px 4px calc(6px + var(--depth, 0) * 14px); }
  .row:hover, .row.selected { background: var(--pi-selection-bg); }
  .row span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .summary { margin: 4px 6px 8px; color: var(--pi-muted); }
  .viewer { min-height: 0; overflow: auto; display: flex; flex-direction: column; }
  .diffs { flex: 1 1 auto; min-height: 0; overflow: auto; display: grid; grid-template-rows: minmax(120px, 1fr) minmax(120px, 1fr); }
  .diffs.single { grid-template-rows: minmax(0, 1fr); }
  .diff-section { min-height: 0; display: flex; flex-direction: column; border-bottom: 1px solid var(--pi-border); }
  .diff-section:last-child { border-bottom: 0; }
  .viewer-header { position: sticky; top: 0; display: flex; justify-content: space-between; gap: 8px; padding: 8px; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg); }
  .viewer-header strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  code-viewer, unified-diff-viewer { flex: 1 1 auto; min-height: 0; }
  .image-preview { flex: 1 1 auto; min-height: 0; box-sizing: border-box; display: flex; align-items: center; justify-content: center; overflow: auto; padding: 16px; }
  .image-preview img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; border: 1px solid var(--pi-border-muted); border-radius: 8px; background-color: var(--pi-surface); background-image: linear-gradient(45deg, color-mix(in srgb, var(--pi-border-muted) 45%, transparent) 25%, transparent 25%), linear-gradient(-45deg, color-mix(in srgb, var(--pi-border-muted) 45%, transparent) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--pi-border-muted) 45%, transparent) 75%), linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--pi-border-muted) 45%, transparent) 75%); background-position: 0 0, 0 8px, 8px -8px, -8px 0; background-size: 16px 16px; box-shadow: 0 8px 24px var(--pi-shadow-soft); }
  pre { margin: 0; padding: 10px; overflow: auto; font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
  p { margin: 10px; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) { font-family: var(--pi-body-font-family, system-ui, sans-serif); }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) header,
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .toolbar,
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .viewer-header,
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .list,
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .diff-section { border-width: var(--pi-divider-width, 2px); }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) button,
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .row,
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .image-preview img { border-radius: 0; }
  @media (pointer: coarse) {
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) button { min-height: 2.75rem; }
  }
  @media (prefers-reduced-motion: reduce) { * { transition: none; animation: none; } }
`;

export const listStyles = css`
  :host { display: flex; flex-direction: column; min-height: 0; overflow: hidden; color: var(--pi-text); font: 14px var(--pi-body-font-family, system-ui, sans-serif); }
  :host([collapsed]) { flex: 0 0 auto; min-height: auto; overflow: hidden; }
  section { box-sizing: border-box; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: var(--pi-space-3, 10px); }
  h2 { flex: 0 0 auto; display: flex; justify-content: space-between; align-items: center; gap: var(--pi-space-2, 8px); margin: 0 0 var(--pi-space-2, 8px); color: var(--pi-muted); font-family: var(--pi-heading-font-family, inherit); font-size: 0.75rem; font-weight: var(--pi-heading-font-weight, 700); letter-spacing: var(--pi-list-heading-letter-spacing, normal); text-transform: uppercase; }
  .list-body { flex: 1 1 auto; min-height: 0; overflow: auto; }
  button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control, 8px); background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; font-family: var(--pi-control-font-family, system-ui, sans-serif); }
  button:focus-visible { outline: var(--pi-focus-ring-width, 2px) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset, 2px); }
  section > button { display: block; width: 100%; text-align: left; margin: 6px 0; }
  .subheading { margin-top: 14px; }
  .section-toggle { display: flex; flex: 1 1 auto; min-width: 0; align-items: center; justify-content: space-between; gap: 8px; width: 100%; border: 0; background: transparent; color: inherit; padding: 0; font: inherit; text-align: left; text-transform: inherit; }
  .section-toggle span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .section-title { display: grid; gap: 2px; min-width: 0; }
  .section-toggle .section-selected { display: block; color: var(--pi-text); font-size: 12px; font-weight: 600; line-height: 1.25; text-transform: none; }
  .section-toggle .section-count { flex: 0 0 auto; display: inline; color: var(--pi-muted); font-size: inherit; }
  .section-toggle small { display: inline; color: inherit; font-size: inherit; }
  .action-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; margin: 6px 0; cursor: pointer; }
  .action-row:focus-visible { outline: var(--pi-focus-ring-width, 2px) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset, 2px); border-radius: var(--pi-radius-control, 8px); }
  .action-row.selected .action-main, .action-row.selected .action-menu-toggle { border-color: var(--pi-accent); background: var(--pi-selection-bg); color: var(--pi-selected-nav-color, var(--pi-text)); font-weight: var(--pi-selected-nav-font-weight, 400); }
  .action-row.archived .action-main { color: var(--pi-muted); }
  .action-main { position: relative; box-sizing: border-box; min-width: 0; width: 100%; border: 1px solid var(--pi-border); border-top-right-radius: 0; border-bottom-right-radius: 0; border-top-left-radius: var(--pi-radius-control, 8px); border-bottom-left-radius: var(--pi-radius-control, 8px); background: var(--pi-surface); color: var(--pi-text); padding: 7px 22px 7px calc(9px + var(--depth, 0) * 16px); text-align: left; }
  .action-name { display: -webkit-box; max-height: 2.5em; overflow: hidden; overflow-wrap: anywhere; line-height: 1.25; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .action-row:not(.selected):hover .action-main { background: var(--pi-surface-hover); }
  .workspace-row .action-main { border-radius: var(--pi-radius-control, 8px) 0 0 var(--pi-radius-control, 8px); }
  .workspace-primary { min-width: 0; display: flex; align-items: baseline; gap: 6px; }
  .workspace-primary-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .workspace-status { flex: 0 0 auto; color: var(--pi-warning); font-size: 12px; }
  .workspace-secondary { margin-top: 3px; }
  .workspace-menu-panel { width: max-content; min-width: min(120px, calc(100vw - 16px)); padding: 8px; }
  .workspace-menu-actions { margin: 0 0 8px; padding-bottom: 8px; border-bottom: 1px solid var(--pi-border-muted); }
  .workspace-menu-actions button.danger { color: var(--pi-danger); }
  .workspace-menu-actions button.danger:hover, .workspace-menu-actions button.danger:focus { background: color-mix(in srgb, var(--pi-danger) 14%, transparent); }
  .workspace-menu-details { display: grid; gap: 6px; margin: 0; }
  .workspace-detail-row { display: grid; grid-template-columns: minmax(58px, max-content) minmax(0, 1fr); gap: 8px; align-items: baseline; }
  .workspace-detail-row dt { color: var(--pi-muted); font-size: 12px; white-space: normal; }
  .workspace-detail-row dd { min-width: 0; margin: 0; overflow-wrap: anywhere; white-space: normal; }
  .tree-marker { color: var(--pi-dim); margin-right: 5px; }
  .badge { display: inline-block; margin-left: 5px; border: 1px solid var(--pi-border); border-radius: var(--pi-pill-radius, 999px); color: var(--pi-muted); padding: 0 5px; font-size: 11px; font-weight: 400; }
  .action-activity { position: absolute; top: 5px; right: 6px; z-index: 1; display: grid; place-items: center; width: 10px; height: 10px; }
  .action-activity .activity-indicator { margin: 0; vertical-align: 0; }
  .activity-indicator { display: inline-block; width: 7px; height: 7px; margin-right: 6px; background: var(--pi-success); animation: pulse 1s ease-in-out infinite; vertical-align: 1px; }
  .activity-indicator.session { border-radius: 50%; background: var(--pi-success); }
  .activity-indicator.terminal { border-radius: 2px; background: var(--pi-accent); }
  /* Client-side sending (upload in flight); distinct from server activity, which propagates to workspace/machine rows. */
  .activity-indicator.sending { border-radius: 50%; background: var(--pi-warning); }
  .action-menu { position: relative; align-self: stretch; }
  .action-menu-toggle { display: grid; place-items: center; height: 100%; min-width: 32px; padding: 0; color: var(--pi-muted); border-left: 0; border-top-left-radius: 0; border-bottom-left-radius: 0; }
  .action-menu-toggle:hover { color: var(--pi-text); background: var(--pi-surface-hover); }
  .action-menu-panel { position: fixed; z-index: 50; box-sizing: border-box; min-width: min(120px, calc(100vw - 16px)); overflow: auto; padding: 4px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control, 8px); background: var(--pi-surface); box-shadow: 0 8px 24px var(--pi-shadow); overflow-wrap: anywhere; }
  .action-menu-panel button { display: block; width: 100%; text-align: left; white-space: normal; overflow-wrap: anywhere; border: 0; background: transparent; color: var(--pi-text); }
  .action-menu-panel button:hover { background: var(--pi-selection-bg); }
  button.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
  button:disabled { opacity: .5; cursor: not-allowed; }
  small { display: block; color: var(--pi-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .workspace-label { min-width: 0; display: inline-flex; align-items: baseline; gap: 5px; max-width: 100%; overflow: hidden; white-space: nowrap; }
  .workspace-label-base, .workspace-label-item, .workspace-label-render { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .workspace-label-item, .workspace-label-render, .workspace-label-separator { color: var(--pi-muted); }
  .workspace-label-link { color: var(--pi-accent); text-decoration: none; }
  .workspace-label-link:hover, .workspace-label-link:focus { text-decoration: underline; }
  .workspace-detail-row .workspace-label { overflow: visible; white-space: normal; flex-wrap: wrap; }
  .workspace-detail-row .workspace-label-base, .workspace-detail-row .workspace-label-item, .workspace-detail-row .workspace-label-render { overflow: visible; text-overflow: clip; overflow-wrap: anywhere; white-space: normal; }
  @keyframes pulse { 0%, 100% { transform: scale(.75); opacity: .55; } 50% { transform: scale(1.2); opacity: 1; } }
`;

export const chatStyles = css`
  :host { position: relative; z-index: 0; display: flex; flex-direction: column; min-height: 0; overflow: hidden; color: var(--pi-text); font: var(--pi-transcript-font-size, 0.875rem)/var(--pi-transcript-line-height, 1.45) var(--pi-body-font-family, system-ui, sans-serif); }
  .chat-wrap { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; }
  .chat { height: 100%; min-height: 0; overflow: auto; overflow-anchor: none; padding: var(--pi-chat-padding, 1.625rem 1rem var(--pi-chat-bottom-clearance, 2rem)); box-sizing: border-box; }
  .chat.has-live-strip { --pi-chat-bottom-clearance: 4.75rem; }
  .chat.has-jump-to-latest { --pi-chat-bottom-clearance: 5.5rem; }
  .chat.has-live-strip.has-jump-to-latest { --pi-chat-bottom-clearance: 8.5rem; }
  .top-notices { box-sizing: border-box; flex: 0 0 auto; max-height: 40%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; border-bottom: 1px solid var(--pi-border); background: var(--pi-bg-overlay); }
  .session-warnings { flex: 0 1 auto; display: grid; gap: 8px; max-height: 50%; min-height: 0; overflow-y: auto; box-sizing: border-box; padding: 10px 16px; border-bottom: 1px solid var(--pi-border-muted); }
  .session-warnings:only-child { flex: 1 1 auto; max-height: 100%; border-bottom: 0; }
  .session-warning { position: relative; display: grid; gap: 4px; box-sizing: border-box; padding: 10px 34px 10px 12px; border: 1px solid var(--pi-warning-border); border-radius: 10px; background: var(--pi-warning-surface); color: var(--pi-text); }
  .session-warning.error { border-color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 12%, var(--pi-surface)); }
  .session-warning.info { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); }
  .session-warning-head { display: flex; align-items: center; gap: 8px; min-height: 16px; }
  .session-warning-icon { flex: 0 0 auto; font-size: 14px; line-height: 1.4; }
  .session-warning-body { min-width: 0; display: grid; gap: 3px; }
  .session-warning-message { margin: 0; overflow-wrap: anywhere; }
  .session-warning-path { margin: 0; color: var(--pi-muted); font-size: 12px; font-family: var(--pi-mono, ui-monospace, monospace); overflow-wrap: anywhere; }
  .session-warning-source { color: var(--pi-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .session-warning-dismiss { position: absolute; top: 6px; right: 6px; display: inline-grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-muted); font: 15px/1 system-ui, sans-serif; cursor: pointer; }
  .session-warning-dismiss:hover, .session-warning-dismiss:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); background: var(--pi-bg-overlay); }
  .session-warning-dismiss:focus-visible { outline: 1px solid var(--pi-border); outline-offset: 2px; }
  .notification-tray { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; background: var(--pi-bg-overlay); }
  .notification-tray.collapsed { flex: 0 0 auto; }
  .notification-header { position: sticky; top: 0; z-index: 2; flex: 0 0 auto; min-width: 0; display: flex; flex-wrap: nowrap; align-items: center; justify-content: space-between; gap: 8px; box-sizing: border-box; min-height: 40px; padding: 4px 10px; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg-overlay); }
  .notification-tray.collapsed .notification-header { border-bottom: 0; }
  .notification-header:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -3px; }
  .notification-heading { min-width: 0; flex: 1 1 auto; overflow: hidden; color: var(--pi-text-bright); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
  .notification-header-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; }
  .notification-control, .notification-row-dismiss { box-sizing: border-box; min-height: 32px; border: 0; border-radius: 6px; background: transparent; color: var(--pi-muted); cursor: pointer; }
  .notification-control { padding: 0 7px; font: 12px system-ui, sans-serif; white-space: nowrap; }
  .notification-toggle { display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; }
  .notification-control:hover, .notification-control:focus-visible, .notification-row-dismiss:hover, .notification-row-dismiss:focus-visible { background: var(--pi-selection-bg); color: var(--pi-text-bright); }
  .notification-control:focus-visible, .notification-row-dismiss:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
  .notification-control:disabled, .notification-row-dismiss:disabled { opacity: .5; background: transparent; cursor: default; }
  .notification-icon { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .notification-disclosure-icon.expanded { transform: rotate(90deg); }
  .notification-close-icon { width: 16px; height: 16px; }
  .notification-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior-y: contain; box-sizing: border-box; padding: 0 10px 5px; }
  .notification-list[hidden] { display: none; }
  .notification-overflow { margin: 0; padding: 7px 2px; border-bottom: 1px solid var(--pi-border-muted); color: var(--pi-muted); font-size: 11px; overflow-wrap: anywhere; }
  .notification-row { position: relative; min-width: 0; display: grid; gap: 4px; box-sizing: border-box; padding: 9px 38px 9px 2px; border-bottom: 1px solid var(--pi-border-muted); color: var(--pi-text); }
  .notification-row:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
  .notification-metadata { min-width: 0; display: flex; align-items: baseline; gap: 5px; color: var(--pi-muted); font-size: 11px; }
  .notification-severity { color: var(--pi-muted); font-size: inherit; font-weight: 600; }
  .notification-row.warning .notification-severity { color: var(--pi-warning); }
  .notification-row.error .notification-severity { color: var(--pi-danger); }
  .notification-message { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; text-align: start; unicode-bidi: plaintext; }
  .notification-truncated { margin: 0; color: var(--pi-muted); font-size: 11px; overflow-wrap: anywhere; }
  .notification-row-dismiss { position: absolute; top: 5px; right: 0; display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; }
  .visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0 0 0 0) !important; clip-path: inset(50%) !important; white-space: nowrap !important; border: 0 !important; }
  .notification-live span { display: block; }
  @media (pointer: coarse) {
    .notification-control, .notification-row-dismiss { min-height: 34px; }
    .notification-toggle, .notification-row-dismiss { width: 34px; height: 34px; }
    .notification-row { padding-right: 40px; }
  }
  @media (max-width: 520px) {
    .notification-header { gap: 4px; padding-inline: 8px; }
    .notification-list { padding-inline: 8px; }
  }
  .chat { height: 100%; min-height: 0; overflow: auto; overflow-anchor: none; padding: var(--pi-chat-padding, 1.625rem 1rem var(--pi-chat-bottom-clearance, 2rem)); box-sizing: border-box; }
  .scroll-marker { display: block; height: 0; overflow: hidden; pointer-events: none; }
  .live-strip { position: absolute; left: 1rem; right: 1rem; bottom: 0.75rem; z-index: 20; display: flex; align-items: center; gap: 0.5rem; min-width: 0; box-sizing: border-box; border: var(--pi-divider-width, 1px) solid var(--pi-border); border-radius: var(--pi-pill-radius, 999px); background: var(--pi-bg-overlay); color: var(--pi-muted); padding: 0.375rem 0.625rem; font-size: 0.75rem; pointer-events: none; box-shadow: 0 8px 28px var(--pi-shadow); backdrop-filter: blur(6px); }
  .live-strip.active { border-color: var(--pi-success-border); color: var(--pi-success); background: var(--pi-success-bg-overlay); }
  .live-strip.error { border-color: var(--pi-danger); color: var(--pi-danger); }
  .chat-wrap.has-jump-to-latest .live-strip { bottom: 4rem; }
  .activity-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: currentColor; opacity: .45; flex: 0 0 auto; }
  .live-strip.active .dot { animation: pulse 1s ease-in-out infinite; opacity: 1; }
  .jump-to-latest { position: absolute; left: 50%; bottom: 0.75rem; z-index: 21; display: inline-flex; min-height: 2.75rem; transform: translateX(-50%); align-items: center; justify-content: center; gap: 0.375rem; border: var(--pi-divider-width, 1px) solid var(--pi-border); border-radius: var(--pi-pill-radius, 999px); background: var(--pi-surface); color: var(--pi-text); padding: 0.5rem 0.75rem; box-shadow: 0 8px 28px var(--pi-shadow); font: 600 0.75rem var(--pi-control-font-family, system-ui, sans-serif); white-space: nowrap; cursor: pointer; }
  .jump-to-latest:hover { background: var(--pi-surface-hover); }
  .jump-to-latest:focus-visible { outline: var(--pi-focus-ring-width, 2px) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset, 2px); }
  .jump-to-latest svg { width: 1rem; height: 1rem; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .msg { max-width: 100%; min-width: 0; box-sizing: border-box; margin: 0 0 0.875rem; padding: var(--pi-chat-message-padding, 0.75rem); border: var(--pi-divider-width, 1px) solid var(--pi-border); border-radius: var(--pi-chat-card-radius, 0.625rem); background: var(--pi-surface); overflow: visible; }
  .msg.assistant, .msg.tool-image-output { border-color: var(--pi-chat-assistant-border, var(--pi-border)); background: var(--pi-chat-assistant-background, var(--pi-surface)); }
  .msg.user { width: var(--pi-chat-user-max-width, 100%); max-width: 100%; margin-left: auto; border-color: var(--pi-accent-border); background: var(--pi-selection-bg); }
  .msg.tool { border-color: var(--pi-warning-border); background: var(--pi-warning-surface); color: var(--pi-warning); }
  .msg.tool-execution-shell { padding: 0; border: 0; background: transparent; color: var(--pi-text); }
  .msg.system { color: var(--pi-danger); }
  .msg.bash { border-color: var(--pi-success); background: var(--pi-success-bg); }
  .msg.skill { border-color: var(--pi-purple-border); background: var(--pi-purple-surface); }
  .msg.event-group { padding: 0; border-color: var(--pi-border); background: var(--pi-bg); color: var(--pi-muted); }
  .msg.event-group.live { border-color: var(--pi-success-border); background: var(--pi-success-bg); }
  .msg.event-group > summary { position: sticky; top: -26px; z-index: 5; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 9px 9px 0 0; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg); color: var(--pi-muted); }
  .msg.event-group.live > summary { border-bottom-color: var(--pi-success-border); background: var(--pi-success-bg); color: var(--pi-success); }
  .msg.event-group > summary .label { margin: 0; }
  .group-body { padding: 0 12px 12px; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .msg.assistant { padding-inline: 0; }
  /* The assistant header shares its prose edge: unlike the stock card header,
     it has no negative margins that could extend beyond the Modernist surface. */
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .msg.assistant > .msg-header { margin: 0 0 0.5rem; padding: 0.4375rem 0 0.375rem; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .msg.system { border-left-width: var(--pi-accent-rule-width, 0.25rem); border-color: var(--pi-danger); background: transparent; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .msg.event-group[data-event-status="error"] { border-left-width: var(--pi-accent-rule-width, 0.25rem); border-left-color: var(--pi-text); }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .msg.event-group > summary { top: -1.625rem; gap: 0.5rem; padding: 0.5rem 0.75rem; border-radius: var(--pi-chat-card-radius, 0.625rem) var(--pi-chat-card-radius, 0.625rem) 0 0; border-bottom-width: var(--pi-divider-width, 1px); }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .event-icon { flex: 0 0 auto; font-weight: 800; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .event-summary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .event-detail { flex: 0 0 auto; overflow: hidden; max-width: 18rem; color: var(--pi-dim); font-size: 0.75rem; text-overflow: ellipsis; white-space: nowrap; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .group-body { padding: 0 0.75rem 0.75rem; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .subsession-rows { display: grid; gap: 0.375rem; padding: 0.625rem 0; border-bottom: var(--pi-divider-width, 1px) solid var(--pi-border-muted); }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .subsession-row { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.375rem 0.5rem; align-items: baseline; font-size: 0.8125rem; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .subsession-row small { grid-column: 2; min-width: 0; overflow: hidden; color: var(--pi-muted); text-overflow: ellipsis; white-space: nowrap; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .subsession-status { color: var(--pi-muted); font-size: 0.75rem; text-transform: uppercase; }
  .chat-image { display: block; max-width: 100%; max-height: 320px; margin: 8px 0 0; border: 1px solid var(--pi-border-muted); border-radius: 8px; object-fit: contain; }
  .chat-image { display: block; max-width: 100%; max-height: 320px; margin: 8px 0 0; border: 1px solid var(--pi-border-muted); border-radius: 8px; object-fit: contain; cursor: zoom-in; }
  .chat-image:focus-visible { outline: 2px solid var(--pi-accent, var(--pi-success-border)); outline-offset: 2px; }
  dialog.image-zoom { position: fixed; inset: 0; margin: auto; max-width: calc(96vw - env(safe-area-inset-left) - env(safe-area-inset-right)); max-height: calc(96vh - env(safe-area-inset-top) - env(safe-area-inset-bottom)); width: fit-content; height: fit-content; padding: 0; border: none; background: transparent; overflow: visible; }
  dialog.image-zoom[open] { display: flex; }
  dialog.image-zoom::backdrop { background: rgba(0, 0, 0, 0.8); }
  .image-zoom-full { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; border-radius: 8px; object-fit: contain; cursor: zoom-out; }
  .image-zoom-close { position: absolute; top: max(8px, env(safe-area-inset-top)); right: max(8px, env(safe-area-inset-right)); display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; font: 16px/1 system-ui, sans-serif; color: var(--pi-muted); background: color-mix(in srgb, var(--pi-surface) 88%, transparent); border: 1px solid var(--pi-border); border-radius: 6px; cursor: pointer; }
  .image-zoom-close:hover, .image-zoom-close:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); }
  .image-zoom-close:focus-visible { outline: 1px solid var(--pi-border); outline-offset: 2px; }
  .group-msg { max-width: 100%; min-width: 0; box-sizing: border-box; padding: 10px 0; border-top: 1px solid var(--pi-border-muted); color: var(--pi-text); overflow: visible; }
  .group-msg.tool { color: var(--pi-warning); }
  .group-msg.tool-execution-shell { color: var(--pi-text); }
  .group-msg.system { color: var(--pi-danger); }
  .group-msg.bash { color: var(--pi-success); }
  .history-boundary { position: relative; z-index: 5; display: grid; gap: 3px; justify-items: center; margin: 0 0 14px; color: var(--pi-muted); font-size: 12px; text-align: center; }
  .history-load-button { border: 1px solid var(--pi-border); border-radius: var(--pi-pill-radius, 999px); background: var(--pi-surface); color: var(--pi-text-secondary); padding: 5px 12px; font: 12px system-ui, sans-serif; cursor: pointer; }
  .history-load-button:hover, .history-load-button:focus { border-color: var(--pi-accent); color: var(--pi-text-bright); }
  .history-load-button:disabled { cursor: default; opacity: .55; }
  .queued-messages { max-width: 100%; min-width: 0; box-sizing: border-box; display: grid; gap: 0.5rem; margin: 0 0 0.875rem; padding: var(--pi-chat-message-padding, 0.75rem); border: var(--pi-divider-width, 1px) solid var(--pi-warning-border); border-radius: var(--pi-chat-card-radius, 0.625rem); background: var(--pi-warning-surface); color: var(--pi-text); overflow: hidden; }
  .queued-header { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .queued-heading { min-width: 0; flex: 1 1 180px; display: grid; gap: 2px; }
  .queued-heading strong { color: var(--pi-warning); }
  .queued-heading small { color: var(--pi-muted); }
  .queued-clear-button { flex: 0 0 auto; border: 1px solid var(--pi-warning-border); border-radius: var(--pi-pill-radius, 999px); background: var(--pi-surface); color: var(--pi-warning); padding: 5px 10px; font: 12px system-ui, sans-serif; white-space: nowrap; cursor: pointer; }
  .queued-clear-button:hover, .queued-clear-button:focus { border-color: var(--pi-warning); color: var(--pi-text-bright); }
  .queued-message { display: grid; gap: 4px; padding-top: 8px; border-top: 1px solid var(--pi-border); }
  .queued-message:first-of-type { padding-top: 0; border-top: 0; }
  .queued-kind { color: var(--pi-muted); font-size: 12px; text-transform: uppercase; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .queued-lane { display: grid; gap: 0.5rem; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .queued-lane + .queued-lane { padding-top: 0.5rem; border-top: var(--pi-divider-width, 1px) solid var(--pi-border); }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .queued-lane-heading { color: var(--pi-warning); font-size: 0.75rem; text-transform: uppercase; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .queued-message { gap: 0.25rem; padding-top: 0; border-top: 0; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .queued-kind { font-size: 0.75rem; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .queued-unlisted,
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .queued-stop-note { color: var(--pi-muted); font-size: 0.75rem; }
  .session-activity { max-width: 100%; min-width: 0; box-sizing: border-box; display: grid; gap: 0.25rem; margin: 0 0 0.875rem; padding: var(--pi-chat-message-padding, 0.75rem); border: var(--pi-divider-width, 1px) solid var(--pi-border); border-radius: var(--pi-chat-card-radius, 0.625rem); background: var(--pi-surface); color: var(--pi-text); overflow: hidden; }
  .session-activity.compacting { border-color: var(--pi-purple-border); background: var(--pi-purple-surface); }
  .session-activity strong { color: var(--pi-purple); }
  .session-activity span, .session-activity small { color: var(--pi-muted); }
  .history-boundary small { color: var(--pi-dim); }
  .msg-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 22px; margin-bottom: 8px; }
  .msg > .msg-header { position: sticky; top: -1.625rem; z-index: 4; margin: calc(0px - var(--pi-chat-message-padding, 0.75rem)) calc(0px - var(--pi-chat-message-padding, 0.75rem)) 0.5rem; padding: 0.4375rem 0.625rem 0.375rem; border-radius: var(--pi-chat-card-radius, 0.625rem) var(--pi-chat-card-radius, 0.625rem) 0 0; border-bottom: var(--pi-divider-width, 1px) solid color-mix(in srgb, var(--pi-border-muted) 35%, transparent); background: var(--pi-chat-assistant-background, var(--pi-surface)); box-shadow: var(--pi-chat-header-shadow, 0 8px 18px var(--pi-shadow-soft)); }
  .msg.user > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-accent-border) 35%, transparent); background: var(--pi-selection-bg); }
  .msg.assistant > .msg-header .label, .msg.tool-image-output > .msg-header .label { color: var(--pi-text-secondary); }
  .msg.user > .msg-header .label { color: var(--pi-accent); }
  .msg.tool > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-warning-border) 35%, transparent); background: var(--pi-warning-surface); }
  .msg.bash > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-success) 35%, transparent); background: var(--pi-success-bg); }
  .msg.skill > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-purple-border) 35%, transparent); background: var(--pi-purple-surface); }
  .group-msg > .msg-header { position: sticky; top: -26px; z-index: 4; margin: -10px 0 8px; padding: 7px 0 6px; border-bottom: 1px solid color-mix(in srgb, var(--pi-border-muted) 35%, transparent); background: var(--pi-bg); }
  .msg-header-trailing { min-width: 0; flex: 1 1 auto; display: inline-flex; align-items: center; justify-content: flex-end; gap: 8px; }
  .msg-actions { flex: 0 0 auto; display: inline-flex; gap: 6px; opacity: 0; transition: opacity .12s ease; }
  .msg-action { display: inline-grid; place-items: center; width: 24px; height: 24px; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-muted); padding: 0; font: 14px system-ui, sans-serif; line-height: 1; cursor: pointer; }
  .msg-action:hover, .msg-action:focus { color: var(--pi-text); border-color: var(--pi-accent); }
  .msg:hover > .msg-header .msg-actions, .msg:focus-within > .msg-header .msg-actions, .group-msg:hover > .msg-header .msg-actions, .group-msg:focus-within > .msg-header .msg-actions { opacity: 1; }
  .label { display: block; color: var(--pi-muted); font-family: var(--pi-heading-font-family, inherit); font-size: 0.75rem; font-weight: var(--pi-heading-font-weight, 700); letter-spacing: var(--pi-label-letter-spacing, normal); text-transform: uppercase; }
  .msg-header .label { margin: 0; }
  .msg-meta { min-width: 0; opacity: .28; border: 0; background: transparent; color: var(--pi-dim); padding: 0; font: 11px system-ui, sans-serif; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: opacity .12s ease; cursor: pointer; user-select: text; -webkit-user-select: text; }
  .msg:hover > .msg-header .msg-meta, .msg:focus-within > .msg-header .msg-meta, .group-msg:hover > .msg-header .msg-meta, .group-msg:focus-within > .msg-header .msg-meta, .msg-meta:focus, .msg-meta.expanded { opacity: 1; }
  .msg-meta.expanded { flex: 1 1 auto; max-width: 100%; white-space: normal; overflow: visible; overflow-wrap: anywhere; text-overflow: clip; }
  .msg-meta:focus { outline: 1px solid var(--pi-border); outline-offset: 3px; border-radius: 4px; }
  @media (hover: none) {
    .msg-actions { opacity: 1; }
    .msg-meta { opacity: .75; max-width: 26px; }
    .msg-meta:not(.expanded) { display: inline-grid; width: 26px; height: 22px; place-items: center; font-size: 0; text-overflow: clip; }
    .msg-meta::before { content: "ⓘ"; font-size: 13px; }
    .msg-meta.expanded { opacity: 1; max-width: 100%; }
    .msg-meta.expanded::before { content: ""; }
  }
  formatted-text.part { display: block; }
  formatted-text.part, .queued-message formatted-text { text-align: start; unicode-bidi: plaintext; }
  .part { max-width: 100%; min-width: 0; box-sizing: border-box; overflow: visible; }
  .part + .part { margin-top: 10px; }
  .tool-line { color: var(--pi-warning); }
  .summary { color: var(--pi-muted); margin-left: 6px; }
  .part:is(details) { border-top: 1px solid var(--pi-border); padding-top: 8px; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .part:is(details) { border-top-width: var(--pi-divider-width, 1px); padding-top: 0.5rem; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .msg.assistant .part:is(details) { color: var(--pi-muted); }
  .part > formatted-text { display: block; max-width: 100%; min-width: 0; overflow: visible; }
  .skill-invocation, .skill-read { border: var(--pi-divider-width, 1px) solid var(--pi-border); border-radius: var(--pi-chat-inline-card-radius, 8px); background: var(--pi-surface); padding: 0.5rem 0.625rem; }
  .skill-invocation > summary, .skill-read > strong { color: var(--pi-purple); }
  .skill-invocation > small, .skill-read > small { display: block; margin: 6px 0 0; color: var(--pi-muted); }
  summary { cursor: pointer; color: var(--pi-muted); }
  pre { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; direction: ltr; text-align: left; unicode-bidi: isolate; }
  .shell-output { color: var(--pi-text); font: 0.8125rem ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45; direction: ltr; text-align: left; unicode-bidi: isolate; }
  @media (max-width: 30rem) {
    .chat { padding: 1rem 0.75rem var(--pi-chat-bottom-clearance, 2rem); }
    .msg.user { width: 100%; }
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .event-detail { display: none; }
    .live-strip { left: 0.75rem; right: 0.75rem; }
  }
  @media (max-width: 47.9375rem) {
    /* Each Modernist transcript surface owns its overflow. The shell itself
       never needs a horizontal scrollbar for a long path, line, or diff. */
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .chat { padding: 1rem 0.75rem var(--pi-chat-bottom-clearance, 2rem); overscroll-behavior: contain; }
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .msg,
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .group-msg,
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .queued-messages,
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .session-activity { overflow-wrap: anywhere; }
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .event-detail { max-width: 10rem; }
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .subsession-row { grid-template-columns: minmax(0, 1fr); gap: 0.125rem; }
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .subsession-row small { grid-column: 1; }
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .subsession-status { justify-self: start; }
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .queued-header { gap: 0.5rem; }
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .queued-clear-button { min-height: 2.75rem; }
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .live-strip { left: 0.75rem; right: 0.75rem; }
  }
  @media (prefers-reduced-motion: reduce) { .live-strip.active .dot, .msg-actions, .msg-meta { animation: none; transition: none; } }
  @keyframes pulse { 0%, 100% { transform: scale(.75); opacity: .55; } 50% { transform: scale(1.2); opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .activity-indicator { animation: none; } }
`;

export const formattedTextStyles = css`
  :host { display: block; font: inherit; }
  .formatted { white-space: normal; overflow-wrap: anywhere; font-size: inherit; line-height: var(--pi-transcript-line-height, 1.45); text-align: start; unicode-bidi: plaintext; }
  p, ul, ol, pre, blockquote, table, .code-block-wrapper { margin: 0 0 10px; }
  :is(p, ul, ol, pre, blockquote, table, .code-block-wrapper):last-child { margin-bottom: 0; }
  ul, ol { padding-left: 22px; }
  li + li { margin-top: 3px; }
  code { border: var(--pi-divider-width, 1px) solid var(--pi-border); border-radius: var(--pi-inline-code-radius, 4px); background: var(--pi-code-background, var(--pi-bg)); padding: 0.0625rem 0.25rem; font: 0.8125rem ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; direction: ltr; text-align: left; unicode-bidi: isolate; }
  .code-block-wrapper { position: relative; }
  .code-block-wrapper pre { margin: 0; padding-right: 40px; }
  pre { border: var(--pi-divider-width, 1px) solid var(--pi-border); border-radius: var(--pi-code-block-radius, 8px); background: var(--pi-code-background, var(--pi-bg)); padding: 0.625rem; overflow-x: auto; overflow-y: hidden; direction: ltr; text-align: left; unicode-bidi: isolate; }
  pre code { border: 0; padding: 0; background: transparent; }
  .code-copy-button { position: absolute; top: 6px; right: 6px; z-index: 1; display: inline-grid; place-items: center; width: 24px; height: 24px; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-muted); padding: 0; font: 14px system-ui, sans-serif; line-height: 1; cursor: pointer; }
  .code-copy-button:hover, .code-copy-button:focus { color: var(--pi-text); border-color: var(--pi-accent); }
  blockquote { border-left: 3px solid var(--pi-border); padding-left: 10px; color: var(--pi-muted); }
  a { color: var(--pi-accent); }
  h1, h2, h3, h4 { margin: 14px 0 8px; line-height: 1.2; }
  h1:first-child, h2:first-child, h3:first-child, h4:first-child { margin-top: 0; }
  h1 { font-size: 20px; }
  h2 { font-size: 17px; }
  h3 { font-size: 15px; }
  h4 { font-size: 14px; }
  table { border-collapse: collapse; display: block; overflow-x: auto; overflow-y: hidden; }
  th, td { border: 1px solid var(--pi-border); padding: 4px 8px; }
  th { background: var(--pi-surface); }
`;

export const statusBarStyles = css`
  :host { display: block; color: var(--pi-muted); font: 0.75rem var(--pi-body-font-family, system-ui, sans-serif); }
  .bar { display: flex; justify-content: flex-end; gap: 0.75rem; align-items: center; min-width: 0; padding: 0.4375rem 0.75rem; border-top: var(--pi-divider-width, 1px) solid var(--pi-border); background: var(--pi-bg); white-space: nowrap; overflow: hidden; }
  span { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .activity { display: inline-flex; align-items: center; gap: 6px; color: var(--pi-muted); }
  .activity.active { color: var(--pi-success); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .45; flex: 0 0 auto; }
  .activity.active .dot { animation: pulse 1s ease-in-out infinite; opacity: 1; }
  .muted { color: var(--pi-dim); }
  @keyframes pulse { 0%, 100% { transform: scale(.75); opacity: .55; } 50% { transform: scale(1.2); opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .activity.active .dot { animation: none; } }
`;

export const autocompleteStyles = css`
  :host { display: block; }
  .menu { position: absolute; left: 0; right: 0; bottom: calc(100% + 6px); z-index: 10; max-height: 260px; overflow: auto; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); box-shadow: 0 10px 30px var(--pi-shadow); }
  button { display: grid; grid-template-columns: minmax(120px, 1fr) auto; gap: 4px 10px; width: 100%; border: 0; border-bottom: 1px solid var(--pi-border); border-radius: 0; background: transparent; color: var(--pi-text); padding: 8px 10px; text-align: left; cursor: pointer; }
  button:last-child { border-bottom: 0; }
  button.selected, button:hover { background: var(--pi-selection-bg); }
  span { color: var(--pi-muted); font-size: 12px; }
  small { grid-column: 1 / -1; color: var(--pi-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

export const commandPickerStyles = css`
  :host { position: fixed; inset: 0; z-index: 10; color: var(--pi-text); font: 14px system-ui, sans-serif; }
  .backdrop { display: grid; place-items: center; width: 100%; height: 100%; background: var(--pi-overlay); }
  section { width: min(720px, calc(100vw - 40px)); max-height: min(640px, calc(100vh - 40px)); display: flex; flex-direction: column; border: 1px solid var(--pi-border); border-radius: 12px; background: var(--pi-bg); box-shadow: 0 20px 60px var(--pi-shadow-strong); overflow: hidden; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px solid var(--pi-border); }
  .options { min-height: 0; overflow: auto; outline: none; }
  button { border: 0; background: transparent; color: var(--pi-text); cursor: pointer; }
  header button { font-size: 20px; color: var(--pi-muted); }
  input { margin: 10px 12px; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); color: var(--pi-text); font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); padding: 8px 10px; outline: none; }
  input:focus { border-color: var(--pi-accent); }
  .options button { display: block; width: 100%; padding: 10px 12px; border-bottom: 1px solid var(--pi-border-muted); text-align: left; }
  .options button.selected, .options button:hover { background: var(--pi-selection-bg); }
  small { display: block; margin-top: 4px; color: var(--pi-muted); }
  .empty { padding: 24px; color: var(--pi-muted); text-align: center; }
`;

export const actionPaletteStyles = css`
  :host { position: fixed; inset: 0; z-index: 20; color: var(--pi-text); font: 14px system-ui, sans-serif; }
  .backdrop { --palette-top: min(12dvh, 90px); --palette-bottom: max(20px, env(safe-area-inset-bottom)); display: grid; align-items: start; justify-items: center; width: 100%; height: 100dvh; background: var(--pi-overlay); padding: var(--palette-top) 20px var(--palette-bottom); box-sizing: border-box; overflow: hidden; }
  section { width: min(720px, 100%); max-height: min(640px, calc(100dvh - var(--palette-top) - var(--palette-bottom))); display: flex; flex-direction: column; border: 1px solid var(--pi-border); border-radius: 12px; background: var(--pi-bg); box-shadow: 0 20px 60px var(--pi-shadow-strong); overflow: hidden; }
  header { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 10px; border-bottom: 1px solid var(--pi-border); }
  input { min-width: 0; border: 0; outline: none; background: transparent; color: var(--pi-text); font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); padding: 8px; }
  input::placeholder { color: var(--pi-dim); }
  button { border: 0; background: transparent; color: var(--pi-text); cursor: pointer; }
  header button { color: var(--pi-muted); font-size: 22px; padding: 2px 8px; }
  .options { flex: 1 1 auto; min-height: 0; overflow: auto; }
  .options button { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 12px; width: 100%; padding: 10px 12px; border-bottom: 1px solid var(--pi-border-muted); text-align: left; }
  .options button.selected, .options button:hover:not(:disabled) { background: var(--pi-selection-bg); }
  .options button:disabled { cursor: not-allowed; opacity: .68; }
  .options button.disabled.selected { background: color-mix(in srgb, var(--pi-selection-bg) 55%, transparent); }
  .main { min-width: 0; }
  strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  small { display: block; color: var(--pi-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .disabled-reason { color: var(--pi-warning); }
  .group { grid-column: 1 / -1; font-size: 12px; }
  kbd { align-self: center; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-muted); padding: 2px 6px; font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: nowrap; }
  .empty { padding: 24px; color: var(--pi-muted); text-align: center; }
`;

export const promptEditorStyles = css`
  :host { position: relative; z-index: 5; display: block; container-type: inline-size; color: var(--pi-text); font: 0.875rem var(--pi-body-font-family, system-ui, sans-serif); }
  footer { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--pi-space-2, 0.5rem); padding: var(--pi-space-3, 0.75rem); border-top: var(--pi-divider-width, 1px) solid var(--pi-border); background: var(--pi-bg); }
  footer.shell-mode { border-top-color: var(--pi-success); background: var(--pi-success-bg); }
  .editor-wrap { position: relative; min-width: 0; }
  /* Classic and PI WEB retain the original single action row. Modernist has a
     separately rendered template so its grouping cannot rearrange legacy DOM. */
  .legacy-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: nowrap; white-space: nowrap; }
  .modernist-composer { display: none; }
  .compact-status { display: flex; min-width: 0; align-items: center; gap: 6px; color: var(--pi-muted); font-size: 12px; flex: 1 1 0; }
  .compact-status > button { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .select-model { max-width: min(42vw, 320px); }
  .model-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .action-label { display: none; }
  .icon-button { flex: 0 0 auto; display: inline-grid; place-items: center; width: 36px; height: 36px; padding: 0; }
  .icon-button .prompt-action-icon, .icon-button .prompt-thinking-gauge { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .icon-button .prompt-action-icon-filled { fill: currentColor; stroke: none; }
  .send-button:not(:disabled) { color: var(--pi-accent, var(--pi-text)); }
  .stop-button:not(:disabled) { color: var(--pi-danger); }
  .select-thinking .prompt-thinking-gauge .gauge-bar { fill: currentColor; stroke: none; opacity: .28; }
  .select-thinking .prompt-thinking-gauge .gauge-bar-active { opacity: 1; }
  .editor-attach { position: absolute; right: 8px; bottom: 8px; z-index: 2; width: 30px; height: 30px; }
  .editor-attach .prompt-action-icon { width: 16px; height: 16px; }
  textarea, .markdown-editor .cm-editor { box-sizing: border-box; width: 100%; min-height: 3.375rem; max-height: 13.75rem; resize: none; overflow: hidden; border-radius: var(--pi-radius-control, 0.5rem); border: var(--pi-divider-width, 1px) solid var(--pi-border); background: var(--pi-code-background, var(--pi-bg)); color: var(--pi-text); font: var(--pi-control-font-size, 1rem)/1.4 var(--pi-control-font-family, system-ui, sans-serif); }
  textarea { overflow-y: auto; padding: 8px; }
  .markdown-editor .cm-scroller { max-height: 220px; overflow-y: auto; font-family: var(--pi-control-font-family, system-ui, sans-serif); line-height: 1.4; }
  .markdown-editor .cm-content { min-height: 38px; padding: 8px 44px 8px 8px; caret-color: var(--pi-text); text-align: start; unicode-bidi: plaintext; }
  .markdown-editor .cm-line { padding: 0; unicode-bidi: plaintext; }
  .markdown-editor .cm-placeholder { color: var(--pi-dim); }
  .markdown-editor .cm-focused { outline: none; }
  .shell-mode textarea, .shell-mode .markdown-editor .cm-editor { border-color: var(--pi-success); box-shadow: 0 0 0 1px var(--pi-success-ring); }
  .mode-hint { position: absolute; right: 46px; bottom: 8px; max-width: calc(100% - 54px); border: 1px solid var(--pi-success-border); border-radius: 999px; background: var(--pi-success-surface); color: var(--pi-success); padding: 2px 8px; font-size: 12px; pointer-events: none; }
  .attachments { display: flex; max-width: 100%; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
  .attachment-chip { position: relative; width: 56px; height: 56px; border: 1px solid var(--pi-border); border-radius: 8px; overflow: hidden; background: var(--pi-bg); }
  .attachment-chip img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .attachment-chip-file { display: grid; place-items: center; }
  .attachment-file-preview { display: grid; place-items: center; width: 34px; height: 26px; border: 1px solid var(--pi-border-muted); border-radius: 4px; background: var(--pi-surface); color: var(--pi-muted); font: 700 10px/1 system-ui, sans-serif; letter-spacing: .03em; }
  .attachment-file-name { position: absolute; right: 4px; bottom: 3px; left: 4px; overflow: hidden; color: var(--pi-muted); font-size: 10px; line-height: 1.2; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
  .attachment-remove { position: absolute; top: 1px; right: 1px; width: 18px; height: 18px; padding: 0; line-height: 16px; border-radius: 50%; border: 1px solid var(--pi-border); background: var(--pi-surface); color: var(--pi-text); font-size: 13px; cursor: pointer; }
  .attachment-delivery { min-width: 0; max-width: 100%; }
  .attachment-delivery select { max-width: 100%; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 5px 7px; font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); }
  .attachment-error { flex-basis: 100%; color: var(--pi-danger); font-size: 12px; }
  button { border: var(--pi-divider-width, 1px) solid var(--pi-border); border-radius: var(--pi-radius-control, 0.5rem); background: var(--pi-surface); color: var(--pi-text); padding: 0.4375rem 0.5625rem; cursor: pointer; font-family: var(--pi-control-font-family, system-ui, sans-serif); }
  button:focus-visible, .markdown-editor .cm-focused { outline: var(--pi-focus-ring-width, 2px) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset, 2px); }
  button:disabled, textarea:disabled, .markdown-editor-disabled .cm-editor { opacity: .5; cursor: not-allowed; }
  /* Modernist alone swaps to a grouped template. Display none keeps the
     inactive duplicate out of both keyboard focus and the accessibility tree. */
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .legacy-composer { display: none; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .modernist-composer { display: grid; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) footer { gap: 0.5rem; padding: 0.75rem; border-top-width: 2px; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .modernist-actions { grid-template-columns: minmax(0, 1fr) max-content; gap: 0.5rem; align-items: center; overflow: hidden; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .action-context { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.5rem; min-width: 0; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .compact-status { display: grid; grid-template-columns: minmax(0, 1fr) max-content; gap: 0.5rem; font-size: 0.75rem; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .compact-status > button { max-width: none; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .select-model { display: inline-flex; min-width: 0; max-width: none; align-items: center; gap: 0.5rem; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .action-execution { display: flex; align-items: center; gap: 0.5rem; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .action-button { display: inline-flex; min-height: 2.75rem; align-items: center; justify-content: center; gap: 0.5rem; border-width: 2px; border-radius: 0; padding: 0.5rem 0.75rem; font-family: var(--pi-body-font-family, system-ui, sans-serif); }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .action-button .action-label { display: inline; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .icon-button.action-button { width: auto; height: 2.75rem; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .editor-attach { position: static; width: 2.75rem; padding: 0; background: var(--pi-surface); color: var(--pi-text); }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .editor-attach .action-label { display: none; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .markdown-editor .cm-content { padding: 8px; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .mode-hint { right: 8px; max-width: calc(100% - 16px); }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .select-model, :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .select-thinking { background: var(--pi-surface); color: var(--pi-muted); }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .steer-button, :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .stop-button { background: transparent; color: var(--pi-text); }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .send-button:not(:disabled) { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-bg); font-family: Archivo, var(--pi-body-font-family, system-ui, sans-serif); font-weight: 800; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) button:focus-visible, :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .markdown-editor .cm-focused { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) button:disabled, :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .markdown-editor-disabled .cm-editor { opacity: .45; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) textarea, :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .markdown-editor .cm-editor, :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .attachment-chip, :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .attachment-file-preview, :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .attachment-remove, :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .attachment-delivery select { border-width: 2px; border-radius: 0; }
  :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .attachment-delivery select { max-width: 100%; }
  @media (max-width: 640px) {
    footer { gap: 8px; padding: 8px; }
    .actions { gap: 6px; }
    .compact-status { flex: 1 1 220px; gap: 4px; }
    .select-model { max-width: min(58vw, 260px); }
    button { padding: 6px 8px; }
  }
  @media (max-width: 767px) {
    /* Keep the controls in normal flow: a smaller, scrolling editor gives the
       non-shrinking action row and the destination nav room above the IME. */
    .actions { flex: 0 0 auto; flex-shrink: 0; min-height: 2.75rem; }
    .icon-button, .editor-attach { width: 2.75rem; height: 2.75rem; min-width: 2.75rem; min-height: 2.75rem; }
    textarea, .markdown-editor .cm-editor { min-height: 3.75rem; max-height: var(--pi-mobile-editor-max-height, 13.75rem); }
    .markdown-editor .cm-scroller { max-height: var(--pi-mobile-editor-max-height, 13.75rem); }
  }
  @media (max-width: 430px) {
    .compact-status { flex-basis: 170px; font-size: 11px; }
    .select-model { max-width: 48vw; }
    button { padding: 5px 7px; }
  }
  @container (max-width: 38rem) {
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .action-button { width: 2.75rem; height: 2.75rem; min-width: 2.75rem; padding: 0; }
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .select-model { width: 100%; min-width: 0; padding: 0.5rem; justify-content: flex-start; }
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .action-button .action-label { display: none; }
  }
  @container (max-width: 22rem) {
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .actions { grid-template-columns: minmax(0, 1fr); }
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .action-context { grid-column: 1; }
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) .action-execution { grid-column: 1; justify-self: end; }
  }
  @media (prefers-reduced-motion: reduce) {
    :host-context(:root[data-pi-web-theme^="themes:modernist-"]) * { transition: none; animation: none; }
  }
`;
