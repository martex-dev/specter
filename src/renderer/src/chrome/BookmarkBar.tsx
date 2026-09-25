import { useEffect, useState } from 'react'
import { AppWindow, ExternalLink, Folder, FolderPlus, Pencil, Trash2, Plus, Layers } from 'lucide-react'
import type { Bookmark } from '@shared/types'
import { invoke, on } from '../lib/ipc'
import { activeTab, loadUrl, newTab } from '../stores/browser'
import { openMenu, type MenuItem } from '../stores/ui'
import { Favicon } from '../components/ui'
import { promptText } from '../components/prompt'

export function useBookmarks(): Bookmark[] {
  const [list, setList] = useState<Bookmark[]>([])
  useEffect(() => {
    const load = () => invoke('bookmarks:list').then(setList).catch(() => undefined)
    load()
    const off = on('bookmarks:changed', () => {
      load()
      window.dispatchEvent(new Event('specter:bookmarks-changed'))
    })
    return off
  }, [])
  return list
}

export function openBookmark(b: Bookmark, mode: 'current' | 'tab' | 'background' | 'window' = 'current'): void {
  if (!b.url) return
  if (mode === 'window') invoke('window:new', { url: b.url })
  else if (mode === 'tab' || mode === 'background') newTab(b.url, { background: mode === 'background' })
  else {
    const t = activeTab()
    if (t) loadUrl(t.id, b.url)
    else newTab(b.url)
  }
}

export function bookmarkMenu(b: Bookmark, all: Bookmark[]): MenuItem[] {
  const items: MenuItem[] = []
  if (b.kind === 'bookmark') {
    items.push(
      { label: 'Open', icon: <ExternalLink size={14} />, run: () => openBookmark(b) },
      { label: 'Open in new tab', icon: <Plus size={14} />, run: () => openBookmark(b, 'tab') },
      { label: 'Open in new window', icon: <AppWindow size={14} />, run: () => openBookmark(b, 'window') },
      { separator: true }
    )
  } else {
    const kids = all.filter((x) => x.parentId === b.id && x.url)
    items.push({ label: `Open all (${kids.length})`, icon: <Layers size={14} />, disabled: !kids.length, run: () => kids.forEach((k) => openBookmark(k, 'background')) }, { separator: true })
  }
  items.push({
    label: 'Edit…',
    icon: <Pencil size={14} />,
    run: async () => {
      const title = await promptText({ title: b.kind === 'folder' ? 'Rename folder' : 'Edit bookmark', label: 'Name', initial: b.title })
      if (title === null) return
      let url = b.url
      if (b.kind === 'bookmark') {
        const u = await promptText({ title: 'Edit bookmark', label: 'URL', initial: b.url })
        if (u === null) return
        url = u
      }
      await invoke('bookmarks:update', b.id, { title, url })
    }
  })
  if (!b.id.startsWith('bar_') && !b.id.startsWith('other_')) items.push({ label: 'Delete', icon: <Trash2 size={14} />, danger: true, run: () => invoke('bookmarks:remove', b.id) })
  items.push(
    { separator: true },
    {
      label: 'Add folder…',
      icon: <FolderPlus size={14} />,
      run: async () => {
        const name = await promptText({ title: 'New folder', placeholder: 'Folder name' })
        if (name) await invoke('bookmarks:add', { kind: 'folder', title: name, parentId: b.kind === 'folder' ? b.id : b.parentId })
      }
    }
  )
  return items
}

function folderMenu(folder: Bookmark, all: Bookmark[]): MenuItem[] {
  const kids = all.filter((x) => x.parentId === folder.id).sort((a, b) => a.sort - b.sort)
  if (!kids.length) return [{ label: '(empty)', disabled: true }]
  return kids.map((k) =>
    k.kind === 'folder'
      ? { label: k.title, icon: <Folder size={14} />, submenu: folderMenu(k, all) }
      : { label: k.title || k.url, icon: <Favicon src={k.favicon} url={k.url ?? ''} size={14} />, run: () => openBookmark(k) }
  )
}

export function BookmarkBar() {
  const all = useBookmarks()
  const [dropIdx, setDropIdx] = useState<number | null>(null)
  const bar = all.find((b) => b.id.startsWith('bar_'))
  const other = all.find((b) => b.id.startsWith('other_'))
  const items = bar ? all.filter((b) => b.parentId === bar.id).sort((a, b) => a.sort - b.sort) : []

  const onDrop = async (e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDropIdx(null)
    const bmId = e.dataTransfer.getData('application/x-specter-bookmark')
    if (bmId) return invoke('bookmarks:move', bmId, bar?.id ?? null, index)
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    if (url && /^(https?|file):/.test(url)) {
      const tab = activeTab()
      const title = tab?.url === url ? tab.title : url.replace(/^https?:\/\/(www\.)?/, '')
      const b = await invoke('bookmarks:add', { kind: 'bookmark', title, url, parentId: bar?.id, favicon: tab?.url === url ? tab.favicon : undefined })
      await invoke('bookmarks:move', b.id, bar?.id ?? null, index)
    }
  }

  return (
    <div
      className="bookmarks-bar"
      onDragOver={(e) => {
        e.preventDefault()
        if (dropIdx === null) setDropIdx(items.length)
      }}
      onDragLeave={() => setDropIdx(null)}
      onDrop={(e) => onDrop(e, dropIdx ?? items.length)}
      onContextMenu={(e) => {
        if (e.target !== e.currentTarget || !bar) return
        e.preventDefault()
        openMenu({ x: e.clientX, y: e.clientY, items: bookmarkMenu(bar, all) })
      }}
    >
      {items.length === 0 && <span className="muted" style={{ fontSize: 11.5, padding: '0 6px' }}>Drag tabs here or press Ctrl+D to bookmark pages</span>}
      {items.map((b, i) => (
        <button
          key={b.id}
          className={'bm-item' + (dropIdx === i ? ' drop' : '')}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-specter-bookmark', b.id)
            if (b.url) e.dataTransfer.setData('text/uri-list', b.url)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            setDropIdx(e.clientX > r.left + r.width / 2 ? i + 1 : i)
          }}
          onDrop={(e) => {
            e.stopPropagation()
            onDrop(e, dropIdx ?? i)
          }}
          onClick={(e) => {
            if (b.kind === 'folder') {
              const r = e.currentTarget.getBoundingClientRect()
              openMenu({ x: r.left, y: r.bottom + 4, items: folderMenu(b, all), width: 240 })
            } else openBookmark(b, e.ctrlKey ? 'background' : e.shiftKey ? 'window' : 'current')
          }}
          onAuxClick={(e) => e.button === 1 && openBookmark(b, 'background')}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            openMenu({ x: e.clientX, y: e.clientY, items: bookmarkMenu(b, all) })
          }}
          data-tip={b.kind === 'bookmark' ? b.url : undefined}
        >
          {b.kind === 'folder' ? <Folder size={14} style={{ color: 'var(--fg-2)' }} /> : <Favicon src={b.favicon} url={b.url ?? ''} size={14} />}
          <span>{b.title}</span>
        </button>
      ))}
      <span className="spacer" />
      {other && (
        <button
          className="bm-item"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            openMenu({ x: r.right - 240, y: r.bottom + 4, items: folderMenu(other, all), width: 240 })
          }}
        >
          <Folder size={14} style={{ color: 'var(--fg-2)' }} />
          <span>Other bookmarks</span>
        </button>
      )}
    </div>
  )
}
