// Password manager end-to-end test: saving after sign-in, the in-page
// suggestion list, filling, updates, single-page and two-step sign-ins,
// per-site isolation, CSV import / export. Uses local pages and a throwaway
// profile. Run after `npm run build`: node tests/e2e/passwords.mjs
import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const results = []
const step = async (name, fn) => {
  const t0 = Date.now()
  try {
    const note = await fn()
    results.push({ name, ok: true })
    console.log(`  ✓ ${name}${note ? ` — ${note}` : ''} (${Date.now() - t0} ms)`)
  } catch (err) {
    results.push({ name, ok: false })
    console.log(`  ✗ ${name} — ${err.message}`)
  }
}
const until = async (fn, ms = 8000, what = 'condition') => {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what)
    await new Promise((r) => setTimeout(r, 150))
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- test site
const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title><style>input,button{display:block;margin:8px;font-size:16px;width:260px;height:30px}</style>${body}`
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  if (url.pathname === '/login')
    return res.end(page('Login', '<form action="/welcome" method="post"><input id="u" name="email" autocomplete="username"><input id="p" type="password" name="pw" autocomplete="current-password"><button id="go">Sign in</button></form>'))
  // Signs in without navigating: the form is removed.
  if (url.pathname === '/spa')
    return res.end(page('SPA', '<div id="box"><input id="u" type="email" placeholder="Email"><input id="p" type="password"><button id="go" type="button">Log in</button></div><script>go.onclick=()=>setTimeout(()=>{box.remove();document.body.append("Welcome")},200)</script>'))
  // Wrong password: the form stays.
  if (url.pathname === '/stay')
    return res.end(page('Stay', '<div><input id="u" autocomplete="username"><input id="p" type="password"><button id="go" type="button">Log in</button><p id="err"></p></div><script>go.onclick=()=>err.textContent="Wrong password"</script>'))
  if (url.pathname === '/signup')
    return res.end(page('Sign up', '<form action="/welcome" method="post"><input id="u" type="email" name="email" autocomplete="username"><input id="p" type="password" name="pw" autocomplete="new-password"><input id="p2" type="password" name="pw2" autocomplete="new-password"><button id="go">Create account</button></form>'))
  if (url.pathname === '/step1') return res.end(page('Step 1', '<form action="/step2" method="post"><input id="u" type="email" name="identifier" placeholder="Email"><button id="go">Next</button></form>'))
  if (url.pathname === '/step2') return res.end(page('Step 2', '<form action="/welcome" method="post"><input id="p" type="password" name="pw"><button id="go">Sign in</button></form>'))
  res.end(page('Welcome', '<h1>Signed in</h1>'))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const base = `http://127.0.0.1:${port}`
const other = `http://localhost:${port}` // same server, different origin

const profile = mkdtempSync(join(tmpdir(), 'specter-pw-e2e-'))
const USER = 'tester@example.test'
const PW1 = 'Test-pw-' + Math.random().toString(36).slice(2, 10)
const PW2 = PW1 + '-changed'

const app = await electron.launch({ args: [resolve('.')], env: { ...process.env, SPECTER_USER_DATA: profile }, timeout: 60000 })
const win = await app.firstWindow()
await win.waitForSelector('.app', { timeout: 30000 })
await win.evaluate(() => window.specter.invoke('settings:set', 'general.onboarded', true))

const invoke = (ch, ...args) => win.evaluate(([c, a]) => window.specter.invoke(c, ...a), [ch, args])
const activeTab = () =>
  win.evaluate(() => {
    const s = window.__specterDebug.browser()
    const ws = s.open[s.activeWsId]
    return ws.tabs.find((t) => t.id === ws.activeTabId)
  })
/** The page open in the active tab (tracked by URL, updated by open()). */
const GUEST = `webContents.getAllWebContents().filter((w) => w.getType() === 'webview' && !w.isDestroyed() && w.getURL() === globalThis.__pwUrl).pop()`
/** Runs a script in the active tab's page (main world, like the site's own scripts). */
const inPage = (code) => app.evaluate(({ webContents }, [g, c]) => new Function('webContents', 'c', `const wc = ${g}; return wc ? wc.executeJavaScript(c) : undefined`)(webContents, c), [GUEST, code])
const setPage = (u) => app.evaluate((_, x) => (globalThis.__pwUrl = x), u)

/** Loads a URL in the active tab through the address bar. */
async function open(url) {
  await win.click('.omnibox-row', { position: { x: 200, y: 15 } })
  await win.keyboard.press('Control+a')
  await win.keyboard.type(url, { delay: 2 })
  await win.keyboard.press('Enter')
  await until(async () => (await activeTab())?.url === url, 8000, 'navigation to ' + url)
  await setPage(url)
  await until(() => inPage('document.readyState === "complete"'), 8000, 'page load')
  await sleep(250)
}
// Real (trusted) input, the way a person produces it.
const wcCall = (fn, arg) => app.evaluate(({ webContents }, [src, a]) => new Function('webContents', 'a', src)(webContents, a), [fn, arg])
const click = async (x, y) =>
  wcCall(
    `const wc = ${GUEST};
     wc.focus();
     wc.sendInputEvent({ type: 'mouseDown', x: a[0], y: a[1], button: 'left', clickCount: 1 });
     wc.sendInputEvent({ type: 'mouseUp', x: a[0], y: a[1], button: 'left', clickCount: 1 });`,
    [Math.round(x), Math.round(y)]
  )
const center = (sel) => inPage(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`)
const clickEl = async (sel) => {
  const [x, y] = await center(sel)
  await click(x, y)
}
const type = (text) => wcCall(`return ${GUEST}.insertText(a)`, text)
const value = (sel) => inPage(`document.querySelector(${JSON.stringify(sel)})?.value`)

async function typeInto(sel, text) {
  await clickEl(sel)
  await sleep(120)
  await inPage(`document.querySelector(${JSON.stringify(sel)}).select()`)
  await type(text)
}
const offer = async () => (await activeTab())?.passwordOffer
/** E2E_SHOTS=<dir> saves window captures (web page included) at key moments. */
const shot = async (name) => {
  if (!process.env.E2E_SHOTS) return
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'))
  writeFileSync(join(process.env.E2E_SHOTS, `passwords-${name}.png`), Buffer.from(png, 'base64'))
}

console.log('SPECTER passwords E2E — profile', profile)

await step('Open the sign-in page', async () => {
  await open(`${base}/login`)
})

await step('Nothing is offered before signing in, and no suggestions exist yet', async () => {
  await clickEl('#u')
  await sleep(500)
  assert.equal(await inPage('!!document.querySelector("specter-password-menu")'), false, 'no suggestion menu without saved logins')
  assert.equal(await offer(), undefined)
})

await step('Signing in offers to save the password', async () => {
  await typeInto('#u', USER)
  await typeInto('#p', PW1)
  await clickEl('#go')
  const o = await until(offer, 8000, 'save prompt')
  assert.equal(o.username, USER)
  assert.equal(o.update, false)
  await win.waitForSelector('.infobar[aria-label="Save password"]', { timeout: 3000 })
  await shot('save-prompt')
  return `prompt for ${o.origin}`
})

await step('Save stores it encrypted', async () => {
  await win.click('.infobar[aria-label="Save password"] button.primary')
  const list = await until(async () => {
    const l = await invoke('passwords:list')
    return l.length === 1 && l
  }, 5000, 'saved login')
  assert.equal(list[0].username, USER)
  assert.equal(list[0].origin, base)
  assert.equal(await invoke('passwords:reveal', list[0].id), PW1)
  const db = new DatabaseSync(join(profile, 'specter.db'), { readOnly: true })
  const blob = Buffer.from(db.prepare('SELECT password FROM logins').get().password)
  db.close()
  assert.ok(!blob.includes(Buffer.from(PW1)), 'password is not stored in plain text')
  return `${blob.length}-byte encrypted blob`
})

await step('Sign-in fields list the saved login; the page cannot read it', async () => {
  await open(`${base}/login`)
  await clickEl('#u')
  await until(() => inPage('!!document.querySelector("specter-password-menu")'), 5000, 'suggestion menu')
  assert.equal(await inPage('document.querySelector("specter-password-menu").shadowRoot'), null, 'closed shadow root')
  assert.equal(await value('#p'), '', 'nothing filled before picking')
  await shot('suggestions')
})

await step('Picking the suggestion fills username and password', async () => {
  const [x, y] = await inPage('(() => { const r = document.querySelector("specter-password-menu").getBoundingClientRect(); return [r.left + 40, r.top + 20] })()')
  await click(x, y)
  await until(async () => (await value('#p')) === PW1, 4000, 'filled password')
  assert.equal(await value('#u'), USER)
  assert.equal(await inPage('!!document.querySelector("specter-password-menu")'), false, 'menu closed')
})

await step('Signing in with the saved password asks nothing', async () => {
  await clickEl('#go')
  await until(async () => (await activeTab())?.title === 'Welcome', 5000, 'welcome page')
  await sleep(800)
  assert.equal(await offer(), undefined)
})

await step('A changed password offers an update', async () => {
  await open(`${base}/login`)
  await typeInto('#u', USER)
  await typeInto('#p', PW2)
  await clickEl('#go')
  const o = await until(offer, 8000, 'update prompt')
  assert.equal(o.update, true)
  await win.click('.infobar[aria-label="Update password"] button.primary')
  const [l] = await invoke('passwords:list')
  await until(async () => (await invoke('passwords:reveal', l.id)) === PW2, 3000, 'updated password')
})

await step('A failed sign-in (form stays) is not offered', async () => {
  await open(`${base}/stay`)
  await typeInto('#u', 'wrong@example.test')
  await typeInto('#p', 'not-the-password')
  await clickEl('#go')
  await sleep(5000)
  assert.equal(await offer(), undefined)
})

await step('A single-page sign-in (form removed, no navigation) is offered', async () => {
  await open(`${base}/spa`)
  await typeInto('#u', 'spa@example.test')
  await typeInto('#p', 'spa-pass-123')
  await clickEl('#go')
  const o = await until(offer, 6000, 'SPA prompt')
  assert.equal(o.username, 'spa@example.test')
  await win.click('.infobar[aria-label="Save password"] button[aria-label="Not now"]')
  await until(async () => !(await offer()), 3000, 'prompt dismissed')
})

await step('A two-step sign-in keeps the username from the first step', async () => {
  await open(`${base}/step1`)
  await typeInto('#u', 'two@example.test')
  await clickEl('#go')
  await until(async () => (await activeTab())?.title === 'Step 2', 5000, 'step 2')
  await setPage(`${base}/step2`)
  await typeInto('#p', 'two-step-pass')
  await clickEl('#go')
  const o = await until(offer, 8000, 'two-step prompt')
  assert.equal(o.username, 'two@example.test')
  await win.click('.infobar[aria-label="Save password"] button.primary')
  await until(async () => (await invoke('passwords:list')).length === 2, 3000, 'second login')
})

await step('"Never for this site" stops the prompts', async () => {
  await open(`${other}/login`)
  await typeInto('#u', 'x@example.test')
  await typeInto('#p', 'whatever-1')
  await clickEl('#go')
  await until(offer, 8000, 'prompt on localhost')
  await win.click('.infobar button:has-text("Never for this site")')
  const never = await invoke('passwords:neverList')
  assert.deepEqual(never.map((n) => n.origin), [other])
  await open(`${other}/login`)
  await typeInto('#u', 'x@example.test')
  await typeInto('#p', 'whatever-2')
  await clickEl('#go')
  await sleep(1500)
  assert.equal(await offer(), undefined)
})

await step('Logins stay on their own site', async () => {
  // localhost:port is a different origin from 127.0.0.1:port.
  await open(`${other}/login`)
  await clickEl('#u')
  await sleep(800)
  assert.equal(await inPage('!!document.querySelector("specter-password-menu")'), false, 'no menu on another origin')
  assert.deepEqual(await invoke('passwords:forUrl', `${other}/login`), [])
})

await step('Sign-up forms suggest a strong password and it is saved without asking', async () => {
  await open(`${base}/signup`)
  await typeInto('#u', 'new@example.test')
  await clickEl('#p')
  await until(() => inPage('!!document.querySelector("specter-password-menu")'), 5000, 'password suggestion')
  await shot('generator')
  const [x, y] = await inPage('(() => { const r = document.querySelector("specter-password-menu").getBoundingClientRect(); return [r.left + 40, r.top + 20] })()')
  await click(x, y)
  const pw = await until(async () => {
    const v = await value('#p')
    return v && v.length === 15 && v
  }, 4000, 'generated password filled')
  assert.equal(await value('#p2'), pw, 'confirmation filled too')
  assert.match(pw, /[a-z]/)
  assert.match(pw, /[A-Z]/)
  assert.match(pw, /[0-9]/)
  await clickEl('#go')
  const o = await until(offer, 6000, 'saved confirmation')
  assert.equal(o.saved, true)
  await win.waitForSelector('.infobar[aria-label="Password saved"]', { timeout: 3000 })
  const saved = (await invoke('passwords:list')).find((l) => l.username === 'new@example.test')
  assert.ok(saved, 'saved')
  assert.equal(await invoke('passwords:reveal', saved.id), pw)
  await win.click('.infobar[aria-label="Password saved"] button[aria-label="Close"]')
  return 'suggested password saved'
})

await step('Copying a password puts it on the clipboard', async () => {
  const l = (await invoke('passwords:list')).find((x) => x.username === USER)
  await invoke('passwords:copy', l.id)
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), PW2)
  await app.evaluate(({ clipboard }) => clipboard.clear())
})

await step('The address-bar key fills the login', async () => {
  await open(`${base}/login`)
  await win.waitForSelector('button[aria-label="Saved logins for this site"]', { timeout: 4000 })
  await win.click('button[aria-label="Saved logins for this site"]')
  await win.click(`.menu-item:has-text("${USER}")`)
  await until(async () => (await value('#p')) === PW2, 4000, 'filled from the toolbar')
})

const csv = join(profile, 'Chrome Passwords.csv')
await step('Importing a Chrome export', async () => {
  writeFileSync(
    csv,
    'name,url,username,password,note\r\n' +
      'example.test,https://example.test/login,alice,alice-pw,\r\n' +
      `127.0.0.1,${base}/login,${USER},${PW2},\r\n` + // already saved
      'app,android://abc@com.example/,bob,x,\r\n' // skipped
  )
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })
  }, csv)
  const r = await invoke('passwords:importCsv')
  assert.deepEqual({ added: r.added, updated: r.updated, unchanged: r.unchanged, skipped: r.skipped }, { added: 1, updated: 0, unchanged: 1, skipped: 1 })
  assert.equal(await invoke('passwords:trashImported', 'C:\\Windows\\win.ini'), false, 'only the imported file may be trashed')
  return `${r.added} added, ${r.unchanged} already saved, ${r.skipped} skipped`
})

await step('Exporting writes a CSV any browser can import', async () => {
  const out = join(profile, 'export.csv')
  await app.evaluate(({ dialog }, f) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: f })
  }, out)
  assert.equal(await invoke('passwords:exportCsv'), out)
  const text = readFileSync(out, 'utf8')
  assert.ok(text.startsWith('name,url,username,password,note'))
  assert.ok(text.includes('alice-pw') && text.includes(PW2))
})

await step('Passwords page lists everything', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('evt:command:run', { id: 'browser.openUrl', args: { url: 'specter://passwords' } }))
  await win.waitForSelector('.pw-row', { timeout: 5000 })
  const rows = await win.locator('.pw-row').count()
  assert.equal(rows, 4)
  await win.locator('.pw-row', { hasText: 'alice' }).locator('button[aria-label="Show password"]').click()
  await win.waitForSelector('.pw-pass:has-text("alice-pw")', { timeout: 3000 })
  await shot('manager')
  return `${rows} logins`
})

await app.close()
server.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
