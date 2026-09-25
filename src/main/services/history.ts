import type { HistoryEntry, HistoryQuery } from '@shared/types'
import { hostname } from '@shared/url'
import { all, get, run } from '../db'
import { handle } from '../ipc'
import { getSetting } from './settings'
import { activeProfileId } from './profiles'

const SKIP = /^(specter:|about:|chrome:|devtools:|data:|blob:|view-source:)/

export function addHistory(url: string, title: string, workspaceId?: string): void {
  if (!getSetting('privacy.recordHistory') || SKIP.test(url)) return
  const now = Date.now()
  // Collapse rapid duplicate visits (redirect chains, reloads within 30s).
  const last = get<{ id: number; url: string; visited_at: number }>('SELECT id, url, visited_at FROM history ORDER BY id DESC LIMIT 1')
  if (last && last.url === url && now - last.visited_at < 30_000) {
    if (title) run('UPDATE history SET title = ? WHERE id = ?', title, last.id)
    return
  }
  run(
    'INSERT INTO history(url, title, visited_at, workspace_id, profile_id, domain) VALUES(?, ?, ?, ?, ?, ?)',
    url,
    title || '',
    now,
    workspaceId ?? null,
    activeProfileId(),
    hostname(url)
  )
}

export function updateHistoryTitle(url: string, title: string): void {
  if (!title) return
  run('UPDATE history SET title = ? WHERE id = (SELECT id FROM history WHERE url = ? ORDER BY id DESC LIMIT 1) AND title != ?', title, url, title)
}

/** Quote each token so user input can't inject FTS syntax; prefix-match the last. */
export function ftsQuery(text: string): string {
  const tokens = text
    .replace(/["'*^():{}[\]]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
  return tokens.map((t, i) => `"${t}"${i === tokens.length - 1 ? '*' : ''}`).join(' ')
}

type Row = { id: number; url: string; title: string; visited_at: number; workspace_id: string | null; profile_id: string }

export function searchHistory(q: HistoryQuery): HistoryEntry[] {
  const where: string[] = ['h.profile_id = ?']
  const params: any[] = [activeProfileId()]
  let from = 'history h'
  if (q.text && q.text.trim()) {
    const fq = ftsQuery(q.text)
    if (fq) {
      from = 'history_fts f JOIN history h ON h.id = f.rowid'
      where.push('history_fts MATCH ?')
      params.push(fq)
    }
  }
  if (q.from) where.push('h.visited_at >= ?'), params.push(q.from)
  if (q.to) where.push('h.visited_at <= ?'), params.push(q.to)
  if (q.domain) where.push('(h.domain = ? OR h.domain LIKE ?)'), params.push(q.domain.replace(/^www\./, ''), '%.' + q.domain)
  if (q.workspaceId) where.push('h.workspace_id = ?'), params.push(q.workspaceId)
  const limit = Math.min(q.limit ?? 200, 2000)
  const offset = q.offset ?? 0
  const rows = all<Row>(
    `SELECT h.id, h.url, h.title, h.visited_at, h.workspace_id, h.profile_id FROM ${from} WHERE ${where.join(' AND ')} ORDER BY h.visited_at DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset
  )
  return rows.map(toEntry)
}

/** Frecency-ranked unique URLs for omnibox suggestions. */
export function suggestHistory(text: string, limit = 8): { url: string; title: string; visits: number; last: number }[] {
  const fq = ftsQuery(text)
  if (!fq) return []
  return all<{ url: string; title: string; visits: number; last: number }>(
    `SELECT h.url AS url, MAX(h.title) AS title, COUNT(*) AS visits, MAX(h.visited_at) AS last
     FROM history_fts f JOIN history h ON h.id = f.rowid
     WHERE history_fts MATCH ? AND h.profile_id = ?
     GROUP BY h.url ORDER BY (COUNT(*) * 2 + (MAX(h.visited_at) > ?) * 10) DESC, last DESC LIMIT ?`,
    fq,
    activeProfileId(),
    Date.now() - 3 * 86400_000,
    limit
  )
}

function toEntry(r: Row): HistoryEntry {
  return { id: r.id, url: r.url, title: r.title, visitedAt: r.visited_at, workspaceId: r.workspace_id ?? undefined, profileId: r.profile_id }
}

export function topSites(limit: number): { url: string; title: string; visits: number }[] {
  return all(
    `SELECT url, MAX(title) AS title, COUNT(*) AS visits FROM history WHERE profile_id = ? AND visited_at > ?
     GROUP BY domain ORDER BY visits DESC LIMIT ?`,
    activeProfileId(),
    Date.now() - 30 * 86400_000,
    limit
  )
}

export function historyCount(): number {
  return get<{ c: number }>('SELECT COUNT(*) AS c FROM history WHERE profile_id = ?', activeProfileId())?.c ?? 0
}

export function registerHistoryIpc(): void {
  handle('history:add', (_e, entry) => addHistory(entry.url, entry.title, entry.workspaceId))
  handle('history:updateTitle', (_e, url, title) => updateHistoryTitle(url, title))
  handle('history:search', (_e, q) => searchHistory(q))
  handle('history:delete', (_e, ids) => {
    for (const id of ids) run('DELETE FROM history WHERE id = ?', id)
  })
  handle('history:deleteRange', (_e, from, to) => run('DELETE FROM history WHERE visited_at BETWEEN ? AND ? AND profile_id = ?', from, to, activeProfileId()).changes)
  handle('history:deleteDomain', (_e, domain) => run('DELETE FROM history WHERE (domain = ? OR domain LIKE ?) AND profile_id = ?', domain, '%.' + domain, activeProfileId()).changes)
  handle('history:clear', () => {
    run('DELETE FROM history WHERE profile_id = ?', activeProfileId())
  })
  handle('history:topSites', (_e, limit) => topSites(limit))
  handle('history:count', () => historyCount())
  handle('history:activity', (_e, since) =>
    all(
      `SELECT strftime('%Y-%m-%d', visited_at / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS visits, COUNT(DISTINCT domain) AS domains
       FROM history WHERE visited_at >= ? AND profile_id = ? GROUP BY day ORDER BY day`,
      since,
      activeProfileId()
    )
  )

  handle('searches:add', (_e, q) => {
    if (!getSetting('search.keepHistory') || !q.trim()) return
    run('DELETE FROM searches WHERE query = ?', q.trim())
    run('INSERT INTO searches(query, ts) VALUES(?, ?)', q.trim(), Date.now())
    run('DELETE FROM searches WHERE id NOT IN (SELECT id FROM searches ORDER BY ts DESC LIMIT 500)')
  })
  handle('searches:recent', (_e, limit) => all('SELECT query, ts FROM searches ORDER BY ts DESC LIMIT ?', limit))
  handle('searches:clear', () => {
    run('DELETE FROM searches')
  })
}
