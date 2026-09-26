import { useMemo, useState } from 'react'
import { ChevronRight, Download, Folder, FolderOpen, FolderPlus, Plus, Search, Tag, Upload } from 'lucide-react'
import type { Bookmark } from '@shared/types'
import { hostname } from '@shared/url'
import { invoke } from '../lib/ipc'
import { openMenu, toast } from '../stores/ui'
import { useBrowser } from '../stores/browser'
import { Favicon } from '../components/ui'
import { promptText } from '../components/prompt'
import { bookmarkMenu, openBookmark, useBookmarks } from '../chrome/BookmarkBar'
import type { PageProps } from './registry'
import { bookmarkDropIndex } from './pageLogic'

export default function Bookmarks(_: PageProps) {
  const all = useBookmarks()
  const [folder, setFolder] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [wsFilter, setWsFilter] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const workspaces = useBrowser((s) => s.workspaces)

  const roots = all.filter((b) => b.parentId === null)
  // Fall back to the first root if the open folder was deleted (from here or the bookmarks bar).
  const current = (folder && all.some((b) => b.id === folder) ? folder : null) ?? roots[0]?.id ?? null
  const folders = all.filter((b) => b.kind === 'folder')
  const tags = useMemo(() => [...new Set(all.flatMap((b) => b.tags))].filter((t) => !t.startsWith('workspace:')).sort(), [all])

  const items = useMemo(() => {
    if (q || tag || wsFilter) {
      const ql = q.toLowerCase()
      return all.filter(
        (b) =>
          b.kind === 'bookmark' &&
          (!q || b.title.toLowerCase().includes(ql) || (b.url ?? '').toLowerCase().includes(ql) || b.tags.some((t) => t.toLowerCase().includes(ql))) &&
          (!tag || b.tags.includes(tag)) &&
          (!wsFilter || b.workspaceId === wsFilter)
      )
    }
    return all.filter((b) => b.parentId === current).sort((a, b) => (a.kind === b.kind ? a.sort - b.sort : a.kind === 'folder' ? -1 : 1))
  }, [all, current, q, tag, wsFilter])

  const path = useMemo(() => {
    const out: Bookmark[] = []
    let id: string | null = current
    while (id) {
      const b = all.find((x) => x.id === id)
      if (!b) break
      out.unshift(b)
      id = b.parentId
    }
    return out
  }, [all, current])

  const tree = (parent: string | null, depth: number): JSX.Element[] =>
    folders
      .filter((f) => f.parentId === parent)
      .sort((a, b) => a.sort - b.sort)
      .flatMap((f) => [
        <button
          key={f.id}
          className={'list-row' + (current === f.id && !q ? ' sel' : '')}
          style={{ paddingLeft: 8 + depth * 14, width: '100%', border: 'none', background: current === f.id && !q ? 'var(--accent-dim)' : undefined, color: current === f.id && !q ? 'var(--accent)' : undefined }}
          onClick={() => {
            setFolder(f.id)
            setQ('')
            setTag('')
            setWsFilter('')
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => dragId && invoke('bookmarks:move', dragId, f.id, 9999)}
        >
          {current === f.id ? <FolderOpen size={14} /> : <Folder size={14} />}
          <span className="ellipsis">{f.title}</span>
        </button>,
        ...tree(f.id, depth + 1)
      ])

  return (
    <div className="page wide">
      <div className="page-h">
        <div className="grow">
          <div className="page-kicker">Browser</div>
          <h1 className="page-title">Bookmarks</h1>
          <div className="page-sub">{all.filter((b) => b.kind === 'bookmark').length} bookmarks · folders, tags and workspace links</div>
        </div>
        <button
          className="btn"
          onClick={async () => {
            const title = await promptText({ title: 'Add bookmark', label: 'Name' })
            if (!title) return
            const url = await promptText({ title: 'Add bookmark', label: 'URL', initial: 'https://' })
            if (!url) return
            const tagsText = await promptText({ title: 'Add bookmark', label: 'Tags (comma separated, optional)' })
            await invoke('bookmarks:add', { kind: 'bookmark', title, url, parentId: current, tags: (tagsText ?? '').split(',').map((t) => t.trim()).filter(Boolean) })
          }}
        >
          <Plus size={14} /> Add
        </button>
        <button
          className="btn"
          onClick={async () => {
            const name = await promptText({ title: 'New folder', placeholder: 'Folder name' })
            if (name) await invoke('bookmarks:add', { kind: 'folder', title: name, parentId: current })
          }}
        >
          <FolderPlus size={14} /> Folder
        </button>
        <button className="btn" onClick={async () => toast({ kind: 'ok', title: `Imported ${await invoke('bookmarks:importHtml')} bookmarks` })}>
          <Upload size={14} /> Import HTML
        </button>
        <button className="btn" onClick={async () => ((p) => p && toast({ kind: 'ok', title: 'Bookmarks exported', body: p }))(await invoke('bookmarks:exportHtml'))}>
          <Download size={14} /> Export
        </button>
      </div>
      <div style={{ display: 'flex', gap: 20 }}>
        <div style={{ width: 230, flex: 'none' }}>
          <div className="col" style={{ gap: 1 }}>
            {tree(null, 0)}
          </div>
          {tags.length > 0 && (
            <>
              <div className="label" style={{ margin: '18px 0 6px 8px' }}>
                Tags
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 4, paddingLeft: 6 }}>
                {tags.map((t) => (
                  <button key={t} className={'badge' + (tag === t ? ' accent' : '')} style={{ cursor: 'pointer' }} onClick={() => setTag(tag === t ? '' : t)}>
                    <Tag size={9} /> {t}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="grow">
          <div className="row" style={{ marginBottom: 12, gap: 8 }}>
            <div className="row grow" style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--fg-3)' }} />
              <input className="input grow" style={{ paddingLeft: 30, height: 34 }} placeholder="Search all bookmarks, URLs and tags…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="select" style={{ height: 34 }} value={wsFilter} onChange={(e) => setWsFilter(e.target.value)} aria-label="Workspace">
              <option value="">Any workspace</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          {!q && !tag && !wsFilter && (
            <div className="row muted" style={{ fontSize: 12, marginBottom: 8, gap: 4 }}>
              {path.map((p, i) => (
                <span key={p.id} className="row" style={{ gap: 4 }}>
                  {i > 0 && <ChevronRight size={12} />}
                  <a style={{ cursor: 'pointer', color: i === path.length - 1 ? 'var(--fg-0)' : 'var(--fg-2)' }} onClick={() => setFolder(p.id)}>
                    {p.title}
                  </a>
                </span>
              ))}
            </div>
          )}
          <div className="card">
            {items.length === 0 && <div className="empty">{q || tag || wsFilter ? 'No bookmarks match.' : 'This folder is empty.'}</div>}
            {items.map((b) => (
              <div
                key={b.id}
                className="history-item"
                style={{ height: 40, borderBottom: '1px solid var(--line)', borderRadius: 0 }}
                draggable
                onDragStart={() => setDragId(b.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dragId && dragId !== b.id && invoke('bookmarks:move', dragId, b.kind === 'folder' ? b.id : b.parentId, b.kind === 'folder' ? 9999 : bookmarkDropIndex(all, b.id))}
                onDoubleClick={() => (b.kind === 'folder' ? setFolder(b.id) : openBookmark(b))}
                onContextMenu={(e) => {
                  e.preventDefault()
                  openMenu({
                    x: e.clientX,
                    y: e.clientY,
                    items: [
                      ...bookmarkMenu(b, all),
                      ...(b.kind === 'bookmark'
                        ? [
                            {
                              label: 'Edit tags…',
                              icon: <Tag size={14} />,
                              run: async () => {
                                const t = await promptText({ title: 'Tags', label: 'Comma separated', initial: b.tags.join(', ') })
                                if (t !== null) invoke('bookmarks:update', b.id, { tags: t.split(',').map((x) => x.trim()).filter(Boolean) })
                              }
                            },
                            {
                              label: 'Link to workspace',
                              submenu: [{ label: 'None', run: () => invoke('bookmarks:update', b.id, { workspaceId: '' }) }, ...workspaces.map((w) => ({ label: w.name, checked: b.workspaceId === w.id, run: () => invoke('bookmarks:update', b.id, { workspaceId: w.id }) }))]
                            }
                          ]
                        : [])
                    ]
                  })
                }}
              >
                {b.kind === 'folder' ? <Folder size={15} className="muted" /> : <Favicon src={b.favicon} url={b.url ?? ''} />}
                <a className="ellipsis" style={{ color: 'var(--fg-0)', cursor: 'pointer', maxWidth: '50%' }} onClick={(e) => (b.kind === 'folder' ? setFolder(b.id) : openBookmark(b, e.ctrlKey ? 'background' : 'current'))}>
                  {b.title}
                </a>
                <span className="host ellipsis grow">{b.url ? hostname(b.url) : `${all.filter((x) => x.parentId === b.id).length} items`}</span>
                {b.tags
                  .filter((t) => !t.startsWith('workspace:'))
                  .slice(0, 3)
                  .map((t) => (
                    <span key={t} className="badge">
                      {t}
                    </span>
                  ))}
                {b.workspaceId && <span className="badge accent">{workspaces.find((w) => w.id === b.workspaceId)?.name ?? 'workspace'}</span>}
              </div>
            ))}
          </div>
          <div className="dim" style={{ fontSize: 11.5, marginTop: 8 }}>
            Drag to reorder or drop onto a folder. Double-click to open. Right-click for more.
          </div>
        </div>
      </div>
    </div>
  )
}
