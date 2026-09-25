// Registered projects (persistence + path validation). The list of project
// folders is the user-controlled `developer.projectRoots` setting; this table
// holds metadata and index statistics for each of them.
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { IndexState, IndexStats, ProjectKind } from '@shared/modules/developer'
import { all, get, json, registerMigrations, run } from '../../db'

registerMigrations('developer', [
  `
  CREATE TABLE dev_projects (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    kinds TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    added_at INTEGER NOT NULL,
    last_opened INTEGER,
    content_index INTEGER NOT NULL DEFAULT 0,
    index_state TEXT NOT NULL DEFAULT 'never',
    indexed_at INTEGER,
    file_count INTEGER NOT NULL DEFAULT 0,
    dir_count INTEGER NOT NULL DEFAULT 0,
    total_bytes INTEGER NOT NULL DEFAULT 0,
    content_count INTEGER NOT NULL DEFAULT 0,
    truncated INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    index_error TEXT
  );

  CREATE TABLE dev_files (
    id INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL,
    rel TEXT NOT NULL,
    name TEXT NOT NULL,
    ext TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    mtime INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_dev_files_project ON dev_files(project_id);
  CREATE VIRTUAL TABLE dev_files_fts USING fts5(name, rel, content='dev_files', content_rowid='id', tokenize='trigram');
  CREATE TRIGGER dev_files_ai AFTER INSERT ON dev_files BEGIN
    INSERT INTO dev_files_fts(rowid, name, rel) VALUES (new.id, new.name, new.rel);
  END;
  CREATE TRIGGER dev_files_ad AFTER DELETE ON dev_files BEGIN
    INSERT INTO dev_files_fts(dev_files_fts, rowid, name, rel) VALUES ('delete', old.id, old.name, old.rel);
  END;

  CREATE TABLE dev_content_map (
    id INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL,
    rel TEXT NOT NULL
  );
  CREATE INDEX idx_dev_content_project ON dev_content_map(project_id);
  CREATE VIRTUAL TABLE dev_content_fts USING fts5(body, tokenize="unicode61 tokenchars '_'");
  `
])

export interface ProjectRow {
  id: string
  path: string
  name: string
  kinds: string
  tags: string
  added_at: number
  last_opened: number | null
  content_index: number
  index_state: string
  indexed_at: number | null
  file_count: number
  dir_count: number
  total_bytes: number
  content_count: number
  truncated: number
  duration_ms: number
  index_error: string | null
}

export function normalizePath(p: string): string {
  let out = resolve(p)
  if (out.length > 3 && (out.endsWith(sep) || out.endsWith('/'))) out = out.slice(0, -1)
  return out
}

const pathKey = (p: string) => (process.platform === 'win32' ? normalizePath(p).toLowerCase() : normalizePath(p))

export function projectIdFor(path: string): string {
  return 'p' + createHash('sha1').update(pathKey(path)).digest('hex').slice(0, 11)
}

export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b)
}

export function listRows(): ProjectRow[] {
  return all<ProjectRow>('SELECT * FROM dev_projects ORDER BY COALESCE(last_opened, 0) DESC, name COLLATE NOCASE')
}

export function getRow(id: string): ProjectRow | undefined {
  return get<ProjectRow>('SELECT * FROM dev_projects WHERE id = ?', id)
}

export function requireRow(id: string): ProjectRow {
  const r = typeof id === 'string' ? getRow(id) : undefined
  if (!r) throw new Error('Unknown project')
  return r
}

export function rowStats(r: ProjectRow): IndexStats {
  return {
    state: r.index_state as IndexState,
    files: r.file_count,
    dirs: r.dir_count,
    bytes: r.total_bytes,
    contentFiles: r.content_count,
    truncated: !!r.truncated,
    durationMs: r.duration_ms,
    indexedAt: r.indexed_at,
    error: r.index_error ?? undefined
  }
}

export function rowKinds(r: ProjectRow): ProjectKind[] {
  return json<ProjectKind[]>(r.kinds, [])
}

export function insertRow(id: string, path: string, name: string, kinds: string[], tags: string[]): void {
  run(
    'INSERT INTO dev_projects(id, path, name, kinds, tags, added_at) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
    id,
    path,
    name,
    JSON.stringify(kinds),
    JSON.stringify(tags),
    Date.now()
  )
}

export function updateDetection(id: string, name: string, kinds: string[], tags: string[]): void {
  run('UPDATE dev_projects SET name = ?, kinds = ?, tags = ? WHERE id = ?', name, JSON.stringify(kinds), JSON.stringify(tags), id)
}

export function setIndexState(id: string, state: IndexState, error?: string | null): void {
  run('UPDATE dev_projects SET index_state = ?, index_error = ? WHERE id = ?', state, error ?? null, id)
}

/**
 * Resolves `rel` inside the project and verifies (lexically and after
 * resolving symlinks/junctions) that the result does not escape the project.
 */
export function resolveInProject(id: string, rel: string): { root: string; abs: string; rel: string } {
  const row = requireRow(id)
  const root = row.path
  if (typeof rel !== 'string' || rel.includes('\0')) throw new Error('Invalid path')
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  if (isAbsolute(cleaned)) throw new Error('Path must be relative to the project')
  const abs = resolve(root, cleaned)
  const within = (base: string, target: string) => {
    const r = relative(base, target)
    return r === '' || (!r.startsWith('..') && !isAbsolute(r))
  }
  if (!within(root, abs)) throw new Error('Path is outside the project')
  try {
    const realRoot = realpathSync.native(root)
    const realAbs = realpathSync.native(abs)
    if (!within(realRoot, realAbs)) throw new Error('Path resolves outside the project')
  } catch (err) {
    if (err instanceof Error && /outside/.test(err.message)) throw err
    // Non-existent paths are fine lexically (e.g. deleted files in a diff).
  }
  return { root, abs, rel: relative(root, abs).split(sep).join('/') }
}
