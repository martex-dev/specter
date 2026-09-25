// Local knowledge base: documents are chunked (~800 chars, overlapping),
// stored in SQLite with FTS5 keyword search and — when the user opted in and
// Ollama is reachable — float32 embeddings for hybrid semantic ranking.
import {
  chunkText,
  ftsMatch,
  hybridRank,
  normalizeText,
  topKCosine,
  type KbDoc,
  type KbDocFull,
  type KbDocInput,
  type KbDocKind,
  type KbHit,
  type KbSearchResult
} from '@shared/modules/knowledge'
import { all, get, run, tx, uid } from '../../db'
import { broadcast } from '../../ipc'
import { activeProfileId } from '../../services/profiles'
import { createLogger } from '../../logger'
import { embed, embeddingModel, fromBlob, semanticStatus, toBlob } from './embeddings'

const log = createLogger('knowledge')

type DocRow = {
  id: string
  kind: KbDocKind
  title: string
  url: string
  workspace_id: string | null
  ref_id: string | null
  created_at: number
  updated_at: number
  chars: number
  chunks: number
  embedded: number
}

const DOC_COLS = `d.id, d.kind, d.title, d.url, d.workspace_id, d.ref_id, d.created_at, d.updated_at, length(d.text) AS chars,
  (SELECT COUNT(*) FROM kb_chunks c WHERE c.doc_id = d.id) AS chunks,
  (SELECT COUNT(*) FROM kb_chunks c WHERE c.doc_id = d.id AND c.embedding IS NOT NULL) AS embedded`

function toDoc(r: DocRow): KbDoc {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    url: r.url,
    workspaceId: r.workspace_id,
    refId: r.ref_id,
    chars: Number(r.chars),
    chunks: Number(r.chunks),
    embedded: Number(r.embedded),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at)
  }
}

export function getDoc(id: string): KbDocFull | null {
  const r = get<DocRow & { text: string }>(`SELECT ${DOC_COLS}, d.text FROM kb_docs d WHERE d.id = ? AND d.profile_id = ?`, id, activeProfileId())
  return r ? { ...toDoc(r), text: r.text } : null
}

export function listDocs(q: { kind?: KbDocKind; limit?: number }): KbDoc[] {
  const limit = Math.min(q.limit ?? 500, 2000)
  const rows = q.kind
    ? all<DocRow>(`SELECT ${DOC_COLS} FROM kb_docs d WHERE d.profile_id = ? AND d.kind = ? ORDER BY d.updated_at DESC LIMIT ?`, activeProfileId(), q.kind, limit)
    : all<DocRow>(`SELECT ${DOC_COLS} FROM kb_docs d WHERE d.profile_id = ? ORDER BY d.updated_at DESC LIMIT ?`, activeProfileId(), limit)
  return rows.map(toDoc)
}

/**
 * Stores (or updates) a document and re-chunks it when its text changed.
 * Pages are de-duplicated by URL, notes/sources by ref id.
 */
export function saveDoc(input: KbDocInput): KbDoc {
  const text = normalizeText(input.text ?? '')
  const title = (input.title || input.url || 'Untitled').trim().slice(0, 500)
  const url = (input.url ?? '').trim()
  const now = Date.now()
  const profile = activeProfileId()
  let existing: { id: string; text: string; title: string } | undefined
  if (input.refId) existing = get('SELECT id, text, title FROM kb_docs WHERE profile_id = ? AND ref_id = ? AND kind = ?', profile, input.refId, input.kind)
  else if (url && (input.kind === 'page' || input.kind === 'source')) existing = get('SELECT id, text, title FROM kb_docs WHERE profile_id = ? AND url = ? AND kind = ?', profile, url, input.kind)

  const id = existing?.id ?? uid('kb_')
  tx(() => {
    if (existing) {
      run('UPDATE kb_docs SET title = ?, url = ?, text = ?, workspace_id = COALESCE(?, workspace_id), updated_at = ? WHERE id = ?', title, url, text, input.workspaceId ?? null, now, id)
    } else {
      run(
        'INSERT INTO kb_docs(id, profile_id, kind, title, url, text, workspace_id, ref_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id,
        profile,
        input.kind,
        title,
        url,
        text,
        input.workspaceId ?? null,
        input.refId ?? null,
        now,
        now
      )
    }
    if (!existing || existing.text !== text || existing.title !== title) {
      run('DELETE FROM kb_chunks WHERE doc_id = ?', id)
      const chunks = chunkText(text)
      chunks.forEach((c, i) => run('INSERT INTO kb_chunks(doc_id, idx, title, text) VALUES (?, ?, ?, ?)', id, i, title, c))
      // Title-only documents stay searchable by title.
      if (!chunks.length) run('INSERT INTO kb_chunks(doc_id, idx, title, text) VALUES (?, 0, ?, ?)', id, title, title)
      vectorCache = null
    }
  })
  broadcast('knowledge:changed', { docId: id })
  scheduleEmbedding()
  return getDocMeta(id)!
}

function getDocMeta(id: string): KbDoc | null {
  const r = get<DocRow>(`SELECT ${DOC_COLS} FROM kb_docs d WHERE d.id = ?`, id)
  return r ? toDoc(r) : null
}

export function deleteDoc(id: string): void {
  run('DELETE FROM kb_docs WHERE id = ? AND profile_id = ?', id, activeProfileId())
  vectorCache = null
  broadcast('knowledge:changed', { docId: id })
}

export function deleteDocByRef(kind: KbDocKind, refId: string): void {
  const r = run('DELETE FROM kb_docs WHERE kind = ? AND ref_id = ? AND profile_id = ?', kind, refId, activeProfileId())
  if (r.changes) {
    vectorCache = null
    broadcast('knowledge:changed', {})
  }
}

// ------------------------------------------------------------------ search

type ChunkHitRow = { id: number; doc_id: string; bm25: number; snip: string }

function keywordSearch(text: string, limit: number): ChunkHitRow[] {
  const profile = activeProfileId()
  const q = (match: string) =>
    all<ChunkHitRow>(
      `SELECT c.id, c.doc_id, bm25(kb_chunks_fts, 2.0, 1.0) AS bm25,
         snippet(kb_chunks_fts, 1, char(1), char(2), '…', 28) AS snip
       FROM kb_chunks_fts JOIN kb_chunks c ON c.id = kb_chunks_fts.rowid JOIN kb_docs d ON d.id = c.doc_id
       WHERE kb_chunks_fts MATCH ? AND d.profile_id = ?
       ORDER BY bm25 LIMIT ?`,
      match,
      profile,
      limit
    )
  const strict = ftsMatch(text)
  if (!strict) return []
  try {
    const rows = q(strict)
    if (rows.length) return rows
    const loose = ftsMatch(text, true)
    return loose && loose !== strict ? q(loose) : rows
  } catch (err) {
    log.warn('fts query failed', err)
    return []
  }
}

let vectorCache: { model: string; profile: string; vecs: { id: number; vec: Float32Array }[] } | null = null

function loadVectors(model: string): { id: number; vec: Float32Array }[] {
  const profile = activeProfileId()
  if (vectorCache && vectorCache.model === model && vectorCache.profile === profile) return vectorCache.vecs
  const rows = all<{ id: number; embedding: Uint8Array }>(
    'SELECT c.id, c.embedding FROM kb_chunks c JOIN kb_docs d ON d.id = c.doc_id WHERE d.profile_id = ? AND c.model = ? AND c.embedding IS NOT NULL',
    profile,
    model
  )
  const vecs = rows.map((r) => ({ id: Number(r.id), vec: fromBlob(r.embedding) }))
  vectorCache = { model, profile, vecs }
  return vecs
}

export async function searchKb(q: { text: string; limit?: number; mode?: 'auto' | 'keyword' }): Promise<KbSearchResult> {
  const t0 = Date.now()
  const text = (q.text ?? '').trim()
  const limit = Math.min(q.limit ?? 20, 100)
  if (!text) return { mode: 'keyword', hits: [], tookMs: 0 }
  const kw = keywordSearch(text, 200)
  let semantic: { id: number; cos: number }[] = []
  let mode: KbSearchResult['mode'] = 'keyword'
  let reason: string | undefined
  if (q.mode === 'keyword') reason = 'Keyword search requested'
  else {
    const st = await semanticStatus()
    if (!st.available) reason = st.reason
    else {
      const vecs = loadVectors(st.model)
      if (!vecs.length) reason = 'No embeddings built yet — keyword results only'
      else {
        try {
          const [qv] = await embed([text], 'query')
          semantic = topKCosine(qv, vecs, 200)
          mode = 'hybrid'
        } catch (err: any) {
          reason = `Embedding the query failed (${err?.message ?? err}) — keyword results only`
        }
      }
    }
  }
  const ranked = hybridRank({ keyword: kw.map((k) => ({ id: Number(k.id), bm25: Number(k.bm25) })), semantic })
  const snippets = new Map(kw.map((k) => [Number(k.id), k.snip]))
  const hits: KbHit[] = []
  const seenDocs = new Set<string>()
  for (const r of ranked) {
    if (hits.length >= limit) break
    const row = get<{ doc_id: string; text: string; kind: KbDocKind; title: string; url: string; ref_id: string | null }>(
      'SELECT c.doc_id, c.text, d.kind, d.title, d.url, d.ref_id FROM kb_chunks c JOIN kb_docs d ON d.id = c.doc_id WHERE c.id = ?',
      r.id
    )
    if (!row || seenDocs.has(row.doc_id)) continue
    seenDocs.add(row.doc_id)
    const snip = snippets.get(r.id) ?? (row.text.length > 260 ? row.text.slice(0, 259) + '…' : row.text)
    hits.push({
      docId: row.doc_id,
      chunkId: r.id,
      kind: row.kind,
      title: row.title,
      url: row.url,
      refId: row.ref_id,
      snippet: snip.replace(/\s+/g, ' '),
      score: r.score,
      keyword: r.keyword,
      semantic: r.semantic,
      matchedBy: r.keyword > 0 && r.semantic > 0 ? 'both' : r.semantic > 0 ? 'semantic' : 'keyword'
    })
  }
  return { mode, reason, hits, tookMs: Date.now() - t0 }
}

// ------------------------------------------------------------------ embedding worker

let timer: NodeJS.Timeout | null = null
let running = false
let lastError: string | undefined

export function isEmbedding(): boolean {
  return running
}

export function pendingEmbeddings(): number {
  const model = embeddingModel()
  return Number(
    get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM kb_chunks c JOIN kb_docs d ON d.id = c.doc_id WHERE d.profile_id = ? AND (c.embedding IS NULL OR c.model IS NOT ?)',
      activeProfileId(),
      model
    )?.n ?? 0
  )
}

/** Debounced background embedding of new chunks (no-op unless semantic search is usable). */
export function scheduleEmbedding(delay = 3000): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    runEmbedding().catch((err) => log.warn('embedding pass failed', err))
  }, delay)
}

export async function runEmbedding(): Promise<{ started: boolean; reason?: string }> {
  if (running) return { started: false, reason: 'Already running' }
  const st = await semanticStatus()
  if (!st.available) return { started: false, reason: st.reason }
  running = true
  lastError = undefined
  let done = 0
  try {
    for (;;) {
      const batch = all<{ id: number; text: string; title: string }>(
        'SELECT c.id, c.text, c.title FROM kb_chunks c JOIN kb_docs d ON d.id = c.doc_id WHERE d.profile_id = ? AND (c.embedding IS NULL OR c.model IS NOT ?) LIMIT 16',
        activeProfileId(),
        st.model
      )
      if (!batch.length) break
      broadcast('knowledge:progress', { pending: pendingEmbeddings(), done, running: true })
      const vecs = await embed(
        batch.map((b) => (b.title && !b.text.startsWith(b.title) ? `${b.title}\n${b.text}` : b.text)),
        'document'
      )
      tx(() => batch.forEach((b, i) => run('UPDATE kb_chunks SET embedding = ?, model = ? WHERE id = ?', toBlob(vecs[i]), st.model, b.id)))
      done += batch.length
      vectorCache = null
    }
  } catch (err: any) {
    lastError = String(err?.message ?? err)
    log.warn('embedding failed', err)
  } finally {
    running = false
    broadcast('knowledge:progress', { pending: pendingEmbeddings(), done, running: false, error: lastError })
    if (done) broadcast('knowledge:changed', {})
  }
  return { started: true }
}

export function kbCounts(): { docs: number; chunks: number; embedded: number } {
  const p = activeProfileId()
  const r = get<{ docs: number; chunks: number; embedded: number }>(
    `SELECT (SELECT COUNT(*) FROM kb_docs WHERE profile_id = ?) AS docs,
      (SELECT COUNT(*) FROM kb_chunks c JOIN kb_docs d ON d.id = c.doc_id WHERE d.profile_id = ?) AS chunks,
      (SELECT COUNT(*) FROM kb_chunks c JOIN kb_docs d ON d.id = c.doc_id WHERE d.profile_id = ? AND c.embedding IS NOT NULL) AS embedded`,
    p,
    p,
    p
  )
  return { docs: Number(r?.docs ?? 0), chunks: Number(r?.chunks ?? 0), embedded: Number(r?.embedded ?? 0) }
}
