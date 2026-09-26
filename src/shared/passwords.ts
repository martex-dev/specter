// Password manager: shared types, IPC contract and pure helpers (CSV import /
// export, origin matching). No Electron here so it can be unit-tested.
import { registrableDomain } from './domains'

/** A saved login as the UI sees it. The password itself is only sent on an explicit reveal. */
export interface SavedLogin {
  id: string
  origin: string
  url: string
  username: string
  note: string
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
  timesUsed: number
}

export interface LoginInput {
  id?: string
  url: string
  username: string
  /** Omitted when editing without changing the password. */
  password?: string
  note?: string
}

/** A login that may be filled on a page: exact origin, or another host of the same site. */
export interface LoginSuggestion {
  id: string
  username: string
  origin: string
  exact: boolean
}

export interface PasswordOffer {
  offerId: string
  /** The tab that shows the prompt (the opener tab for logins in pop-up windows). */
  webContentsId: number
  origin: string
  username: string
  /** A login for this username exists and the password changed. */
  update: boolean
}

export interface PasswordImportResult {
  file: string
  added: number
  updated: number
  unchanged: number
  skipped: number
}

export interface PasswordStatus {
  /** OS-backed encryption (DPAPI on Windows) is usable; nothing is stored without it. */
  available: boolean
  count: number
  chromeInstalled: boolean
}

declare module './ipc' {
  interface IpcContract {
    'passwords:status': () => PasswordStatus
    'passwords:list': () => SavedLogin[]
    'passwords:reveal': (id: string) => string
    'passwords:save': (input: LoginInput) => SavedLogin
    'passwords:remove': (id: string) => void
    'passwords:importCsv': () => PasswordImportResult | null
    /** Moves the file that was just imported to the Recycle Bin (it holds passwords in plain text). */
    'passwords:trashImported': (file: string) => boolean
    'passwords:exportCsv': () => string | null
    /** Opens Chrome's password settings, where Chrome's own "Export passwords" button is. */
    'passwords:openChromeExport': () => boolean
    'passwords:forUrl': (url: string) => LoginSuggestion[]
    'passwords:fillInTab': (webContentsId: number, id: string) => boolean
    'passwords:respondOffer': (offerId: string, action: 'save' | 'never' | 'dismiss', username?: string) => void
    'passwords:neverList': () => { origin: string; createdAt: number }[]
    'passwords:neverRemove': (origin: string) => void
  }
  interface IpcEvents {
    'passwords:offer': PasswordOffer
    'passwords:offerCancelled': { offerId: string }
    'passwords:changed': undefined
  }
}

// ---------------------------------------------------------------- origins

/** "https://host[:port]" for web URLs; null for anything a login can't be filled on (android://, chrome://…). */
export function loginOrigin(url: string): string | null {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    // CSV rows sometimes carry a bare host.
    if (/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(url.trim())) return loginOrigin('https://' + url.trim())
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (!u.hostname) return null
  return u.origin
}

/**
 * Whether a login saved for `saved` may be offered on `page`:
 * - 'exact': same origin (an http login also matches the https version of the site);
 * - 'site': another host of the same registrable domain (accounts.example.com on example.com) —
 *   offered, never filled without the user picking it;
 * - null: different site, or an https login on an http page (never downgrade).
 */
export function matchOrigin(saved: string, page: string): 'exact' | 'site' | null {
  let s: URL, p: URL
  try {
    s = new URL(saved)
    p = new URL(page)
  } catch {
    return null
  }
  if (!/^https?:$/.test(s.protocol) || !/^https?:$/.test(p.protocol)) return null
  if (s.protocol === 'https:' && p.protocol === 'http:') return null
  const sameScheme = s.protocol === p.protocol
  if (s.hostname === p.hostname) {
    if (sameScheme && s.port === p.port) return 'exact'
    // http → https upgrade of the same host on default ports.
    if (!sameScheme && !s.port && !p.port) return 'exact'
    return null
  }
  if (isIp(s.hostname) || isIp(p.hostname) || s.hostname === 'localhost' || p.hostname === 'localhost') return null
  return registrableDomain(s.hostname) === registrableDomain(p.hostname) ? 'site' : null
}

const isIp = (h: string) => /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':') || h.startsWith('[')

// ---------------------------------------------------------------- CSV

/** RFC 4180 CSV: quoted fields, doubled quotes, embedded newlines, CRLF, a leading BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  for (; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (row.length > 1 || row[0] !== '') rows.push(row)
  }
  return rows
}

export interface CsvLogin {
  url: string
  username: string
  password: string
  note: string
}

// Header names used by Chrome / Edge / Brave / Opera / Vivaldi (name,url,username,password,note),
// Firefox, Safari, Bitwarden, 1Password, LastPass, Dashlane, Proton Pass and KeePass exports.
const URL_KEYS = ['url', 'login_uri', 'website', 'web site', 'origin', 'hostname', 'uri', 'login url', 'urls']
const USER_KEYS = ['username', 'login_username', 'login', 'user', 'user name', 'email', 'login name', 'username/email']
const PASS_KEYS = ['password', 'login_password', 'pass']
const NOTE_KEYS = ['note', 'notes', 'extra', 'comment', 'comments']

/**
 * Maps a password-export CSV to logins. The header row decides the columns;
 * rows without a web URL or a password are skipped (and counted).
 */
export function loginsFromCsv(text: string): { logins: CsvLogin[]; skipped: number } {
  const rows = parseCsv(text)
  if (rows.length < 1) return { logins: [], skipped: 0 }
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const col = (keys: string[]) => {
    for (const k of keys) {
      const i = header.indexOf(k)
      if (i >= 0) return i
    }
    return -1
  }
  const ui = col(URL_KEYS)
  const pi = col(PASS_KEYS)
  if (ui < 0 || pi < 0) throw new Error('This file doesn’t look like a password export (it needs “url” and “password” columns).')
  const ni = col(USER_KEYS)
  const oi = col(NOTE_KEYS)
  const logins: CsvLogin[] = []
  let skipped = 0
  for (const r of rows.slice(1)) {
    const password = r[pi] ?? ''
    // Some managers put several URLs in one cell; the first is the login page.
    const url = (r[ui] ?? '').split(/[\n,]/)[0].trim()
    if (!password || !loginOrigin(url)) {
      skipped++
      continue
    }
    logins.push({ url, username: (ni >= 0 ? r[ni] : '') ?? '', password, note: (oi >= 0 ? r[oi] : '') ?? '' })
  }
  return { logins, skipped }
}

const csvField = (v: string) => (/[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)

/** Chrome's export format, which every browser and password manager can import. */
export function loginsToCsv(rows: { name: string; url: string; username: string; password: string; note: string }[]): string {
  const lines = ['name,url,username,password,note']
  for (const r of rows) lines.push([r.name, r.url, r.username, r.password, r.note].map(csvField).join(','))
  return lines.join('\r\n') + '\r\n'
}
