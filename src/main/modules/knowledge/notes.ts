// Local Markdown notes with tags, FTS5 search and [[wiki-link]] backlinks.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  excerptOf,
  ftsMatch,
  linkContext,
  noteToMarkdown,
  normalizeTitle,
  parseWikiLinks,
  replaceWikiLinks,
  type NoteFull,
  type NoteHit,
  type NoteInput,
  type NoteQuery,
  type NoteSummary
} from '@shared/modules/knowledge'
import { all, get, json, run, tx, uid } from '../../db'
import { broadcast } from '../../ipc'
import { activeProfileId } from '../../services/profiles'
import { deleteDocByRef, saveDoc } from './kb'

type Row = {
  id: string
  title: string
  body: string
  tags: string
  workspace_id: string | null
  mission_id: string | null
  source_url: string | null
  pinned: number
  created_at: number
  updated_at: number
}

function toSummary(r: Row): NoteSummary {
  return {
    id: r.id,
    title: r.title,
    excerpt: excerptOf(r.body),
    tags: json<string[]>(r.tags, []),
    workspaceId: r.workspace_id,
    missionId: r.mission_id,
    sourceUrl: r.source_url,
    pinned: !!r.pinned,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at)
  }
}

const COLS = 'id, title, body, tags, workspace_id, mission_id, source_url, pinned, created_at, updated_at'

export function listNotes(q: NoteQuery = {}): NoteSummary[] {
  const where = ['profile_id = ?']
  const params: unknown[] = [activeProfileId()]
  if (q.workspaceId) where.push('workspace_id = ?'), params.push(q.workspaceId)
  if (q.pinned) where.push('pinned = 1')
  if (q.missionId) where.push('mission_id = ?'), params.push(q.missionId)
  if (q.sourceUrl) where.push('source_url = ?'), params.push(q.sourceUrl)
  if (q.tag) where.push('EXISTS (SELECT 1 FROM json_each(kn_notes.tags) WHERE value = ?)'), params.push(q.tag)
  const limit = Math.min(q.limit ?? 1000, 5000)
  return all<Row>(`SELECT ${COLS} FROM kn_notes WHERE ${where.join(' AND ')} ORDER BY pinned DESC, updated_at DESC LIMIT ?`, ...params, limit).map(toSummary)
}

function row(id: string): Row | undefined {
  return get<Row>(`SELECT ${COLS} FROM kn_notes WHERE id = ? AND profile_id = ?`, id, activeProfileId())
}

export function getNote(id: string): NoteFull | null {
  const r = row(id)
  if (!r) return null
  const key = normalizeTitle(r.title)
  const backlinks = key
    ? all<{ id: string; title: string; body: string }>(
        'SELECT n.id, n.title, n.body FROM kn_note_links l JOIN kn_notes n ON n.id = l.from_id WHERE l.target_key = ? AND n.id != ? AND n.profile_id = ? ORDER BY n.updated_at DESC',
        key,
        id,
        activeProfileId()
      ).map((b) => ({ id: b.id, title: b.title || 'Untitled', context: linkContext(b.body, r.title) }))
    : []
  const links = parseWikiLinks(r.body).map((title) => ({ title, id: findByTitle(title) }))
  return { ...toSummary(r), body: r.body, backlinks, links }
}

export function findByTitle(title: string): string | null {
  const key = normalizeTitle(title)
  if (!key) return null
  const rows = all<{ id: string; title: string }>('SELECT id, title FROM kn_notes WHERE profile_id = ? AND lower(title) = ? ORDER BY updated_at DESC', activeProfileId(), key)
  if (rows.length) return rows[0].id
  // Whitespace-insensitive fallback.
  const any = all<{ id: string; title: string }>('SELECT id, title FROM kn_notes WHERE profile_id = ?', activeProfileId())
  return any.find((n) => normalizeTitle(n.title) === key)?.id ?? null
}

function syncLinks(id: string, body: string): void {
  run('DELETE FROM kn_note_links WHERE from_id = ?', id)
  for (const t of parseWikiLinks(body)) run('INSERT OR IGNORE INTO kn_note_links(from_id, target_key, target_title) VALUES (?, ?, ?)', id, normalizeTitle(t), t)
}

function indexNote(n: NoteFull): void {
  try {
    const body = replaceWikiLinks(n.body, (_t, label) => label)
    const title = n.title && !body.trimStart().startsWith(n.title) ? n.title : ''
    const text = [title, n.tags.length ? 'Tags: ' + n.tags.join(', ') : '', body].filter(Boolean).join('\n\n')
    saveDoc({ kind: 'note', title: n.title || 'Untitled note', text, url: n.sourceUrl ?? '', workspaceId: n.workspaceId, refId: n.id })
  } catch {
    /* indexing is best-effort */
  }
}

const cleanTags = (tags: string[] | undefined): string[] => [...new Set((tags ?? []).map((t) => String(t).trim().replace(/^#/, '').toLowerCase()).filter(Boolean))].slice(0, 32)

export function createNote(input: NoteInput): NoteFull {
  const id = uid('n_')
  const now = Date.now()
  const body = input.body ?? ''
  tx(() => {
    run(
      `INSERT INTO kn_notes(id, profile_id, title, body, tags, workspace_id, mission_id, source_url, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      activeProfileId(),
      (input.title ?? '').trim().slice(0, 300),
      body,
      JSON.stringify(cleanTags(input.tags)),
      input.workspaceId ?? null,
      input.missionId ?? null,
      input.sourceUrl ?? null,
      input.pinned ? 1 : 0,
      now,
      now
    )
    syncLinks(id, body)
  })
  const n = getNote(id)!
  indexNote(n)
  broadcast('notes:changed', { id })
  return n
}

export function updateNote(id: string, patch: NoteInput): NoteFull | null {
  const r = row(id)
  if (!r) return null
  const sets: string[] = []
  const params: unknown[] = []
  const put = (col: string, v: unknown) => (sets.push(`${col} = ?`), params.push(v))
  if (patch.title !== undefined) put('title', patch.title.replace(/[\r\n]+/g, ' ').slice(0, 300))
  if (patch.body !== undefined) put('body', patch.body)
  if (patch.tags !== undefined) put('tags', JSON.stringify(cleanTags(patch.tags)))
  if (patch.workspaceId !== undefined) put('workspace_id', patch.workspaceId)
  if (patch.missionId !== undefined) put('mission_id', patch.missionId)
  if (patch.sourceUrl !== undefined) put('source_url', patch.sourceUrl)
  if (patch.pinned !== undefined) put('pinned', patch.pinned ? 1 : 0)
  if (!sets.length) return getNote(id)
  // Pinning alone doesn't count as an edit.
  const onlyPin = sets.length === 1 && patch.pinned !== undefined
  if (!onlyPin) put('updated_at', Date.now())
  tx(() => {
    run(`UPDATE kn_notes SET ${sets.join(', ')} WHERE id = ?`, ...params, id)
    if (patch.body !== undefined) syncLinks(id, patch.body)
  })
  const n = getNote(id)!
  if (!onlyPin) indexNote(n)
  broadcast('notes:changed', { id })
  return n
}

export function deleteNote(id: string): void {
  run('DELETE FROM kn_notes WHERE id = ? AND profile_id = ?', id, activeProfileId())
  deleteDocByRef('note', id)
  broadcast('notes:changed', { id })
}

export function searchNotes(text: string, limit = 20): NoteHit[] {
  const t = text.trim()
  if (!t) return []
  const q = (match: string) =>
    all<{ id: string; title: string; snip: string; updated_at: number; pinned: number }>(
      `SELECT n.id, n.title, snippet(kn_notes_fts, 1, char(1), char(2), '…', 16) AS snip, n.updated_at, n.pinned
       FROM kn_notes_fts JOIN kn_notes n ON n.rid = kn_notes_fts.rowid
       WHERE kn_notes_fts MATCH ? AND n.profile_id = ?
       ORDER BY bm25(kn_notes_fts, 4.0, 1.0, 2.0) LIMIT ?`,
      match,
      activeProfileId(),
      Math.min(limit, 200)
    )
  try {
    let rows = q(ftsMatch(t))
    if (!rows.length && /\s/.test(t)) rows = q(ftsMatch(t, true))
    return rows.map((r) => ({ id: r.id, title: r.title || 'Untitled', snippet: r.snip.replace(/\*\*|__|\[\[|\]\]/g, '').replace(/\s+/g, ' '), updatedAt: Number(r.updated_at), pinned: !!r.pinned }))
  } catch {
    return []
  }
}

export function noteTags(): { tag: string; count: number }[] {
  return all<{ tag: string; count: number }>(
    'SELECT j.value AS tag, COUNT(*) AS count FROM kn_notes, json_each(kn_notes.tags) j WHERE kn_notes.profile_id = ? GROUP BY j.value ORDER BY count DESC, tag',
    activeProfileId()
  ).map((r) => ({ tag: r.tag, count: Number(r.count) }))
}

export function noteTitles(): { id: string; title: string }[] {
  return all<{ id: string; title: string }>("SELECT id, title FROM kn_notes WHERE profile_id = ? AND title != '' ORDER BY updated_at DESC", activeProfileId())
}

export function safeFileName(name: string): string {
  return (name || 'Untitled').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled'
}

export function exportAllNotes(folder: string): { count: number; folder: string } {
  const dir = join(folder, 'SPECTER Notes')
  mkdirSync(dir, { recursive: true })
  const rows = all<Row>(`SELECT ${COLS} FROM kn_notes WHERE profile_id = ? ORDER BY created_at`, activeProfileId())
  const used = new Set<string>()
  for (const r of rows) {
    const base = safeFileName(r.title)
    let name = base
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} (${i})`
    used.add(name.toLowerCase())
    writeFileSync(join(dir, name + '.md'), noteToMarkdown({ ...toSummary(r), body: r.body }), 'utf8')
  }
  return { count: rows.length, folder: dir }
}

export function noteCount(): number {
  return Number(get<{ n: number }>('SELECT COUNT(*) AS n FROM kn_notes WHERE profile_id = ?', activeProfileId())?.n ?? 0)
}
