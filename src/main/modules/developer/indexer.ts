// Local project indexer. Walks a registered project folder (asynchronously,
// in small batches so the main process stays responsive), honours ignore
// rules, and stores filenames — and, when the user opts in for a project,
// text file contents — in SQLite FTS5 tables. Nothing leaves the machine.
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ContentHit, FileContent, FileHit, IndexProgress, IndexState, TreeEntry } from '@shared/modules/developer'
import { all, get, run, tx } from '../../db'
import { broadcast } from '../../ipc'
import { createLogger } from '../../logger'
import { isDefaultIgnored, isIgnored, isTextCandidate, looksBinary, matchRules, parseGitignore, type IgnoreRule } from './ignore'
import { getRow, requireRow, resolveInProject, setIndexState } from './registry'

const log = createLogger('developer.index')

export const MAX_FILES = 50_000
export const MAX_CONTENT_FILE_BYTES = 512 * 1024
const MAX_CONTENT_FILES = 20_000
const MAX_CONTENT_TOTAL = 256 * 1024 * 1024
const BATCH = 400

const yieldToLoop = () => new Promise<void>((r) => setImmediate(r))

interface Job {
  projectId: string
  cancelled: boolean
}

const queue: string[] = []
let current: Job | null = null
const onDoneListeners = new Set<(projectId: string, state: IndexState) => void>()

export function onIndexDone(fn: (projectId: string, state: IndexState) => void): () => void {
  onDoneListeners.add(fn)
  return () => onDoneListeners.delete(fn)
}

export function isIndexing(projectId: string): boolean {
  return current?.projectId === projectId || queue.includes(projectId)
}

export function enqueueIndex(projectId: string): void {
  if (current?.projectId === projectId) {
    // Restart with fresh settings (e.g. content indexing toggled).
    current.cancelled = true
    if (!queue.includes(projectId)) queue.push(projectId)
    return
  }
  if (queue.includes(projectId)) return
  queue.push(projectId)
  setIndexState(projectId, 'queued')
  progress({ projectId, state: 'queued', files: 0, dirs: 0, contentFiles: 0, phase: 'files' }, true)
  void pump()
}

export function cancelIndex(projectId: string): void {
  const qi = queue.indexOf(projectId)
  if (qi >= 0) {
    queue.splice(qi, 1)
    const row = getRow(projectId)
    setIndexState(projectId, row?.indexed_at ? 'ready' : 'cancelled')
    progress({ projectId, state: row?.indexed_at ? 'ready' : 'cancelled', files: row?.file_count ?? 0, dirs: row?.dir_count ?? 0, contentFiles: row?.content_count ?? 0, phase: 'done' }, true)
  }
  if (current?.projectId === projectId) current.cancelled = true
}

export function cancelAllIndexing(): void {
  queue.length = 0
  if (current) current.cancelled = true
}

let lastProgress = 0
function progress(p: IndexProgress, force = false): void {
  const now = Date.now()
  if (!force && now - lastProgress < 200) return
  lastProgress = now
  broadcast('projects:indexProgress', p)
}

let pumping = false
async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    while (queue.length) {
      const projectId = queue.shift()!
      if (!getRow(projectId)) continue
      const job: Job = { projectId, cancelled: false }
      current = job
      let state: IndexState = 'ready'
      try {
        state = await indexProject(job)
      } catch (err) {
        state = 'error'
        log.error('index failed', err)
        setIndexState(projectId, 'error', err instanceof Error ? err.message : String(err))
      }
      current = null
      const row = getRow(projectId)
      // Removed while indexing: its last batches were written after the removal cleared the index.
      if (!row) await clearIndex(projectId).catch((err) => log.warn('index cleanup failed', err))
      progress({ projectId, state, files: row?.file_count ?? 0, dirs: row?.dir_count ?? 0, contentFiles: row?.content_count ?? 0, phase: 'done' }, true)
      for (const l of onDoneListeners) l(projectId, state)
    }
  } finally {
    pumping = false
  }
}

/** Deletes a project's index rows in small batches (keeps the UI responsive). */
export async function clearIndex(projectId: string): Promise<void> {
  for (;;) {
    const n = run('DELETE FROM dev_files WHERE id IN (SELECT id FROM dev_files WHERE project_id = ? LIMIT 500)', projectId).changes
    if (n === 0) break
    await yieldToLoop()
  }
  await clearContent(projectId)
}

async function clearContent(projectId: string): Promise<void> {
  for (;;) {
    const ids = all<{ id: number }>('SELECT id FROM dev_content_map WHERE project_id = ? LIMIT 500', projectId)
    if (!ids.length) break
    tx(() => {
      for (const { id } of ids) {
        run('DELETE FROM dev_content_fts WHERE rowid = ?', id)
        run('DELETE FROM dev_content_map WHERE id = ?', id)
      }
    })
    await yieldToLoop()
  }
}

interface FileRec {
  rel: string
  name: string
  ext: string
  size: number
  mtime: number
}

async function loadGitignore(abs: string, relDir: string): Promise<IgnoreRule[]> {
  try {
    const st = await stat(join(abs, '.gitignore'))
    if (!st.isFile() || st.size > 512 * 1024) return []
    return parseGitignore(await readFile(join(abs, '.gitignore'), 'utf8'), relDir)
  } catch {
    return []
  }
}

async function indexProject(job: Job): Promise<IndexState> {
  const row = requireRow(job.projectId)
  const root = row.path
  const t0 = Date.now()
  setIndexState(job.projectId, 'indexing')
  try {
    const st = await stat(root)
    if (!st.isDirectory()) throw new Error('Not a folder')
  } catch {
    setIndexState(job.projectId, 'error', 'Folder not found')
    return 'error'
  }

  await clearIndex(job.projectId)
  run('UPDATE dev_projects SET file_count = 0, dir_count = 0, total_bytes = 0, content_count = 0, truncated = 0 WHERE id = ?', job.projectId)

  let files = 0
  let dirs = 0
  let bytes = 0
  let truncated = false
  let batch: FileRec[] = []
  const flush = () => {
    if (!batch.length) return
    const b = batch.splice(0, BATCH)
    tx(() => {
      for (const f of b) run('INSERT INTO dev_files(project_id, rel, name, ext, size, mtime) VALUES(?, ?, ?, ?, ?, ?)', job.projectId, f.rel, f.name, f.ext, f.size, f.mtime)
    })
  }
  // Writes full batches, yielding to the event loop between transactions.
  const drain = async (all = false) => {
    while (batch.length >= BATCH || (all && batch.length)) {
      flush()
      await yieldToLoop()
    }
  }

  // Iterative DFS; each stack entry carries the gitignore rules in effect.
  const stack: { abs: string; rel: string; rules: IgnoreRule[] }[] = [{ abs: root, rel: '', rules: await loadGitignore(root, '') }]
  while (stack.length && !job.cancelled && !truncated) {
    const dir = stack.pop()!
    let entries
    try {
      entries = await readdir(dir.abs, { withFileTypes: true })
    } catch {
      continue
    }
    dirs++
    // Large folders are processed in slices so no single step blocks the main process.
    for (let start = 0; start < entries.length && !truncated && !job.cancelled; start += 256) {
      const fileEntries: FileRec[] = []
      const statJobs: Promise<void>[] = []
      for (const e of entries.slice(start, start + 256)) {
        if (e.isSymbolicLink()) continue // avoid cycles and escaping the project
        const rel = dir.rel ? dir.rel + '/' + e.name : e.name
        const isDir = e.isDirectory()
        if (!isDir && !e.isFile()) continue
        if (isDefaultIgnored(e.name, isDir) || matchRules(rel, isDir, dir.rules)) continue
        const abs = join(dir.abs, e.name)
        if (isDir) {
          const nested = await loadGitignore(abs, rel)
          stack.push({ abs, rel, rules: nested.length ? [...dir.rules, ...nested] : dir.rules })
        } else {
          if (files + fileEntries.length >= MAX_FILES) {
            truncated = true
            break
          }
          const dot = e.name.lastIndexOf('.')
          const rec: FileRec = { rel, name: e.name, ext: dot > 0 ? e.name.slice(dot + 1).toLowerCase() : '', size: 0, mtime: 0 }
          fileEntries.push(rec)
          statJobs.push(
            stat(abs).then(
              (s) => {
                rec.size = s.size
                rec.mtime = Math.floor(s.mtimeMs)
              },
              () => undefined
            )
          )
        }
      }
      await Promise.all(statJobs)
      for (const f of fileEntries) {
        bytes += f.size
        batch.push(f)
      }
      files += fileEntries.length
      await drain()
    }
    progress({ projectId: job.projectId, state: 'indexing', files, dirs, contentFiles: 0, phase: 'files', current: dir.rel || '.' })
  }
  await drain(true)

  if (job.cancelled) {
    run('UPDATE dev_projects SET file_count = ?, dir_count = ?, total_bytes = ?, truncated = 1, duration_ms = ? WHERE id = ?', files, dirs, bytes, Date.now() - t0, job.projectId)
    setIndexState(job.projectId, 'cancelled')
    return 'cancelled'
  }

  run('UPDATE dev_projects SET file_count = ?, dir_count = ?, total_bytes = ?, truncated = ?, indexed_at = ?, duration_ms = ? WHERE id = ?', files, dirs, bytes, truncated ? 1 : 0, Date.now(), Date.now() - t0, job.projectId)

  // Optional content indexing (opt-in per project).
  let contentFiles = 0
  if (getRow(job.projectId)?.content_index) {
    let total = 0
    let lastId = 0
    outer: for (;;) {
      const chunk = all<{ id: number; rel: string; name: string; size: number }>('SELECT id, rel, name, size FROM dev_files WHERE project_id = ? AND id > ? ORDER BY id LIMIT 200', job.projectId, lastId)
      if (!chunk.length) break
      lastId = chunk[chunk.length - 1].id
      let docs: { rel: string; body: string }[] = []
      let docBytes = 0
      // Small transactions (≈1 MB of text) keep FTS tokenizing from blocking the main process.
      const commit = async () => {
        if (!docs.length) return
        const d = docs
        docs = []
        docBytes = 0
        tx(() => {
          for (const doc of d) {
            const id = run('INSERT INTO dev_content_map(project_id, rel) VALUES(?, ?)', job.projectId, doc.rel).lastInsertRowid
            run('INSERT INTO dev_content_fts(rowid, body) VALUES(?, ?)', id, doc.body)
          }
        })
        contentFiles += d.length
        await yieldToLoop()
      }
      for (const f of chunk) {
        if (job.cancelled) break outer
        if (f.size === 0 || f.size > MAX_CONTENT_FILE_BYTES || !isTextCandidate(f.name)) continue
        if (contentFiles + docs.length >= MAX_CONTENT_FILES || total + f.size > MAX_CONTENT_TOTAL) {
          await commit()
          break outer
        }
        try {
          const buf = await readFile(join(root, f.rel))
          if (looksBinary(buf)) continue
          total += buf.length
          docBytes += buf.length
          docs.push({ rel: f.rel, body: buf.toString('utf8') })
          if (docBytes > 1024 * 1024 || docs.length >= 100) await commit()
        } catch {
          /* unreadable — skip */
        }
      }
      await commit()
      progress({ projectId: job.projectId, state: 'indexing', files, dirs, contentFiles, phase: 'content' })
    }
  }
  run('UPDATE dev_projects SET content_count = ?, duration_ms = ? WHERE id = ?', contentFiles, Date.now() - t0, job.projectId)
  if (job.cancelled) {
    setIndexState(job.projectId, 'cancelled')
    return 'cancelled'
  }
  setIndexState(job.projectId, 'ready')
  log.info(`indexed ${row.name}: ${files} files, ${dirs} dirs, ${contentFiles} content files in ${Date.now() - t0} ms`)
  return 'ready'
}

// Search ---------------------------------------------------------------------------------

const ftsPhrase = (s: string) => '"' + s.replace(/"/g, '""') + '"'

interface FileRow {
  project_id: string
  project_name: string
  rel: string
  name: string
  size: number
  mtime: number
}

export function searchFiles(query: string, opts: { projectId?: string; limit?: number } = {}): FileHit[] {
  const q = String(query ?? '').trim().replace(/\\/g, '/')
  if (!q) return []
  const limit = Math.max(1, Math.min(200, opts.limit ?? 30))
  const terms = q.split(/\s+/).filter(Boolean)
  const long = terms.filter((t) => t.length >= 3)
  const short = terms.filter((t) => t.length < 3).map((t) => t.toLowerCase())
  let rows: FileRow[]
  const projectFilter = opts.projectId ? ' AND f.project_id = ?' : ''
  const params: unknown[] = []
  if (long.length) {
    params.push(long.map(ftsPhrase).join(' '))
    if (opts.projectId) params.push(opts.projectId)
    params.push(limit * 8)
    rows = all<FileRow>(
      `SELECT f.project_id, p.name AS project_name, f.rel, f.name, f.size, f.mtime
       FROM dev_files_fts JOIN dev_files f ON f.id = dev_files_fts.rowid JOIN dev_projects p ON p.id = f.project_id
       WHERE dev_files_fts MATCH ?${projectFilter} ORDER BY rank LIMIT ?`,
      ...params
    )
  } else {
    params.push('%' + short[0].replace(/[%_]/g, (m) => '\\' + m) + '%')
    if (opts.projectId) params.push(opts.projectId)
    params.push(limit * 8)
    rows = all<FileRow>(
      `SELECT f.project_id, p.name AS project_name, f.rel, f.name, f.size, f.mtime
       FROM dev_files f JOIN dev_projects p ON p.id = f.project_id
       WHERE f.name LIKE ? ESCAPE '\\'${projectFilter} LIMIT ?`,
      ...params
    )
  }
  const lowTerms = terms.map((t) => t.toLowerCase())
  const scored = rows
    .filter((r) => short.every((s) => r.rel.toLowerCase().includes(s)))
    .map((r) => {
      const name = r.name.toLowerCase()
      const rel = r.rel.toLowerCase()
      let score = 0
      for (const t of lowTerms) {
        if (name === t) score += 100
        else if (name.startsWith(t)) score += 60
        else if (name.includes(t)) score += 40
        else if (rel.includes(t)) score += 10
      }
      score -= rel.split('/').length * 2 + rel.length / 40
      return { r, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  return scored.map(({ r }) => ({ projectId: r.project_id, projectName: r.project_name, rel: r.rel, name: r.name, size: r.size, mtime: r.mtime }))
}

export function searchContent(query: string, opts: { projectId?: string; limit?: number } = {}): ContentHit[] {
  const terms = String(query ?? '')
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_]+/gu, ''))
    .filter(Boolean)
  if (!terms.length) return []
  const match = terms.map((t) => ftsPhrase(t) + '*').join(' ')
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50))
  const rows = all<{ project_id: string; project_name: string; rel: string; snip: string }>(
    `SELECT m.project_id, p.name AS project_name, m.rel, snippet(dev_content_fts, 0, char(1), char(2), '…', 16) AS snip
     FROM dev_content_fts JOIN dev_content_map m ON m.id = dev_content_fts.rowid JOIN dev_projects p ON p.id = m.project_id
     WHERE dev_content_fts MATCH ?${opts.projectId ? ' AND m.project_id = ?' : ''} ORDER BY rank LIMIT ?`,
    ...(opts.projectId ? [match, opts.projectId, limit] : [match, limit])
  )
  return rows.map((r) => ({ projectId: r.project_id, projectName: r.project_name, rel: r.rel, snippet: r.snip.replace(/\s+/g, ' ') }))
}

export function languageStats(projectId: string): { ext: string; files: number }[] {
  return all<{ ext: string; files: number }>("SELECT ext, COUNT(*) AS files FROM dev_files WHERE project_id = ? AND ext != '' GROUP BY ext ORDER BY files DESC LIMIT 12", projectId)
}

export function totalIndexedFiles(): number {
  return get<{ n: number }>('SELECT COUNT(*) AS n FROM dev_files')?.n ?? 0
}

// Live tree + file reads (always from disk, confined to the project) ------------------

export async function listTree(projectId: string, rel: string): Promise<TreeEntry[]> {
  const { root, abs, rel: cleanRel } = resolveInProject(projectId, rel || '')
  // Rules from every .gitignore between the root and this folder.
  const parts = cleanRel ? cleanRel.split('/') : []
  let rules: IgnoreRule[] = await loadGitignore(root, '')
  for (let i = 0; i < parts.length; i++) {
    const sub = parts.slice(0, i + 1).join('/')
    rules = rules.concat(await loadGitignore(join(root, sub), sub))
  }
  const entries = await readdir(abs, { withFileTypes: true })
  const out: TreeEntry[] = []
  await Promise.all(
    entries.map(async (e) => {
      if (e.name === '.git') return
      const isDir = e.isDirectory()
      if (!isDir && !e.isFile()) return
      const childRel = cleanRel ? cleanRel + '/' + e.name : e.name
      let size = 0
      let mtime = 0
      if (!isDir) {
        try {
          const s = await stat(join(abs, e.name))
          size = s.size
          mtime = s.mtimeMs
        } catch {
          /* ignore */
        }
      }
      out.push({ name: e.name, rel: childRel, dir: isDir, size, mtime, ignored: isIgnored(childRel, isDir, rules) })
    })
  )
  return out.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })))
}

const MAX_VIEW_BYTES = 1024 * 1024

export async function readProjectFile(projectId: string, rel: string): Promise<FileContent> {
  const { abs, rel: cleanRel } = resolveInProject(projectId, rel)
  const st = await stat(abs)
  if (!st.isFile()) throw new Error('Not a file')
  const fh = await open(abs, 'r')
  try {
    const len = Math.min(st.size, MAX_VIEW_BYTES)
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, 0)
    if (looksBinary(buf)) return { rel: cleanRel, size: st.size, binary: true, truncated: false, text: '' }
    return { rel: cleanRel, size: st.size, binary: false, truncated: st.size > MAX_VIEW_BYTES, text: buf.toString('utf8') }
  } finally {
    await fh.close()
  }
}
