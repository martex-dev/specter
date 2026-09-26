# Roadmap

Status reflects what is implemented and verified in the running app, not intent.

## Completed

- Chromium browsing core: tabs, pinned tabs, tab groups, drag/reorder/tear-off, multiple windows, merge windows, temporary tabs, tab notes, hover previews
- Omnibox with scopes, inline autocomplete, history/bookmark/tab/command/workspace/module providers, optional remote suggestions
- History (FTS5), bookmarks (folders, tags, bar, HTML import/export), downloads manager, site permissions, pop-up blocker
- Profiles with isolated storage; browser import (Chrome, Edge, Brave, Vivaldi, Opera, Firefox — bookmarks & history)
- Session restore (lazy), crash recovery, reopen closed tabs, workspace snapshots & compare, exports
- Split view (8 presets, resizable, saved layouts), focus mode, pop-out panels
- Tab lifecycle & sleeping with measured memory
- Command palette, customisable shortcuts (UI and in-page), help, onboarding
- Ad blocker: uBlock Origin / EasyList filter lists (network, element hiding, scriptlets incl. YouTube), cookie banners, per-site switch, custom filters
- Video tools: speed keys (S/D/R/Z/X/G, rebindable), speed badge, per-site speed memory, speed kept across site resets, same-origin frames, media-controls and palette integration
- Privacy Center, tracker blocking, GPC/DNT, HTTPS-first, per-site cookie/JS controls, third-party cookie blocking (approximate), security dashboard with live probes
- Reader mode + TTS, find with regex, page tools, screenshots (visible/full page), PDF viewer, docked/detached DevTools, HTML5 fullscreen
- Font inspector: hover tooltip, pinned detail cards with Copy CSS, the platform font Chromium rendered (DevTools protocol), fonts and web fonts on the page
- Theme engine v2: 11 theme packs (layouts, typography, effects) × 6 palettes, custom accent, layout mix-and-match, automatic day/night or system-following themes
- Opera-GX-style dock with app / widget / tool sections, keep-alive panels and badges
- Vertical tabs layout (collapsible sidebar, groups, pinned grid, drag reorder)
- Sidebar web apps (20-app catalog + custom), unread badges, mobile/desktop layouts
- Widgets: weather, RSS news, world clocks, calendar (.ics import, reminders), speed test, currency, sticky notes, countdowns
- GX Control: RAM / network / CPU limiters, hot tabs, browser sounds, new-tab wallpapers
- Diagnostics, log viewer, measured performance metrics, auto-updates for the installed Windows build (electron-updater + GitHub Releases), notify-only release check for portable builds
- Modules: local AI (Ollama), notes/research/knowledge (+ semantic search), markets/crypto/finance, system monitor, developer (projects, Git, terminal), toolkit, automation/plugins/media/widgets/cockpit
- Windows installer + portable build

## In progress

- Keyboard focus hand-off when a shortcut opens SPECTER UI while a web page holds native focus (a global fix is in place; broader verification with real keyboard input on more setups)

## Planned

- Network limiter as a shared budget across tabs (currently a per-page cap)
- Recurring calendar events (ICS import currently takes the first occurrence)
- Chrome Web Store installs (currently: load unpacked extensions only)
- Password manager integration with the OS credential store
- Keep-alive for hidden internal pages (cockpit web panels currently reload when you leave the cockpit tab)
- Code signing for release builds
- Linux and macOS builds (the architecture is portable; not yet tested)

## Experimental

- Unpacked Chrome extensions (Electron supports a subset of extension APIs)
- Knowledge graph and agent pipelines
- Declarative plugins
