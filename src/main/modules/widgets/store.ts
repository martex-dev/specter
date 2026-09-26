// Widgets — SQLite schema and the small key-value store used by the simple
// widgets (saved places, clocks, sticky notes, countdowns, preferences).
import { WIDGET_KV_KEYS, type WidgetKvKey } from '@shared/modules/widgets'
import { get, json, registerMigrations, run } from '../../db'
import { broadcast } from '../../ipc'

registerMigrations('widgets', [
  `
  CREATE TABLE wg_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE wg_feeds (
    id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, site_url TEXT NOT NULL DEFAULT '',
    added_at INTEGER NOT NULL, last_fetched INTEGER, last_error TEXT, etag TEXT, last_modified TEXT, sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE wg_items (
    id TEXT PRIMARY KEY, feed_id TEXT NOT NULL REFERENCES wg_feeds(id) ON DELETE CASCADE, guid TEXT NOT NULL,
    title TEXT NOT NULL, link TEXT NOT NULL, author TEXT, summary TEXT NOT NULL, published INTEGER,
    fetched_at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0, UNIQUE(feed_id, guid)
  );
  CREATE INDEX idx_wg_items_feed ON wg_items(feed_id, read);
  CREATE TABLE wg_events (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, start_at INTEGER NOT NULL, end_at INTEGER NOT NULL, all_day INTEGER NOT NULL,
    color TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', remind_min INTEGER,
    source TEXT NOT NULL, uid TEXT UNIQUE, notified_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_wg_events_start ON wg_events(start_at);
  CREATE TABLE wg_speed (id TEXT PRIMARY KEY, at INTEGER NOT NULL, data TEXT NOT NULL);
  `
])

const MAX_VALUE_BYTES = 1024 * 1024
const listeners = new Map<WidgetKvKey, Set<() => void>>()

export function isKvKey(k: unknown): k is WidgetKvKey {
  return typeof k === 'string' && (WIDGET_KV_KEYS as readonly string[]).includes(k)
}

export function kvGet<T>(key: WidgetKvKey, fallback: T): T {
  const row = get<{ value: string }>('SELECT value FROM wg_kv WHERE key = ?', key)
  return json<T>(row?.value, fallback)
}

export function kvSet(key: WidgetKvKey, value: unknown): void {
  const s = JSON.stringify(value ?? null)
  if (s.length > MAX_VALUE_BYTES) throw new Error('Value too large')
  run('INSERT INTO wg_kv(key, value, updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', key, s, Date.now())
  broadcast('widgets:kvChanged', { key })
  listeners.get(key)?.forEach((fn) => {
    try {
      fn()
    } catch {
      /* ignore */
    }
  })
}

export function onKvChanged(key: WidgetKvKey, fn: () => void): void {
  let set = listeners.get(key)
  if (!set) listeners.set(key, (set = new Set()))
  set.add(fn)
}
