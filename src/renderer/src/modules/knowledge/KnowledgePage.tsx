// specter://knowledge — local knowledge base: search (keyword / hybrid
// semantic), documents, entity graph and index status.
import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Cpu, Database, FileText, Library, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react'
import type { KbDoc, KbDocFull, KbDocKind, KbSearchResult, KbStatus } from '@shared/modules/knowledge'
import { invoke, on } from '../../lib/ipc'
import { timeAgo } from '../../lib/format'
import { useSetting, setSetting } from '../../stores/settings'
import { toast } from '../../stores/ui'
import { confirmAction, promptText } from '../../components/prompt'
import type { PageProps } from '../../pages/registry'
import { openNote } from './actions'
import { currentWorkspaceId, fmtDate, hostOf, openUrl, Snippet, useLoad } from './lib'
import { KnowledgeGraph } from './KnowledgeGraph'

type Tab = 'search' | 'docs' | 'graph' | 'status'

const KIND_LABEL: Record<KbDocKind, string> = { page: 'Page', selection: 'Selection', note: 'Note', snippet: 'Snippet', 'ai-summary': 'AI summary', source: 'Source' }

export default function KnowledgePage({ query }: PageProps) {
  const [tab, setTab] = useState<Tab>(query.get('tab') === 'graph' ? 'graph' : query.get('tab') === 'status' ? 'status' : query.get('doc') && !query.get('q') ? 'docs' : 'search')
  const [viewing, setViewing] = useState<string | null>(query.get('doc'))
  const [status] = useLoad(() => invoke('knowledge:status'), ['knowledge:changed', 'knowledge:progress', 'notes:changed'], [])

  return (
    <div className="kn-kb">
      <div className="kn-kb-main">
        <div className="page wide" style={{ paddingTop: 28 }}>
          <div className="page-h">
            <div>
              <div className="page-kicker">Knowledge base · local</div>
              <h1 className="page-title">Knowledge</h1>
              <div className="page-sub">
                {status ? `${status.docs} documents · ${status.chunks} chunks · ${status.notes} notes · ${status.sources} research sources` : '—'} — stored in SQLite on this device.
              </div>
            </div>
            <span className="spacer" />
            <div className="seg">
              {(
                [
                  ['search', 'Search'],
                  ['docs', 'Documents'],
                  ['graph', 'Graph'],
                  ['status', 'Index']
                ] as [Tab, string][]
              ).map(([t, l]) => (
                <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {tab === 'search' && <SearchView initial={query.get('q') ?? ''} status={status} onView={setViewing} />}
          {tab === 'docs' && <DocsView onView={setViewing} />}
          {tab === 'graph' && <GraphView />}
          {tab === 'status' && <StatusView status={status} />}
        </div>
      </div>
      {viewing && <DocViewer id={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

function ModeBadge({ result, status }: { result: KbSearchResult | null; status?: KbStatus }) {
  if (result) {
    return result.mode === 'hybrid' ? (
      <span className="badge ok" data-tip={`Keyword (FTS5) + semantic (${status?.semantic.model ?? 'embeddings'}) ranking`}>
        Hybrid · keyword + semantic
      </span>
    ) : (
      <span className="badge" data-tip={result.reason}>
        Keyword · FTS5
      </span>
    )
  }
  return status?.semantic.available ? <span className="badge ok">Semantic ready</span> : <span className="badge">Keyword · FTS5</span>
}

function SearchView({ initial, status, onView }: { initial: string; status?: KbStatus; onView: (id: string) => void }) {
  const [q, setQ] = useState(initial)
  const [keywordOnly, setKeywordOnly] = useState(false)
  const [res, setRes] = useState<KbSearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  const run = async (text = q) => {
    const t = text.trim()
    if (!t) return setRes(null)
    const n = ++seq.current
    setBusy(true)
    try {
      const r = await invoke('knowledge:search', { text: t, limit: 30, mode: keywordOnly ? 'keyword' : 'auto' })
      if (n === seq.current) setRes(r)
    } catch (err: any) {
      toast({ kind: 'error', title: 'Search failed', body: String(err?.message ?? err) })
    } finally {
      if (n === seq.current) setBusy(false)
    }
  }

  useEffect(() => {
    input.current?.focus()
    if (initial) run(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const t = setTimeout(() => run(), 260)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, keywordOnly])

  const openHit = (h: KbSearchResult['hits'][number]) => {
    if (h.kind === 'note' && h.refId) openNote(h.refId)
    else onView(h.docId)
  }

  return (
    <div>
      <div className="kn-kb-search">
        <Search size={16} className="dim" />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="Search saved pages, notes, snippets and sources…" aria-label="Search knowledge base" />
        {busy && <RefreshCw size={13} className="spin dim" />}
        <ModeBadge result={res} status={status} />
      </div>
      <div className="row kn-kb-opts">
        <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={keywordOnly} onChange={(e) => setKeywordOnly(e.target.checked)} /> Keyword only
        </label>
        {res && (
          <span className="dim mono" style={{ fontSize: 11 }}>
            {res.hits.length} results · {res.tookMs} ms{res.mode === 'keyword' && res.reason ? ` · ${res.reason}` : ''}
          </span>
        )}
      </div>
      {res && res.hits.length === 0 && <div className="empty">No matches in your knowledge base.</div>}
      {!res && (
        <div className="kn-kb-hint muted">
          Save pages with <b>Save to SPECTER → Knowledge base</b> or the “Save page to knowledge base” command. Notes are indexed automatically.
        </div>
      )}
      <div className="kn-hits">
        {res?.hits.map((h) => (
          <button key={h.docId} className="kn-hit" onClick={() => openHit(h)}>
            <div className="row" style={{ gap: 8 }}>
              <span className="badge">{KIND_LABEL[h.kind]}</span>
              <span className="kn-hit-title ellipsis">{h.title}</span>
              <span className="spacer" />
              <span className={'kn-match mono ' + h.matchedBy} data-tip={`keyword ${h.keyword.toFixed(2)} · semantic ${h.semantic.toFixed(2)}`}>
                {h.matchedBy === 'both' ? 'keyword + semantic' : h.matchedBy} · {h.score.toFixed(2)}
              </span>
            </div>
            {h.url && <div className="kn-hit-url mono ellipsis">{h.url}</div>}
            <div className="kn-hit-snip">
              <Snippet text={h.snippet} />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function DocsView({ onView }: { onView: (id: string) => void }) {
  const [kind, setKind] = useState<KbDocKind | ''>('')
  const [docs] = useLoad(() => invoke('knowledge:docs', { kind: kind || undefined, limit: 1000 }), ['knowledge:changed'], [kind])

  const addSnippet = async () => {
    const title = await promptText({ title: 'Add snippet', label: 'Title', placeholder: 'e.g. Useful shell one-liner' })
    if (!title?.trim()) return
    const text = await promptText({ title: 'Snippet text', label: 'Text', multiline: true, confirmLabel: 'Save' })
    if (!text?.trim()) return
    await invoke('knowledge:saveDoc', { kind: 'snippet', title: title.trim(), text, workspaceId: currentWorkspaceId() })
    toast({ kind: 'ok', title: 'Snippet saved to knowledge base' })
  }

  const remove = async (d: KbDoc) => {
    if (d.kind === 'note') return toast({ kind: 'info', title: 'Notes are indexed automatically', body: 'Delete the note itself to remove it.' })
    if (await confirmAction('Remove document?', `“${d.title}” and its index will be deleted from this device.`, 'Remove', true)) invoke('knowledge:deleteDoc', d.id)
  }

  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <div className="seg">
          <button className={kind === '' ? 'on' : ''} onClick={() => setKind('')}>
            All
          </button>
          {(['page', 'note', 'source', 'snippet', 'selection', 'ai-summary'] as KbDocKind[]).map((k) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button className="btn sm" onClick={addSnippet}>
          <Plus size={12} /> Snippet
        </button>
      </div>
      {docs && docs.length === 0 && <div className="empty">Nothing saved yet.</div>}
      <table className="table kn-docs">
        <thead>
          <tr>
            <th>Title</th>
            <th>Kind</th>
            <th className="num">Chars</th>
            <th className="num">Chunks</th>
            <th className="num">Embedded</th>
            <th>Updated</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {docs?.map((d) => (
            <tr key={d.id} onClick={() => (d.kind === 'note' && d.refId ? openNote(d.refId) : onView(d.id))} style={{ cursor: 'pointer' }}>
              <td style={{ maxWidth: 420 }}>
                <div className="ellipsis">{d.title}</div>
                {d.url && <div className="dim mono ellipsis" style={{ fontSize: 10.5 }}>{hostOf(d.url)}</div>}
              </td>
              <td>
                <span className="badge">{KIND_LABEL[d.kind]}</span>
              </td>
              <td className="num mono">{d.chars.toLocaleString()}</td>
              <td className="num mono">{d.chunks}</td>
              <td className="num mono">{d.embedded ? `${d.embedded}/${d.chunks}` : '—'}</td>
              <td className="mono dim">{timeAgo(d.updatedAt)}</td>
              <td onClick={(e) => e.stopPropagation()}>
                <button className="icon-btn sm" onClick={() => remove(d)} aria-label="Remove document">
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GraphView() {
  const [graph] = useLoad(() => invoke('knowledge:graph'), ['knowledge:changed'], [])
  if (!graph) return <div className="empty">Loading…</div>
  return (
    <div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        A hand-curated map of entities (concepts, companies, projects, technologies, assets, documents, people) and how they relate. Nothing is inferred automatically.
      </div>
      <KnowledgeGraph graph={graph} />
    </div>
  )
}

function StatusView({ status }: { status?: KbStatus }) {
  const semanticOn = useSetting('knowledge.semanticSearch')
  const indexPages = useSetting('research.indexPages')
  const [progress, setProgress] = useState<{ pending: number; done: number; running: boolean; error?: string } | null>(null)
  useEffect(() => on('knowledge:progress', setProgress), [])
  if (!status) return <div className="empty">Loading…</div>
  const sem = status.semantic
  const running = progress?.running ?? status.embedding

  const build = async () => {
    const r = await invoke('knowledge:embedAll')
    if (!r.started) toast({ kind: 'warn', title: 'Embeddings not started', body: r.reason })
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="grid-4">
        {[
          ['Documents', status.docs, 'pages, notes, snippets, sources'],
          ['Chunks', status.chunks, '~800 chars with overlap · FTS5'],
          ['Embedded', status.embedded, sem.available ? sem.model : 'semantic search not active'],
          ['Pending', status.pending, running ? 'embedding now…' : 'chunks without vectors']
        ].map(([l, v, s]) => (
          <div key={String(l)} className="card stat">
            <div className="label">{l}</div>
            <div className="v num">{Number(v).toLocaleString()}</div>
            <div className="s">{s}</div>
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ gap: 10 }}>
          <Cpu size={16} className={sem.available ? 'ok' : 'dim'} />
          <div className="grow">
            <div style={{ fontWeight: 600 }}>Semantic search {sem.available ? 'available' : semanticOn ? 'unavailable' : 'off'}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {sem.available ? `Local embeddings via Ollama at ${sem.url} using “${sem.model}”. Queries and chunks never leave this machine.` : sem.reason}
              {!sem.available && ' Search falls back to keyword (FTS5) ranking.'}
            </div>
            {progress?.error && <div className="bad" style={{ fontSize: 12, marginTop: 4 }}>Last embedding run failed: {progress.error}</div>}
          </div>
          <button className="btn sm" onClick={() => setSetting('knowledge.semanticSearch', !semanticOn)}>
            {semanticOn ? 'Turn off' : 'Turn on'}
          </button>
          <button className="btn primary sm" onClick={build} disabled={!sem.available || running || status.pending === 0} data-tip={status.pending ? `${status.pending} chunks without embeddings` : 'All chunks embedded'}>
            <RefreshCw size={12} className={running ? 'spin' : ''} /> {running ? `Embedding… ${progress?.done ?? 0} done` : 'Build embeddings'}
          </button>
        </div>
      </div>
      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ gap: 10 }}>
          <Database size={16} className="dim" />
          <div className="grow">
            <div style={{ fontWeight: 600 }}>Index research sources</div>
            <div className="muted" style={{ fontSize: 12 }}>When on, readable text of pages saved as research sources is also added to this knowledge base. Only pages you explicitly save are ever indexed.</div>
          </div>
          <button className="btn sm" onClick={() => setSetting('research.indexPages', !indexPages)}>
            {indexPages ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      </div>
      <div className="dim" style={{ fontSize: 11.5 }}>
        <Library size={12} style={{ verticalAlign: -2 }} /> Everything is stored in SPECTER's local SQLite database. Nothing is uploaded.
      </div>
    </div>
  )
}

function DocViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const [doc, setDoc] = useState<KbDocFull | null | undefined>(undefined)
  useEffect(() => {
    setDoc(undefined)
    invoke('knowledge:doc', id)
      .then(setDoc)
      .catch(() => setDoc(null))
  }, [id])
  return (
    <aside className="kn-viewer">
      <div className="kn-viewer-h">
        <FileText size={14} className="accent" />
        <span className="label">Saved document</span>
        <span className="spacer" />
        {doc?.url && (
          <button className="btn sm" onClick={() => openUrl(doc.url)}>
            Open page <ArrowUpRight size={12} />
          </button>
        )}
        <button className="icon-btn sm" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>
      {doc === undefined && <div className="empty">Loading…</div>}
      {doc === null && <div className="empty">Document not found.</div>}
      {doc && (
        <div className="kn-viewer-b">
          <h2 className="kn-viewer-title selectable">{doc.title}</h2>
          <div className="kn-meta" style={{ marginBottom: 12 }}>
            <span className="label">Kind</span>
            <span className="mono">{KIND_LABEL[doc.kind]}</span>
            <span className="label">Saved</span>
            <span className="mono">{fmtDate(doc.createdAt)}</span>
            <span className="label">Chunks</span>
            <span className="mono">
              {doc.chunks}
              {doc.embedded ? ` (${doc.embedded} embedded)` : ''}
            </span>
          </div>
          {doc.url && <div className="mono dim ellipsis" style={{ fontSize: 11, marginBottom: 10 }}>{doc.url}</div>}
          <div className="kn-src-text selectable" style={{ maxHeight: 'none' }}>
            {doc.text || <span className="dim">No text.</span>}
          </div>
        </div>
      )}
    </aside>
  )
}
