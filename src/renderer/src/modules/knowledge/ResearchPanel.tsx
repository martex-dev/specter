// Research side panel: the current mission's checklist, sources and notes,
// shown next to the page being researched.
import { useEffect, useState } from 'react'
import { ArrowUpRight, Check, Circle, CircleDot, FlaskConical, Globe, Maximize2, NotebookPen, Plus, Quote } from 'lucide-react'
import { sourceUrlKey, type StepState } from '@shared/modules/knowledge'
import { isInternal } from '@shared/url'
import { invoke } from '../../lib/ipc'
import { wcIdFor } from '../../lib/webviews'
import { timeAgo } from '../../lib/format'
import { useActiveTab } from '../../stores/browser'
import { toast } from '../../stores/ui'
import { createMissionInteractive, openNote, saveResearchSource } from './actions'
import { currentWorkspaceId, hostOf, openInternal, openUrl, useLoad, useSteps } from './lib'

const NEXT: Record<StepState, StepState> = { todo: 'doing', doing: 'done', done: 'todo' }

export default function ResearchPanel({ popout }: { popout?: boolean }) {
  const tab = useActiveTab()
  const pageUrl = tab && !isInternal(tab.url) ? tab.url : ''
  const [missions] = useLoad(() => invoke('research:missions'), ['research:changed'], [])
  const [missionId, setMissionId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!missions) return
    if (missionId && missions.some((m) => m.id === missionId)) return
    invoke('research:current').then((c) => setMissionId(c && missions.some((m) => m.id === c) ? c : (missions[0]?.id ?? null)))
  }, [missions, missionId])

  const [m] = useLoad(() => (missionId ? invoke('research:get', missionId) : Promise.resolve(null)), ['research:changed', 'notes:changed'], [missionId])
  const [steps, updateSteps] = useSteps(m?.id, m?.steps)

  if (missions && !missions.length) {
    return (
      <div className="kn-blank" style={{ padding: 24 }}>
        <FlaskConical size={24} className="dim" />
        <div className="kn-blank-title">No research mission</div>
        <div className="muted" style={{ textAlign: 'center', fontSize: 12 }}>
          Start a mission, then save pages you visit as sources — their readable text is kept locally.
        </div>
        <button className="btn primary" style={{ marginTop: 12 }} onClick={() => createMissionInteractive(false).then((x) => x && setMissionId(x.id))}>
          <Plus size={13} /> New mission
        </button>
      </div>
    )
  }
  if (!m) return <div className="empty">Loading…</div>

  const pageKey = pageUrl ? sourceUrlKey(pageUrl) : ''
  const saved = pageKey ? m.sources.find((s) => sourceUrlKey(s.url) === pageKey) : undefined
  const done = steps.filter((s) => s.state === 'done').length

  const savePage = async (withSelection: boolean) => {
    setBusy(true)
    try {
      let quote = ''
      if (withSelection && tab) {
        const wcId = wcIdFor(tab.id)
        if (wcId !== null) quote = (await invoke('guest:selection', wcId).catch(() => '')).trim()
        if (!quote) {
          toast({ kind: 'info', title: 'Select text on the page first' })
          return
        }
      }
      await saveResearchSource({ missionId: m.id, quote: quote || undefined })
    } catch (err) {
      toast({ kind: 'error', title: 'Could not save source', body: String((err as Error)?.message ?? err) })
    } finally {
      setBusy(false)
    }
  }

  const addNote = async () => {
    const body = note.trim()
    if (!body) return
    const title = body.split('\n')[0].replace(/^[#>*\-\s]+/, '').slice(0, 80)
    await invoke('notes:create', {
      title,
      body: body + (pageUrl ? `\n\n— [${tab?.title || hostOf(pageUrl)}](${pageUrl})\n` : ''),
      missionId: m.id,
      sourceUrl: pageUrl || null,
      workspaceId: currentWorkspaceId()
    })
    setNote('')
  }

  return (
    <div className="kn-panel">
      <div className="kn-panel-bar">
        <select
          className="select grow"
          value={m.id}
          onChange={(e) => {
            setMissionId(e.target.value)
            invoke('research:setCurrent', e.target.value)
          }}
          aria-label="Research mission"
        >
          {(missions ?? []).map((x) => (
            <option key={x.id} value={x.id}>
              {x.title}
            </option>
          ))}
        </select>
        <button className="icon-btn sm" onClick={() => createMissionInteractive(false).then((x) => x && setMissionId(x.id))} data-tip="New mission" aria-label="New mission">
          <Plus size={14} />
        </button>
        <button className="icon-btn sm" onClick={() => openInternal('specter://research/' + m.id)} data-tip="Open full mission" aria-label="Open full mission">
          <Maximize2 size={13} />
        </button>
      </div>

      <div className="kn-panel-scroll">
        <div className="kn-panel-sec">
          <div className="row" style={{ gap: 8 }}>
            <span className="label">Progress</span>
            <span className="mono dim" style={{ fontSize: 11 }}>
              {done}/{steps.length}
            </span>
          </div>
          <div className="kn-progress" style={{ margin: '6px 0 8px' }}>
            <i style={{ width: `${steps.length ? (done / steps.length) * 100 : 0}%` }} />
          </div>
          <div className="kn-steps compact">
            {steps.map((s) => (
              <button key={s.id} className={'kn-step-btn ' + s.state} onClick={() => updateSteps((cur) => cur.map((x) => (x.id === s.id ? { ...x, state: NEXT[x.state] } : x)))}>
                {s.state === 'done' ? <Check size={12} className="ok" /> : s.state === 'doing' ? <CircleDot size={12} className="accent" /> : <Circle size={12} className="dim" />}
                <span className="kn-step-title">{s.title}</span>
              </button>
            ))}
          </div>
        </div>

        {!popout && (
          <div className="kn-panel-sec">
            <div className="label" style={{ marginBottom: 6 }}>
              This page
            </div>
            {pageUrl ? (
              <>
                <div className="kn-src-title ellipsis" style={{ fontSize: 12.5 }}>
                  {tab?.title}
                </div>
                <div className="kn-src-meta mono" style={{ marginBottom: 8 }}>
                  {hostOf(pageUrl)} · {saved ? `saved as source · ${m.evidence.filter((e) => e.sourceId === saved.id).length} quotes` : 'not saved'}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn primary sm" disabled={busy} onClick={() => savePage(false)}>
                    <Globe size={12} /> {saved ? 'Re-capture page' : 'Save as source'}
                  </button>
                  <button className="btn sm" disabled={busy} onClick={() => savePage(true)} data-tip="Save the selected text as an evidence quote">
                    <Quote size={12} /> Save selection
                  </button>
                </div>
              </>
            ) : (
              <div className="dim" style={{ fontSize: 12 }}>
                Open a web page to save it as a source.
              </div>
            )}
          </div>
        )}

        <div className="kn-panel-sec">
          <div className="label" style={{ marginBottom: 6 }}>
            Sources · {m.sources.length}
          </div>
          {m.sources.length === 0 && <div className="dim" style={{ fontSize: 12 }}>No sources yet.</div>}
          {m.sources.map((s) => (
            <button key={s.id} className={'kn-link-row' + (s.id === saved?.id ? ' current' : '')} onClick={() => openUrl(s.url)} data-tip={s.url}>
              <div className="kn-link-title ellipsis">{s.title || s.url}</div>
              <div className="kn-link-ctx mono">
                {hostOf(s.url)} · {s.text ? `${s.text.split(/\s+/).length.toLocaleString()} words` : 'link only'} · {timeAgo(s.addedAt)} <ArrowUpRight size={10} />
              </div>
            </button>
          ))}
        </div>

        <div className="kn-panel-sec">
          <div className="label" style={{ marginBottom: 6 }}>
            Notes · {m.notes.length}
          </div>
          <textarea
            className="textarea"
            style={{ width: '100%' }}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                addNote()
              }
            }}
            placeholder={pageUrl ? 'Note about this page… (Ctrl+Enter)' : 'Mission note… (Ctrl+Enter)'}
          />
          <div className="row" style={{ marginTop: 6 }}>
            <span className="spacer" />
            <button className="btn sm" disabled={!note.trim()} onClick={addNote}>
              <NotebookPen size={12} /> Add note
            </button>
          </div>
          {m.notes.map((n) => (
            <button key={n.id} className="kn-link-row" onClick={() => openNote(n.id)}>
              <div className="kn-link-title ellipsis">{n.title || 'Untitled'}</div>
              <div className="kn-link-ctx">{n.excerpt}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
