// News / RSS reader — feeds are fetched in the main process with Electron's
// net stack (timeout, conditional GET, size cap), parsed locally by ./feed and
// stored in SQLite with per-item read state.
import { createHash } from 'node:crypto'
import { net } from 'electron'
import { DEFAULT_FEEDS, DEFAULT_NEWS_SETTINGS, type NewsFeed, type NewsItem, type NewsSettings } from '@shared/modules/widgets'
import { all, get, metaGet, metaSet, run, tx, uid } from '../../db'
import { broadcast } from '../../ipc'
import { createLogger } from '../../logger'
import { discoverFeeds, parseFeed, type ParsedFeed } from './feed'

const log = createLogger('widgets.news')
const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 15_000
/** Never re-download a feed more often than this, even on a forced refresh. */
const MIN_FORCED_GAP = 30_000
const CONCURRENCY = 4

interface FeedRow {
  id: string
  url: string
  title: string
  site_url: string
  added_at: number
  last_fetched: number | null
  last_error: string | null
  etag: string | null
  last_modified: string | null
}

export function newsSettings(): NewsSettings {
  // Stored in meta (not the renderer-writable kv) and clamped on write.
  try {
    const s = JSON.parse(metaGet('widgets:newsSettings') ?? '{}') as Partial<NewsSettings>
    return { ...DEFAULT_NEWS_SETTINGS, ...s }
  } catch {
    return DEFAULT_NEWS_SETTINGS
  }
}

export function setNewsSettings(patch: Partial<NewsSettings>): NewsSettings {
  const cur = newsSettings()
  const next: NewsSettings = {
    intervalMin: Math.round(Math.min(24 * 60, Math.max(10, Number(patch.intervalMin ?? cur.intervalMin) || cur.intervalMin))),
    keepPerFeed: Math.round(Math.min(1000, Math.max(20, Number(patch.keepPerFeed ?? cur.keepPerFeed) || cur.keepPerFeed)))
  }
  metaSet('widgets:newsSettings', JSON.stringify(next))
  return next
}

function seedDefaults(): void {
  if (metaGet('widgets:feedsSeeded')) return
  metaSet('widgets:feedsSeeded', '1')
  const now = Date.now()
  DEFAULT_FEEDS.forEach((f, i) => {
    run("INSERT OR IGNORE INTO wg_feeds(id, url, title, site_url, added_at, sort) VALUES(?,?,?,'',?,?)", uid('f_'), f.url, f.title, now, i)
  })
}

export function listFeeds(): NewsFeed[] {
  seedDefaults()
  const rows = all<FeedRow & { unread: number; total: number }>(
    `SELECT f.*, COALESCE(SUM(CASE WHEN i.read = 0 THEN 1 ELSE 0 END), 0) AS unread, COUNT(i.id) AS total
     FROM wg_feeds f LEFT JOIN wg_items i ON i.feed_id = f.id GROUP BY f.id ORDER BY f.sort, f.added_at`
  )
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    title: r.title,
    siteUrl: r.site_url,
    addedAt: r.added_at,
    lastFetched: r.last_fetched,
    lastError: r.last_error,
    unread: Number(r.unread),
    total: Number(r.total)
  }))
}

export function unreadCount(): number {
  return Number(get<{ n: number }>('SELECT COUNT(*) AS n FROM wg_items WHERE read = 0')?.n ?? 0)
}

function changed(): void {
  broadcast('news:changed', { unread: unreadCount() })
}

function httpUrl(input: string): URL {
  let s = String(input ?? '').trim()
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s
  const u = new URL(s)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) feeds are supported')
  return u
}

interface FetchResult {
  status: number
  text: string
  contentType: string
  etag: string | null
  lastModified: string | null
  finalUrl: string
}

async function fetchText(url: string, cond?: { etag?: string | null; lastModified?: string | null }): Promise<FetchResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const headers: Record<string, string> = {
      Accept: 'application/rss+xml, application/atom+xml, application/rdf+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.5, */*;q=0.1',
      'User-Agent': 'SPECTER-Browser RSS reader'
    }
    if (cond?.etag) headers['If-None-Match'] = cond.etag
    if (cond?.lastModified) headers['If-Modified-Since'] = cond.lastModified
    const res = await net.fetch(url, { signal: ctrl.signal, headers, redirect: 'follow', credentials: 'omit' } as RequestInit)
    const base = { status: res.status, contentType: res.headers.get('content-type') ?? '', etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), finalUrl: res.url || url }
    if (res.status === 304) return { ...base, text: '' }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const reader = res.body?.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_BYTES) {
          await reader.cancel().catch(() => undefined)
          throw new Error('Feed is larger than 5 MB')
        }
        chunks.push(value)
      }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)))
    return { ...base, text: decode(buf, base.contentType) }
  } catch (err) {
    if (ctrl.signal.aborted) throw new Error('Timed out')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function decode(buf: Buffer, contentType: string): string {
  let charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/"/g, '')
  if (!charset) charset = /<\?xml[^>]*encoding=["']([^"']+)["']/i.exec(buf.subarray(0, 200).toString('latin1'))?.[1]
  try {
    return new TextDecoder(charset || 'utf-8', { fatal: false }).decode(buf)
  } catch {
    return new TextDecoder('utf-8').decode(buf)
  }
}

const looksLikeHtml = (r: FetchResult) => /text\/html/i.test(r.contentType) || /^\s*(<!doctype html|<html)/i.test(r.text.slice(0, 500))

function itemId(feedId: string, guid: string): string {
  return 'i_' + createHash('sha1').update(feedId + '\n' + guid).digest('hex').slice(0, 20)
}

function storeItems(feedId: string, parsed: ParsedFeed): number {
  const now = Date.now()
  const keep = newsSettings().keepPerFeed
  let added = 0
  tx(() => {
    for (const it of parsed.items.slice(0, keep)) {
      if (!it.title && !it.link) continue
      const r = run(
        `INSERT INTO wg_items(id, feed_id, guid, title, link, author, summary, published, fetched_at, read)
         VALUES(?,?,?,?,?,?,?,?,?,0)
         ON CONFLICT(feed_id, guid) DO UPDATE SET title = excluded.title, link = excluded.link, author = excluded.author,
           summary = excluded.summary, published = COALESCE(excluded.published, wg_items.published)`,
        itemId(feedId, it.guid),
        feedId,
        it.guid.slice(0, 1000),
        it.title,
        it.link,
        it.author,
        it.summary,
        it.published,
        now
      )
      if (r.changes) added++
    }
    // Trim old items beyond the per-feed limit (oldest first).
    run(
      `DELETE FROM wg_items WHERE feed_id = ? AND id NOT IN (
         SELECT id FROM wg_items WHERE feed_id = ? ORDER BY COALESCE(published, fetched_at) DESC LIMIT ?)`,
      feedId,
      feedId,
      keep
    )
  })
  return added
}

async function refreshFeed(row: FeedRow, force: boolean): Promise<string | null> {
  const s = newsSettings()
  const age = Date.now() - (row.last_fetched ?? 0)
  if (!force && age < s.intervalMin * 60_000) return null
  if (force && age < MIN_FORCED_GAP) return null
  try {
    const r = await fetchText(row.url, { etag: row.etag, lastModified: row.last_modified })
    if (r.status === 304) {
      run('UPDATE wg_feeds SET last_fetched = ?, last_error = NULL WHERE id = ?', Date.now(), row.id)
      return null
    }
    const parsed = parseFeed(r.text, r.finalUrl)
    storeItems(row.id, parsed)
    run(
      'UPDATE wg_feeds SET last_fetched = ?, last_error = NULL, etag = ?, last_modified = ?, site_url = ?, title = CASE WHEN title = \'\' THEN ? ELSE title END WHERE id = ?',
      Date.now(),
      r.etag,
      r.lastModified,
      parsed.siteUrl || row.site_url,
      parsed.title || row.url,
      row.id
    )
    return null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    run('UPDATE wg_feeds SET last_fetched = ?, last_error = ? WHERE id = ?', Date.now(), msg.slice(0, 300), row.id)
    log.warn(`feed ${new URL(row.url).host} failed: ${msg}`)
    return msg
  }
}

let refreshing: Promise<{ refreshed: number; errors: { feedId: string; error: string }[] }> | null = null

export async function refresh(opts: { feedId?: string; force?: boolean } = {}): Promise<{ refreshed: number; errors: { feedId: string; error: string }[] }> {
  seedDefaults()
  if (refreshing && !opts.feedId) return refreshing
  const run1 = (async () => {
    const rows = opts.feedId ? all<FeedRow>('SELECT * FROM wg_feeds WHERE id = ?', opts.feedId) : all<FeedRow>('SELECT * FROM wg_feeds ORDER BY sort, added_at')
    const errors: { feedId: string; error: string }[] = []
    let refreshed = 0
    let idx = 0
    const worker = async () => {
      while (idx < rows.length) {
        const row = rows[idx++]
        const before = row.last_fetched
        const err = await refreshFeed(row, !!opts.force)
        if (err) errors.push({ feedId: row.id, error: err })
        else if (get<{ last_fetched: number }>('SELECT last_fetched FROM wg_feeds WHERE id = ?', row.id)?.last_fetched !== before) refreshed++
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker))
    changed()
    return { refreshed, errors }
  })()
  if (!opts.feedId) refreshing = run1
  try {
    return await run1
  } finally {
    if (!opts.feedId) refreshing = null
  }
}

export async function addFeed(input: string): Promise<NewsFeed> {
  let u = httpUrl(input)
  if (get('SELECT id FROM wg_feeds WHERE url = ?', u.href)) throw new Error('That feed is already in your list')
  let r = await fetchText(u.href)
  let parsed: ParsedFeed | null = null
  try {
    parsed = parseFeed(r.text, r.finalUrl)
  } catch {
    if (!looksLikeHtml(r)) throw new Error('That address is not an RSS or Atom feed')
    // A web page: follow its advertised feed.
    const found = discoverFeeds(r.text, r.finalUrl)
    if (!found.length) throw new Error('No RSS or Atom feed found on that page')
    u = new URL(found[0])
    if (get('SELECT id FROM wg_feeds WHERE url = ?', u.href)) throw new Error('That feed is already in your list')
    r = await fetchText(u.href)
    parsed = parseFeed(r.text, r.finalUrl)
  }
  const id = uid('f_')
  const sort = Number(get<{ n: number }>('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM wg_feeds')?.n ?? 0)
  run(
    'INSERT INTO wg_feeds(id, url, title, site_url, added_at, last_fetched, etag, last_modified, sort) VALUES(?,?,?,?,?,?,?,?,?)',
    id,
    u.href,
    (parsed.title || u.host).slice(0, 200),
    parsed.siteUrl,
    Date.now(),
    Date.now(),
    r.etag,
    r.lastModified,
    sort
  )
  storeItems(id, parsed)
  changed()
  const feed = listFeeds().find((f) => f.id === id)
  if (!feed) throw new Error('Feed could not be saved')
  return feed
}

export function removeFeed(id: string): void {
  run('DELETE FROM wg_items WHERE feed_id = ?', id)
  run('DELETE FROM wg_feeds WHERE id = ?', id)
  changed()
}

export function renameFeed(id: string, title: string): void {
  const t = String(title ?? '').trim().slice(0, 200)
  if (t) run('UPDATE wg_feeds SET title = ? WHERE id = ?', t, id)
  changed()
}

export function resetDefaultFeeds(): NewsFeed[] {
  const now = Date.now()
  DEFAULT_FEEDS.forEach((f, i) => run("INSERT OR IGNORE INTO wg_feeds(id, url, title, site_url, added_at, sort) VALUES(?,?,?,'',?,?)", uid('f_'), f.url, f.title, now, -10 + i))
  changed()
  return listFeeds()
}

type ItemRow = { id: string; feed_id: string; title: string; link: string; author: string | null; summary: string; published: number | null; fetched_at: number; read: number }

export function listItems(q: { feedId?: string; unreadOnly?: boolean; limit?: number }): NewsItem[] {
  const limit = Math.max(1, Math.min(500, Number(q?.limit) || 100))
  const where: string[] = []
  const params: unknown[] = []
  if (q?.feedId) {
    where.push('feed_id = ?')
    params.push(q.feedId)
  }
  if (q?.unreadOnly) where.push('read = 0')
  const rows = all<ItemRow>(
    `SELECT id, feed_id, title, link, author, summary, published, fetched_at, read FROM wg_items ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY COALESCE(published, fetched_at) DESC LIMIT ?`,
    ...params,
    limit
  )
  return rows.map((r) => ({ id: r.id, feedId: r.feed_id, title: r.title, link: r.link, author: r.author, summary: r.summary, published: r.published, fetchedAt: r.fetched_at, read: r.read === 1 }))
}

export function markRead(q: { ids?: string[]; feedId?: string; all?: boolean; read?: boolean }): void {
  const v = q?.read === false ? 0 : 1
  if (Array.isArray(q?.ids) && q.ids.length) {
    tx(() => {
      for (const id of q.ids!.slice(0, 1000)) run('UPDATE wg_items SET read = ? WHERE id = ?', v, String(id))
    })
  } else if (q?.feedId) run('UPDATE wg_items SET read = ? WHERE feed_id = ?', v, q.feedId)
  else if (q?.all) run('UPDATE wg_items SET read = ?', v)
  changed()
}
