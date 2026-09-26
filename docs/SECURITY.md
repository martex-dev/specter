# Security model

## Isolation

- **SPECTER UI**: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, strict
  Content-Security-Policy (`script-src 'self'`). It can only call `window.specter.invoke(channel)`
  for allow-listed channel domains; the main process additionally verifies that every IPC call comes
  from a registered SPECTER window.
- **Web pages**: every `<webview>` goes through `will-attach-webview`, which removes any preload and
  forces `sandbox`, `contextIsolation`, `webSecurity`, no Node integration and no insecure content.
  The live Security dashboard (`specter://security`) *probes* each open page to confirm that Node.js
  and SPECTER's bridge are unreachable from it.
- **Page helpers** run in an isolated JavaScript world, invisible to page scripts.
- **Ad blocker**: web pages get exactly two session preloads, both in the isolated world and exposing
  nothing to the page: SPECTER's scriptlet loader (`src/preload/adblock.ts`) and Ghostery's cosmetic
  filter script. They can reach only three ad-blocker channels, which the main process answers only for
  tab and pop-up contents of a profile session. Scriptlets from the filter lists run in the page's main
  world, as they do in uBlock Origin.
- **Video tools**: a third session preload (`src/preload/video.ts`), also in the isolated world and
  exposing nothing, runs the speed controller. It only sets `playbackRate` / `currentTime` on the page's
  own media elements (and those of same-origin frames), which the page could do itself; it ignores
  synthetic key events and clicks from page scripts, and its badge is a closed shadow root. It reaches
  three video-tools channels, answered only for the main frame of tab and pop-up contents; the site it
  remembers a speed for is taken from the sending frame, never from the page.
- **The UI never navigates**: `will-navigate` and `window.open` from the UI are blocked.

## Permissions

Stored per origin with allow / block / ask. Low-risk permissions (fullscreen, pointer lock,
sanitized clipboard write) are granted automatically; device access (USB/HID/serial/Bluetooth,
MIDI SysEx) is always denied; everything else asks in the tab.

## Certificates

Chromium's certificate verification is used unchanged (SPECTER only observes the result to show
certificate details). Invalid certificates are blocked with an error page; there is no "proceed
anyway" bypass in v1.

## Commands that execute or delete

- The terminal only runs commands the user types or explicitly confirms.
- AI can only *suggest* commands; running one always requires a visible confirmation, and the AI
  permission model (read / suggest / write / execute) defaults to read + suggest.
- Destructive Git operations and data deletion require confirmation dialogs.
- Plugins are declarative JSON (commands and automations built from SPECTER's own actions) — they
  cannot run arbitrary code.

## Extensions

Unpacked Chrome extensions can be loaded (experimental; Electron supports a subset of the APIs).
Extensions can read pages you visit — the Security dashboard lists them.

## Passwords

SPECTER does not store passwords in v1 and does not import them from other browsers.

## Reporting

Please report vulnerabilities privately to the maintainers rather than in a public issue.
