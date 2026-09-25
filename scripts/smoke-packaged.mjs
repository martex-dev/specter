import { _electron as electron } from 'playwright'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const profile = mkdtempSync(join(tmpdir(), 'specter-pkg-'))
const app = await electron.launch({ executablePath: process.argv[2], args: [], env: { ...process.env, SPECTER_USER_DATA: profile }, timeout: 60000 })
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(e.message))
await win.waitForSelector('.app', { timeout: 30000 })
await win.evaluate(() => window.specter.invoke('settings:set', 'general.onboarded', true))
await win.click('.omnibox-row'); await win.keyboard.press('Control+a'); await win.keyboard.type('example.com'); await win.keyboard.press('Enter')
await win.waitForTimeout(3000)
const s = await win.evaluate(() => { const b = window.__specterDebug.browser(); return b.open[b.activeWsId].tabs.map((t) => t.title) })
const rail = await win.evaluate(() => [...document.querySelectorAll('.rail button')].map((b) => b.getAttribute('aria-label')))
const hud = await win.evaluate(() => document.querySelector('.hud')?.textContent)
const info = await win.evaluate(() => window.specter.invoke('app:info'))
const diag = await win.evaluate(() => window.specter.invoke('diagnostics:run'))
console.log(JSON.stringify({ tabs: s, rail, hud, packaged: info.isPackaged, version: info.version, diag: diag.map((d) => d.label + ':' + d.status), errors }, null, 1))
await app.close()
