// Password manager. Passwords are encrypted with Electron's safeStorage (DPAPI
// on Windows: only this Windows account can decrypt them) and stored per
// profile in the SQLite database; nothing is kept without that encryption.
//
// Pages talk to the manager through the passwords preload (isolated world, see
// src/preload/passwords.ts). Every guest request is scoped to the origin
// Chromium reports for the sending frame, never to anything the page says, so
// a site can only ever receive the logins saved for that site.
import { app, clipboard, dialog, ipcMain, safeStorage, session as electronSession, shell, webContents, type IpcMainEvent, type IpcMainInvokeEvent, type Session, type WebContents } from 'electron'
import { spawn } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  generatePassword,
  loginOrigin,
  loginsFromCsv,
  loginsToCsv,
  matchOrigin,
  type LoginInput,
  type LoginSuggestion,
  type PasswordImportResult,
  type PasswordStatus,
  type SavedLogin
} from '@shared/passwords'
import { hostname } from '@shared/url'
import { all, get, registerMigrations, run, tx, uid } from '../db'
import { broadcast, handle, sendTo, windowOf } from '../ipc'
import { createLogger } from '../logger'
import { owningGuestOf } from '../guest'
import { activeProfileId, getProfile } from './profiles'
import { getSetting } from './settings'

const log = createLogger('passwords')

registerMigrations('passwords', [
  `CREATE TABLE logins (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    origin TEXT NOT NULL,
    url TEXT NOT NULL,
    username TEXT NOT NULL DEFAULT '',
    password BLOB NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_used_at INTEGER,
    times_used INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX idx_logins_key ON logins(profile_id, origin, username);
  CREATE TABLE login_never (profile_id TEXT NOT NULL, origin TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (profile_id, origin));`
])

type Row = {
  id: string
  origin: string
  url: string
  username: string
  password: Uint8Array
  note: string
  created_at: number
  updated_at: number
  last_used_at: number | null
  times_used: number
}

const toLogin = (r: Row): SavedLogin => ({
  id: r.id,
  origin: r.origin,
  url: r.url,
  username: r.username,
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastUsedAt: r.last_used_at ?? undefined,
  timesUsed: r.times_used
})

// ---------------------------------------------------------------- storage

function available(): boolean {
  try {
    return app.isReady() && safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function encrypt(password: string): Buffer {
  if (!available()) throw new Error('Windows data protection is unavailable, so SPECTER can’t store passwords securely on this system.')
  return safeStorage.encryptString(password)
}

function decrypt(blob: Uint8Array): string {
  return safeStorage.decryptString(Buffer.from(blob))
}

const COLS = 'id, origin, url, username, password, note, created_at, updated_at, last_used_at, times_used'

function rowById(id: string, profileId = activeProfileId()): Row | undefined {
  return get<Row>(`SELECT ${COLS} FROM logins WHERE id = ? AND profile_id = ?`, id, profileId)
}

function rowByKey(origin: string, username: string, profileId = activeProfileId()): Row | undefined {
  return get<Row>(`SELECT ${COLS} FROM logins WHERE profile_id = ? AND origin = ? AND username = ?`, profileId, origin, username)
}

function listRows(): Row[] {
  return all<Row>(`SELECT ${COLS} FROM logins WHERE profile_id = ? ORDER BY origin, username`, activeProfileId())
}

const changed = () => broadcast('passwords:changed', undefined)

/** Inserts or replaces the login for (origin, username) in a profile (default: the open one). Returns what happened. */
function upsert(url: string, username: string, password: string, note?: string, profileId = activeProfileId()): { row: Row; result: 'added' | 'updated' | 'unchanged' } {
  const origin = loginOrigin(url)
  if (!origin) throw new Error('Passwords can only be saved for http(s) websites.')
  if (!password) throw new Error('The password is empty.')
  const now = Date.now()
  const cur = rowByKey(origin, username, profileId)
  if (cur) {
    const same = safeDecrypt(cur) === password
    if (same && (note === undefined || note === cur.note)) return { row: cur, result: 'unchanged' }
    run('UPDATE logins SET password = ?, note = ?, updated_at = ? WHERE id = ?', same ? cur.password : encrypt(password), note ?? cur.note, now, cur.id)
    return { row: rowById(cur.id, profileId)!, result: 'updated' }
  }
  const id = uid('pw_')
  run(
    'INSERT INTO logins(id, profile_id, origin, url, username, password, note, created_at, updated_at, times_used) VALUES(?,?,?,?,?,?,?,?,?,0)',
    id,
    profileId,
    origin,
    url,
    username,
    encrypt(password),
    note ?? '',
    now,
    now
  )
  return { row: rowById(id, profileId)!, result: 'added' }
}

/** A row whose blob can't be decrypted (copied from another PC or Windows account) reads as no password. */
function safeDecrypt(r: Row): string | null {
  try {
    return decrypt(r.password)
  } catch {
    return null
  }
}

function suggestionsFor(pageOrigin: string): LoginSuggestion[] {
  const out: (LoginSuggestion & { lastUsed: number })[] = []
  for (const r of listRows()) {
    const m = matchOrigin(r.origin, pageOrigin)
    if (m) out.push({ id: r.id, username: r.username, origin: r.origin, exact: m === 'exact', lastUsed: r.last_used_at ?? 0 })
  }
  // Exact matches first, then the most recently used.
  out.sort((a, b) => Number(b.exact) - Number(a.exact) || b.lastUsed - a.lastUsed || a.username.localeCompare(b.username))
  return out.map(({ lastUsed: _, ...s }) => s)
}

function isNever(origin: string): boolean {
  return !!get('SELECT 1 FROM login_never WHERE profile_id = ? AND origin = ?', activeProfileId(), origin)
}

function markUsed(id: string): void {
  run('UPDATE logins SET last_used_at = ?, times_used = times_used + 1 WHERE id = ?', Date.now(), id)
}

// ---------------------------------------------------------------- save offers

interface Offer {
  offerId: string
  hostId: number
  tabWcId: number
  origin: string
  url: string
  username: string
  password: string
  timer: NodeJS.Timeout
  /** Removes the tab-closed listener. */
  detach: () => void
}

const offers = new Map<string, Offer>()
/** Passwords SPECTER suggested on a page (per page and origin): used ones are saved without asking. */
const generated = new Map<string, { passwords: string[]; at: number }>()
const GENERATED_TTL = 30 * 60_000

/** Username typed on the first step of a username-then-password sign-in (per page and origin). */
const recentUsernames = new Map<string, { username: string; at: number }>()
const OFFER_TTL = 10 * 60_000

function dropOffer(offerId: string, notify: boolean): void {
  const o = offers.get(offerId)
  if (!o) return
  clearTimeout(o.timer)
  o.detach()
  offers.delete(offerId)
  if (notify) sendTo(o.hostId, 'passwords:offerCancelled', { offerId })
}

/** The tab that shows prompts for a sender: the tab itself, or the tab that opened a sign-in pop-up. */
function promptTarget(wc: WebContents): { tabWcId: number; hostId: number } | null {
  const tabId = owningGuestOf(wc.id)
  if (tabId === undefined) return null
  const tab = webContents.fromId(tabId)
  const host = tab?.hostWebContents
  return tab && host && !host.isDestroyed() ? { tabWcId: tab.id, hostId: host.id } : null
}

/** Submitted logins wait here until the sign-in looks successful, so a mistyped password isn't offered. */
const pendingByWc = new Map<number, { show: () => void; cancel: () => void }>()

function onSubmitted(wc: WebContents, frame: { processId: number; routingId: number }, pageOrigin: string, pageUrl: string, username: string, password: string): void {
  if (!getSetting('passwords.offerToSave') || !password || password.length > 4096 || username.length > 1024) return
  if (!available() || isNever(pageOrigin)) return
  if (!username) {
    const recent = recentUsernames.get(wc.id + ' ' + pageOrigin)
    if (recent && Date.now() - recent.at < 5 * 60_000) username = recent.username
  }
  let existing = rowByKey(pageOrigin, username)
  // A password-only form (e.g. a re-login prompt) on a site with exactly one saved login updates that one.
  if (!existing && !username) {
    const only = all<Row>(`SELECT ${COLS} FROM logins WHERE profile_id = ? AND origin = ?`, activeProfileId(), pageOrigin)
    if (only.length === 1) existing = only[0]
  }
  if (existing && safeDecrypt(existing) === password) {
    markUsed(existing.id)
    return
  }
  const target = promptTarget(wc)
  if (!target) return
  // A password SPECTER suggested is saved right away (like Chrome), so it can't be lost
  // if the sign-up then navigates somewhere unexpected; the bar just confirms it.
  const gen = generated.get(wc.id + ' ' + pageOrigin)
  if (gen && Date.now() - gen.at < GENERATED_TTL && gen.passwords.includes(password)) {
    const { result } = upsert(pageUrl, existing?.username ?? username, password)
    changed()
    log.info(`suggested password ${result} for ${hostname(pageOrigin)}`)
    for (const o of offers.values()) if (o.tabWcId === target.tabWcId) dropOffer(o.offerId, true)
    const offerId = uid('pwo_')
    offers.set(offerId, { offerId, ...target, origin: pageOrigin, url: pageUrl, username, password: '', timer: setTimeout(() => dropOffer(offerId, true), 60_000), detach: () => undefined })
    sendTo(target.hostId, 'passwords:offer', { offerId, webContentsId: target.tabWcId, origin: pageOrigin, username: existing?.username ?? username, update: false, saved: true })
    return
  }
  pendingByWc.get(wc.id)?.cancel()

  const isPopup = wc.getType() === 'window'
  const submittedAt = Date.now()
  // Success = the page itself navigates soon after the submit (the form posting, a
  // redirect, pushState in a single-page app). Leaving by other means — typing an
  // address, Back — or much later means the sign-in didn't go through.
  const onNavigate = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
    const ours = details.isMainFrame || (details.frame?.processId === frame.processId && details.frame?.routingId === frame.routingId)
    if (!ours) return
    if (details.initiator && Date.now() - submittedAt < 10_000) show()
    else if (details.isMainFrame && !details.isSameDocument) cancel()
  }
  const onDestroyed = () => (isPopup ? show() : cancel())
  const cleanup = () => {
    clearTimeout(expiry)
    pendingByWc.delete(wc.id)
    if (!wc.isDestroyed()) {
      wc.off('did-start-navigation', onNavigate)
      wc.off('destroyed', onDestroyed)
    }
  }
  const cancel = () => cleanup()
  const show = () => {
    cleanup()
    const tab = webContents.fromId(target.tabWcId)
    if (!tab || tab.isDestroyed()) return
    // One prompt per tab: a newer sign-in replaces the one still showing.
    for (const o of offers.values()) if (o.tabWcId === target.tabWcId) dropOffer(o.offerId, true)
    const offerId = uid('pwo_')
    const offer: Offer = {
      offerId,
      ...target,
      origin: pageOrigin,
      url: pageUrl,
      username: existing?.username ?? username,
      password,
      timer: setTimeout(() => dropOffer(offerId, true), OFFER_TTL),
      detach: () => !tab.isDestroyed() && tab.off('destroyed', onTabGone)
    }
    const onTabGone = () => dropOffer(offerId, false)
    offers.set(offerId, offer)
    tab.once('destroyed', onTabGone)
    sendTo(target.hostId, 'passwords:offer', { offerId, webContentsId: target.tabWcId, origin: pageOrigin, username: offer.username, update: !!existing })
  }
  const expiry = setTimeout(cancel, 60_000)
  wc.on('did-start-navigation', onNavigate)
  wc.once('destroyed', onDestroyed)
  pendingByWc.set(wc.id, { show, cancel })
}

// ---------------------------------------------------------------- guest (page) side

/** Only web pages in tabs, web-app panels and their pop-ups — never SPECTER's own UI. */
function guestFrame(e: IpcMainInvokeEvent | IpcMainEvent): { wc: WebContents; origin: string; url: string; frame: { processId: number; routingId: number } } | null {
  const wc = e.sender
  if (wc.isDestroyed() || wc.session === electronSession.defaultSession) return null
  const t = wc.getType()
  if (t !== 'webview' && t !== 'window') return null
  const frame = e.senderFrame
  if (!frame || frame.isDestroyed()) return null
  const origin = loginOrigin(frame.origin || '')
  if (!origin) return null
  // The sign-in page without its query or fragment (those can carry one-time tokens).
  let url = origin
  try {
    const u = new URL(frame.url)
    url = u.origin + u.pathname
  } catch {
    /* keep the origin */
  }
  return { wc, origin, url, frame: { processId: frame.processId, routingId: frame.routingId } }
}

function registerGuestIpc(): void {
  ipcMain.handle('specter-pw:query', (e) => {
    const g = guestFrame(e)
    if (!g || !getSetting('passwords.autofill') || !available()) return []
    return suggestionsFor(g.origin).map((s) => ({ id: s.id, username: s.username, host: hostname(s.origin) || s.origin, exact: s.exact }))
  })

  ipcMain.handle('specter-pw:fill', (e, id: unknown) => {
    const g = guestFrame(e)
    if (!g || typeof id !== 'string' || !getSetting('passwords.autofill')) return null
    const r = rowById(id)
    if (!r || !matchOrigin(r.origin, g.origin)) return null
    const password = safeDecrypt(r)
    if (password === null) return null
    markUsed(r.id)
    return { username: r.username, password }
  })

  ipcMain.on('specter-pw:submitted', (e, data: unknown) => {
    const g = guestFrame(e)
    if (!g || !data || typeof data !== 'object') return
    const { username, password } = data as { username?: unknown; password?: unknown }
    if (typeof password !== 'string' || (username !== undefined && typeof username !== 'string')) return
    try {
      onSubmitted(g.wc, g.frame, g.origin, g.url, (username ?? '').trim(), password)
    } catch (err) {
      log.warn('could not offer to save a password', err)
    }
  })

  ipcMain.handle('specter-pw:generate', (e, maxLength: unknown) => {
    const g = guestFrame(e)
    if (!g || !available() || !getSetting('passwords.autofill') || !getSetting('passwords.offerToSave')) return null
    const password = generatePassword(randomInt, typeof maxLength === 'number' ? maxLength : undefined)
    const key = g.wc.id + ' ' + g.origin
    const now = Date.now()
    for (const [k, v] of generated) if (now - v.at > GENERATED_TTL) generated.delete(k)
    const cur = generated.get(key)
    generated.set(key, { passwords: [...(cur?.passwords ?? []), password].slice(-5), at: now })
    return password
  })

  ipcMain.on('specter-pw:succeeded', (e) => {
    if (guestFrame(e)) pendingByWc.get(e.sender.id)?.show()
  })

  ipcMain.on('specter-pw:username', (e, username: unknown) => {
    const g = guestFrame(e)
    if (!g || typeof username !== 'string' || !username.trim() || username.length > 1024) return
    const now = Date.now()
    for (const [k, v] of recentUsernames) if (now - v.at > 5 * 60_000) recentUsernames.delete(k)
    recentUsernames.set(g.wc.id + ' ' + g.origin, { username: username.trim(), at: now })
  })

  ipcMain.on('specter-pw:manage', (e) => {
    const g = guestFrame(e)
    const target = g && promptTarget(g.wc)
    if (target) sendTo(target.hostId, 'command:run', { id: 'browser.openUrl', args: { url: 'specter://passwords' } })
  })
}

/** Registers the page-side preload on a profile session (tabs, web-app panels and pop-ups share it). */
const attached = new WeakSet<Session>()
export function attachPasswords(ses: Session): void {
  if (attached.has(ses)) return
  attached.add(ses)
  try {
    ses.registerPreloadScript({ type: 'frame', id: 'specter-passwords', filePath: join(__dirname, '../preload/passwords.js') })
  } catch (err) {
    log.warn('could not register the password preload', err)
  }
}

// ---------------------------------------------------------------- Chrome export helper

function chromePath(): string | null {
  const candidates = [
    join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

// ---------------------------------------------------------------- UI IPC

/** Files imported this session — the only ones "move to Recycle Bin" may touch. */
const importedFiles = new Set<string>()

export function registerPasswordsIpc(): void {
  registerGuestIpc()

  handle('passwords:status', (): PasswordStatus => ({
    available: available(),
    count: get<{ n: number }>('SELECT COUNT(*) AS n FROM logins WHERE profile_id = ?', activeProfileId())?.n ?? 0,
    chromeInstalled: !!chromePath()
  }))

  handle('passwords:list', () => listRows().map(toLogin))

  handle('passwords:reveal', (_e, id) => {
    const r = rowById(id)
    if (!r) throw new Error('This login no longer exists.')
    const pw = safeDecrypt(r)
    if (pw === null) throw new Error('This password was encrypted on another computer or Windows account and can’t be read here.')
    return pw
  })

  let clipTimer: NodeJS.Timeout | undefined
  handle('passwords:copy', async (_e, id) => {
    const r = rowById(id)
    const pw = r && safeDecrypt(r)
    if (!pw) throw new Error('This password can’t be read here.')
    await clipboard.writeText(pw)
    clearTimeout(clipTimer)
    clipTimer = setTimeout(async () => {
      if ((await clipboard.readText()) === pw) clipboard.clear()
    }, 60_000)
  })

  handle('passwords:save', (_e, input: LoginInput) => {
    const origin = loginOrigin(input.url)
    if (!origin) throw new Error('Enter a website address like https://example.com.')
    const username = (input.username ?? '').trim()
    if (input.id) {
      const cur = rowById(input.id)
      if (!cur) throw new Error('This login no longer exists.')
      const clash = rowByKey(origin, username)
      if (clash && clash.id !== cur.id) throw new Error(`A login for ${username || '(no username)'} on ${hostname(origin)} already exists.`)
      run(
        'UPDATE logins SET origin = ?, url = ?, username = ?, password = ?, note = ?, updated_at = ? WHERE id = ?',
        origin,
        input.url.trim(),
        username,
        input.password ? encrypt(input.password) : cur.password,
        input.note ?? cur.note,
        Date.now(),
        cur.id
      )
      changed()
      return toLogin(rowById(cur.id)!)
    }
    if (!input.password) throw new Error('Enter a password.')
    if (rowByKey(origin, username)) throw new Error(`A login for ${username || '(no username)'} on ${hostname(origin)} already exists — edit it instead.`)
    const { row } = upsert(input.url.trim(), username, input.password, input.note)
    changed()
    return toLogin(row)
  })

  handle('passwords:remove', (_e, id) => {
    run('DELETE FROM logins WHERE id = ? AND profile_id = ?', id, activeProfileId())
    changed()
  })

  handle('passwords:importCsv', async (e, profileId): Promise<PasswordImportResult | null> => {
    if (!available()) throw new Error('Windows data protection is unavailable, so SPECTER can’t store passwords securely on this system.')
    const target = profileId ?? activeProfileId()
    if (!getProfile(target)) throw new Error('That SPECTER profile no longer exists.')
    const win = windowOf(e)
    const opts = {
      title: 'Import passwords',
      defaultPath: app.getPath('downloads'),
      properties: ['openFile' as const],
      filters: [{ name: 'Password export (CSV)', extensions: ['csv'] }]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const file = r.filePaths[0]
    if (r.canceled || !file) return null
    if (statSync(file).size > 50 * 1024 * 1024) throw new Error('That file is too large to be a password export.')
    const { logins, skipped } = loginsFromCsv(readFileSync(file, 'utf8'))
    const result: PasswordImportResult = { file, added: 0, updated: 0, unchanged: 0, skipped }
    tx(() => {
      for (const l of logins) result[upsert(l.url, l.username.trim(), l.password, l.note || undefined, target).result]++
    })
    importedFiles.add(file)
    changed()
    log.info('passwords imported', { profile: target, added: result.added, updated: result.updated, unchanged: result.unchanged, skipped })
    return result
  })

  handle('passwords:trashImported', async (_e, file) => {
    if (!importedFiles.has(file) || !existsSync(file)) return false
    await shell.trashItem(file)
    importedFiles.delete(file)
    return true
  })

  handle('passwords:exportCsv', async (e) => {
    const win = windowOf(e)
    const warn = {
      type: 'warning' as const,
      title: 'Export passwords',
      message: 'Export your passwords to a file?',
      detail: 'The file will contain every saved password in plain text. Anyone who can open it can read them. Delete it once you’re done.',
      buttons: ['Export', 'Cancel'],
      defaultId: 1,
      cancelId: 1
    }
    const ok = win ? await dialog.showMessageBox(win, warn) : await dialog.showMessageBox(warn)
    if (ok.response !== 0) return null
    const opts = { title: 'Export passwords', defaultPath: join(app.getPath('documents'), 'SPECTER Passwords.csv'), filters: [{ name: 'CSV', extensions: ['csv'] }] }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    const rows = listRows().flatMap((row) => {
      const password = safeDecrypt(row)
      return password === null ? [] : [{ name: hostname(row.origin) || row.origin, url: row.url, username: row.username, password, note: row.note }]
    })
    writeFileSync(r.filePath, loginsToCsv(rows), { encoding: 'utf8', mode: 0o600 })
    log.info('passwords exported', { count: rows.length })
    return r.filePath
  })

  handle('passwords:openChromeExport', (_e, profileDir) => {
    const chrome = chromePath()
    if (!chrome) return false
    // Opens the password settings of that Chrome profile (each profile exports its own passwords).
    const args = profileDir && /^(Default|Profile \d+)$/.test(profileDir) ? [`--profile-directory=${profileDir}`] : []
    spawn(chrome, [...args, 'chrome://password-manager/settings'], { detached: true, stdio: 'ignore' }).unref()
    return true
  })

  handle('passwords:forUrl', (_e, url) => {
    const origin = loginOrigin(url)
    return origin && available() ? suggestionsFor(origin) : []
  })

  handle('passwords:fillInTab', (_e, wcId, id) => {
    const wc = webContents.fromId(wcId)
    const r = rowById(id)
    if (!wc || wc.isDestroyed() || wc.getType() !== 'webview' || !r) return false
    const password = safeDecrypt(r)
    if (password === null) return false
    // Only frames of a matching site get the login; the preload fills the first sign-in form it has.
    let sent = false
    for (const frame of wc.mainFrame.framesInSubtree) {
      const origin = loginOrigin(frame.origin || '')
      if (origin && matchOrigin(r.origin, origin)) {
        frame.send('specter-pw:fill-now', { username: r.username, password })
        sent = true
      }
    }
    if (sent) markUsed(r.id)
    return sent
  })

  handle('passwords:respondOffer', (_e, offerId, action, username) => {
    const o = offers.get(offerId)
    if (!o) return
    dropOffer(offerId, false)
    if (action === 'never') {
      run('INSERT OR IGNORE INTO login_never(profile_id, origin, created_at) VALUES(?,?,?)', activeProfileId(), o.origin, Date.now())
      changed()
    } else if (action === 'save') {
      const name = (username ?? o.username).trim()
      const { result } = upsert(o.url, name, o.password)
      log.info(`password ${result} for ${hostname(o.origin)}`)
      changed()
    }
  })

  handle('passwords:neverList', () =>
    all<{ origin: string; created_at: number }>('SELECT origin, created_at FROM login_never WHERE profile_id = ? ORDER BY origin', activeProfileId()).map((r) => ({ origin: r.origin, createdAt: r.created_at }))
  )

  handle('passwords:neverRemove', (_e, origin) => {
    run('DELETE FROM login_never WHERE profile_id = ? AND origin = ?', activeProfileId(), origin)
    changed()
  })
}
