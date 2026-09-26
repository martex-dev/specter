// Ad-blocker scriptlet preload (registered on profile sessions, runs in every
// web page's isolated world). Scriptlets — e.g. the ones that strip YouTube
// ads — patch page APIs and must run before the page's own scripts, so they are
// fetched synchronously at document start and executed in the main world
// (webFrame.executeJavaScript is exempt from the page's CSP / Trusted Types).
// Exposes nothing to the page.
import { ipcRenderer, webFrame } from 'electron'

declare const location: { href: string }

try {
  if (/^https?:/.test(location.href)) {
    // One pre-assembled script (see assembleScriptlets in services/adblock.ts).
    const code = ipcRenderer.sendSync('specter-adblock:scriptlets', location.href) as unknown
    if (typeof code === 'string' && code) void webFrame.executeJavaScript(code).catch(() => {})
  }
} catch {
  /* never break a page over an ad */
}
