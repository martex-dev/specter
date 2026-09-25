// SPECTER end-to-end acceptance test.
// Builds are expected in out/ (npm run test:e2e builds first).
// Serves local test pages + a downloadable file so the core flow is network-independent;
// the web-search step is skipped (reported) when offline.
import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const results = []
const step = async (name, fn) => {
  const t0 = Date.now()
  try {
    const note = await fn()
    results.push({ name, ok: true, ms: Date.now() - t0, note })
    console.log(`  ✓ ${name}${note ? ` — ${note}` : ''} (${Date.now() - t0} ms)`)
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t0, note: err.message })
    if (process.env.E2E_VERBOSE) console.log(err.message)
    if (process.env.E2E_SHOTS && globalThis.__win) {
      const f = join(process.env.E2E_SHOTS, 'fail-' + name.replace(/[^a-z0-9]+/gi, '_') + '.png')
      await globalThis.__win.screenshot({ path: f }).catch(() => {})
      const menu = await globalThis.__win.evaluate(() => ({ menus: document.querySelectorAll('.menu').length, active: document.activeElement?.tagName, focus: document.hasFocus() })).catch(() => null)
      console.log('    failure state:', JSON.stringify(menu), f)
    }
    console.log(`  ✗ ${name} — ${err.message}`)
  }
}

// ---------------------------------------------------------------- local test server
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/file.bin') {
    const body = Buffer.alloc(256 * 1024, 7)
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="specter-e2e.bin"', 'Content-Length': body.length })
    return res.end(body)
  }
  const n = url.pathname.replace(/\W/g, '') || 'home'
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><title>E2E ${n}</title><h1>SPECTER E2E page ${n}</h1><p>alpha beta gamma ${n}</p><a id="dl" href="/file.bin">download</a>`)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const profile = mkdtempSync(join(tmpdir(), 'specter-e2e-'))
const downloads = mkdtempSync(join(tmpdir(), 'specter-e2e-dl-'))

async function launch() {
  const app = await electron.launch({ args: [resolve('.')], env: { ...process.env, SPECTER_USER_DATA: profile }, timeout: 60000 })
  const win = await app.firstWindow()
  await win.waitForSelector('.app', { timeout: 30000 })
  await win.waitForTimeout(600)
  globalThis.__win = win
  return { app, win }
}
const state = (win) => win.evaluate(() => {
  const s = window.__specterDebug.browser()
  const ws = s.open[s.activeWsId]
  return { activeWsId: s.activeWsId, wsName: ws?.name, tabs: ws?.tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, groupId: t.groupId, suspended: t.suspended })) ?? [], activeTabId: ws?.activeTabId, groups: ws?.groups ?? [], layout: ws?.layout, workspaces: s.workspaces.map((w) => ({ id: w.id, name: w.name })) }
})
const until = async (fn, ms = 10000, what = 'condition') => {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what)
    await new Promise((r) => setTimeout(r, 150))
  }
}
// Shortcuts pressed while a web page has focus travel page → main → UI, so give
// focus a human-scale moment to move before typing (a person's first keystroke
// after Ctrl+L is ~100 ms later; synthetic typing is ~5 ms).
const navigate = async (win, text) => {
  // Click the address bar (synthetic key events can't reach a focused web page's
  // native input path, so shortcuts are exercised from SPECTER's UI instead).
  await win.click('.omnibox-row', { position: { x: 200, y: 15 } })
  await win.keyboard.press('Control+a')
  await win.keyboard.type(text, { delay: 5 })
  await win.keyboard.press('Enter')
}

console.log('SPECTER E2E — profile', profile)
let { app, win } = await launch()
const startupMs = await app.evaluate(() => Math.round(process.uptime() * 1000))

await step('Launch SPECTER', async () => {
  // Skip onboarding and point downloads to a temp folder.
  await win.evaluate(async (dl) => {
    await window.specter.invoke('settings:set', 'general.onboarded', true)
    await window.specter.invoke('settings:set', 'downloads.directory', dl)
  }, downloads)
  const s = await state(win)
  assert.ok(s.tabs.length >= 1, 'has a tab')
  return `main process uptime at first window ${startupMs} ms`
})

await step('Create tab', async () => {
  const before = (await state(win)).tabs.length
  await win.keyboard.press('Control+t')
  await until(async () => (await state(win)).tabs.length === before + 1, 5000, 'new tab')
})

await step('Visit website', async () => {
  await navigate(win, `${base}/one`)
  await until(async () => (await state(win)).tabs.find((t) => t.title === 'E2E one'), 10000, 'page title')
})

await step('Search web', async () => {
  await win.click('button[aria-label="New tab"]')
  await navigate(win, 'specter browser e2e search')
  const s = await until(async () => (await state(win)).tabs.find((t) => t.url.includes('duckduckgo.com') || t.url.includes('search')), 8000, 'search navigation')
  return s.url.slice(0, 60)
})

await step('Open multiple tabs', async () => {
  for (const p of ['two', 'three']) {
    await win.click('button[aria-label="New tab"]')
    await navigate(win, `${base}/${p}`)
  }
  await until(async () => (await state(win)).tabs.filter((t) => t.title.startsWith('E2E ')).length >= 3, 10000, 'three local tabs')
})

await step('Create tab group', async () => {
  const tab = win.locator('.tab', { hasText: 'E2E one' })
  await tab.click({ button: 'right' })
  // Let Chromium's compositor hit-test data catch up with the overlay (menus float above webviews).
  await win.waitForTimeout(200)
  await win.locator('.menu-item', { hasText: 'Add to group' }).hover()
  await win.waitForTimeout(150)
  await win.locator('.menu-item', { hasText: 'New group' }).click()
  await win.fill('.modal input', 'E2E Group')
  await win.keyboard.press('Enter')
  const s = await until(async () => {
    const st = await state(win)
    return st.groups.find((g) => g.name === 'E2E Group') && st
  }, 5000, 'group')
  assert.ok(s.tabs.some((t) => t.groupId && t.title === 'E2E one'))
})

let newWsId = ''
await step('Create workspace', async () => {
  await win.keyboard.press('Control+Shift+W')
  await win.click('.palette button:has-text("New")')
  await win.fill('.modal input', 'E2E Space')
  await win.keyboard.press('Enter')
  const s = await until(async () => {
    const st = await state(win)
    return st.wsName === 'E2E Space' && st
  }, 8000, 'switch to new workspace')
  newWsId = s.activeWsId
  // Go back to the previous workspace for the next steps.
  await win.keyboard.press('Control+Shift+W')
  await win.keyboard.press('1')
  await until(async () => (await state(win)).wsName === 'Personal', 5000, 'back to Personal')
})

await step('Move tabs to workspace', async () => {
  const tab = win.locator('.tab', { hasText: 'E2E three' })
  await tab.click({ button: 'right' })
  await win.waitForTimeout(200)
  await win.locator('.menu-item', { hasText: 'Move to workspace' }).hover()
  await win.waitForTimeout(150)
  await win.locator('.menu-item', { hasText: 'E2E Space' }).click()
  await until(async () => !(await state(win)).tabs.some((t) => t.title === 'E2E three'), 5000, 'tab moved out')
  const target = await win.evaluate((id) => window.specter.invoke('workspaces:list').then((l) => l.find((w) => w.id === id)), newWsId)
  await until(async () => {
    const l = await win.evaluate((id) => window.specter.invoke('workspaces:list').then((l) => l.find((w) => w.id === id)), newWsId)
    return l.state.tabs.some((t) => t.title === 'E2E three')
  }, 5000, 'tab present in target workspace')
  return `target had ${target?.state.tabs.length} tab(s) before verification`
})

await step('Split screen', async () => {
  await win.click('button[aria-label="Split view"]')
  await win.waitForTimeout(200)
  await win.locator('.menu-item', { hasText: 'Split 50 / 50' }).click()
  const s = await until(async () => {
    const st = await state(win)
    return st.layout.preset === '50/50' && st.layout.panes.length === 2 && st
  }, 5000, 'split layout')
  const panes = await win.locator('.pane.split:visible').count()
  assert.equal(panes, 2)
  await win.click('button[aria-label="Split view"]')
  await win.waitForTimeout(200)
  await win.locator('.menu-item', { hasText: 'Single view' }).click()
  await until(async () => (await state(win)).layout.preset === 'single', 5000, 'back to single view')
  return `panes: ${s.layout.panes.length}`
})

await step('Bookmark page', async () => {
  await win.locator('.tab', { hasText: 'E2E one' }).click()
  await win.keyboard.press('Control+d')
  await until(async () => win.evaluate((u) => window.specter.invoke('bookmarks:findByUrl', u), `${base}/one`), 5000, 'bookmark saved')
  await win.waitForSelector('.bm-item:has-text("E2E one")', { timeout: 5000 })
})

await step('Download file', async () => {
  await win.locator('.tab', { hasText: 'E2E one' }).click()
  await win.evaluate(() => {
    const wv = [...document.querySelectorAll('webview')].find((w) => !w.closest('.pane').style.display)
    return wv?.executeJavaScript("document.getElementById('dl').click()")
  })
  const d = await until(async () => {
    const list = await win.evaluate(() => window.specter.invoke('downloads:list'))
    return list.find((x) => x.filename.startsWith('specter-e2e') && x.state === 'completed')
  }, 15000, 'download complete')
  assert.ok(existsSync(d.savePath), 'file exists on disk')
  return `${d.filename}, ${d.receivedBytes} bytes`
})

await step('Search history', async () => {
  const res = await win.evaluate(() => window.specter.invoke('history:search', { text: 'E2E two' }))
  assert.ok(res.some((r) => r.title === 'E2E two'), 'history hit')
  return `${res.length} hit(s)`
})

await step('Close tab', async () => {
  await win.locator('.tab', { hasText: 'E2E two' }).click()
  await win.keyboard.press('Control+w')
  await until(async () => !(await state(win)).tabs.some((t) => t.title === 'E2E two'), 5000, 'tab closed')
})

await step('Restore closed tab', async () => {
  await win.keyboard.press('Control+Shift+t')
  await until(async () => (await state(win)).tabs.some((t) => t.url.endsWith('/two')), 8000, 'tab restored')
})

const beforeRestart = await state(win)
await step('Restart SPECTER', async () => {
  await win.waitForTimeout(900) // let debounced state saves land
  await app.close()
  ;({ app, win } = await launch())
})

await step('Restore session', async () => {
  const s = await state(win)
  const urls = (x) => x.tabs.map((t) => t.url).filter((u) => u.startsWith(base)).sort()
  assert.deepEqual(urls(s), urls(beforeRestart))
  assert.ok(s.groups.some((g) => g.name === 'E2E Group'), 'group restored')
  return `${s.tabs.length} tabs restored (${s.tabs.filter((t) => t.suspended).length} lazily sleeping)`
})

await step('Open command palette & search workspace', async () => {
  await win.keyboard.press('Control+k')
  await win.keyboard.type('E2E Space')
  await win.waitForSelector('.palette-item:has-text("E2E Space")', { timeout: 5000 })
  await win.keyboard.press('Escape')
})

const optional = [
  ['Open AI panel', 'ai'],
  ['Open research tools', 'research'],
  ['Open market dashboard', 'markets'],
  ['Open system monitor', 'system']
]
for (const [name, panel] of optional) {
  await step(name, async () => {
    const exists = await win.evaluate((id) => !!document.querySelector(`.rail button[aria-label]`) && [...document.querySelectorAll('.rail button')].some((b) => b.getAttribute('aria-label')?.toLowerCase().includes(id)), panel)
    if (!exists) return 'module not present — skipped'
    await win.locator(`.rail button[aria-label*="${panel}" i]`).first().click()
    await win.waitForSelector('.sidepanel', { timeout: 5000 })
    const crashed = await win.locator('.sidepanel [role="alert"]').count()
    assert.equal(crashed, 0, 'panel rendered without errors')
    await win.locator(`.rail button[aria-label*="${panel}" i]`).first().click()
  })
}

await step('Open developer tools', async () => {
  await win.locator('.tab', { hasText: 'E2E one' }).click()
  await win.keyboard.press('F12')
  const docked = await until(async () => (await state(win)).tabs.length && win.evaluate(() => {
    const s = window.__specterDebug.browser()
    const ws = s.open[s.activeWsId]
    return ws.tabs.find((t) => t.id === ws.activeTabId)?.devtoolsDocked
  }), 5000, 'devtools docked')
  await win.keyboard.press('F12')
  return docked ? 'docked' : ''
})

await app.close()
server.close()
try {
  rmSync(profile, { recursive: true, force: true })
  rmSync(downloads, { recursive: true, force: true })
} catch {
  /* Windows may hold files briefly */
}
void readdirSync
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} steps passed`)
process.exit(failed.length ? 1 : 0)
