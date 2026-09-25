// Browser migration: import bookmarks and history from Chromium-family
// browsers and Firefox. Passwords are intentionally NOT imported (they are
// encrypted with OS-bound keys; exporting them would weaken security).
import { app } from 'electron'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ImportResult, ImportSource } from '@shared/ipc'
import { hostname } from '@shared/url'
import { run, tx } from '../db'
import { handle } from '../ipc'
import { addBookmark, otherFolderId } from './bookmarks'
import { activeProfileId } from './profiles'
import { createLogger } from '../logger'

const log = createLogger('import')

const CHROMIUM: { id: ImportSource['id']; name: string; dir: () => string; single?: boolean }[] = [
  { id: 'chrome', name: 'Google Chrome', dir: () => join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'User Data') },
  { id: 'edge', name: 'Microsoft Edge', dir: () => join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Edge', 'User Data') },
  { id: 'brave', name: 'Brave', dir: () => join(process.env.LOCALAPPDATA ?? '', 'BraveSoftware', 'Brave-Browser', 'User Data') },
  { id: 'vivaldi', name: 'Vivaldi', dir: () => join(process.env.LOCALAPPDATA ?? '', 'Vivaldi', 'User Data') },
  { id: 'opera', name: 'Opera', dir: () => join(process.env.APPDATA ?? '', 'Opera Software'), single: true }
]

function chromiumProfiles(base: string, single?: boolean): { name: string; path: string }[] {
  if (!existsSync(base)) return []
  if (single) {
    // Opera keeps each edition's profile directly in its folder.
    return readdirSync(base)
      .filter((d) => existsSync(join(base, d, 'Bookmarks')) || existsSync(join(base, d, 'History')))
      .map((d) => ({ name: d, path: join(base, d) }))
  }
  let names: Record<string, { name?: string }> = {}
  try {
    names = JSON.parse(readFileSync(join(base, 'Local State'), 'utf8'))?.profile?.info_cache ?? {}
  } catch {
    /* ignore */
  }
  return readdirSync(base)
    .filter((d) => (d === 'Default' || /^Profile \d+$/.test(d)) && (existsSync(join(base, d, 'Bookmarks')) || existsSync(join(base, d, 'History'))))
    .map((d) => ({ name: names[d]?.name ? `${names[d].name} (${d})` : d, path: join(base, d) }))
}

function firefoxProfiles(): { name: string; path: string }[] {
  const base = join(process.env.APPDATA ?? '', 'Mozilla', 'Firefox', 'Profiles')
  if (!existsSync(base)) return []
  return readdirSync(base)
    .filter((d) => existsSync(join(base, d, 'places.sqlite')))
    .map((d) => ({ name: d, path: join(base, d) }))
}

export function detectSources(): ImportSource[] {
  const out: ImportSource[] = []
  for (const b of CHROMIUM) {
    const profiles = chromiumProfiles(b.dir(), b.single)
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
  copyFileSync(file, target)
  for (const ext of ['-wal', '-shm']) if (existsSync(file + ext)) copyFileSync(file + ext, target + ext)
  const db = new DatabaseSync(target, { readOnly: false })
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

function importChromiumBookmarks(profilePath: string, parentId: string): number {
  const file = join(profilePath, 'Bookmarks')
  if (!existsSync(file)) return 0
  const data = JSON.parse(readFileSync(file, 'utf8'))
  let count = 0
  const walk = (node: any, parent: string) => {
    if (!node) return
    if (node.type === 'url' && /^(https?|ftp|file):/i.test(node.url)) {
      addBookmark({ kind: 'bookmark', title: node.name || node.url, url: node.url, parentId: parent })
      count++
    } else if (node.type === 'folder' || node.children) {
      const f = addBookmark({ kind: 'folder', title: node.name || 'Folder', parentId: parent })
      for (const c of node.children ?? []) walk(c, f.id)
    }
  }
  tx(() => {
    for (const key of ['bookmark_bar', 'other', 'synced']) if (data.roots?.[key]?.children?.length) walk(data.roots[key], parentId)
  })
  return count
}

function importChromiumHistory(profilePath: string): number {
  const file = join(profilePath, 'History')
  if (!existsSync(file)) return 0
  const { db, cleanup } = openCopy(file)
  try {
    const rows = db.prepare('SELECT url, title, last_visit_time FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT 25000').all() as { url: string; title: string; last_visit_time: number }[]
    const profile = activeProfileId()
    tx(() => {
      for (const r of rows) {
        if (!/^https?:/.test(r.url)) continue
        // WebKit epoch: microseconds since 1601-01-01.
        const ts = Math.round(Number(r.last_visit_time) / 1000 - 11644473600000)
        if (ts <= 0) continue
        run('INSERT INTO history(url, title, visited_at, workspace_id, profile_id, domain) VALUES(?,?,?,?,?,?)', r.url, r.title ?? '', ts, null, profile, hostname(r.url))
      }
    })
    return rows.length
  } finally {
    cleanup()
  }
}

function importFirefox(profilePath: string, what: { bookmarks: boolean; history: boolean }, parentId: string): ImportResult {
  const result: ImportResult = { bookmarks: 0, history: 0, errors: [] }
  const { db, cleanup } = openCopy(join(profilePath, 'places.sqlite'))
  try {
    if (what.history) {
      const rows = db.prepare('SELECT url, title, last_visit_date FROM moz_places WHERE last_visit_date IS NOT NULL AND hidden = 0 ORDER BY last_visit_date DESC LIMIT 25000').all() as {
        url: string
        title: string | null
        last_visit_date: number
      }[]
      const profile = activeProfileId()
      tx(() => {
        for (const r of rows) {
          if (!/^https?:/.test(r.url)) continue
          run('INSERT INTO history(url, title, visited_at, workspace_id, profile_id, domain) VALUES(?,?,?,?,?,?)', r.url, r.title ?? '', Math.round(Number(r.last_visit_date) / 1000), null, profile, hostname(r.url))
        }
      })
      result.history = rows.length
    }
    if (what.bookmarks) {
      const rows = db
        .prepare('SELECT b.id, b.type, b.parent, b.title, b.position, p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position')
        .all() as { id: number; type: number; parent: number; title: string | null; url: string | null }[]
      const map = new Map<number, string>()
      // Firefox roots: 1 = root, 2 = menu, 3 = toolbar, 5 = unfiled, 6 = mobile
      map.set(1, parentId)
      tx(() => {
        for (const r of rows) {
          if (r.id === 1) continue
          const parent = map.get(r.parent)
          if (!parent) continue
          if (r.type === 2) map.set(r.id, addBookmark({ kind: 'folder', title: r.title || 'Folder', parentId: parent }).id)
          else if (r.type === 1 && r.url && /^(https?|ftp|file):/i.test(r.url)) {
            addBookmark({ kind: 'bookmark', title: r.title || r.url, url: r.url, parentId: parent })
            result.bookmarks++
          }
        }
      })
    }
  } finally {
    cleanup()
  }
  return result
}

export function registerImportIpc(): void {
  handle('import:sources', () => detectSources())
  handle('import:run', (_e, sourceId, profilePath, what) => {
    const source = detectSources().find((s) => s.id === sourceId)
    if (!source || !source.profiles.some((p) => p.path === profilePath)) throw new Error('Unknown import source')
    const result: ImportResult = { bookmarks: 0, history: 0, errors: [] }
    let folderId = otherFolderId()
    if (what.bookmarks) folderId = addBookmark({ kind: 'folder', title: `Imported from ${source.name}`, parentId: otherFolderId() }).id
    if (sourceId === 'firefox') {
      try {
        return importFirefox(profilePath, what, folderId)
      } catch (err: any) {
        log.error('firefox import failed', err)
        return { ...result, errors: [String(err?.message ?? err)] }
      }
    }
    if (what.bookmarks) {
      try {
        result.bookmarks = importChromiumBookmarks(profilePath, folderId)
      } catch (err: any) {
        result.errors.push('Bookmarks: ' + (err?.message ?? err))
      }
    }
    if (what.history) {
      try {
        result.history = importChromiumHistory(profilePath)
      } catch (err: any) {
        result.errors.push('History: ' + (err?.message ?? err))
      }
    }
    log.info('import finished', { sourceId, ...result })
    return result
  })
}
