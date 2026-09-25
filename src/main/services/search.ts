import type { Suggestion } from '@shared/types'
import { SEARCH_ENGINES } from '@shared/settings'
import { all } from '../db'
import { handle } from '../ipc'
import { suggestHistory } from './history'
import { activeProfileId } from './profiles'
import { getSetting } from './settings'
import { fetchJson } from './net'

export function localSuggestions(text: string): Suggestion[] {
  const q = text.trim()
  if (!q) return []
  const out: Suggestion[] = []
  const lower = q.toLowerCase()
  for (const h of suggestHistory(q, 8)) {
    const urlHit = h.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').startsWith(lower)
    out.push({ kind: 'history', title: h.title || h.url, url: h.url, score: 50 + Math.min(30, h.visits * 3) + (urlHit ? 40 : 0), subtitle: h.url })
  }
  const like = '%' + q.replace(/[%_]/g, '') + '%'
  const bms = all<{ title: string; url: string }>(
    "SELECT title, url FROM bookmarks WHERE kind = 'bookmark' AND profile_id = ? AND (title LIKE ? OR url LIKE ? OR tags LIKE ?) LIMIT 6",
    activeProfileId(),
    like,
    like,
    like
  )
  for (const b of bms) {
    const urlHit = b.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').startsWith(lower)
    out.push({ kind: 'bookmark', title: b.title, url: b.url, score: 70 + (urlHit ? 40 : 0), subtitle: b.url })
  }
  // de-duplicate by URL, keep best score
  const best = new Map<string, Suggestion>()
  for (const s of out) {
    const k = s.url ?? s.title
    const cur = best.get(k)
    if (!cur || s.score > cur.score) best.set(k, s)
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, 10)
}

export async function remoteSuggestions(text: string): Promise<string[]> {
  if (!getSetting('search.remoteSuggestions') || !text.trim()) return []
  const engine = SEARCH_ENGINES.find((e) => e.id === getSetting('search.engine'))
  if (!engine?.suggest) return []
  try {
    const data = await fetchJson<any>(engine.suggest.replace('%s', encodeURIComponent(text.trim())), { timeoutMs: 2500, retries: 0, ttl: 60_000 })
    // OpenSearch format: [query, [suggestions...]]
    if (Array.isArray(data) && Array.isArray(data[1])) return (data[1] as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 6)
    if (Array.isArray(data)) return data.map((d: any) => d?.phrase).filter(Boolean).slice(0, 6)
  } catch {
    /* suggestions are best-effort */
  }
  return []
}

export function registerSearchIpc(): void {
  handle('search:suggest', (_e, text) => localSuggestions(text))
  handle('search:remote', (_e, text) => remoteSuggestions(text))
}
