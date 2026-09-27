// Browser-profile import end-to-end test: a fake Chrome "User Data" folder with
// two profiles is imported through Settings → Profiles — one into the open
// profile, one into a new SPECTER profile — then imported again (no
// duplicates), a password export goes into the new profile, and deleting that
// profile removes its data. Uses a throwaway profile and LOCALAPPDATA.
// Run after `npm run build`: node tests/e2e/profiles.mjs
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
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

// ---------------------------------------------------------------- fake Chrome
const localAppData = mkdtempSync(join(tmpdir(), 'specter-fake-lad-'))
const userData = join(localAppData, 'Google', 'Chrome', 'User Data')
const now = Date.now()
const webkit = (ms) => BigInt(ms + 11644473600000) * 1000n // microseconds since 1601
function chromeProfile(dir, bar, other, visits) {
  const p = join(userData, dir)
  mkdirSync(p, { recursive: true })
  const node = (b) => (b.children ? { type: 'folder', name: b.name, children: b.children.map(node) } : { type: 'url', name: b.name, url: b.url })
  writeFileSync(join(p, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: bar.map(node) }, other: { type: 'folder', name: 'Other', children: other.map(node) }, synced: { type: 'folder', children: [] } } }))
  const db = new DatabaseSync(join(p, 'History'))
  db.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_time INTEGER, hidden INTEGER DEFAULT 0)')
  const ins = db.prepare('INSERT INTO urls(url, title, visit_count, last_visit_time, hidden) VALUES(?,?,1,?,0)')
  visits.forEach(([url, title], i) => ins.run(url, title, webkit(now - i * 60_000)))
  db.close()
}
chromeProfile('Default', [{ name: 'Mail', url: 'https://mail.example.test/' }, { name: 'Dev', children: [{ name: 'Docs', url: 'https://docs.example.test/' }] }], [{ name: 'Recipes', url: 'https://recipes.example.test/' }], [
  ['https://mail.example.test/', 'Mail'],
  ['https://news.example.test/', 'News']
])
// Chrome's Web Data: one saved address (current layout) next to a card table that must not be read.
{
  const w = new DatabaseSync(join(userData, 'Default', 'Web Data'))
  w.exec(`CREATE TABLE addresses (guid VARCHAR PRIMARY KEY, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0, date_modified INTEGER NOT NULL DEFAULT 0, language_code VARCHAR, label VARCHAR, initial_creator_id INTEGER DEFAULT 0, record_type INTEGER);
    CREATE TABLE address_type_tokens (guid VARCHAR, type INTEGER, value VARCHAR, verification_status INTEGER DEFAULT 0, observations BLOB, PRIMARY KEY (guid, type));
    CREATE TABLE credit_cards (guid VARCHAR PRIMARY KEY, name_on_card VARCHAR, card_number_encrypted BLOB);
    INSERT INTO addresses(guid, record_type) VALUES('g1', 0);
    INSERT INTO credit_cards VALUES('c1', 'Should Not Import', x'00');`)
  const t = w.prepare('INSERT INTO address_type_tokens(guid, type, value) VALUES(?,?,?)')
  for (const [type, value] of [[7, 'Anna Smith'], [77, '1 Main St\nApt 4'], [33, 'Springfield'], [34, 'IL'], [35, '62701'], [36, 'US'], [9, 'anna@example.test'], [14, '+15550100']]) t.run('g1', type, value)
  w.close()
}
chromeProfile('Profile 1', [{ name: 'Jira', url: 'https://jira.work.test/' }], [], [['https://jira.work.test/browse/X-1', 'X-1'], ['https://wiki.work.test/', 'Wiki'], ['https://ci.work.test/', 'CI']])
writeFileSync(
  join(userData, 'Local State'),
  JSON.stringify({ profile: { info_cache: { Default: { name: 'Your Chrome', user_name: '' }, 'Profile 1': { name: 'Work', user_name: 'me@work.test', profile_highlight_color: -12627531 } } } })
)

const profile = mkdtempSync(join(tmpdir(), 'specter-profiles-e2e-'))
const app = await electron.launch({ args: [resolve('.')], env: { ...process.env, SPECTER_USER_DATA: profile, LOCALAPPDATA: localAppData }, timeout: 60000 })
const win = await app.firstWindow()
await win.waitForSelector('.app', { timeout: 30000 })
await win.waitForTimeout(1500) // the launch splash
await win.evaluate(() => window.specter.invoke('settings:set', 'general.onboarded', true))
const invoke = (ch, ...args) => win.evaluate(([c, a]) => window.specter.invoke(c, ...a), [ch, args])
const db = () => new DatabaseSync(join(profile, 'specter.db'), { readOnly: true })
const q = (sql, ...params) => {
  const d = db()
  try {
    return d.prepare(sql).all(...params)
  } finally {
    d.close()
  }
}

/** E2E_SHOTS=<dir> saves window captures at key moments. */
const shot = async (name) => {
  if (!process.env.E2E_SHOTS) return
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'))
  writeFileSync(join(process.env.E2E_SHOTS, `profiles-${name}.png`), Buffer.from(png, 'base64'))
}

console.log('SPECTER profile import E2E — profile', profile)
let workId = ''

await step('Chrome profiles are found with their names, accounts and colours', async () => {
  const chrome = (await invoke('import:sources')).find((s) => s.id === 'chrome')
  assert.ok(chrome, 'Chrome detected')
  assert.deepEqual(
    chrome.profiles.map((p) => [p.dir, p.label, p.account, p.color]),
    [
      ['Default', 'Your Chrome', undefined, undefined],
      ['Profile 1', 'Work', 'me@work.test', '#3f51b5']
    ]
  )
})

await step('Settings → Profiles suggests: first into this profile, the other as a new one', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('evt:command:run', { id: 'browser.openUrl', args: { url: 'specter://settings/profiles' } }))
  await win.waitForSelector('.pi-row', { timeout: 8000 })
  await win.locator('.pi-list').scrollIntoViewIfNeeded()
  await shot('before')
  const choices = await win.$$eval('.pi-row select', (s) => s.map((x) => x.value))
  assert.deepEqual(choices, ['current', 'new'])
})

await step('Importing fills this profile and creates "Work"', async () => {
  await win.click('button:has-text("Import 2 profiles")')
  await win.waitForSelector('.pi-result >> nth=1', { timeout: 10000 })
  await shot('after')
  const profiles = await invoke('profiles:list')
  const work = profiles.find((p) => p.name === 'Work')
  assert.ok(work, 'Work profile created')
  assert.equal(work.color, '#3f51b5')
  workId = work.id
  // Chrome's bookmarks bar became each profile's bookmarks bar (no "Imported from" folder in an empty profile).
  const bar = q("SELECT title FROM bookmarks WHERE parent_id = 'bar_default' ORDER BY sort").map((r) => r.title)
  assert.deepEqual(bar, ['Mail', 'Dev'])
  assert.deepEqual(q("SELECT title FROM bookmarks WHERE parent_id = 'other_default'").map((r) => r.title), ['Recipes'])
  assert.deepEqual(q('SELECT title FROM bookmarks WHERE parent_id = ?', 'bar_' + workId).map((r) => r.title), ['Jira'])
  assert.equal(q("SELECT COUNT(*) n FROM history WHERE profile_id = 'default'")[0].n, 2)
  assert.equal(q('SELECT COUNT(*) n FROM history WHERE profile_id = ?', workId)[0].n, 3)
  const ad = q("SELECT name, street, city, state, postal_code, country, email, phone FROM addresses WHERE profile_id = 'default'")
  assert.deepEqual(ad.map((r) => ({ ...r })), [{ name: 'Anna Smith', street: '1 Main St\nApt 4', city: 'Springfield', state: 'IL', postal_code: '62701', country: 'US', email: 'anna@example.test', phone: '+15550100' }])
  assert.equal(q("SELECT COUNT(*) n FROM addresses WHERE name LIKE '%Should Not%'")[0].n, 0)
  return `Personal: 3 bookmarks, 2 visits, 1 address · Work: 1 bookmark, 3 visits`
})

await step('Importing again adds nothing and reuses "Work"', async () => {
  const chrome = (await invoke('import:sources')).find((s) => s.id === 'chrome')
  assert.equal(chrome.profiles[1].importedInto, workId, 'remembered')
  const a = await invoke('import:toProfile', 'chrome', chrome.profiles[0].path, { bookmarks: true, history: true, addresses: true }, 'current')
  assert.equal(a.addresses, 0, 'address not duplicated')
  const b = await invoke('import:toProfile', 'chrome', chrome.profiles[1].path, { bookmarks: true, history: true }, 'new')
  assert.deepEqual([a.bookmarks, a.history, b.bookmarks, b.history, b.profileId, b.created], [0, 0, 0, 0, workId, false])
  assert.equal((await invoke('profiles:list')).length, 2)
  assert.equal(q("SELECT COUNT(*) n FROM bookmarks WHERE title LIKE 'Imported from%'")[0].n, 0, 'no empty import folders')
})

await step('A profile with bookmarks gets an "Imported from" folder instead', async () => {
  const other = await invoke('profiles:create', 'Scratch', '#ffffff')
  await invoke('import:toProfile', 'chrome', (await invoke('import:sources'))[0].profiles[1].path, { bookmarks: true, history: false }, { profileId: other.id })
  // Scratch was empty, so the first import went to its bar; a second browser profile goes into a folder.
  await invoke('import:toProfile', 'chrome', (await invoke('import:sources'))[0].profiles[0].path, { bookmarks: true, history: false }, { profileId: other.id })
  const folder = q("SELECT id FROM bookmarks WHERE profile_id = ? AND title = 'Imported from Google Chrome'", other.id)
  assert.equal(folder.length, 1)
  assert.deepEqual(q('SELECT title FROM bookmarks WHERE parent_id = ? ORDER BY sort', folder[0].id).map((r) => r.title), ['Mail', 'Dev', 'Recipes'])
  await invoke('profiles:delete', other.id)
})

await step("A Chrome profile's password export goes into its SPECTER profile", async () => {
  const csv = join(profile, 'Work Passwords.csv')
  writeFileSync(csv, 'name,url,username,password,note\r\njira,https://jira.work.test/login,me@work.test,work-pass-1,\r\n')
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })
  }, csv)
  const r = await invoke('passwords:importCsv', workId)
  assert.equal(r.added, 1)
  assert.deepEqual(q('SELECT profile_id FROM logins').map((x) => x.profile_id), [workId])
  assert.deepEqual(await invoke('passwords:list'), [], 'not in the open profile')
})

await step('Deleting the profile deletes its bookmarks, history and passwords', async () => {
  await invoke('profiles:delete', workId)
  for (const t of ['bookmarks', 'history', 'logins']) assert.equal(q(`SELECT COUNT(*) n FROM ${t} WHERE profile_id = ?`, workId)[0].n, 0, t)
})

await app.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
