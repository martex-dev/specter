// specter://notes — local Markdown notes.
import { useEffect, useMemo, useState } from 'react'
import { FolderDown, NotebookPen, Pin, Plus, Search, X } from 'lucide-react'
import type { NoteHit, NoteSummary } from '@shared/modules/knowledge'
import { invoke } from '../../lib/ipc'
import { timeAgo } from '../../lib/format'
import { useBrowser } from '../../stores/browser'
import { toast } from '../../stores/ui'
import { Kbd } from '../../components/ui'
import type { PageProps } from '../../pages/registry'
import { NoteEditor } from './NoteEditor'
import { currentWorkspaceId, Snippet, useLoad } from './lib'

type Filter = 'all' | 'pinned' | 'workspace'

export default function NotesPage({ sub, query }: PageProps) {
  const [selected, setSelected] = useState<string | null>(sub || query.get('id') || null)
  const [filter, setFilter] = useState<Filter>('all')
  const [tag, setTag] = useState('')
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<NoteHit[] | null>(null)
  const activeWsId = useBrowser((s) => s.activeWsId)
  const workspaces = useBrowser((s) => s.workspaces)

  const [notes] = useLoad(
    () => invoke('notes:list', { pinned: filter === 'pinned' || undefined, workspaceId: filter === 'workspace' ? activeWsId : undefined, tag: tag || undefined }),
    ['notes:changed'],
    [filter, tag, activeWsId]
  )
  const [tags] = useLoad(() => invoke('notes:tags'), ['notes:changed'], [])

  useEffect(() => {
    const text = q.trim()
    if (!text) return setHits(null)
    let alive = true
    const t = setTimeout(() => {
      invoke('notes:search', text, 60)
        .then((h) => alive && setHits(h))
        .catch(() => alive && setHits([]))
    }, 120)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [q, notes])

  // Select the first note when nothing is selected.
  useEffect(() => {
    if (!selected && notes && notes.length) setSelected(notes[0].id)
  }, [notes, selected])

  const create = async () => {
    const n = await invoke('notes:create', { title: '', body: '', workspaceId: currentWorkspaceId(), tags: tag ? [tag] : [] })
    setQ('')
    setSelected(n.id)
    requestAnimationFrame(() => (document.querySelector('.kn-title-input') as HTMLInputElement | null)?.focus())
  }

  const exportAll = async () => {
    const folder = await invoke('app:pickFolder', 'Export notes to folder')
    if (!folder) return
    const r = await invoke('notes:exportAll', folder)
    toast({ kind: 'ok', title: `Exported ${r.count} notes`, body: r.folder, action: { label: 'Show', run: () => invoke('app:openPath', r.folder) } })
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        create()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag])

  const wsName = workspaces.find((w) => w.id === activeWsId)?.name ?? 'Workspace'
  const list: (NoteSummary | NoteHit)[] = hits ?? notes ?? []
  const topTags = useMemo(() => (tags ?? []).slice(0, 14), [tags])

  return (
    <div className="kn-notes">
      <div className="kn-list-pane">
        <div className="kn-list-head">
          <div>
            <div className="page-kicker">Notes</div>
            <div className="kn-list-count mono">{notes ? `${notes.length} ${filter === 'all' && !tag ? 'total' : 'shown'}` : '—'} · local</div>
          </div>
          <span className="spacer" />
          <button className="icon-btn sm" onClick={exportAll} data-tip="Export all as Markdown files" aria-label="Export all notes">
            <FolderDown size={14} />
          </button>
          <button className="btn primary sm" onClick={create} data-tip="New note" data-kbd="Alt+N">
            <Plus size={13} /> New
          </button>
        </div>
        <div className="kn-search">
          <Search size={13} />
          <input
            className="kn-search-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search notes (full text)"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQ('')
              if (e.key === 'Enter' && list[0]) setSelected(list[0].id)
            }}
            aria-label="Search notes"
          />
          {q && (
            <button className="icon-btn sm" onClick={() => setQ('')} aria-label="Clear search">
              <X size={12} />
            </button>
          )}
        </div>
        <div className="kn-filters">
          <div className="seg">
            <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
              All
            </button>
            <button className={filter === 'pinned' ? 'on' : ''} onClick={() => setFilter('pinned')}>
              Pinned
            </button>
            <button className={filter === 'workspace' ? 'on' : ''} onClick={() => setFilter('workspace')} data-tip="Notes in the current workspace">
              {wsName}
            </button>
          </div>
        </div>
        {topTags.length > 0 && (
          <div className="kn-tagbar">
            {topTags.map((t) => (
              <button key={t.tag} className={'kn-tag' + (tag === t.tag ? ' on' : '')} onClick={() => setTag(tag === t.tag ? '' : t.tag)}>
                #{t.tag} <span className="dim">{t.count}</span>
              </button>
            ))}
          </div>
        )}
        <div className="kn-list" role="listbox" aria-label="Notes">
          {hits && <div className="label kn-list-sub">{hits.length} matches</div>}
          {list.map((n) => (
            <button key={n.id} role="option" aria-selected={selected === n.id} className={'kn-item' + (selected === n.id ? ' sel' : '')} onClick={() => setSelected(n.id)}>
              <div className="kn-item-title">
                {n.pinned && <Pin size={11} className="accent" />}
                <span className="ellipsis">{n.title || 'Untitled'}</span>
              </div>
              <div className="kn-item-ex">{'snippet' in n ? <Snippet text={n.snippet} /> : n.excerpt || <span className="dim">Empty note</span>}</div>
              <div className="kn-item-meta mono">
                {timeAgo(n.updatedAt)}
                {'tags' in n && n.tags.length > 0 && <span> · {n.tags.map((t) => '#' + t).join(' ')}</span>}
              </div>
            </button>
          ))}
          {notes && list.length === 0 && (
            <div className="empty" style={{ padding: 24 }}>
              {hits ? 'No notes match.' : 'No notes yet.'}
            </div>
          )}
        </div>
      </div>
      <div className="kn-editor-pane">
        {selected ? (
          <NoteEditor key={selected} id={selected} onOpenNote={setSelected} onDeleted={() => setSelected(null)} />
        ) : (
          <div className="kn-blank">
            <NotebookPen size={28} className="dim" />
            <div className="kn-blank-title">Local Markdown notes</div>
            <div className="muted">Everything stays on this device. Link notes with [[Note title]] to build backlinks.</div>
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button className="btn primary" onClick={create}>
                <Plus size={14} /> New note
              </button>
              <span className="dim" style={{ fontSize: 12 }}>
                Quick note anywhere <Kbd keys="Ctrl+Shift+N" />
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
