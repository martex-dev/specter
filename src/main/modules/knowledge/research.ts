// Research missions: topic, checklist steps, sources (with captured readable
// text), claims, evidence quotes, questions and summaries.
import {
  DEFAULT_MISSION_STEPS,
  sourceUrlKey,
  type MissionFull,
  type MissionStep,
  type MissionSummary,
  type ResearchClaim,
  type ResearchEvidence,
  type ResearchHit,
  type ResearchItemInput,
  type ResearchItemKind,
  type ResearchQuestion,
  type ResearchSource,
  type ResearchSummary
} from '@shared/modules/knowledge'
import { all, get, json, metaGet, metaSet, run, uid } from '../../db'
import { broadcast } from '../../ipc'
import { activeProfileId } from '../../services/profiles'
import { getSetting } from '../../services/settings'
import { deleteDocByRef, saveDoc } from './kb'
import { listNotes } from './notes'

type MissionRow = {
  id: string
  title: string
  description: string
  status: 'active' | 'archived'
  steps: string
  workspace_id: string | null
  created_at: number
  updated_at: number
  sources: number
  claims: number
}

const MCOLS = `m.id, m.title, m.description, m.status, m.steps, m.workspace_id, m.created_at, m.updated_at,
  (SELECT COUNT(*) FROM rs_sources s WHERE s.mission_id = m.id) AS sources,
  (SELECT COUNT(*) FROM rs_claims c WHERE c.mission_id = m.id) AS claims`

function toMission(r: MissionRow): MissionSummary {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    steps: json<MissionStep[]>(r.steps, []),
    workspaceId: r.workspace_id,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    sourceCount: Number(r.sources),
    claimCount: Number(r.claims)
  }
}

export function listMissions(includeArchived = false): MissionSummary[] {
  return all<MissionRow>(
    `SELECT ${MCOLS} FROM rs_missions m WHERE m.profile_id = ? ${includeArchived ? '' : "AND m.status = 'active'"} ORDER BY m.updated_at DESC`,
    activeProfileId()
  ).map(toMission)
}

function missionRow(id: string): MissionSummary | null {
  const r = get<MissionRow>(`SELECT ${MCOLS} FROM rs_missions m WHERE m.id = ? AND m.profile_id = ?`, id, activeProfileId())
  return r ? toMission(r) : null
}

export function getMission(id: string): MissionFull | null {
  const m = missionRow(id)
  if (!m) return null
  const sources = all<any>('SELECT * FROM rs_sources WHERE mission_id = ? ORDER BY added_at DESC', id).map(
    (s): ResearchSource => ({
      id: s.id,
      missionId: s.mission_id,
      url: s.url,
      title: s.title,
      siteName: s.site_name,
      author: s.author,
      published: s.published,
      excerpt: s.excerpt,
      text: s.text,
      tags: json<string[]>(s.tags, []),
      addedAt: Number(s.added_at),
      accessedAt: Number(s.accessed_at)
    })
  )
  const claims = all<any>('SELECT * FROM rs_claims WHERE mission_id = ? ORDER BY created_at', id).map(
    (c): ResearchClaim => ({ id: c.id, missionId: c.mission_id, text: c.text, status: c.status, createdAt: Number(c.created_at) })
  )
  const evidence = all<any>('SELECT * FROM rs_evidence WHERE mission_id = ? ORDER BY created_at', id).map(
    (e): ResearchEvidence => ({ id: e.id, missionId: e.mission_id, claimId: e.claim_id, sourceId: e.source_id, quote: e.quote, note: e.note, createdAt: Number(e.created_at) })
  )
  const questions = all<any>('SELECT * FROM rs_questions WHERE mission_id = ? ORDER BY created_at', id).map(
    (q): ResearchQuestion => ({ id: q.id, missionId: q.mission_id, text: q.text, answer: q.answer, state: q.state, createdAt: Number(q.created_at) })
  )
  const summaries = all<any>('SELECT * FROM rs_summaries WHERE mission_id = ? ORDER BY created_at DESC', id).map(
    (s): ResearchSummary => ({ id: s.id, missionId: s.mission_id, kind: s.kind, text: s.text, model: s.model, createdAt: Number(s.created_at) })
  )
  return { ...m, sources, claims, evidence, questions, summaries, notes: listNotes({ missionId: id }) }
}

export function createMission(input: { title: string; description?: string; steps?: string[]; workspaceId?: string | null }): MissionSummary {
  const id = uid('rm_')
  const now = Date.now()
  const steps: MissionStep[] = (input.steps?.length ? input.steps : DEFAULT_MISSION_STEPS).map((t, i) => ({ id: 's' + i + '_' + Math.random().toString(36).slice(2, 6), title: t, state: 'todo' }))
  run(
    'INSERT INTO rs_missions(id, profile_id, title, description, status, steps, workspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    activeProfileId(),
    input.title.trim().slice(0, 300) || 'Untitled research',
    (input.description ?? '').trim(),
    'active',
    JSON.stringify(steps),
    input.workspaceId ?? null,
    now,
    now
  )
  setCurrentMission(id)
  broadcast('research:changed', { missionId: id })
  return missionRow(id)!
}

export function updateMission(id: string, patch: { title?: string; description?: string; status?: 'active' | 'archived'; steps?: MissionStep[] }): MissionSummary | null {
  if (!missionRow(id)) return null
  const sets: string[] = []
  const params: unknown[] = []
  if (patch.title !== undefined) sets.push('title = ?'), params.push(patch.title.trim().slice(0, 300) || 'Untitled research')
  if (patch.description !== undefined) sets.push('description = ?'), params.push(patch.description)
  if (patch.status !== undefined) sets.push('status = ?'), params.push(patch.status === 'archived' ? 'archived' : 'active')
  if (patch.steps !== undefined) sets.push('steps = ?'), params.push(JSON.stringify(patch.steps.map((s) => ({ id: String(s.id), title: String(s.title).slice(0, 200), state: ['todo', 'doing', 'done'].includes(s.state) ? s.state : 'todo' }))))
  sets.push('updated_at = ?')
  params.push(Date.now())
  run(`UPDATE rs_missions SET ${sets.join(', ')} WHERE id = ?`, ...params, id)
  broadcast('research:changed', { missionId: id })
  return missionRow(id)
}

export function deleteMission(id: string): void {
  const sources = all<{ id: string }>('SELECT id FROM rs_sources WHERE mission_id = ?', id)
  run('DELETE FROM rs_missions WHERE id = ? AND profile_id = ?', id, activeProfileId())
  for (const s of sources) deleteDocByRef('source', s.id)
  // Mission notes stay as regular notes.
  run('UPDATE kn_notes SET mission_id = NULL WHERE mission_id = ?', id)
  if (currentMission() === id) setCurrentMission(null)
  broadcast('research:changed', { missionId: id })
}

const currentKey = () => 'research:current:' + activeProfileId()

export function currentMission(): string | null {
  const id = metaGet(currentKey())
  if (!id) return null
  return missionRow(id)?.status === 'active' ? id : null
}

export function setCurrentMission(id: string | null): void {
  metaSet(currentKey(), id ?? '')
}

function touch(missionId: string): void {
  run('UPDATE rs_missions SET updated_at = ? WHERE id = ?', Date.now(), missionId)
}

function ensureMission(missionId: string): void {
  if (!missionRow(missionId)) throw new Error('Research mission not found')
}

/** Inserts or updates one research item. Sources are de-duplicated by URL within a mission. */
export function upsertItem(item: ResearchItemInput): { id: string } {
  ensureMission(item.missionId)
  const now = Date.now()
  let id = item.id ?? ''
  switch (item.kind) {
    case 'source': {
      if (!id && item.url) {
        const key = sourceUrlKey(item.url)
        id = all<{ id: string; url: string }>('SELECT id, url FROM rs_sources WHERE mission_id = ?', item.missionId).find((s) => sourceUrlKey(s.url) === key)?.id ?? ''
      }
      const cur = id ? get<any>('SELECT * FROM rs_sources WHERE id = ?', id) : undefined
      const v = {
        url: item.url ?? cur?.url ?? '',
        title: item.title ?? cur?.title ?? '',
        site_name: item.siteName ?? cur?.site_name ?? '',
        author: item.author ?? cur?.author ?? '',
        published: item.published ?? cur?.published ?? '',
        excerpt: item.excerpt ?? cur?.excerpt ?? '',
        // Never replace captured text with nothing (e.g. re-saving a link).
        text: item.text ? item.text : (cur?.text ?? ''),
        tags: JSON.stringify(item.tags ?? json<string[]>(cur?.tags, []))
      }
      if (cur) {
        run(
          'UPDATE rs_sources SET url = ?, title = ?, site_name = ?, author = ?, published = ?, excerpt = ?, text = ?, tags = ?, accessed_at = ? WHERE id = ?',
          v.url,
          v.title,
          v.site_name,
          v.author,
          v.published,
          v.excerpt,
          v.text,
          v.tags,
          item.text ? now : Number(cur.accessed_at),
          id
        )
      } else {
        id = uid('rsrc_')
        run(
          'INSERT INTO rs_sources(id, mission_id, url, title, site_name, author, published, excerpt, text, tags, added_at, accessed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          id,
          item.missionId,
          v.url,
          v.title,
          v.site_name,
          v.author,
          v.published,
          v.excerpt,
          v.text,
          v.tags,
          now,
          now
        )
      }
      // Optional: make saved sources searchable in the knowledge base.
      if (getSetting('research.indexPages') && v.text) {
        try {
          saveDoc({ kind: 'source', title: v.title || v.url, text: v.text, url: v.url, refId: id })
        } catch {
          /* best-effort */
        }
      }
      break
    }
    case 'claim': {
      const status = item.status && ['unverified', 'supported', 'disputed'].includes(item.status) ? item.status : undefined
      if (id) run('UPDATE rs_claims SET text = COALESCE(?, text), status = COALESCE(?, status) WHERE id = ? AND mission_id = ?', item.text ?? null, status ?? null, id, item.missionId)
      else run('INSERT INTO rs_claims(id, mission_id, text, status, created_at) VALUES (?, ?, ?, ?, ?)', (id = uid('rc_')), item.missionId, (item.text ?? '').trim(), status ?? 'unverified', now)
      break
    }
    case 'evidence': {
      if (id) {
        const cur = get<any>('SELECT * FROM rs_evidence WHERE id = ? AND mission_id = ?', id, item.missionId)
        if (!cur) throw new Error('Evidence not found')
        run(
          'UPDATE rs_evidence SET claim_id = ?, source_id = ?, quote = ?, note = ? WHERE id = ?',
          item.claimId !== undefined ? item.claimId : cur.claim_id,
          item.sourceId !== undefined ? item.sourceId : cur.source_id,
          item.quote ?? cur.quote,
          item.note ?? cur.note,
          id
        )
      } else {
        run(
          'INSERT INTO rs_evidence(id, mission_id, claim_id, source_id, quote, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          (id = uid('re_')),
          item.missionId,
          item.claimId ?? null,
          item.sourceId ?? null,
          (item.quote ?? '').trim(),
          (item.note ?? '').trim(),
          now
        )
      }
      break
    }
    case 'question': {
      const state = item.state === 'answered' ? 'answered' : item.state === 'open' ? 'open' : undefined
      if (id) run('UPDATE rs_questions SET text = COALESCE(?, text), answer = COALESCE(?, answer), state = COALESCE(?, state) WHERE id = ? AND mission_id = ?', item.text ?? null, item.answer ?? null, state ?? null, id, item.missionId)
      else run('INSERT INTO rs_questions(id, mission_id, text, answer, state, created_at) VALUES (?, ?, ?, ?, ?, ?)', (id = uid('rq_')), item.missionId, (item.text ?? '').trim(), item.answer ?? '', state ?? 'open', now)
      break
    }
    case 'summary': {
      const kind = item.summaryKind === 'ai' ? 'ai' : 'user'
      if (id) run('UPDATE rs_summaries SET text = COALESCE(?, text) WHERE id = ? AND mission_id = ?', item.text ?? null, id, item.missionId)
      else run('INSERT INTO rs_summaries(id, mission_id, kind, text, model, created_at) VALUES (?, ?, ?, ?, ?, ?)', (id = uid('rsum_')), item.missionId, kind, item.text ?? '', item.model ?? '', now)
      break
    }
  }
  touch(item.missionId)
  broadcast('research:changed', { missionId: item.missionId })
  return { id }
}

const TABLES: Record<ResearchItemKind, string> = {
  source: 'rs_sources',
  claim: 'rs_claims',
  evidence: 'rs_evidence',
  question: 'rs_questions',
  summary: 'rs_summaries'
}

export function removeItem(kind: ResearchItemKind, id: string): void {
  const table = TABLES[kind]
  if (!table) throw new Error('Unknown research item kind')
  const r = get<{ mission_id: string }>(`SELECT mission_id FROM ${table} WHERE id = ?`, id)
  if (!r || !missionRow(r.mission_id)) return
  run(`DELETE FROM ${table} WHERE id = ?`, id)
  if (kind === 'source') deleteDocByRef('source', id)
  touch(r.mission_id)
  broadcast('research:changed', { missionId: r.mission_id })
}

export function searchResearch(text: string, limit = 10): ResearchHit[] {
  const t = text.trim().toLowerCase()
  if (!t) return []
  const like = '%' + t.replace(/[%_\\]/g, (c) => '\\' + c) + '%'
  const p = activeProfileId()
  const missions = all<{ id: string; title: string; description: string; status: string }>(
    "SELECT id, title, description, status FROM rs_missions WHERE profile_id = ? AND (lower(title) LIKE ? ESCAPE '\\' OR lower(description) LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT ?",
    p,
    like,
    like,
    limit
  ).map((m): ResearchHit => ({ kind: 'mission', id: m.id, missionId: m.id, title: m.title, subtitle: m.status === 'archived' ? 'Research mission · archived' : 'Research mission' }))
  const sources = all<{ id: string; mission_id: string; title: string; url: string; mt: string }>(
    `SELECT s.id, s.mission_id, s.title, s.url, m.title AS mt FROM rs_sources s JOIN rs_missions m ON m.id = s.mission_id
     WHERE m.profile_id = ? AND (lower(s.title) LIKE ? ESCAPE '\\' OR lower(s.url) LIKE ? ESCAPE '\\') ORDER BY s.added_at DESC LIMIT ?`,
    p,
    like,
    like,
    limit
  ).map((s): ResearchHit => ({ kind: 'source', id: s.id, missionId: s.mission_id, title: s.title || s.url, subtitle: `Source in “${s.mt}”`, url: s.url }))
  return [...missions, ...sources].slice(0, limit)
}

export function researchCounts(): { missions: number; sources: number } {
  const p = activeProfileId()
  const r = get<{ m: number; s: number }>(
    'SELECT (SELECT COUNT(*) FROM rs_missions WHERE profile_id = ?) AS m, (SELECT COUNT(*) FROM rs_sources s JOIN rs_missions m ON m.id = s.mission_id WHERE m.profile_id = ?) AS s',
    p,
    p
  )
  return { missions: Number(r?.m ?? 0), sources: Number(r?.s ?? 0) }
}
