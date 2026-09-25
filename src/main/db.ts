// SQLite storage (Node's built-in node:sqlite, no native modules).
// Every module registers its own ordered migrations; versions are tracked per
// module so features can evolve independently.
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createLogger } from './logger'

const log = createLogger('db')

let db: DatabaseSync | null = null
const pendingMigrations: { module: string; steps: string[] }[] = []
const stmtCache = new Map<string, StatementSync>()

export function openDatabase(file: string): DatabaseSync {
  mkdirSync(dirname(file), { recursive: true })
  db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;')
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)')
  for (const m of pendingMigrations) runMigrations(m.module, m.steps)
  pendingMigrations.length = 0
  return db
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('Database not opened')
  return db
}

export function isDbOpen(): boolean {
  return db !== null
}

export function closeDatabase(): void {
  stmtCache.clear()
  try {
    db?.close()
  } catch {
    /* ignore */
  }
  db = null
}

/** Registers migrations for a module. Each string is one migration step. */
export function registerMigrations(module: string, steps: string[]): void {
  if (db) runMigrations(module, steps)
  else pendingMigrations.push({ module, steps })
}

function runMigrations(module: string, steps: string[]): void {
  const d = getDb()
  const row = d.prepare('SELECT value FROM meta WHERE key = ?').get('schema:' + module) as { value: string } | undefined
  let version = row ? Number(row.value) : 0
  while (version < steps.length) {
    const sql = steps[version]
    d.exec('BEGIN')
    try {
      d.exec(sql)
      version++
      d.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('schema:' + module, String(version))
      d.exec('COMMIT')
      log.info(`migrated ${module} to v${version}`)
    } catch (err) {
      d.exec('ROLLBACK')
      log.error(`migration ${module} v${version + 1} failed`, err)
      throw err
    }
  }
}

/** Cached prepared statement. */
export function stmt(sql: string): StatementSync {
  let s = stmtCache.get(sql)
  if (!s) {
    s = getDb().prepare(sql)
    stmtCache.set(sql, s)
  }
  return s
}

export function all<T>(sql: string, ...params: any[]): T[] {
  return stmt(sql).all(...params) as T[]
}

export function get<T>(sql: string, ...params: any[]): T | undefined {
  return stmt(sql).get(...params) as T | undefined
}

export function run(sql: string, ...params: any[]): { changes: number; lastInsertRowid: number } {
  const r = stmt(sql).run(...params)
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
}

export function tx<T>(fn: () => T): T {
  const d = getDb()
  d.exec('BEGIN')
  try {
    const out = fn()
    d.exec('COMMIT')
    return out
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }
}

export function metaGet(key: string): string | undefined {
  return get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)?.value
}

export function metaSet(key: string, value: string): void {
  run('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value)
}

export function json<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

export function uid(prefix = ''): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// Core schema -----------------------------------------------------------------

registerMigrations('core', [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE profiles (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, partition TEXT NOT NULL, created_at INTEGER NOT NULL
  );

  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, name TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, state TEXT NOT NULL
  );
  CREATE INDEX idx_workspaces_profile ON workspaces(profile_id);

  CREATE TABLE workspace_snapshots (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    label TEXT NOT NULL, created_at INTEGER NOT NULL, tab_count INTEGER NOT NULL, state TEXT NOT NULL
  );
  CREATE INDEX idx_snapshots_ws ON workspace_snapshots(workspace_id, created_at);

  CREATE TABLE saved_layouts (id TEXT PRIMARY KEY, name TEXT NOT NULL, layout TEXT NOT NULL, urls TEXT NOT NULL);

  CREATE TABLE window_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT NOT NULL, open_workspaces TEXT NOT NULL,
    active_workspace TEXT NOT NULL, bounds TEXT, maximized INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
  );

  CREATE TABLE history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
    visited_at INTEGER NOT NULL, workspace_id TEXT, profile_id TEXT NOT NULL, domain TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_history_visited ON history(visited_at);
  CREATE INDEX idx_history_url ON history(url);
  CREATE INDEX idx_history_domain ON history(domain);
  CREATE VIRTUAL TABLE history_fts USING fts5(title, url, content='history', content_rowid='id', tokenize='unicode61');
  CREATE TRIGGER history_ai AFTER INSERT ON history BEGIN
    INSERT INTO history_fts(rowid, title, url) VALUES (new.id, new.title, new.url);
  END;
  CREATE TRIGGER history_ad AFTER DELETE ON history BEGIN
    INSERT INTO history_fts(history_fts, rowid, title, url) VALUES('delete', old.id, old.title, old.url);
  END;
  CREATE TRIGGER history_au AFTER UPDATE ON history BEGIN
    INSERT INTO history_fts(history_fts, rowid, title, url) VALUES('delete', old.id, old.title, old.url);
    INSERT INTO history_fts(rowid, title, url) VALUES (new.id, new.title, new.url);
  END;

  CREATE TABLE searches (id INTEGER PRIMARY KEY AUTOINCREMENT, query TEXT NOT NULL, ts INTEGER NOT NULL);

  CREATE TABLE bookmarks (
    id TEXT PRIMARY KEY, parent_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, url TEXT,
    tags TEXT NOT NULL DEFAULT '[]', workspace_id TEXT, sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, favicon TEXT, profile_id TEXT NOT NULL
  );
  CREATE INDEX idx_bookmarks_parent ON bookmarks(parent_id, sort);
  CREATE INDEX idx_bookmarks_url ON bookmarks(url);

  CREATE TABLE downloads (
    id TEXT PRIMARY KEY, url TEXT NOT NULL, filename TEXT NOT NULL, save_path TEXT NOT NULL, mime TEXT NOT NULL DEFAULT '',
    total_bytes INTEGER NOT NULL DEFAULT 0, received_bytes INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL,
    started_at INTEGER NOT NULL, ended_at INTEGER
  );

  CREATE TABLE permissions (
    origin TEXT NOT NULL, permission TEXT NOT NULL, decision TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (origin, permission)
  );

  CREATE TABLE closed_tabs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, title TEXT NOT NULL, favicon TEXT,
    workspace_id TEXT, closed_at INTEGER NOT NULL, idx INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE notifications (
    id TEXT PRIMARY KEY, category TEXT NOT NULL, title TEXT NOT NULL, body TEXT, created_at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0
  );
  `
])
