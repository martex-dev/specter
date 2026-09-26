# SPECTER architecture

SPECTER is an Electron application: Chromium renders web pages, Node.js runs
SPECTER's own services, and a React UI draws the browser chrome. Nothing is a
custom engine — page rendering, networking, sandboxing and DevTools are
Chromium's.

```
┌──────────────────────────── BrowserWindow (one per window) ────────────────────────────┐
│  SPECTER UI renderer (React, sandboxed, contextIsolation, no Node)                     │
│  ┌──────────── title bar: workspace pill · tab strip · HUD ─────────────────────────┐  │
│  │ toolbar: navigation · omnibox · split · downloads · profile · menu               │  │
│  ├───────────────────────────────────────────────┬─────────────┬────────┤           │  │
│  │ viewport                                      │ side panel  │ rail   │           │  │
│  │  <webview> per live tab (guest process each) │ (AI, notes, │        │           │  │
│  │  internal pages (specter://…) as React        │  system…)   │        │           │  │
│  ├───────────────────────────────────────────────┴─────────────┴────────┤           │  │
│  │ status bar                                                            │           │  │
│  └───────────────────────────────────────────────────────────────────────┘           │  │
│            ▲ typed IPC (preload bridge, allow-listed domains)                        │  │
└────────────┼──────────────────────────────────────────────────────────────────────────┘
             ▼
  Main process (Node 24): windows · sessions/profiles · permissions · downloads · privacy
  (webRequest) · page tools (isolated-world scripts) · SQLite (node:sqlite, FTS5) ·
  event bus · modules (AI, markets, system, knowledge, developer, automation, toolkit)
```

## Processes and trust

| Component | Trust | Capabilities |
| --- | --- | --- |
| Main process | trusted | Node.js, filesystem, SQLite, child processes (modules only, with timeouts) |
| SPECTER UI renderer | trusted UI, sandboxed | only `window.specter.invoke/on` through the preload; the main process rejects IPC from any other sender |
| Tab guests (`<webview>`) | untrusted web content | Chromium sandbox, context isolation, no Node; `will-attach-webview` strips any preload and forces safe preferences; the only preloads are the ad blocker's two isolated-world scripts and the video tools script (session-registered) |
| Pop-ups with `window.opener` (OAuth) | untrusted | separate sandboxed BrowserWindow in the same profile partition |

Scripts SPECTER runs inside pages (reader mode, page stats, regex find, media
controls, AI context, the font inspector) execute in an **isolated world** (`executeJavaScriptInIsolatedWorld`),
so pages cannot observe or tamper with them. UI drawn inside a page (the font inspector's cards)
lives in a closed shadow root with its own styles.

## Source layout

```
src/
  shared/            types, settings schema, IPC contract, URL/omnibox parsing, fuzzy matching, key bindings, domain helpers
    modules/         per-module IPC contract augmentations
  main/
    index.ts         lifecycle, single-instance, session handler attachment, shutdown
    windows.ts       browser & pop-out windows, window sessions, startup restoration
    guest.ts         webview hardening, shortcuts inside pages, pop-up policy, context menu, crash/zoom events
    db.ts            SQLite with per-module migrations
    ipc.ts / bus.ts / logger.ts
    services/        settings, history, bookmarks, downloads, permissions, privacy (+trackers, adblock), profiles,
                     workspaces, page tools, font inspector, search, importer, notifications, diagnostics, net (rate-limited fetch)
    modules/         ai, markets, system, knowledge, developer, automation, toolkit
  preload/           the only bridge from the UI to the main process; isolated-world preloads for web pages (ad blocker, video tools)
  inject/            overlays the main process evaluates inside web pages (font inspector), bundled as standalone files
  renderer/src/
    stores/          browser (tabs/workspaces/layout/lifecycle), ui, settings   — separate zustand stores
    chrome/          tab strip, toolbar, omnibox (+providers), bookmarks bar, HUD/status/rail, site info
    content/         viewport, webview host, split layout, find bar, reader, pane bars, DevTools dock
    overlays/        command palette, tab search, workspace switcher, page context menu, save/capture
    pages/           specter:// internal pages
    panels/          core side panels
    commands/        core command set
    modules/         UI side of each module
    lib/             command registry, extension registries, IPC client, themes, webview registry, perf
```

## Key design decisions

- **`<webview>` per tab** (not `WebContentsView`): overlays (palette, menus, prompts) can float above
  pages with normal CSS, split layouts are plain absolute positioning, and the chrome stays one React
  tree. Webviews are rendered in a stable DOM order and never re-parented (moving one reloads it).
- **Tabs belong to workspaces.** A window shows one or more workspaces; each workspace's tabs, groups
  and split layout are persisted per workspace (debounced) so a crash loses at most ~0.5 s of changes.
- **Lazy session restore.** Only visible tabs load at startup; the rest restore as *sleeping* and load
  on first activation (like Chrome's "continue where you left off" throttling).
- **Tab lifecycle**: active → background (hidden, still running) → idle → sleeping (webview destroyed,
  renderer process released; URL, title, scroll position kept).
- **Everything is a command.** The palette, shortcuts (in the UI *and* inside pages via
  `before-input-event`), menus, automations and plugins all run commands from one registry.
- **Modules are optional.** Each registers through extension points (commands, pages, side panels, HUD,
  status bar, settings sections, new-tab widgets, omnibox providers) and is wrapped in error boundaries;
  a failing module cannot take down browsing.
- **Storage**: one SQLite database per SPECTER profile directory (`specter.db`, WAL). Tables per entity,
  FTS5 for history/notes/knowledge, per-module migrations (never one giant JSON blob).
- **Profiles**: each profile has its own Chromium partition (cookies, storage, cache, service workers)
  and its own rows in history/bookmarks/workspaces. One profile is active at a time.

## Data flow examples

**Typing in the omnibox** → `interpretInput` (URL / search / `@scope`) → providers queried in parallel
(open tabs, history+bookmarks via FTS5, commands, workspaces, module providers, optional remote
suggestions) → merged, de-duplicated, ranked → Enter runs the item or navigates.

**A web page asks for the camera** → `setPermissionRequestHandler` → stored decision? → otherwise an
inline prompt bar in that tab → the user's choice (optionally remembered per origin).

**An ad request** → `webRequest.onBeforeRequest` (privacy.ts) → the ad blocker's filter engine
(adblock.ts, Ghostery's engine fed with uBlock Origin / EasyList lists) or the built-in tracker list →
cancelled or redirected to a harmless stub, counted, shown in the HUD, the site popover and the Privacy
Center. Element hiding and scriptlets are applied by two frame preloads at document start.
Lists are compiled in a worker thread and the compiled engine is cached on disk.

**Pressing D on a video** → the video tools preload (isolated world, registered on the profile session)
sees the trusted keydown first, checks the key map it got from services/video.ts, that nothing editable
has focus and that the page has media → sets `playbackRate` on the page's media and shows the badge →
reports the speed, which the main process remembers for the site (per profile). If the site later resets
the rate without user input, the preload restores it; SPECTER's media controls and palette send speed
commands through the same preload.
