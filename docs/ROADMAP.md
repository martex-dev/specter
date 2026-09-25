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
- Privacy Center, tracker blocking, GPC/DNT, HTTPS-first, per-site cookie/JS controls, third-party cookie blocking (approximate), security dashboard with live probes
- Reader mode + TTS, find with regex, page tools, screenshots (visible/full page), PDF viewer, docked/detached DevTools, HTML5 fullscreen
- 7 themes, accent colours, density, reduced motion
- Diagnostics, log viewer, measured performance metrics, opt-in update checker (GitHub Releases)
- Modules: local AI (Ollama), notes/research/knowledge (+ semantic search), markets/crypto/finance, system monitor, developer (projects, Git, terminal), toolkit, automation/plugins/media/widgets/cockpit
- Windows installer + portable build

## In progress

- Keyboard focus hand-off when a shortcut opens SPECTER UI while a web page holds native focus (a global fix is in place; broader verification with real keyboard input on more setups)

## Planned

- Vertical tabs layout (the setting exists but is not exposed yet)
- Chrome Web Store installs (currently: load unpacked extensions only)
- Password manager integration with the OS credential store
- Keep-alive for hidden internal pages (cockpit web panels currently reload when you leave the cockpit tab)
- Code signing for release builds
- Linux and macOS builds (the architecture is portable; not yet tested)

## Experimental

- Unpacked Chrome extensions (Electron supports a subset of extension APIs)
- Knowledge graph and agent pipelines
- Declarative plugins
