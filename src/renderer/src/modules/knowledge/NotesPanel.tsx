// Notes side panel: notes for this page / workspace next to the browser page.
import { useEffect, useState } from 'react'
import { ArrowLeft, Maximize2, Pin, Plus, Search } from 'lucide-react'
import type { NoteHit, NoteSummary } from '@shared/modules/knowledge'
import { isInternal } from '@shared/url'
import { invoke } from '../../lib/ipc'
import { timeAgo } from '../../lib/format'
import { useActiveTab, useBrowser } from '../../stores/browser'
import { NoteEditor } from './NoteEditor'
import { currentWorkspaceId, openInternal, Snippet, useLoad } from './lib'

type Scope = 'page' | 'workspace' | 'all'

export default function NotesPanel({ popout }: { popout?: boolean }) {
  const tab = useActiveTab()
  const activeWsId = useBrowser((s) => s.activeWsId)
  const pageUrl = tab && !isInternal(tab.url) ? tab.url : ''
  const [scope, setScope] = useState<Scope>(popout ? 'all' : 'workspace')
  const [open, setOpen] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<NoteHit[] | null>(null)

  const [notes] = useLoad(
    () =>
      scope === 'page'
        ? pageUrl
          ? invoke('notes:list', { sourceUrl: pageUrl })
          : Promise.resolve([] as NoteSummary[])
        : invoke('notes:list', { workspaceId: scope === 'workspace' && activeWsId ? activeWsId : undefined, limit: 300 }),
    ['notes:changed'],
    [scope, pageUrl, activeWsId]
  )

  useEffect(() => {
    const text = q.trim()
    if (!text) return setHits(null)
    const t = setTimeout(() => invoke('notes:search', text, 40).then(setHits).catch(() => setHits([])), 120)
    return () => clearTimeout(t)
  }, [q])

  const create = async () => {
    const n = await invoke('notes:create', {
      title: scope === 'page' && tab ? tab.title : '',
      body: scope === 'page' && pageUrl ? `[${tab?.title || pageUrl}](${pageUrl})\n\n` : '',
      sourceUrl: scope === 'page' && pageUrl ? pageUrl : null,
      workspaceId: currentWorkspaceId()
    })
    setOpen(n.id)
  }

  if (open) {
    return (
      <div className="kn-panel">
        <div className="kn-panel-bar">
          <button className="btn ghost sm" onClick={() => setOpen(null)}>
            <ArrowLeft size={13} /> Notes
          </button>
          <span className="spacer" />
          <button className="icon-btn sm" onClick={() => openInternal('specter://notes/' + open)} data-tip="Open in full editor" aria-label="Open in full editor">
            <Maximize2 size={13} />
          </button>
        </div>
        <div className="kn-panel-editor">
          <NoteEditor key={open} id={open} compact onOpenNote={setOpen} onDeleted={() => setOpen(null)} />
        </div>
      </div>
    )
  }

  const list: (NoteSummary | NoteHit)[] = hits ?? notes ?? []
  return (
    <div className="kn-panel">
      <div className="kn-panel-bar">
        <div className="kn-search grow" style={{ margin: 0 }}>
          <Search size={13} />
          <input className="kn-search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes" aria-label="Search notes" />
        </div>
        <button className="btn primary sm" onClick={create} data-tip={scope === 'page' ? 'New note about this page' : 'New note'}>
          <Plus size={13} /> New
        </button>
      </div>
      {!hits && (
        <div className="kn-panel-bar" style={{ paddingTop: 0 }}>
          <div className="seg">
            {!popout && (
              <button className={scope === 'page' ? 'on' : ''} onClick={() => setScope('page')} disabled={!pageUrl}>
                This page
              </button>
            )}
            {!popout && (
              <button className={scope === 'workspace' ? 'on' : ''} onClick={() => setScope('workspace')}>
                Workspace
              </button>
            )}
            <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
              All
            </button>
          </div>
          <span className="spacer" />
          <button className="btn ghost sm" onClick={() => openInternal('specter://notes')}>
            Open notes
          </button>
        </div>
      )}
      <div className="kn-list">
        {list.map((n) => (
          <button key={n.id} className="kn-item" onClick={() => setOpen(n.id)}>
            <div className="kn-item-title">
              {n.pinned && <Pin size={11} className="accent" />}
              <span className="ellipsis">{n.title || 'Untitled'}</span>
            </div>
            <div className="kn-item-ex">{'snippet' in n ? <Snippet text={n.snippet} /> : n.excerpt || <span className="dim">Empty note</span>}</div>
            <div className="kn-item-meta mono">{timeAgo(n.updatedAt)}</div>
          </button>
        ))}
        {notes && list.length === 0 && (
          <div className="empty" style={{ padding: 20 }}>
            {hits ? 'No notes match.' : scope === 'page' ? 'No notes for this page yet.' : 'No notes yet.'}
          </div>
        )}
      </div>
    </div>
  )
}
