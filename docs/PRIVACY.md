# Privacy

SPECTER has **no analytics, telemetry, crash upload or accounts.** This page lists
every way data can leave your computer, all of which are user-visible.

## Stored locally (never uploaded)

History, recent searches, bookmarks, workspaces and snapshots, downloads list, site
permissions, notifications, notes, research, knowledge base, AI conversations,
portfolio / paper trades, automations, settings — in `specter.db` (SQLite) inside the
profile folder (`%APPDATA%\SPECTER` by default). Cookies, site storage and cache are
Chromium's, isolated per SPECTER profile.

## Network requests SPECTER itself makes

| Feature | Destination | When |
| --- | --- | --- |
| Web pages | the sites you visit | when you browse |
| Remote search suggestions | your search engine (DuckDuckGo / Google / Bing) | **off by default**; only while typing in the address bar when enabled |
| Tracker blocking | none | the blocklist is built in |
| Local AI | your Ollama server (default `127.0.0.1`) | only when you send a prompt; a non-local AI address is flagged in the Privacy Center and AI panel |
| Market data | Binance / Coinbase / CoinGecko / DexScreener public APIs, currency rates API | only when market tools are enabled and visible |
| Translate page | Google Translate (the page URL) | only when you choose "Translate page" |
| Google Lens image search | Google (the image URL) | only when you choose it from the image menu |
| Diagnostics connectivity check | `www.gstatic.com/generate_204` | only when you run diagnostics |
| New-tab shortcut icons | the shortcut's own site (`/favicon.ico`) | when the new tab page is shown |
| Automatic updates (installed Windows build) | `github.com` releases of `martex-dev/specter` (and GitHub's download servers for the installer) | **on by default** (Settings → About): 30 s after start and every 6 h, in a separate network session without cookies; only release metadata is requested, no browsing data |
| Release check (portable / unpacked builds) | `api.github.com` (the repository in Settings → About) | **off by default**; at most daily when enabled, or when you press Check now |

## Protections

- Built-in third-party tracker blocking (a compact list; its size is shown in the Privacy Center).
- Global Privacy Control header (on by default); Do Not Track (off by default).
- HTTPS-first navigation with automatic HTTP fallback for sites without HTTPS.
- Optional third-party cookie blocking (an approximation based on registrable domains — see the setting's description).
- Per-site controls for JavaScript, cookies, pop-ups, camera, microphone, location, notifications, clipboard and screen capture.
- Pop-ups are blocked unless triggered by a click or allowed for the site.
- Device APIs (WebUSB, WebHID, Web Serial, Bluetooth) are always denied.
- Optional "clear on exit".

## AI context

AI never reads anything on its own. The AI panel shows a context selector (current
page, selected text, other tabs, workspace, notes) and exactly how much text is attached
before you send. Conversations store your messages and the answers, plus *which* context
items were used — not the page text itself.

## Local indexing

SPECTER never scans your disk. Project folders are indexed only after you add them in
Settings → Developer, and only those folders.
