# Building a SPECTER module

SPECTER is a browser first. Power tools (AI, markets, system monitor, knowledge,
developer tools, automation…) are **optional modules** that plug into the core
through a small set of extension points. A module must never slow down or crash
normal browsing.

## Layout

```
src/main/modules/<name>/index.ts        export function register(): void   (main process)
src/renderer/src/modules/<name>/index.ts export function register(): void  (UI)
src/shared/modules/<name>.ts             shared types + IPC contract augmentation
```

Both `register()` functions are already wired in `src/main/modules.ts` and
`src/renderer/src/modules/index.ts`. Keep all module code inside your module's
folders (sub-files are fine: `src/main/modules/<name>/providers/binance.ts`, …).

## Typed IPC

Channels are `domain:action`. Allowed domains are listed in `IPC_DOMAINS`
(`src/shared/ipc.ts`) — e.g. `ai`, `market`, `system`, `notes`, `research`,
`knowledge`, `projects`, `terminal`, `git`, `automation`, `portfolio`, `paper`,
`alerts`, `tools`, `plugins`, `media`, `widgets`, `kv`, `crypto`, `finance`.

Declare your channels by **module augmentation** in `src/shared/modules/<name>.ts`:

```ts
import type { SomeType } from './whatever'
declare module '../ipc' {
  interface IpcContract {
    'market:quotes': (symbols: string[]) => Quote[]
  }
  interface IpcEvents {
    'market:tick': Quote
  }
}
export interface Quote { /* … */ }
```

Main process (`src/main/ipc.ts`):

```ts
import { handle, broadcast, sendTo } from '../../ipc'
handle('market:quotes', async (_e, symbols) => fetchQuotes(symbols))
broadcast('market:tick', quote)            // to every SPECTER window
```

Renderer (`src/renderer/src/lib/ipc.ts`): `invoke('market:quotes', ['BTC'])`,
`on('market:tick', fn)` (returns an unsubscribe function). `invokeRaw/onRaw` exist
for untyped use but prefer typed.

Only SPECTER's own windows can call IPC; web pages never can.

## Main-process services you can use

| Import | Purpose |
| --- | --- |
| `../../db` → `registerMigrations(module, [sql…])`, `all`, `get`, `run`, `tx`, `uid`, `json`, `metaGet/metaSet` | SQLite (node:sqlite, FTS5 available). One migration list per module; append new steps, never edit old ones. |
| `../../services/net` → `fetchJson(url, { ttl, timeoutMs, retries })`, `setRateLimit(host, rps)` | All public-API calls: timeouts, retries with backoff, per-host rate limits, TTL cache. Never hammer APIs. |
| `../../services/settings` → `getSetting`, `setSetting`, `onSettingChanged` | Settings (keys in `src/shared/settings.ts`). |
| `../../services/notifications` → `notify({ category, title, body })` | Notification center + desktop toasts. |
| `../../bus` → `bus.emit('ALERT_TRIGGERED', …)`, `bus.on(...)` | Typed event bus (automation listens to it). |
| `../../services/diagnostics` → `registerDiagnostic(() => ({ id, label, status, detail }))` | Adds a row to specter://diagnostics. |
| `../../services/page` → `pageText(wcId)`, `readableArticle(wcId)`, `pageSelection(wcId)`, `focusedGuestId()` | Read content from a tab (isolated world). |
| `../../logger` → `createLogger('scope')` | Structured logs (visible in specter://logs). |
| `../../services/profiles` → `activeProfileId()`, `activeSession()` | Profile scoping. |

## Renderer extension points

```ts
import { registerCommands } from '../../lib/commands'            // palette + shortcuts + automation
import { registerPage, lazyPage } from '../../pages/registry'   // specter://<id> pages
import { sidePanels, hudItems, statusItems, settingsSections, newTabWidgets } from '../../lib/registry'
import { registerOmniboxProvider } from '../../lib/omnibox'     // address-bar suggestions / @scopes
import { registerOverlay } from '../overlays'                     // modal overlays (openOverlay(id))
```

- **Commands**: `{ id, title, category, icon, keywords?, description?, hidden?, when?, run(args) }`.
  IDs are `domain.action` (e.g. `market.open`). Default shortcuts live in
  `src/shared/keys.ts` (`ai.toggle` = Alt+Space, `notes.quick` = Ctrl+Shift+N, …).
- **Pages**: `registerPage({ id: 'markets', title, icon, component: lazyPage(() => import('./MarketsPage')), listed: true, category })`.
  Components receive `{ tabId, url, sub, query }`. Open with `newTab('specter://markets')`.
- **Side panels** (right rail): `sidePanels.register({ id, title, icon, order, component: lazy(() => import('./Panel')), popout: true, enabled?: () => boolean })`.
  `order < 100` appears at the top of the rail, `>= 100` at the bottom. Popout panels render alone in a floating window (receive `popout` prop).
- **HUD** (title-bar telemetry): `hudItems.register({ id, order, component, enabled? })` — tiny mono readouts using `.hud-item`.
- **Status bar**: `statusItems.register({ id, side: 'left'|'right', order, component })` using `.sb-item`.
- **Settings**: `settingsSections.register({ id, title, icon, order, component })`; reuse `Group`, `Row`, `Toggle`, `Choice`, `TextSetting` from `pages/Settings`.
- **New tab widgets**: `newTabWidgets.register({ id, title, order, component })` rendered as `.ntp-card`.
- **Omnibox**: `registerOmniboxProvider({ id, scopes: ['default' | 'market' | 'ai' | 'notes' …], provide(text, scope) })` returning `OmniItem[]`.

Command IDs other modules/core already call (implement them if they are yours):
`ai.ask {action,text}`, `ai.askPage {prompt}`, `ai.toggle`, `notes.quick`, `notes.saveSelection {text,url,title}`,
`notes.savePage {url,title,text}`, `research.saveSource {url,title,quote}`, `research.newMission`, `knowledge.savePage {tabId}`,
`developer.cloneRepo {url}`, `developer.toolkit`, `system.openMonitor`, `market.open`.

### Useful renderer helpers

- Stores: `stores/browser` (`activeTab()`, `newTab(url, opts)`, `loadUrl(tabId, url)`, `useActiveTab()`, `useBrowser(selector)`),
  `stores/settings` (`useSetting(key)`, `getSetting`, `setSetting`), `stores/ui` (`toast`, `openMenu`, `openOverlay`, `closeOverlay`, `openSidePanel`, `toggleSidePanel`).
- `lib/webviews` → `wcIdFor(tabId)` (webContents id of a live tab, for page IPC).
- Components: `components/ui` (`Favicon`, `Kbd`, `Switch`, `Seg`, `Modal`, `Sparkline`, `SpecterMark`),
  `components/prompt` (`promptText`, `confirmAction`), `components/ErrorBoundary`.
- Formatting: `lib/format` (`formatBytes`, `formatPrice`, `formatCompact`, `pct`, `timeAgo`, `formatDuration`).
- Markdown: `marked` + `DOMPurify` (always sanitize), styled with `.md`.

### Design language

Dark, sharp, understated, technical. Reuse the CSS primitives (see `src/renderer/src/styles/*.css`):
`.btn(.primary|.ghost|.sm)`, `.icon-btn`, `.input`, `.select`, `.textarea`, `.switch`, `.seg`, `.card`, `.card-h`,
`.badge(.ok|.warn|.bad|.accent)`, `.label` (mono micro-label), `.table`, `.empty`, `.page`, `.page-h`, `.page-kicker`,
`.page-title`, `.page-sub`, `.section`, `.section-title`, `.grid-2/3/4`, `.stat`, `.list-row`, `.md`, `.mono`, `.num`, `.up/.down`.
Colors come from CSS variables only (`--bg-0..4`, `--fg-0..3`, `--accent`, `--ok`, `--warn`, `--bad`, `--up`, `--down`, `--line`).
Lucide icons (`lucide-react`). No neon, no big gradients, no emoji UI.

## Rules

1. **No fake data.** If data is unavailable show "Unavailable" / "Data unavailable" and why. Always show source and last-updated time for external data.
2. **No fake features.** Every button works. If something can't be done, disable it and say why.
3. **Free only.** No API keys required, no paid services. Free public endpoints must be rate-limited via `net.ts`.
4. **Local & private.** Nothing leaves the machine unless the user explicitly triggers it, and the UI says so.
5. **Fail gracefully.** Wrap optional work in try/catch; an offline API or missing Ollama must never throw into the UI.
6. **Performance.** No polling when the feature isn't visible/enabled. Respect `performance.mode` and `performance.hudPollMs`.
7. **Security.** Never expose Node or arbitrary shell execution to the renderer. Commands that execute or delete require explicit confirmation.

## Verifying

```bash
npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json
npx vitest run
npx electron-vite build
node scripts/drive.mjs <outDir> <profileDir> <steps.json>
```

`scripts/drive.mjs` launches the built app with an isolated profile and runs JSON steps:
`{ "press": "Control+k" }`, `{ "type": "text" }`, `{ "click": "css/text selector" }`, `{ "wait": 1000 }`,
`{ "eval": "js in the UI" }`, `{ "nativeShot": "name" }` (real compositor screenshot — use this, not `shot`, when web pages are visible).
