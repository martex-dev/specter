"""Rebuilds SPECTER's finished tree as a curated, reviewable commit history.

Usage: python scripts/replay-history.py <export_dir> <publish_dir> <author_name> <author_email>

<export_dir> must contain the exact tree to publish (e.g. from `git archive HEAD`).
Every file is committed exactly once, in dependency order, and the script
verifies at the end that the published tree matches the export byte-for-byte.
"""
import os, shutil, subprocess, sys, filecmp

EXPORT, PUB, NAME, EMAIL = sys.argv[1:5]
TRAILER = '\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'

def rel_files(root):
    out = []
    for d, _, fs in os.walk(root):
        for f in fs:
            out.append(os.path.relpath(os.path.join(d, f), root).replace('\\', '/'))
    return sorted(out)

ALL = rel_files(EXPORT)
done = set()
plan = []

def c(msg, *paths):
    files = []
    for p in paths:
        if p.endswith('/'):
            files += [f for f in ALL if f.startswith(p) and f not in done and f not in files]
        elif p in ALL:
            files.append(p)
        else:
            raise SystemExit(f'missing path in plan: {p}')
    files = [f for f in files if f not in done]
    if not files:
        return
    done.update(files)
    plan.append((msg, files))

# ---------------------------------------------------------------- foundation
c('Initialize SPECTER: license, git attributes and ignore rules', 'LICENSE', '.gitattributes', '.gitignore')
c('Add package manifest and lockfile (Electron 44, React 19, Vite)', 'package.json', 'package-lock.json')
c('Configure TypeScript projects for main/preload and renderer', 'tsconfig.json', 'tsconfig.node.json', 'tsconfig.web.json')
c('Configure electron-vite build with dev-only CSP relaxation', 'electron.vite.config.ts')
c('Configure vitest for unit tests', 'vitest.config.ts')

# ---------------------------------------------------------------- shared
c('Define core domain types: tabs, groups, workspaces, history, downloads', 'src/shared/types.ts')
c('Add settings schema, defaults and search engine templates', 'src/shared/settings.ts')
c('Add typed IPC contract with allow-listed channel domains', 'src/shared/ipc.ts')
c('Add URL and omnibox input interpretation with @scopes', 'src/shared/url.ts')
c('Add fuzzy matcher for palette, tab search and omnibox', 'src/shared/fuzzy.ts')
c('Add keyboard shortcut model shared by UI and in-page handling', 'src/shared/keys.ts')
c('Add registrable-domain and tracker matching helpers', 'src/shared/domains.ts')

# ---------------------------------------------------------------- main process core
c('Add structured logger with ring buffer and log file rotation', 'src/main/logger.ts')
c('Add typed main-process event bus', 'src/main/bus.ts')
c('Add SQLite storage on node:sqlite with per-module migrations and FTS5', 'src/main/db.ts')
c('Add IPC handler helpers that only trust SPECTER windows', 'src/main/ipc.ts')
c('Add settings service with change listeners and import/export', 'src/main/services/settings.ts')
c('Add browser profiles with isolated Chromium partitions', 'src/main/services/profiles.ts')
c('Add history service with full-text search and frecency suggestions', 'src/main/services/history.ts')
c('Add bookmarks service with folders, tags and Netscape HTML import/export', 'src/main/services/bookmarks.ts')
c('Add notification center with desktop toasts', 'src/main/services/notifications.ts')
c('Add download manager with progress, speed, pause/resume and retry', 'src/main/services/downloads.ts')
c('Add per-site permission handling with inline prompts', 'src/main/services/permissions.ts')
c('Add built-in third-party tracker blocklist', 'src/main/services/trackers.ts')
c('Add privacy layer: tracker blocking, HTTPS upgrade, GPC, cookie and JS controls', 'src/main/services/privacy.ts')
c('Add workspaces, snapshots, saved layouts and closed-tab history', 'src/main/services/workspaces.ts')
c('Add window manager with window sessions and startup restoration', 'src/main/windows.ts')
c('Harden webview guests and route in-page shortcuts, popups and context menus', 'src/main/guest.ts')
c('Add rate-limited, cached networking layer for public APIs', 'src/main/services/net.ts')
c('Add page tools: screenshots, reader extraction, regex find, media control, docked DevTools', 'src/main/services/page.ts')
c('Add app services: clipboard, dialogs, process metrics, security probes, extensions', 'src/main/services/app.ts')
c('Add local and remote search suggestions', 'src/main/services/search.ts')
c('Add browser migration from Chrome, Edge, Brave, Vivaldi, Opera and Firefox', 'src/main/services/importer.ts')
c('Add diagnostics with pluggable module checks and redacted export', 'src/main/services/diagnostics.ts')
c('Add opt-in update checker using GitHub Releases', 'src/main/services/updates.ts')
c('Add main entry: lifecycle, single instance, session handlers, tray, clean shutdown', 'src/main/index.ts')
c('Add sandboxed preload bridge with channel allow-list', 'src/preload/')

# ---------------------------------------------------------------- renderer core
c('Add renderer HTML shell with strict Content-Security-Policy', 'src/renderer/index.html')
c('Add typed IPC client for the UI', 'src/renderer/src/lib/ipc.ts')
c('Add central command registry', 'src/renderer/src/lib/commands.ts')
c('Add theme engine with seven themes', 'src/renderer/src/lib/themes.ts')
c('Add formatting helpers for bytes, prices and durations', 'src/renderer/src/lib/format.ts')
c('Add webview registry keyed by tab', 'src/renderer/src/lib/webviews.ts')
c('Add workspace icon set and group colours', 'src/renderer/src/lib/icons.ts')
c('Add omnibox provider registry', 'src/renderer/src/lib/omnibox.ts')
c('Add UI extension registries: side panels, HUD, status bar, settings, widgets', 'src/renderer/src/lib/registry.ts')
c('Add measured performance metrics', 'src/renderer/src/lib/perf.ts')
c('Add settings store with optimistic updates', 'src/renderer/src/stores/settings.ts')
c('Add UI store: overlays, menus, toasts, side panel', 'src/renderer/src/stores/ui.ts')
c('Add browser store: tabs, groups, workspaces, split layouts, lifecycle and persistence', 'src/renderer/src/stores/browser.ts')
c('Add design system base styles and tokens', 'src/renderer/src/styles/base.css')
c('Add browser frame styles: tab strip, toolbar, omnibox, rail, status bar', 'src/renderer/src/styles/chrome.css')
c('Add overlay styles: palette, menus, toasts, modals', 'src/renderer/src/styles/overlays.css')
c('Add internal page styles', 'src/renderer/src/styles/pages.css')
c('Add UI primitives: favicon, kbd, switch, tooltips, menus, toasts, modal, sparkline', 'src/renderer/src/components/ui.tsx')
c('Add prompt and confirmation dialogs', 'src/renderer/src/components/prompt.tsx')
c('Add error boundary so optional features never crash the browser', 'src/renderer/src/components/ErrorBoundary.tsx')
c('Add React 19 JSX namespace shim', 'src/renderer/src/env.d.ts')
c('Add internal page registry for specter:// pages', 'src/renderer/src/pages/registry.ts')

# ---------------------------------------------------------------- content
c('Add find-in-page event channel', 'src/renderer/src/content/findEvents.ts')
c('Add webview tab host that never re-parents live pages', 'src/renderer/src/content/WebviewTab.tsx')
c('Add find bar with case, whole-word and regex modes', 'src/renderer/src/content/FindBar.tsx')
c('Add reader mode with typography controls and local text-to-speech', 'src/renderer/src/content/ReaderView.tsx')
c('Add permission, pop-up, crash and error bars for tabs', 'src/renderer/src/content/PaneBars.tsx')
c('Add content area with split layouts, splitters and docked DevTools', 'src/renderer/src/content/ContentArea.tsx')

# ---------------------------------------------------------------- chrome
c('Add tab strip with groups, pinning, drag-reorder, tear-off and previews', 'src/renderer/src/chrome/TabStrip.tsx')
c('Add omnibox input helper', 'src/renderer/src/chrome/openInput.ts')
c('Add core omnibox providers: tabs, history, bookmarks, commands, workspaces', 'src/renderer/src/chrome/omniboxProviders.tsx')
c('Add page-type aware contextual actions', 'src/renderer/src/chrome/contextual.tsx')
c('Add site information popover with certificate and permissions', 'src/renderer/src/chrome/SiteInfo.tsx')
c('Add omnibox with scopes, inline autocomplete and per-tab telemetry', 'src/renderer/src/chrome/Omnibox.tsx')
c('Add main menu', 'src/renderer/src/chrome/mainMenu.tsx')
c('Add toolbar with navigation, split layouts and download progress', 'src/renderer/src/chrome/Toolbar.tsx')
c('Add bookmarks bar with folders and drag and drop', 'src/renderer/src/chrome/BookmarkBar.tsx')
c('Add HUD telemetry, status bar, tool rail and side panel host', 'src/renderer/src/chrome/Frame.tsx')

# ---------------------------------------------------------------- overlays, panels, commands
c('Add command palette', 'src/renderer/src/overlays/CommandPalette.tsx')
c('Add tab search across workspaces and recently closed tabs', 'src/renderer/src/overlays/TabSearch.tsx')
c('Add workspace switcher', 'src/renderer/src/overlays/WorkspaceSwitcher.tsx')
c('Add page context menu with link, image, media, selection and code actions', 'src/renderer/src/overlays/PageContextMenu.tsx')
c('Add Save to SPECTER and quick capture dialogs', 'src/renderer/src/overlays/SaveCapture.tsx')
c('Add downloads side panel', 'src/renderer/src/panels/DownloadsPanel.tsx')
c('Add tab sleeping and memory dashboard', 'src/renderer/src/panels/TabsPanel.tsx')
c('Add notifications panel', 'src/renderer/src/panels/NotificationsPanel.tsx')
c('Add page tools panel: stats, links, images, outline', 'src/renderer/src/panels/PageToolsPanel.tsx')
c('Add core command set', 'src/renderer/src/commands/')

# ---------------------------------------------------------------- pages
c('Add new tab page with quick links, frequent sites and widgets', 'src/renderer/src/pages/NewTab.tsx')
c('Add first-launch onboarding', 'src/renderer/src/pages/Welcome.tsx')
c('Add settings application', 'src/renderer/src/pages/Settings.tsx')
c('Add history page with filters and range deletion', 'src/renderer/src/pages/History.tsx')
c('Add bookmarks manager', 'src/renderer/src/pages/Bookmarks.tsx')
c('Add downloads page', 'src/renderer/src/pages/Downloads.tsx')
c('Add workspace manager with snapshot compare and saved layouts', 'src/renderer/src/pages/Workspaces.tsx')
c('Add Privacy Center', 'src/renderer/src/pages/Privacy.tsx')
c('Add security dashboard with live isolation probes', 'src/renderer/src/pages/Security.tsx')
c('Add diagnostics page with process table and performance metrics', 'src/renderer/src/pages/Diagnostics.tsx')
c('Add log viewer', 'src/renderer/src/pages/Logs.tsx')
c('Add searchable help', 'src/renderer/src/pages/Help.tsx')
c('Add local daily activity page', 'src/renderer/src/pages/Activity.tsx')

# ---------------------------------------------------------------- app shell
c('Register core UI: commands, panels, pages, HUD and status items', 'src/renderer/src/core/')
c('Add module overlay registry', 'src/renderer/src/modules/overlays.tsx')
c('Add app shell: keyboard routing, IPC events, theme sync, restore prompt', 'src/renderer/src/App.tsx')

# ---------------------------------------------------------------- modules
MODULES = {
  'ai': 'Local AI',
  'system': 'System monitor',
  'knowledge': 'Notes, research and knowledge',
  'markets': 'Markets, crypto and finance',
  'developer': 'Developer tools',
  'toolkit': 'Toolkit',
  'automation': 'Automation, plugins, media and cockpit',
}
DESC = {
  # ai
  'src/main/modules/ai/providers/types.ts': 'define the AIProvider interface',
  'src/main/modules/ai/providers/ollama.ts': 'add Ollama provider with streaming chat and embeddings',
  'src/main/modules/ai/providers/index.ts': 'add provider registry with remote opt-in guard',
  'src/main/modules/ai/ndjson.ts': 'add NDJSON stream parser',
  'src/main/modules/ai/context.ts': 'add context budgeting with numbered citations',
  'src/main/modules/ai/gather.ts': 'gather only user-selected page, selection and tab context',
  'src/main/modules/ai/prompt.ts': 'add prompt builder with citation and no-fabrication rules',
  'src/main/modules/ai/agents.ts': 'add sequential agent pipeline',
  'src/main/modules/ai/store.ts': 'persist conversations per profile',
  'src/main/modules/ai/service.ts': 'add chat service with cancellation and timeouts',
  'src/main/modules/ai/index.ts': 'register IPC handlers and diagnostics',
  'src/renderer/src/modules/ai/store.ts': 'add renderer store that survives panel close',
  'src/renderer/src/modules/ai/Markdown.tsx': 'add sanitized markdown with citation badges',
  'src/renderer/src/modules/ai/AiPanel.tsx': 'add AI side panel with context selector',
  'src/renderer/src/modules/ai/StatusItems.tsx': 'add HUD and status bar indicators',
  'src/renderer/src/modules/ai/omnibox.tsx': 'add @ai omnibox provider',
  # system
  'src/main/modules/system/parsers.ts': 'add nvidia-smi, typeperf, netstat and tasklist parsers',
  'src/main/modules/system/sources.ts': 'add metric sources: GPU, disks, network, CPU utility',
  'src/main/modules/system/service.ts': 'add subscription-based metrics poller',
  'src/main/modules/system/processes.ts': 'add process list and open file location',
  'src/main/modules/system/netdiag.ts': 'add DNS, HTTPS and TLS network diagnostics',
  'src/renderer/src/modules/system/charts.tsx': 'add history charts',
  'src/renderer/src/modules/system/Hud.tsx': 'add CPU/RAM/GPU title-bar readouts',
  'src/renderer/src/modules/system/Performance.tsx': 'add performance modes and SPECTER process view',
  # knowledge
  'src/main/modules/knowledge/schema.ts': 'add notes, research and knowledge schema with FTS5',
  'src/main/modules/knowledge/embeddings.ts': 'add local embeddings client',
  'src/main/modules/knowledge/kb.ts': 'add knowledge base with hybrid keyword + semantic search',
  'src/main/modules/knowledge/graph.ts': 'add entity graph storage',
  'src/renderer/src/modules/knowledge/ResearchGraph.tsx': 'add source → claim → evidence graph',
  'src/renderer/src/modules/knowledge/QuickNote.tsx': 'add quick note overlay',
  # markets
  'src/main/modules/markets/normalize.ts': 'normalize exchange responses into quotes and candles',
  'src/main/modules/markets/providers.ts': 'add Binance, Coinbase and CoinGecko providers',
  'src/main/modules/markets/stream.ts': 'add Binance WebSocket stream with reconnect backoff',
  'src/main/modules/markets/hub.ts': 'add market hub: cache, fallback, subscriptions',
  'src/main/modules/markets/alerts.ts': 'add local price, change and volume alerts',
  'src/main/modules/markets/paper.ts': 'add paper trading engine',
  'src/main/modules/markets/research.ts': 'add token research and risk indicators',
  'src/main/modules/markets/fx.ts': 'add currency conversion from free rate APIs',
  'src/renderer/src/modules/markets/Chart.tsx': 'add candlestick chart with timeframes and volume',
  # developer
  'src/main/modules/developer/proc.ts': 'add safe process runner with timeouts',
  'src/main/modules/developer/ignore.ts': 'add ignore rules and binary detection',
  'src/main/modules/developer/indexer.ts': 'add cancellable project file indexer',
  'src/main/modules/developer/gitParse.ts': 'add git status, log and diff parsers',
  'src/main/modules/developer/git.ts': 'add Git operations via the git CLI',
  'src/main/modules/developer/terminal.ts': 'add line-based shell sessions',
  'src/renderer/src/modules/developer/ansi.ts': 'add ANSI color renderer',
  # automation
  'src/main/modules/automation/engine.ts': 'add rule engine with loop protection',
  'src/main/modules/automation/manifest.ts': 'add strict plugin manifest validation',
  'src/main/modules/automation/executor.ts': 'add action executor with run log',
  'src/main/modules/automation/plugins.ts': 'add declarative plugin loader',
  'src/renderer/src/modules/automation/media.tsx': 'add media controls panel',
  'src/renderer/src/modules/automation/CockpitPage.tsx': 'add multi-panel cockpit',
}

def module_msg(mod, path):
    name = MODULES[mod]
    if path in DESC:
        return f'{name}: {DESC[path]}'
    base = os.path.splitext(os.path.basename(path))[0]
    if path.startswith('src/shared/modules/'):
        return f'{name}: define shared types and IPC contract'
    if path.startswith('tests/'):
        return f'{name}: add unit tests for {base.replace(".test", "").split("-", 1)[-1]}'
    if base == 'index':
        where = 'main process' if path.startswith('src/main') else 'UI'
        return f'{name}: register {where} module'
    if path.endswith('.css'):
        return f'{name}: add styles'
    kind = 'page' if base.endswith('Page') else 'panel' if base.endswith('Panel') else 'tool' if '/tools/' in path else 'component' if path.endswith('.tsx') else 'logic'
    words = ''.join(' ' + ch.lower() if ch.isupper() else ch for ch in base).strip()
    if words.split(' ')[-1] == kind:
        return f'{name}: add {words}'
    if path.endswith('.html'):
        return f'{name}: add sandboxed {words} page'
    if kind == 'logic' and '/lib/' in path:
        return f'{name}: add {words} library'
    return f'{name}: add {words} {kind}'

for mod in MODULES:
    files = [f'src/shared/modules/{mod}.ts'] if f'src/shared/modules/{mod}.ts' in ALL else []
    files += [f for f in ALL if f.startswith(f'src/main/modules/{mod}/')]
    files += [f for f in ALL if f.startswith(f'src/renderer/src/modules/{mod}/')]
    files += [f for f in ALL if f.startswith(f'tests/unit/{mod}-')]
    # Group tiny siblings (toolkit tools/libs) in pairs to keep commits meaningful.
    for f in files:
        c(module_msg(mod, f), f)

c('Wire optional modules into the main process', 'src/main/modules.ts')
c('Wire optional modules into the UI', 'src/renderer/src/modules/index.ts')
c('Add renderer entry with focus hand-off and debug accessor', 'src/renderer/src/main.tsx')

# ---------------------------------------------------------------- tests, assets, packaging, docs
c('Add unit tests for URL and omnibox parsing', 'tests/unit/url.test.ts')
c('Add unit tests for fuzzy matching, key bindings and updates', 'tests/unit/fuzzy-keys.test.ts')
c('Add unit tests for tracker and domain rules', 'tests/unit/privacy-rules.test.ts')
c('Add storage tests against in-memory SQLite', 'tests/unit/storage.test.ts')
c('Add Playwright end-to-end acceptance flow', 'tests/e2e/')
c('Add development harness for driving the built app', 'scripts/drive.mjs')
c('Add smoke test for the packaged app', 'scripts/smoke-packaged.mjs')
c('Add SPECTER logo', 'resources/logo.svg')
c('Add icon renderer script and generated app icons', 'scripts/make-icons.cjs', 'resources/icon.png', 'resources/icon.ico', 'build/')
c('Add Windows packaging: NSIS installer and portable build', 'electron-builder.yml')
c('Add third-party license generator and license inventory', 'scripts/licenses.mjs', 'THIRD_PARTY_LICENSES.md')
c('Add module development guide', 'docs/MODULES.md')
c('Document architecture', 'docs/ARCHITECTURE.md')
c('Document privacy', 'docs/PRIVACY.md')
c('Document security model', 'docs/SECURITY.md')
c('Add roadmap', 'docs/ROADMAP.md')
c('Add screenshots', 'docs/screenshots/')
c('Add history replay script used to publish this repository', 'scripts/replay-history.py')
c('Add README', 'README.md')

left = [f for f in ALL if f not in done]
if left:
    c('Add remaining files', *left)

# ---------------------------------------------------------------- execute
os.makedirs(PUB, exist_ok=True)
env = dict(os.environ, GIT_AUTHOR_NAME=NAME, GIT_AUTHOR_EMAIL=EMAIL, GIT_COMMITTER_NAME=NAME, GIT_COMMITTER_EMAIL=EMAIL)
def git(*args):
    subprocess.run(['git', *args], cwd=PUB, check=True, env=env, stdout=subprocess.DEVNULL)
git('init', '-q', '-b', 'main')
git('config', 'core.autocrlf', 'false')
for i, (msg, files) in enumerate(plan, 1):
    for f in files:
        dst = os.path.join(PUB, f)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(os.path.join(EXPORT, f), dst)
    git('add', '--', *files)
    git('commit', '-q', '-m', msg + TRAILER)

# verify
pub = [f for f in rel_files(PUB) if not f.startswith('.git/')]
assert sorted(pub) == ALL, 'file sets differ'
bad = [f for f in ALL if not filecmp.cmp(os.path.join(EXPORT, f), os.path.join(PUB, f), shallow=False)]
assert not bad, f'content differs: {bad[:5]}'
print(f'{len(plan)} commits, {len(ALL)} files, tree verified identical')
