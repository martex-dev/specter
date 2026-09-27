// Address autofill end-to-end test: saving an address after a checkout form,
// filling it into a form that only has labels, <select> fields, no duplicate
// prompts, staying out of sign-in forms, the Addresses page and the switch.
// Local pages, throwaway profile. Run after `npm run build`: node tests/e2e/addresses.mjs
import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
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

const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title><style>input,select,button{display:block;margin:6px;font-size:15px;width:280px;height:28px}</style>${body}`
const STATES = '<option value="">State</option><option value="CA">California</option><option value="IL">Illinois</option><option value="NY">New York</option>'
const COUNTRIES = '<option value="">Country</option><option value="BG">Bulgaria</option><option value="GB">United Kingdom</option><option value="US">United States</option>'
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  if (url.pathname === '/checkout')
    return res.end(
      page(
        'Checkout',
        `<form action="/done" method="post">
          <input id="name" autocomplete="name"><input id="l1" autocomplete="address-line1"><input id="l2" autocomplete="address-line2">
          <input id="city" autocomplete="address-level2"><select id="state" autocomplete="address-level1">${STATES}</select>
          <input id="zip" autocomplete="postal-code"><select id="country" autocomplete="country">${COUNTRIES}</select>
          <input id="email" type="email" autocomplete="email"><input id="tel" type="tel" autocomplete="tel"><button id="go">Place order</button></form>`
      )
    )
  // No autocomplete attributes: only labels and names.
  if (url.pathname === '/shipping')
    return res.end(
      page(
        'Shipping',
        `<form action="/done" method="post">
          <label>First name <input id="fn" name="first"></label><label>Last name <input id="ln" name="last"></label>
          <label>Street <input id="st" name="addr"></label><label>Town / City <input id="ct" name="town"></label>
          <label>ZIP <input id="zp" name="zipcode"></label><label>Country <select id="co" name="ctry">${COUNTRIES}</select></label><button id="go">Continue</button></form>`
      )
    )
  if (url.pathname === '/login') return res.end(page('Login', '<form action="/done" method="post"><input id="email" type="email" autocomplete="username"><input id="pw" type="password"><button id="go">Sign in</button></form>'))
  res.end(page('Done', '<h1>Thanks</h1>'))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const profile = mkdtempSync(join(tmpdir(), 'specter-ad-e2e-'))
const app = await electron.launch({ args: [resolve('.')], env: { ...process.env, SPECTER_USER_DATA: profile }, timeout: 60000 })
const win = await app.firstWindow()
await win.waitForSelector('.app', { timeout: 30000 })
await win.waitForTimeout(1500)
await win.evaluate(() => window.specter.invoke('settings:set', 'general.onboarded', true))

const invoke = (ch, ...args) => win.evaluate(([c, a]) => window.specter.invoke(c, ...a), [ch, args])
const activeTab = () =>
  win.evaluate(() => {
    const s = window.__specterDebug.browser()
    const ws = s.open[s.activeWsId]
    return ws.tabs.find((t) => t.id === ws.activeTabId)
  })
const GUEST = `webContents.getAllWebContents().filter((w) => w.getType() === 'webview' && !w.isDestroyed() && w.getURL() === globalThis.__adUrl).pop()`
const inPage = (code) => app.evaluate(({ webContents }, [g, c]) => new Function('webContents', 'c', `const wc = ${g}; return wc ? wc.executeJavaScript(c) : undefined`)(webContents, c), [GUEST, code])
async function open(url) {
  await win.click('.omnibox-row', { position: { x: 200, y: 15 } })
  await win.keyboard.press('Control+a')
  await win.keyboard.type(url, { delay: 2 })
  await win.keyboard.press('Enter')
  await until(async () => (await activeTab())?.url === url, 8000, 'navigation to ' + url)
  await app.evaluate((_, u) => (globalThis.__adUrl = u), url)
  await until(() => inPage('document.readyState === "complete"'), 8000, 'page load')
  await sleep(250)
}
const wcCall = (fn, arg) => app.evaluate(({ webContents }, [src, a]) => new Function('webContents', 'a', src)(webContents, a), [fn, arg])
const click = (x, y) =>
  wcCall(
    `const wc = ${GUEST}; wc.focus();
     wc.sendInputEvent({ type: 'mouseDown', x: a[0], y: a[1], button: 'left', clickCount: 1 });
     wc.sendInputEvent({ type: 'mouseUp', x: a[0], y: a[1], button: 'left', clickCount: 1 });`,
    [Math.round(x), Math.round(y)]
  )
const clickEl = async (sel) => {
  const [x, y] = await inPage(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`)
  await click(x, y)
}
const typeInto = async (sel, text) => {
  await clickEl(sel)
  await sleep(100)
  await wcCall(`return ${GUEST}.insertText(a)`, text)
}
const value = (sel) => inPage(`document.querySelector(${JSON.stringify(sel)})?.value`)
const menuShown = () => inPage('!!document.querySelector("specter-autofill-menu")')
const pickFirst = async () => {
  const [x, y] = await inPage('(() => { const r = document.querySelector("specter-autofill-menu").getBoundingClientRect(); return [r.left + 40, r.top + 20] })()')
  await click(x, y)
}
const shot = async (name) => {
  if (!process.env.E2E_SHOTS) return
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'))
  writeFileSync(join(process.env.E2E_SHOTS, `addresses-${name}.png`), Buffer.from(png, 'base64'))
}

console.log('SPECTER addresses E2E — profile', profile)

await step('No suggestions before anything is saved', async () => {
  await open(`${base}/checkout`)
  await clickEl('#name')
  await sleep(600)
  assert.equal(await menuShown(), false)
})

await step('Sending a checkout form offers to save the address', async () => {
  await typeInto('#name', 'Anna Smith')
  await typeInto('#l1', '1 Main St')
  await typeInto('#l2', 'Apt 4')
  await typeInto('#city', 'Springfield')
  await inPage(`document.querySelector('#state').value = 'IL'; document.querySelector('#country').value = 'US'`)
  await typeInto('#zip', '62701')
  await typeInto('#email', 'anna@example.test')
  await typeInto('#tel', '+1 555 0100')
  await clickEl('#go')
  const o = await until(async () => (await activeTab())?.addressOffer, 6000, 'address prompt')
  assert.match(o.summary, /Anna Smith, 1 Main St, Springfield/)
  await shot('prompt')
  await win.click('.infobar[aria-label="Save address"] button.primary')
  const [a] = await until(async () => {
    const l = await invoke('addresses:list')
    return l.length === 1 && l
  }, 4000, 'saved address')
  assert.deepEqual(
    { name: a.name, street: a.street, city: a.city, state: a.state, postalCode: a.postalCode, country: a.country, email: a.email, phone: a.phone },
    { name: 'Anna Smith', street: '1 Main St\nApt 4', city: 'Springfield', state: 'Illinois', postalCode: '62701', country: 'United States', email: 'anna@example.test', phone: '+1 555 0100' }
  )
})

await step('A form with only labels is filled from the saved address', async () => {
  await open(`${base}/shipping`)
  await clickEl('#fn')
  await until(menuShown, 5000, 'address suggestions')
  assert.equal(await inPage('document.querySelector("specter-autofill-menu").shadowRoot'), null, 'closed shadow root')
  assert.equal(await value('#st'), '', 'nothing filled before picking')
  await shot('suggestions')
  await pickFirst()
  await until(async () => (await value('#ln')) === 'Smith', 4000, 'filled')
  assert.deepEqual(await inPage('["#fn","#ln","#st","#ct","#zp","#co"].map((s) => document.querySelector(s).value)'), ['Anna', 'Smith', '1 Main St, Apt 4', 'Springfield', '62701', 'US'])
})

await step('Selects get the matching option', async () => {
  await open(`${base}/checkout`)
  await clickEl('#zip')
  await until(menuShown, 5000, 'suggestions')
  await pickFirst()
  await until(async () => (await value('#state')) === 'IL', 4000, 'state selected')
  assert.equal(await value('#country'), 'US')
  assert.equal(await value('#name'), 'Anna Smith')
})

await step('Sending the same address again asks nothing', async () => {
  await clickEl('#go')
  await until(async () => (await activeTab())?.title === 'Done', 5000, 'done page')
  await sleep(800)
  assert.equal((await activeTab()).addressOffer, undefined)
  assert.equal((await invoke('addresses:list')).length, 1)
})

await step('Sign-in forms are left to the password manager', async () => {
  await open(`${base}/login`)
  await clickEl('#email')
  await sleep(700)
  assert.equal(await menuShown(), false)
})

await step('Addresses page lists it', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('evt:command:run', { id: 'browser.openUrl', args: { url: 'specter://addresses' } }))
  await win.waitForSelector('.ad-row:has-text("Anna Smith")', { timeout: 5000 })
  await shot('page')
})

await step('Turning suggestions off stops them', async () => {
  await invoke('settings:set', 'autofill.addresses', false)
  await win.keyboard.press('Control+w')
  await open(`${base}/shipping`)
  await clickEl('#fn')
  await sleep(700)
  assert.equal(await menuShown(), false)
})

await app.close()
server.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
