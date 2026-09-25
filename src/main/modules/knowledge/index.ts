// Notes, research & knowledge — main-process module entry.
// Registers the SQLite schema, IPC handlers and a diagnostics row. Everything
// is stored locally; the only network use is the optional local Ollama
// embedding endpoint when the user turned semantic search on.
import { normalizeText, type ExtractedPage, type KbStatus } from '@shared/modules/knowledge'
import { handle } from '../../ipc'
import { registerDiagnostic } from '../../services/diagnostics'
import { pageText, readableArticle } from '../../services/page'
import { onSettingChanged } from '../../services/settings'
import { createLogger } from '../../logger'
import { registerKnowledgeSchema } from './schema'
import { createNote, deleteNote, exportAllNotes, findByTitle, getNote, listNotes, noteCount, noteTags, noteTitles, searchNotes, updateNote } from './notes'
import { createMission, currentMission, deleteMission, getMission, listMissions, removeItem, researchCounts, searchResearch, setCurrentMission, updateMission, upsertItem } from './research'
import { deleteDoc, getDoc, isEmbedding, kbCounts, listDocs, pendingEmbeddings, runEmbedding, saveDoc, scheduleEmbedding, searchKb } from './kb'
import { invalidateSemanticStatus, semanticStatus } from './embeddings'
import { deleteEntity, deleteRelation, getGraph, saveEntity, saveRelation } from './graph'

const log = createLogger('knowledge')

async function extract(wcId: number): Promise<ExtractedPage | null> {
  try {
    const art = await readableArticle(wcId)
    if (art && art.textContent && art.textContent.trim().length > 200) {
      return {
        url: art.url,
        title: art.title,
        text: normalizeText(art.textContent),
        siteName: art.siteName ?? '',
        author: art.byline ?? '',
        excerpt: art.excerpt ?? '',
        readable: true
      }
    }
    const p = await pageText(wcId)
    return { url: p.url, title: p.title, text: normalizeText(p.text), siteName: '', author: '', excerpt: '', readable: false }
  } catch (err) {
    log.warn('extract failed', err)
    return null
  }
}

async function status(): Promise<KbStatus> {
  const kb = kbCounts()
  const rs = researchCounts()
  return {
    notes: noteCount(),
    missions: rs.missions,
    sources: rs.sources,
    docs: kb.docs,
    chunks: kb.chunks,
    embedded: kb.embedded,
    pending: pendingEmbeddings(),
    semantic: await semanticStatus(),
    embedding: isEmbedding()
  }
}

export function register(): void {
  registerKnowledgeSchema()

  // Notes
  handle('notes:list', (_e, q) => listNotes(q ?? {}))
  handle('notes:get', (_e, id) => getNote(id))
  handle('notes:create', (_e, input) => createNote(input ?? {}))
  handle('notes:update', (_e, id, patch) => updateNote(id, patch ?? {}))
  handle('notes:delete', (_e, id) => deleteNote(id))
  handle('notes:search', (_e, text, limit) => searchNotes(text, limit))
  handle('notes:tags', () => noteTags())
  handle('notes:titles', () => noteTitles())
  handle('notes:findByTitle', (_e, title) => findByTitle(title))
  handle('notes:exportAll', (_e, folder) => {
    if (typeof folder !== 'string' || !folder) throw new Error('No folder selected')
    return exportAllNotes(folder)
  })

  // Research
  handle('research:missions', (_e, includeArchived) => listMissions(!!includeArchived))
  handle('research:get', (_e, id) => getMission(id))
  handle('research:create', (_e, input) => createMission(input))
  handle('research:update', (_e, id, patch) => updateMission(id, patch ?? {}))
  handle('research:delete', (_e, id) => deleteMission(id))
  handle('research:current', () => currentMission())
  handle('research:setCurrent', (_e, id) => setCurrentMission(id))
  handle('research:upsert', (_e, item) => upsertItem(item))
  handle('research:remove', (_e, kind, id) => removeItem(kind, id))
  handle('research:search', (_e, text, limit) => searchResearch(text, limit))

  // Knowledge base
  handle('knowledge:extract', (_e, wcId) => extract(wcId))
  handle('knowledge:savePage', async (_e, wcId, workspaceId) => {
    const page = await extract(wcId)
    if (!page || !page.text) throw new Error('No readable text found on this page')
    return saveDoc({ kind: 'page', title: page.title || page.url, text: page.text, url: page.url, workspaceId })
  })
  handle('knowledge:saveDoc', (_e, input) => {
    if (!input || !input.kind) throw new Error('Invalid document')
    return saveDoc(input)
  })
  handle('knowledge:docs', (_e, q) => listDocs(q ?? {}))
  handle('knowledge:doc', (_e, id) => getDoc(id))
  handle('knowledge:deleteDoc', (_e, id) => deleteDoc(id))
  handle('knowledge:search', (_e, q) => searchKb(q))
  handle('knowledge:status', () => status())
  handle('knowledge:embedAll', async () => {
    invalidateSemanticStatus()
    const st = await semanticStatus(true)
    if (!st.available) return { started: false, reason: st.reason }
    runEmbedding().catch((err) => log.warn('embedding failed', err))
    return { started: true }
  })
  handle('knowledge:graph', () => getGraph())
  handle('knowledge:saveEntity', (_e, ent) => saveEntity(ent))
  handle('knowledge:deleteEntity', (_e, id) => deleteEntity(id))
  handle('knowledge:saveRelation', (_e, r) => saveRelation(r))
  handle('knowledge:deleteRelation', (_e, id) => deleteRelation(id))

  onSettingChanged((key) => {
    if (key === 'knowledge.semanticSearch' || key.startsWith('ai.')) {
      invalidateSemanticStatus()
      scheduleEmbedding(1500)
    }
  })
  // Catch up on chunks saved while Ollama was unavailable (no-op when semantic search is off).
  scheduleEmbedding(20_000)

  registerDiagnostic(async () => {
    try {
      const s = await status()
      const sem = s.semantic.available
        ? `semantic search available (${s.semantic.model}, ${s.embedded}/${s.chunks} chunks embedded)`
        : `semantic search ${s.semantic.enabled ? 'unavailable' : 'off'}: ${s.semantic.reason}`
      return {
        id: 'knowledge',
        label: 'Knowledge base',
        status: s.semantic.enabled && !s.semantic.available ? 'warn' : 'ok',
        detail: `${s.notes} notes · ${s.missions} missions · ${s.sources} sources · ${s.docs} documents · ${s.chunks} chunks (FTS5) · ${sem}`
      }
    } catch (err: any) {
      return { id: 'knowledge', label: 'Knowledge base', status: 'error', detail: String(err?.message ?? err) }
    }
  })
}
