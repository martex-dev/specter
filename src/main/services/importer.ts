// Browser migration: import bookmarks and history from Chromium-family
// browsers and Firefox — into the open profile, or each browser profile into a
// SPECTER profile of its own. Passwords are not read from other browsers'
// encrypted stores; they come over through the browser's own export file (see
// services/passwords.ts).
import { app } from 'electron'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ImportResult, ImportSource, ImportSourceProfile, ImportTarget, ImportWhat, ProfileImportResult } from '@shared/ipc'
import { addressFromChromeTokens, type Address, type AddressKey } from '@shared/addresses'
import { chromiumProfileInfo, profileDisplayName, PROFILE_COLORS } from '@shared/browserImport'
import { hostname } from '@shared/url'
import { all, get, registerMigrations, run, tx } from '../db'
import { broadcast, handle } from '../ipc'
import { addBookmark, barFolderId, bookmarkBatch, ensureBookmarkRoots, otherFolderId, removeBookmark } from './bookmarks'
import { activeProfileId, createProfile, getProfile, listProfiles } from './profiles'
import { addAddress } from './addresses'
import { createLogger } from '../logger'

const log = createLogger('import')

// Which SPECTER profile each browser profile went into, so importing again fills the same one.
registerMigrations('importer', [`CREATE TABLE profile_sources (source_key TEXT PRIMARY KEY, profile_id TEXT NOT NULL, imported_at INTEGER NOT NULL);`])

const CHROMIUM: { id: ImportSource['id']; name: string; dir: () => string; single?: boolean }[] = [
  { id: 'chrome', name: 'Google Chrome', dir: () => join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'User Data') },
  { id: 'edge', name: 'Microsoft Edge', dir: () => join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Edge', 'User Data') },
  { id: 'brave', name: 'Brave', dir: () => join(process.env.LOCALAPPDATA ?? '', 'BraveSoftware', 'Brave-Browser', 'User Data') },
  { id: 'vivaldi', name: 'Vivaldi', dir: () => join(process.env.LOCALAPPDATA ?? '', 'Vivaldi', 'User Data') },
  { id: 'opera', name: 'Opera', dir: () => join(process.env.APPDATA ?? '', 'Opera Software'), single: true }
]

const sourceKey = (sourceId: string, path: string) => `${sourceId}:${path.toLowerCase()}`

function importedInto(sourceId: string, path: string): string | undefined {
  const id = get<{ profile_id: string }>('SELECT profile_id FROM profile_sources WHERE source_key = ?', sourceKey(sourceId, path))?.profile_id
  return id && getProfile(id) ? id : undefined
}

function chromiumProfiles(sourceId: string, base: string, single?: boolean): ImportSourceProfile[] {
  if (!existsSync(base)) return []
  const hasData = (dir: string) => [...CHROMIUM_BOOKMARK_FILES, 'History'].some((f) => existsSync(join(dir, f)))
  if (single) {
    // Opera keeps each edition's profile directly in its folder.
    return readdirSync(base)
      .filter((d) => hasData(join(base, d)))
      .map((d) => ({ name: d, label: d, path: join(base, d), importedInto: importedInto(sourceId, join(base, d)) }))
  }
  let info = new Map<string, { label?: string; account?: string; color?: string }>()
  try {
    info = chromiumProfileInfo(JSON.parse(readFileSync(join(base, 'Local State'), 'utf8')))
  } catch {
    /* no or unreadable Local State: folder names only */
  }
  return readdirSync(base)
    .filter((d) => (d === 'Default' || /^Profile \d+$/.test(d)) && hasData(join(base, d)))
    .sort((a, b) => (a === 'Default' ? -1 : b === 'Default' ? 1 : Number(a.slice(8)) - Number(b.slice(8))))
    .map((d) => {
      const i = info.get(d)
      const path = join(base, d)
      return { name: profileDisplayName(d, i?.label), label: i?.label, dir: d, account: i?.account, color: i?.color, path, importedInto: importedInto(sourceId, path) }
    })
}

function firefoxProfiles(): ImportSourceProfile[] {
  const base = join(process.env.APPDATA ?? '', 'Mozilla', 'Firefox', 'Profiles')
  if (!existsSync(base)) return []
  return readdirSync(base)
    .filter((d) => existsSync(join(base, d, 'places.sqlite')))
    .map((d) => ({ name: d, label: d.replace(/^[a-z0-9]+\./, ''), path: join(base, d), importedInto: importedInto('firefox', join(base, d)) }))
}

export function detectSources(): ImportSource[] {
  const out: ImportSource[] = []
  for (const b of CHROMIUM) {
    const profiles = chromiumProfiles(b.id, b.dir(), b.single)
    if (profiles.length) out.push({ id: b.id, name: b.name, profiles })
  }
  const ff = firefoxProfiles()
  if (ff.length) out.push({ id: 'firefox', name: 'Mozilla Firefox', profiles: ff })
  return out
}

/** Copies a (possibly locked) SQLite database + WAL to a temp dir and opens it read-only. */
function openCopy(file: string): { db: DatabaseSync; cleanup: () => void } {
  const dir = mkdtempSync(join(app.getPath('temp'), 'specter-import-'))
  const target = join(dir, 'db.sqlite')
  let db: DatabaseSync
  try {
    copyFileSync(file, target)
    for (const ext of ['-wal', '-shm']) if (existsSync(file + ext)) copyFileSync(file + ext, target + ext)
    db = new DatabaseSync(target, { readOnly: false })
  } catch (err) {
    // e.g. EBUSY while the browser holds the file: don't leave the temp copy behind.
    rmSync(dir, { recursive: true, force: true })
    throw err
  }
  return {
    db,
    cleanup: () => {
      try {
        db.close()
      } catch {
        /* ignore */
      }
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

// ---------------------------------------------------------------- bookmarks

/**
 * Adds bookmarks without duplicating what's already there: folders with the same name under
 * the same parent are reused, and a URL the profile already has bookmarked is skipped.
 */
class BookmarkWriter {
  count = 0
  private urls: Set<string>
  constructor(private profileId: string) {
    this.urls = new Set(all<{ url: string }>("SELECT url FROM bookmarks WHERE profile_id = ? AND kind = 'bookmark' AND url IS NOT NULL", profileId).map((r) => r.url))
  }
  folder(title: string, parentId: string): string {
    const existing = get<{ id: string }>("SELECT id FROM bookmarks WHERE parent_id = ? AND kind = 'folder' AND title = ? AND profile_id = ?", parentId, title, this.profileId)
    return existing?.id ?? addBookmark({ kind: 'folder', title, parentId }, this.profileId).id
  }
  bookmark(title: string, url: string, parentId: string): void {
    if (!/^(https?|ftp|file):/i.test(url) || this.urls.has(url)) return
    this.urls.add(url)
    addBookmark({ kind: 'bookmark', title: title || url, url, parentId }, this.profileId)
    this.count++
  }
}

/** Where imported bookmarks go: straight into the bar / other roots of an empty profile, else one folder in Other bookmarks. */
interface BookmarkPlan {
  bar: string
  other: string
}

function bookmarkPlan(profileId: string, sourceName: string): { plan: BookmarkPlan; wrapper?: string } {
  ensureBookmarkRoots(profileId)
  const empty = !get("SELECT 1 FROM bookmarks WHERE profile_id = ? AND parent_id IS NOT NULL LIMIT 1", profileId)
  if (empty) return { plan: { bar: barFolderId(profileId), other: otherFolderId(profileId) } }
  const title = `Imported from ${sourceName}`
  const existing = get<{ id: string }>("SELECT id FROM bookmarks WHERE parent_id = ? AND kind = 'folder' AND title = ? AND profile_id = ?", otherFolderId(profileId), title, profileId)
  const wrapper = existing?.id ?? addBookmark({ kind: 'folder', title, parentId: otherFolderId(profileId) }, profileId).id
  return { plan: { bar: wrapper, other: wrapper }, wrapper: existing ? undefined : wrapper }
}

/**
 * Chrome keeps bookmarks that live in the Google account (signed in without full
 * sync) in AccountBookmarks, next to or instead of the local Bookmarks file; both
 * are read, and a URL in both is added once. (EncryptedAccountBookmarks2, Chrome's
 * newer encrypted copy, is not read.)
 */
const CHROMIUM_BOOKMARK_FILES = ['Bookmarks', 'AccountBookmarks']

function importChromiumBookmarks(profilePath: string, profileId: string, plan: BookmarkPlan): number {
  const w = new BookmarkWriter(profileId)
  for (const name of CHROMIUM_BOOKMARK_FILES) {
    const file = join(profilePath, name)
    if (existsSync(file)) importChromiumBookmarkFile(JSON.parse(readFileSync(file, 'utf8')), w, plan)
  }
  return w.count
}

function importChromiumBookmarkFile(data: any, w: BookmarkWriter, plan: BookmarkPlan): void {
  const walk = (node: any, parent: string, depth: number) => {
    if (!node || depth > 100) return
    if (node.type === 'url' && typeof node.url === 'string') w.bookmark(node.name, node.url, parent)
    else if (node.type === 'folder' || node.children) {
      const f = w.folder(node.name || 'Folder', parent)
      for (const c of node.children ?? []) walk(c, f, depth + 1)
    }
  }
  bookmarkBatch(() => {
    // The roots' own children go straight into the matching SPECTER root (or the import folder).
    for (const c of data.roots?.bookmark_bar?.children ?? []) walk(c, plan.bar, 0)
    for (const key of ['other', 'synced']) for (const c of data.roots?.[key]?.children ?? []) walk(c, plan.other, 0)
  })
}

// ---------------------------------------------------------------- history

/** Adds one visit unless it is already there, so importing twice doesn't double the history. */
function insertVisit(url: string, title: string, visitedAt: number, profile: string): boolean {
  if (!/^https?:/i.test(url) || !(visitedAt > 0)) return false
  if (get('SELECT 1 FROM history WHERE url = ? AND visited_at = ? AND profile_id = ?', url, visitedAt, profile)) return false
  run('INSERT INTO history(url, title, visited_at, workspace_id, profile_id, domain) VALUES(?,?,?,?,?,?)', url, title, visitedAt, null, profile, hostname(url))
  return true
}

function importChromiumHistory(profilePath: string, profileId: string): number {
  const file = join(profilePath, 'History')
  if (!existsSync(file)) return 0
  const { db, cleanup } = openCopy(file)
  try {
    const q = db.prepare('SELECT url, title, last_visit_time FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT 25000')
    // WebKit timestamps (microseconds since 1601) are past Number.MAX_SAFE_INTEGER,
    // which node:sqlite refuses to return as a number.
    q.setReadBigInts(true)
    const rows = q.all() as { url: string; title: string | null; last_visit_time: bigint }[]
    let added = 0
    tx(() => {
      for (const r of rows) {
        const ts = Number(BigInt(r.last_visit_time) / 1000n) - 11644473600000
        if (insertVisit(r.url, r.title ?? '', ts, profileId)) added++
      }
    })
    return added
  } finally {
    cleanup()
  }
}

function importFirefox(profilePath: string, what: ImportWhat, profileId: string, plan: BookmarkPlan | null): ImportResult {
  const result: ImportResult = { bookmarks: 0, history: 0, errors: [] }
  const { db, cleanup } = openCopy(join(profilePath, 'places.sqlite'))
  try {
    if (what.history) {
      const q = db.prepare('SELECT url, title, last_visit_date FROM moz_places WHERE last_visit_date IS NOT NULL AND hidden = 0 ORDER BY last_visit_date DESC LIMIT 25000')
      q.setReadBigInts(true)
      const rows = q.all() as { url: string; title: string | null; last_visit_date: bigint }[]
      tx(() => {
        for (const r of rows) if (insertVisit(r.url, r.title ?? '', Number(BigInt(r.last_visit_date) / 1000n), profileId)) result.history++
      })
    }
    if (what.bookmarks && plan) {
      const rows = db
        .prepare('SELECT b.id, b.type, b.parent, b.title, b.guid, b.position, p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position')
        .all() as { id: number; type: number; parent: number; title: string | null; guid: string | null; url: string | null }[]
      const children = new Map<number, typeof rows>()
      for (const r of rows) children.set(r.parent, [...(children.get(r.parent) ?? []), r])
      const w = new BookmarkWriter(profileId)
      // Walk the tree from the root (id 1; children: menu, toolbar, tags, unfiled, mobile).
      // Id order is not tree order: a folder moved into a newer folder has a smaller
      // id than its parent and was skipped, with everything inside it.
      const walk = (folder: number, parent: string, depth: number): void => {
        if (depth > 100) return
        for (const r of children.get(folder) ?? []) {
          if (r.type === 2) {
            // The tags root repeats every tagged bookmark under per-tag folders.
            if (r.guid === 'tags________') continue
            // Firefox's own roots map onto SPECTER's: the toolbar to the bar, the rest to Other.
            if (depth === 0) walk(r.id, r.guid === 'toolbar_____' ? plan.bar : plan.other, depth + 1)
            else walk(r.id, w.folder(r.title || 'Folder', parent), depth + 1)
          } else if (r.type === 1 && r.url) w.bookmark(r.title ?? '', r.url, parent)
        }
      }
      bookmarkBatch(() => walk(1, plan.other, 0))
      result.bookmarks = w.count
    }
  } finally {
    cleanup()
  }
  return result
}

// ---------------------------------------------------------------- addresses

/**
 * Chromium's saved addresses (Web Data). Only the address tables are read — the
 * payment and login tables in the same file are never queried. The table names
 * changed over the years (contact_info / local_addresses → addresses), so every
 * layout that exists is read.
 */
function importChromiumAddresses(profilePath: string, profileId: string): number {
  const file = join(profilePath, 'Web Data')
  if (!existsSync(file)) return 0
  const { db, cleanup } = openCopy(file)
  try {
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name))
    const layouts: [string, string][] = [
      ['addresses', 'address_type_tokens'],
      ['local_addresses', 'local_addresses_type_tokens'],
      ['contact_info', 'contact_info_type_tokens']
    ]
    let added = 0
    tx(() => {
      for (const [main, tokens] of layouts) {
        if (!tables.has(main) || !tables.has(tokens)) continue
        const rows = db.prepare(`SELECT t.guid AS guid, t.type AS type, t.value AS value FROM "${tokens}" t JOIN "${main}" m ON m.guid = t.guid`).all() as { guid: string; type: number; value: string | null }[]
        const byGuid = new Map<string, { type: number; value: string | null }[]>()
        for (const r of rows) byGuid.set(r.guid, [...(byGuid.get(r.guid) ?? []), { type: Number(r.type), value: r.value }])
        for (const t of byGuid.values()) if (addAddress(addressFromChromeTokens(t), profileId)) added++
      }
    })
    return added
  } finally {
    cleanup()
  }
}

/** Firefox keeps addresses in autofill-profiles.json (its card entries are not read). */
function importFirefoxAddresses(profilePath: string, profileId: string): number {
  const file = join(profilePath, 'autofill-profiles.json')
  if (!existsSync(file)) return 0
  const list = (JSON.parse(readFileSync(file, 'utf8'))?.addresses ?? []) as Record<string, unknown>[]
  let added = 0
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  tx(() => {
    for (const r of list) {
      if (r.deleted) continue
      const name = s(r.name) || [s(r['given-name']), s(r['additional-name']), s(r['family-name'])].filter(Boolean).join(' ')
      const a: Pick<Address, AddressKey> = {
        name,
        organization: s(r.organization),
        street: s(r['street-address']),
        city: s(r['address-level2']),
        state: s(r['address-level1']),
        postalCode: s(r['postal-code']),
        country: s(r.country),
        email: s(r.email),
        phone: s(r.tel)
      }
      if (addAddress(a, profileId)) added++
    }
  })
  return added
}

// ---------------------------------------------------------------- running an import

function resolveTarget(source: ImportSource, profile: ImportSourceProfile, target: ImportTarget): { profileId: string; created: boolean } {
  if (target === 'current') return { profileId: activeProfileId(), created: false }
  if (typeof target === 'object') {
    if (!getProfile(target.profileId)) throw new Error('That SPECTER profile no longer exists.')
    return { profileId: target.profileId, created: false }
  }
  // 'new': the profile made by an earlier import of the same browser profile, else a fresh one.
  if (profile.importedInto) return { profileId: profile.importedInto, created: false }
  const label = profile.label || profile.name
  const name = source.id === 'chrome' ? label : `${label} (${source.name})`
  const color = profile.color ?? PROFILE_COLORS[listProfiles().length % PROFILE_COLORS.length]
  return { profileId: createProfile(name, color).id, created: true }
}

function runImport(sourceId: ImportSource['id'], profilePath: string, what: ImportWhat, target: ImportTarget): ProfileImportResult {
  const source = detectSources().find((s) => s.id === sourceId)
  const profile = source?.profiles.find((p) => p.path === profilePath)
  if (!source || !profile) throw new Error('Unknown import source')
  const { profileId, created } = resolveTarget(source, profile, target)
  const result: ProfileImportResult = { bookmarks: 0, history: 0, errors: [], profileId, profileName: getProfile(profileId)?.name ?? '', created }
  const bm = what.bookmarks ? bookmarkPlan(profileId, source.name) : null

  if (sourceId === 'firefox') {
    try {
      const r = importFirefox(profilePath, what, profileId, bm?.plan ?? null)
      result.bookmarks = r.bookmarks
      result.history = r.history
      result.errors.push(...r.errors)
    } catch (err: any) {
      log.error('firefox import failed', err)
      result.errors.push(String(err?.message ?? err))
    }
  } else {
    if (bm) {
      try {
        result.bookmarks = importChromiumBookmarks(profilePath, profileId, bm.plan)
      } catch (err: any) {
        result.errors.push('Bookmarks: ' + (err?.message ?? err))
      }
    }
    if (what.history) {
      try {
        result.history = importChromiumHistory(profilePath, profileId)
      } catch (err: any) {
        result.errors.push('History: ' + (err?.message ?? err))
      }
    }
  }
  if (what.addresses) {
    try {
      result.addresses = sourceId === 'firefox' ? importFirefoxAddresses(profilePath, profileId) : importChromiumAddresses(profilePath, profileId)
      if (result.addresses) broadcast('addresses:changed', undefined)
    } catch (err: any) {
      result.errors.push('Addresses: ' + (err?.message ?? err))
    }
  }
  // Don't leave an empty "Imported from …" folder behind when there was nothing to bring over.
  if (bm?.wrapper && result.bookmarks === 0) removeBookmark(bm.wrapper)
  run(
    'INSERT INTO profile_sources(source_key, profile_id, imported_at) VALUES(?,?,?) ON CONFLICT(source_key) DO UPDATE SET profile_id = excluded.profile_id, imported_at = excluded.imported_at',
    sourceKey(sourceId, profilePath),
    profileId,
    Date.now()
  )
  log.info('import finished', { sourceId, profileId, created, bookmarks: result.bookmarks, history: result.history, addresses: result.addresses, errors: result.errors.length })
  return result
}

export function registerImportIpc(): void {
  handle('import:sources', () => detectSources())
  handle('import:run', (_e, sourceId, profilePath, what): ImportResult => {
    const { bookmarks, history, addresses, errors } = runImport(sourceId, profilePath, what, 'current')
    return { bookmarks, history, addresses, errors }
  })
  handle('import:toProfile', (_e, sourceId, profilePath, what, target) => runImport(sourceId, profilePath, what, target))
}
