// specter://research — research missions with sources, claims, evidence,
// questions, summaries, a Source → Claim → Evidence graph and citations.
import { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  Copy,
  Download,
  FileText,
  FlaskConical,
  Globe,
  Plus,
  Quote,
  Sparkles,
  Target,
  Trash2,
  X
} from 'lucide-react'
import { formatCitationList, type ClaimStatus, type MissionFull, type MissionStep, type ResearchItemInput, type ResearchSource, type StepState } from '@shared/modules/knowledge'
import { isInternal } from '@shared/url'
import { invoke } from '../../lib/ipc'
import { getCommand, runCommand } from '../../lib/commands'
import { timeAgo } from '../../lib/format'
import { activeTab } from '../../stores/browser'
import { toast } from '../../stores/ui'
import { confirmAction, promptText } from '../../components/prompt'
import type { PageProps } from '../../pages/registry'
import { createMissionInteractive, newNote, openNote, saveResearchSource } from './actions'
import { fmtDate, fmtDay, hostOf, openUrl, slugFile, useLoad, useSteps } from './lib'
import { ResearchGraph } from './ResearchGraph'
import { aiContext, citationsFor, missionReport } from './report'

type Tab = 'overview' | 'sources' | 'claims' | 'graph' | 'citations'

export default function ResearchPage({ sub }: PageProps) {
  const [showArchived, setShowArchived] = useState(false)
  const [missions] = useLoad(() => invoke('research:missions', true), ['research:changed'], [])
  const [selected, setSelected] = useState<string | null>(sub || null)

  useEffect(() => {
    if (selected || !missions) return
    invoke('research:current').then((c) => setSelected(c ?? missions.find((m) => m.status === 'active')?.id ?? missions[0]?.id ?? null))
  }, [missions, selected])

  const visible = (missions ?? []).filter((m) => showArchived || m.status === 'active')
  const archivedCount = (missions ?? []).filter((m) => m.status === 'archived').length

  const create = async () => {
    const m = await createMissionInteractive(false)
    if (m) setSelected(m.id)
  }

  return (
    <div className="kn-research">
      <div className="kn-list-pane">
        <div className="kn-list-head">
          <div>
            <div className="page-kicker">Research</div>
            <div className="kn-list-count mono">{missions ? `${visible.length} missions` : '—'} · local</div>
          </div>
          <span className="spacer" />
          <button className="btn primary sm" onClick={create}>
            <Plus size={13} /> Mission
          </button>
        </div>
        <div className="kn-list">
          {visible.map((m) => {
            const done = m.steps.filter((s) => s.state === 'done').length
            return (
              <button key={m.id} className={'kn-item' + (selected === m.id ? ' sel' : '')} onClick={() => setSelected(m.id)}>
                <div className="kn-item-title">
                  <span className="ellipsis">{m.title}</span>
                  {m.status === 'archived' && <span className="badge">archived</span>}
                </div>
                <div className="kn-progress" aria-label={`${done} of ${m.steps.length} steps done`}>
                  <i style={{ width: `${m.steps.length ? (done / m.steps.length) * 100 : 0}%` }} />
                </div>
                <div className="kn-item-meta mono">
                  {done}/{m.steps.length} steps · {m.sourceCount} sources · {m.claimCount} claims · {timeAgo(m.updatedAt)}
                </div>
              </button>
            )
          })}
          {missions && !visible.length && (
            <div className="empty" style={{ padding: 24 }}>
              No research missions yet.
            </div>
          )}
          {archivedCount > 0 && (
            <button className="btn ghost sm" style={{ margin: 10 }} onClick={() => setShowArchived(!showArchived)}>
              {showArchived ? 'Hide' : 'Show'} archived ({archivedCount})
            </button>
          )}
        </div>
      </div>
      <div className="kn-mission-pane">
        {selected ? (
          <MissionView key={selected} id={selected} onDeleted={() => setSelected(null)} />
        ) : (
          <div className="kn-blank">
            <FlaskConical size={28} className="dim" />
            <div className="kn-blank-title">Research missions</div>
            <div className="muted" style={{ maxWidth: 460, textAlign: 'center' }}>
              Track a topic step by step. Save pages as sources (their readable text is stored locally), record claims and back them with quoted evidence, then export a report with citations.
            </div>
            <button className="btn primary" style={{ marginTop: 14 }} onClick={create}>
              <Plus size={14} /> New mission
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const STEP_NEXT: Record<StepState, StepState> = { todo: 'doing', doing: 'done', done: 'todo' }

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <Check size={13} className="ok" />
  if (state === 'doing') return <CircleDot size={13} className="accent" />
  return <Circle size={13} className="dim" />
}

function MissionView({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const [m, reload] = useLoad(() => invoke('research:get', id), ['research:changed', 'notes:changed'], [id])
  const [tab, setTab] = useState<Tab>('overview')
  const [current, setCurrent] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [steps, updateSteps] = useSteps(m?.id, m?.steps)
  const [desc, setDesc] = useState('')

  useEffect(() => {
    invoke('research:current').then(setCurrent)
  }, [id, m])
  useEffect(() => {
    if (m) {
      setTitle(m.title)
      setDesc(m.description)
    }
    // Only when switching missions / first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m?.id])

  if (m === undefined) return <div className="empty">Loading…</div>
  if (m === null) return <div className="empty">This mission no longer exists.</div>

  const upsert = (item: ResearchItemInput) => invoke('research:upsert', item).catch((e) => toast({ kind: 'error', title: 'Save failed', body: String(e?.message ?? e) }))
  const done = steps.filter((s) => s.state === 'done').length

  const exportReport = async () => {
    const path = await invoke('app:saveFile', slugFile(m.title + ' — report', '.md'), missionReport(m))
    if (path) toast({ kind: 'ok', title: 'Report exported', body: path })
  }

  const remove = async () => {
    if (!(await confirmAction('Delete mission?', `“${m.title}” with its ${m.sources.length} sources, claims and evidence will be permanently deleted. Its notes are kept.`, 'Delete', true))) return
    await invoke('research:delete', id)
    onDeleted()
  }

  return (
    <div className="kn-mission">
      <div className="kn-mission-head">
        <div className="page-kicker">Research mission{current === id ? ' · current' : ''}</div>
        <input className="kn-mission-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== m.title && invoke('research:update', id, { title })} aria-label="Mission topic" />
        <textarea
          className="kn-mission-desc"
          value={desc}
          rows={Math.min(4, Math.max(1, desc.split('\n').length))}
          placeholder="Scope, goal or research question…"
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => desc !== m.description && invoke('research:update', id, { description: desc })}
          aria-label="Mission description"
        />
        <div className="kn-meta">
          <span className="label">Created</span>
          <span className="mono">{fmtDay(m.createdAt)}</span>
          <span className="label">Updated</span>
          <span className="mono">{timeAgo(m.updatedAt)}</span>
          <span className="label">Progress</span>
          <span className="mono">
            {done}/{steps.length}
          </span>
          <span className="label">Sources</span>
          <span className="mono">{m.sources.length}</span>
          <span className="label">Claims</span>
          <span className="mono">{m.claims.length}</span>
          <span className="spacer" />
          {current !== id && m.status === 'active' && (
            <button className="btn sm" onClick={() => invoke('research:setCurrent', id).then(() => setCurrent(id))} data-tip="Sources saved from pages go here by default">
              <Target size={12} /> Make current
            </button>
          )}
          <button className="btn sm" onClick={exportReport} data-tip="Export report as Markdown">
            <Download size={12} /> Report
          </button>
          <button className="icon-btn sm" onClick={() => invoke('research:update', id, { status: m.status === 'active' ? 'archived' : 'active' })} data-tip={m.status === 'active' ? 'Archive' : 'Restore'} aria-label="Archive">
            {m.status === 'active' ? <Archive size={13} /> : <ArchiveRestore size={13} />}
          </button>
          <button className="icon-btn sm" onClick={remove} data-tip="Delete mission" aria-label="Delete mission">
            <Trash2 size={13} />
          </button>
        </div>
        <div className="seg kn-tabs">
          {(
            [
              ['overview', 'Overview'],
              ['sources', `Sources ${m.sources.length}`],
              ['claims', `Claims ${m.claims.length}`],
              ['graph', 'Graph'],
              ['citations', 'Citations']
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="kn-mission-body">
        {tab === 'overview' && <Overview m={m} steps={steps} updateSteps={updateSteps} upsert={upsert} />}
        {tab === 'sources' && <Sources m={m} upsert={upsert} reload={reload} />}
        {tab === 'claims' && <Claims m={m} upsert={upsert} />}
        {tab === 'graph' && (
          <div className="kn-section">
            <div className="kn-sec-h">
              <span className="label">Source → Claim → Evidence</span>
            </div>
            <ResearchGraph mission={m} onSelect={(kind) => setTab(kind === 'source' ? 'sources' : 'claims')} />
          </div>
        )}
        {tab === 'citations' && <Citations m={m} />}
      </div>
    </div>
  )
}

type Upsert = (item: ResearchItemInput) => Promise<unknown>

function Overview({ m, steps, updateSteps, upsert }: { m: MissionFull; steps: MissionStep[]; updateSteps: (fn: (s: MissionStep[]) => MissionStep[]) => void; upsert: Upsert }) {
  const [newStep, setNewStep] = useState('')
  const [newQ, setNewQ] = useState('')
  const [summary, setSummary] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const aiAvailable = !!getCommand('ai.ask')

  const addStep = () => {
    const t = newStep.trim()
    if (!t) return
    updateSteps((cur) => [...cur, { id: 's' + Date.now().toString(36), title: t, state: 'todo' }])
    setNewStep('')
  }

  const aiSummary = async () => {
    if (!m.sources.length) return toast({ kind: 'warn', title: 'Save some sources first' })
    setAiBusy(true)
    try {
      const r: any = await runCommand('ai.ask', {
        action: 'summarize',
        text: aiContext(m),
        prompt: `Summarize the saved sources for the research topic “${m.title}”. Only use information from the sources, cite source titles, and say when the sources disagree or are insufficient.`
      })
      const text = typeof r === 'string' ? r : typeof r?.text === 'string' ? r.text : typeof r?.answer === 'string' ? r.answer : ''
      if (text.trim()) {
        await upsert({ kind: 'summary', missionId: m.id, summaryKind: 'ai', text, model: typeof r?.model === 'string' ? r.model : '' })
        toast({ kind: 'ok', title: 'AI summary added', body: 'Labelled as AI-generated and unverified.' })
      } else {
        toast({ kind: 'info', title: 'Sent to the AI assistant', body: 'The answer appears in the AI panel. Paste it here with “AI-generated” ticked if you want to keep it.' })
      }
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <div className="kn-grid">
      <div className="kn-section">
        <div className="kn-sec-h">
          <span className="label">Checklist</span>
          <span className="dim mono" style={{ fontSize: 11 }}>
            click to cycle todo → in progress → done
          </span>
        </div>
        <div className="kn-steps">
          {steps.map((s) => (
            <div key={s.id} className={'kn-step ' + s.state}>
              <button className="kn-step-btn" onClick={() => updateSteps((cur) => cur.map((x) => (x.id === s.id ? { ...x, state: STEP_NEXT[x.state] } : x)))} aria-label={`${s.title}: ${s.state}`}>
                <StepIcon state={s.state} />
                <span className="kn-step-title">{s.title}</span>
                <span className="kn-step-state mono">{s.state === 'doing' ? 'in progress' : s.state}</span>
              </button>
              <button
                className="icon-btn sm kn-hover"
                onClick={async () => {
                  const t = await promptText({ title: 'Rename step', initial: s.title })
                  if (t?.trim()) updateSteps((cur) => cur.map((x) => (x.id === s.id ? { ...x, title: t.trim() } : x)))
                }}
                aria-label="Rename step"
                data-tip="Rename"
              >
                <FileText size={12} />
              </button>
              <button className="icon-btn sm kn-hover" onClick={() => updateSteps((cur) => cur.filter((x) => x.id !== s.id))} aria-label="Remove step" data-tip="Remove">
                <X size={12} />
              </button>
            </div>
          ))}
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <input className="input grow" value={newStep} onChange={(e) => setNewStep(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && addStep()} placeholder="Add step" />
            <button className="btn sm" onClick={addStep} disabled={!newStep.trim()}>
              <Plus size={12} />
            </button>
          </div>
        </div>
      </div>

      <div className="kn-section">
        <div className="kn-sec-h">
          <span className="label">Questions · {m.questions.filter((q) => q.state === 'open').length} open</span>
        </div>
        {m.questions.map((q) => (
          <div key={q.id} className={'kn-question' + (q.state === 'answered' ? ' answered' : '')}>
            <div className="row" style={{ gap: 6 }}>
              <button className="icon-btn sm" onClick={() => upsert({ kind: 'question', id: q.id, missionId: m.id, state: q.state === 'open' ? 'answered' : 'open' })} aria-label="Toggle answered" data-tip={q.state === 'open' ? 'Mark answered' : 'Reopen'}>
                {q.state === 'answered' ? <Check size={13} className="ok" /> : <Circle size={13} className="dim" />}
              </button>
              <div className="grow kn-q-text">{q.text}</div>
              <button className="icon-btn sm kn-hover" onClick={() => invoke('research:remove', 'question', q.id)} aria-label="Delete question">
                <X size={12} />
              </button>
            </div>
            <textarea
              className="kn-inline-ta"
              defaultValue={q.answer}
              placeholder="Answer / findings…"
              rows={q.answer ? 2 : 1}
              onBlur={(e) => e.target.value !== q.answer && upsert({ kind: 'question', id: q.id, missionId: m.id, answer: e.target.value })}
            />
          </div>
        ))}
        <div className="row" style={{ gap: 6, marginTop: 6 }}>
          <input
            className="input grow"
            value={newQ}
            onChange={(e) => setNewQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && newQ.trim()) upsert({ kind: 'question', missionId: m.id, text: newQ.trim() }).then(() => setNewQ(''))
            }}
            placeholder="Add a question to answer"
          />
        </div>
      </div>

      <div className="kn-section">
        <div className="kn-sec-h">
          <span className="label">Summaries</span>
          <span className="spacer" />
          <button className="btn sm" onClick={aiSummary} disabled={!aiAvailable || aiBusy} data-tip={aiAvailable ? 'Ask the local AI module to summarize the saved sources' : 'AI module not available'}>
            <Sparkles size={12} /> {aiBusy ? 'Asking AI…' : 'AI summary'}
          </button>
        </div>
        {m.summaries.map((s) => (
          <div key={s.id} className={'kn-summary' + (s.kind === 'ai' ? ' ai' : '')}>
            <div className="row" style={{ gap: 6 }}>
              {s.kind === 'ai' ? <span className="badge warn">AI-generated · unverified{s.model ? ` · ${s.model}` : ''}</span> : <span className="badge">Your summary</span>}
              <span className="dim mono" style={{ fontSize: 10.5 }}>
                {fmtDate(s.createdAt)}
              </span>
              <span className="spacer" />
              <button className="icon-btn sm kn-hover" onClick={() => invoke('research:remove', 'summary', s.id)} aria-label="Delete summary">
                <X size={12} />
              </button>
            </div>
            <div className="kn-summary-text selectable">{s.text}</div>
          </div>
        ))}
        <textarea className="textarea" style={{ width: '100%' }} rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Write a summary of what you found…" />
        <div className="row" style={{ gap: 6, marginTop: 6 }}>
          <span className="spacer" />
          <button
            className="btn sm"
            disabled={!summary.trim()}
            onClick={() => upsert({ kind: 'summary', missionId: m.id, summaryKind: 'ai', text: summary.trim() }).then(() => setSummary(''))}
            data-tip="Save pasted AI output — it will be labelled AI-generated"
          >
            Save as AI-generated
          </button>
          <button className="btn primary sm" disabled={!summary.trim()} onClick={() => upsert({ kind: 'summary', missionId: m.id, summaryKind: 'user', text: summary.trim() }).then(() => setSummary(''))}>
            Save summary
          </button>
        </div>
      </div>

      <div className="kn-section">
        <div className="kn-sec-h">
          <span className="label">Notes · {m.notes.length}</span>
          <span className="spacer" />
          <button className="btn sm" onClick={() => newNote({ title: `${m.title} — `, missionId: m.id })}>
            <Plus size={12} /> Note
          </button>
        </div>
        {m.notes.length === 0 && <div className="dim kn-side-empty">Notes created from this mission appear here.</div>}
        {m.notes.map((n) => (
          <button key={n.id} className="kn-link-row" onClick={() => openNote(n.id)}>
            <div className="kn-link-title">{n.title || 'Untitled'}</div>
            <div className="kn-link-ctx">{n.excerpt}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function Sources({ m, upsert, reload }: { m: MissionFull; upsert: Upsert; reload: () => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const tab = activeTab()
  const canSaveTab = !!tab && !isInternal(tab.url)
  const cites = useMemo(() => new Map(citationsFor(m).map((c) => [c.id, c.n])), [m])

  const addUrl = async () => {
    const url = await promptText({ title: 'Add source by URL', label: 'URL', placeholder: 'https://…', confirmLabel: 'Add' })
    if (!url?.trim()) return
    const u = url.trim()
    if (!/^https?:\/\//i.test(u)) return toast({ kind: 'warn', title: 'Enter an http(s) URL' })
    await upsert({ kind: 'source', missionId: m.id, url: u, title: hostOf(u), siteName: hostOf(u) })
    toast({ kind: 'info', title: 'Link saved', body: 'Open the page and use “Save page” to capture its readable text.' })
  }

  return (
    <div className="kn-section">
      <div className="kn-sec-h">
        <span className="label">Sources · stored locally with their readable text</span>
        <span className="spacer" />
        <button className="btn sm" onClick={addUrl}>
          <Plus size={12} /> URL
        </button>
        <button className="btn primary sm" disabled={!canSaveTab} onClick={() => saveResearchSource({ missionId: m.id }).then(reload)} data-tip={canSaveTab ? `Save “${tab?.title}”` : 'The active tab is not a web page'}>
          <Globe size={12} /> Save active tab
        </button>
      </div>
      {m.sources.length === 0 && <div className="empty">No sources yet. Browse to a page and use “Save to research” (context menu, Save dialog or the Research panel).</div>}
      {m.sources.map((s) => (
        <SourceCard key={s.id} s={s} n={cites.get(s.id) ?? 0} m={m} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} upsert={upsert} />
      ))}
    </div>
  )
}

function SourceCard({ s, n, m, open, onToggle, upsert }: { s: ResearchSource; n: number; m: MissionFull; open: boolean; onToggle: () => void; upsert: Upsert }) {
  const [quote, setQuote] = useState('')
  const [claimId, setClaimId] = useState('')
  const evidence = m.evidence.filter((e) => e.sourceId === s.id)
  const words = s.text ? s.text.split(/\s+/).length : 0

  const captureSelection = () => {
    const sel = String(window.getSelection() ?? '').trim()
    if (sel) setQuote(sel)
    else toast({ kind: 'info', title: 'Select text in the captured page text first' })
  }

  return (
    <div className="kn-source card">
      <div className="kn-source-h">
        <span className="kn-src-n mono">S{n}</span>
        <button className="kn-src-toggle" onClick={onToggle} aria-expanded={open}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="kn-src-title ellipsis">{s.title || s.url}</div>
          <div className="kn-src-meta mono ellipsis">
            {s.siteName || hostOf(s.url)} · saved {fmtDay(s.addedAt)} · {words ? `${words.toLocaleString()} words captured` : 'link only'} · {evidence.length} quotes
          </div>
        </div>
        <button className="icon-btn sm" onClick={() => openUrl(s.url)} data-tip="Open page" aria-label="Open page">
          <ArrowUpRight size={13} />
        </button>
        <button
          className="icon-btn sm"
          onClick={async () => {
            if (await confirmAction('Remove source?', 'Its evidence quotes are kept but lose the source link.', 'Remove', true)) invoke('research:remove', 'source', s.id)
          }}
          data-tip="Remove source"
          aria-label="Remove source"
        >
          <Trash2 size={13} />
        </button>
      </div>
      {open && (
        <div className="kn-source-b">
          <div className="kn-src-fields">
            <label>
              <span className="label">Author</span>
              <input className="input" defaultValue={s.author} placeholder="Unknown" onBlur={(e) => e.target.value !== s.author && upsert({ kind: 'source', id: s.id, missionId: m.id, author: e.target.value })} />
            </label>
            <label>
              <span className="label">Published</span>
              <input className="input" defaultValue={s.published} placeholder="YYYY-MM-DD" onBlur={(e) => e.target.value !== s.published && upsert({ kind: 'source', id: s.id, missionId: m.id, published: e.target.value })} />
            </label>
            <label>
              <span className="label">Tags</span>
              <input
                className="input"
                defaultValue={s.tags.join(', ')}
                placeholder="comma separated"
                onBlur={(e) => upsert({ kind: 'source', id: s.id, missionId: m.id, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
              />
            </label>
            <label>
              <span className="label">Accessed</span>
              <span className="mono" style={{ fontSize: 12 }}>
                {fmtDate(s.accessedAt)}
              </span>
            </label>
          </div>
          {evidence.length > 0 && (
            <div className="kn-src-evidence">
              {evidence.map((e) => (
                <div key={e.id} className="kn-evidence">
                  <Quote size={12} className="dim" />
                  <div className="grow">
                    <div className="kn-quote">{e.quote}</div>
                    <div className="kn-src-meta mono">{e.claimId ? `→ ${m.claims.find((c) => c.id === e.claimId)?.text ?? 'claim'}` : 'not assigned to a claim'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="kn-add-evidence">
            <textarea className="textarea" rows={2} value={quote} onChange={(e) => setQuote(e.target.value)} placeholder="Paste or select a quote from the text below…" />
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm" onClick={captureSelection} disabled={!s.text}>
                Use selection
              </button>
              <select className="select" style={{ height: 24, fontSize: 11.5 }} value={claimId} onChange={(e) => setClaimId(e.target.value)}>
                <option value="">No claim yet</option>
                {m.claims.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.text.slice(0, 70)}
                  </option>
                ))}
              </select>
              <span className="spacer" />
              <button
                className="btn primary sm"
                disabled={!quote.trim()}
                onClick={() => upsert({ kind: 'evidence', missionId: m.id, sourceId: s.id, claimId: claimId || null, quote: quote.trim() }).then(() => setQuote(''))}
              >
                <Quote size={12} /> Add evidence
              </button>
            </div>
          </div>
          {s.text ? (
            <div className="kn-src-text selectable">{s.text.slice(0, 20000)}{s.text.length > 20000 ? '\n\n…' : ''}</div>
          ) : (
            <div className="dim" style={{ fontSize: 12 }}>
              No text captured — only the link was saved. Open the page and save it again to capture its readable text.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const STATUS: ClaimStatus[] = ['unverified', 'supported', 'disputed']

function Claims({ m, upsert }: { m: MissionFull; upsert: Upsert }) {
  const [text, setText] = useState('')
  const srcN = useMemo(() => new Map(citationsFor(m).map((c) => [c.id, c.n])), [m])
  const loose = m.evidence.filter((e) => !e.claimId)

  const add = () => {
    if (!text.trim()) return
    upsert({ kind: 'claim', missionId: m.id, text: text.trim() }).then(() => setText(''))
  }

  return (
    <div className="kn-section">
      <div className="kn-sec-h">
        <span className="label">Claims — back each one with quoted evidence from saved sources</span>
      </div>
      <div className="row" style={{ gap: 6, marginBottom: 12 }}>
        <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()} placeholder="State a claim to verify…" />
        <button className="btn primary sm" onClick={add} disabled={!text.trim()}>
          <Plus size={12} /> Claim
        </button>
      </div>
      {m.claims.map((c) => {
        const ev = m.evidence.filter((e) => e.claimId === c.id)
        return (
          <div key={c.id} className={'kn-claim card ' + c.status}>
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <div className="grow kn-claim-text">{c.text}</div>
              <select className="select" style={{ height: 24, fontSize: 11.5 }} value={c.status} onChange={(e) => upsert({ kind: 'claim', id: c.id, missionId: m.id, status: e.target.value as ClaimStatus })} aria-label="Claim status">
                {STATUS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button className="icon-btn sm" onClick={() => invoke('research:remove', 'claim', c.id)} aria-label="Delete claim" data-tip="Delete claim">
                <Trash2 size={12} />
              </button>
            </div>
            {ev.length === 0 && <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>No evidence yet.</div>}
            {ev.map((e) => {
              const src = m.sources.find((s) => s.id === e.sourceId)
              return (
                <div key={e.id} className="kn-evidence">
                  <Quote size={12} className="dim" />
                  <div className="grow">
                    <div className="kn-quote">{e.quote}</div>
                    <div className="kn-src-meta mono">{src ? `S${srcN.get(src.id)} · ${src.title || hostOf(src.url)}` : 'source removed'}</div>
                  </div>
                  <button className="icon-btn sm kn-hover" onClick={() => upsert({ kind: 'evidence', id: e.id, missionId: m.id, claimId: null })} aria-label="Unassign" data-tip="Unassign from claim">
                    <X size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        )
      })}
      {loose.length > 0 && (
        <>
          <div className="kn-sec-h" style={{ marginTop: 18 }}>
            <span className="label">Unassigned evidence · {loose.length}</span>
          </div>
          {loose.map((e) => {
            const src = m.sources.find((s) => s.id === e.sourceId)
            return (
              <div key={e.id} className="kn-evidence card" style={{ padding: 10 }}>
                <Quote size={12} className="dim" />
                <div className="grow">
                  <div className="kn-quote">{e.quote}</div>
                  <div className="kn-src-meta mono">{src ? `S${srcN.get(src.id)} · ${src.title || hostOf(src.url)}` : 'no source'}</div>
                </div>
                <select className="select" style={{ height: 24, fontSize: 11.5, maxWidth: 200 }} value="" onChange={(ev) => ev.target.value && upsert({ kind: 'evidence', id: e.id, missionId: m.id, claimId: ev.target.value })} aria-label="Assign to claim">
                  <option value="">Assign to claim…</option>
                  {m.claims.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.text.slice(0, 60)}
                    </option>
                  ))}
                </select>
                <button className="icon-btn sm" onClick={() => invoke('research:remove', 'evidence', e.id)} aria-label="Delete evidence">
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

function Citations({ m }: { m: MissionFull }) {
  const cites = citationsFor(m)
  const apa = formatCitationList(m.sources.map((s) => ({ url: s.url, title: s.title, siteName: s.siteName, author: s.author, published: s.published, accessedAt: s.accessedAt })))
  const copy = async (text: string) => {
    await invoke('app:clipboardWrite', text)
    toast({ kind: 'ok', title: 'Citations copied' })
  }
  return (
    <div className="kn-section">
      <div className="kn-sec-h">
        <span className="label">References · APA-style web citations with access date</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => copy(cites.map((c) => `[${c.n}] ${c.text}`).join('\n'))} disabled={!cites.length}>
          <Copy size={12} /> Copy numbered
        </button>
        <button className="btn sm" onClick={() => copy(apa.join('\n\n'))} disabled={!apa.length}>
          <Copy size={12} /> Copy APA list
        </button>
      </div>
      {!cites.length && <div className="empty">No sources to cite yet.</div>}
      <ol className="kn-cites selectable">
        {cites.map((c) => (
          <li key={c.id}>
            <span className="mono dim">[{c.n}]</span> {c.text}
          </li>
        ))}
      </ol>
      {cites.length > 0 && <div className="dim" style={{ fontSize: 11.5, marginTop: 8 }}>Authors and publication dates are only included when known — edit them on each source. “n.d.” means no date.</div>}
    </div>
  )
}
