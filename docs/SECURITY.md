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
- **Font inspector**: its overlay runs in its own isolated world and draws in a closed shadow root; it
  has no IPC and only answers the main process. To name the font Chromium rendered, the main process
  attaches the debugger to that tab for a few read-only DOM/CSS protocol calls when you pin a card or
  open the page summary, then detaches.
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

SPECTER's password manager (`specter://passwords`) keeps saved logins in the profile's `specter.db`,
each password encrypted with Electron `safeStorage` — Windows DPAPI, so only your Windows account on
this PC can decrypt them. If DPAPI isn't available nothing is stored (there is no plain-text fallback).

- **Filling.** A page-side preload runs in each frame's isolated world. It shows saved logins in a
  closed shadow root under the focused sign-in field and asks for a password only after a real
  (`isTrusted`) click or key press on a suggestion. The main process answers from Chromium's record of
  the requesting frame's origin — never from anything the page sends — so a site only receives logins
  saved for that site (an `https` login is never given to an `http` page; other hosts of the same
  site are listed but must be picked explicitly). Pages get no API: nothing is exposed to the main world.
- **Saving.** Submitted logins are held in the main process and offered ("Save password?") only
  after the sign-in looks successful: a navigation the page itself starts right after the submit,
  the password form disappearing, or a sign-in pop-up closing. Leaving the page any other way drops it.
- **Importing from Chrome.** Chrome encrypts its password store so that only Chrome can read it, and
  SPECTER doesn't try to. You export from Chrome (Settings → Passwords → Export, confirmed with your
  Windows password) and import the CSV; SPECTER then offers to move that plain-text file to the Recycle
  Bin. Exports from Edge, Brave, Opera, Firefox, Bitwarden, 1Password and LastPass are read the same way.
- **Suggested passwords** on sign-up and change-password forms are generated in the main process
  from `crypto.randomInt` (15 characters, four character classes, no look-alike characters) and
  saved as soon as the form is submitted.
- **Copying** a password from `specter://passwords` clears the clipboard a minute later if it still
  holds that password.
- **Exporting** asks for confirmation and warns that the file is plain text.

## Addresses (form autofill)

Saved addresses (`specter://addresses`) are stored per profile in `specter.db`. A second page preload
(isolated world, closed shadow root) recognises address and contact fields — by `autocomplete`, then
by names and labels — and lists saved addresses by name and street only. The full address is sent to a
page only after a real click or key press on one, and only into empty fields plus the focused one.
Email fields of sign-in forms are left to the password manager, and card fields are never touched.

## Reporting

Please report vulnerabilities privately to the maintainers rather than in a public issue.
