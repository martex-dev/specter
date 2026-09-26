import { memo, useEffect, useRef, useState } from 'react'
import {
  AppWindow,
  BellOff,
  Bookmark,
  Columns2,
  Copy,
  CopyX,
  FolderInput,
  Layers,
  Moon,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  StickyNote,
  Sun,
  Volume2,
  VolumeX,
  X,
  ChevronDown,
  ArrowRightToLine,
  Tag,
  Ungroup
} from 'lucide-react'
import type { GroupColor, TabGroup } from '@shared/types'
import { hostname, isInternal } from '@shared/url'
import { invoke } from '../lib/ipc'
import { GROUP_COLOR_HEX, workspaceIcon } from '../lib/icons'
import { formatBytes } from '../lib/format'
import { runCommand, shortcutFor } from '../lib/commands'
import { wcIdFor } from '../lib/webviews'
import {
  activateTab,
  addTabToGroup,
  closeDuplicateTabs,
  closeGroup,
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  createGroup,
  duplicateTab,
  moveTab,
  moveTabToNewWindow,
  moveTabToWorkspace,
  newTab,
  reload,
  reopenClosedTab,
  setMuted,
  setTabNote,
  splitWith,
  suspendTab,
  togglePin,
  ungroup,
  updateGroup,
  useActiveWs,
  useBrowser,
  visibleTabIds,
  wakeTab,
  muteAll,
  type RuntimeTab
} from '../stores/browser'
import { openMenu, openOverlay, toast, type MenuItem } from '../stores/ui'
import { getSetting, useSetting } from '../stores/settings'
import { Favicon } from '../components/ui'
import { promptText } from '../components/prompt'

const DRAG_MIME = 'application/x-specter-tab'

export function TabStrip() {
  const ws = useActiveWs()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null)
  const [preview, setPreview] = useState<{ tab: RuntimeTab; x: number; y: number } | null>(null)
  const showPreviews = useSetting('tabs.showPreviews')

  // Keep the active tab scrolled into view.
  useEffect(() => {
    const el = scrollRef.current?.querySelector('.tab.active') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [ws?.activeTabId])

  if (!ws) return <div className="tabstrip" />
  const visible = new Set(visibleTabIds(ws))
  const groupsById = new Map(ws.groups.map((g) => [g.id, g]))

  const items: ({ kind: 'tab'; tab: RuntimeTab; group?: TabGroup } | { kind: 'group'; group: TabGroup; count: number })[] = []
  let lastGroup: string | undefined
  for (const t of ws.tabs) {
    const g = t.groupId ? groupsById.get(t.groupId) : undefined
    if (g && g.id !== lastGroup) items.push({ kind: 'group', group: g, count: ws.tabs.filter((x) => x.groupId === g.id).length })
    lastGroup = g?.id
    if (g?.collapsed && t.id !== ws.activeTabId) continue
    items.push({ kind: 'tab', tab: t, group: g })
  }

  const onDrop = (e: React.DragEvent, targetId: string, after: boolean, groupId?: string) => {
    const id = e.dataTransfer.getData(DRAG_MIME)
    setDrop(null)
    if (!id || id === targetId) return
    e.preventDefault()
    const targetIdx = ws.tabs.findIndex((t) => t.id === targetId)
    const fromIdx = ws.tabs.findIndex((t) => t.id === id)
    if (fromIdx < 0) return
    let to = after ? targetIdx + 1 : targetIdx
    if (fromIdx < to) to--
    moveTab(id, to)
    const target = ws.tabs[targetIdx]
    const srcTab = ws.tabs[fromIdx]
    if (groupId !== undefined) addTabToGroup(id, groupId)
    else if (target && target.groupId !== srcTab.groupId && !srcTab.pinned) addTabToGroup(id, target.groupId)
  }

  return (
    <div className="tabstrip" onDoubleClick={(e) => e.target === e.currentTarget && newTab()}>
      <div
        className="tabstrip-scroll"
        ref={scrollRef}
        onWheel={(e) => {
          if (scrollRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) scrollRef.current.scrollLeft += e.deltaY
        }}
        // A drag that is cancelled or dropped anywhere but on a tab must not
        // leave the drop marker behind.
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDrop(null)}
        onDragEnd={() => setDrop(null)}
        role="tablist"
        aria-label="Tabs"
      >
        {items.map((it) =>
          it.kind === 'group' ? (
            <GroupChip key={'g' + it.group.id} group={it.group} count={it.count} />
          ) : (
            <TabItem
              key={it.tab.id}
              tab={it.tab}
              active={it.tab.id === ws.activeTabId}
              inSplit={visible.has(it.tab.id) && visible.size > 1}
              groupColor={it.group ? GROUP_COLOR_HEX[it.group.color] : undefined}
              dropState={drop?.id === it.tab.id ? (drop.after ? 'after' : 'before') : null}
              onDragOverTab={(after) => setDrop({ id: it.tab.id, after })}
              onDropTab={(e, after) => onDrop(e, it.tab.id, after)}
              onPreview={showPreviews ? setPreview : undefined}
              narrow={ws.tabs.length > 14}
            />
          )
        )}
      </div>
      <button className="icon-btn tabstrip-btn" onClick={() => newTab()} data-tip="New tab" data-kbd={shortcutFor('browser.newTab')} aria-label="New tab">
        <Plus size={16} />
      </button>
      <div
        className="drag"
        style={{ flex: 1, minWidth: 24, alignSelf: 'stretch' }}
        onDoubleClick={() => newTab()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          // Links or URLs dropped onto the empty strip open in a new tab.
          if (e.dataTransfer.types.includes(DRAG_MIME)) return
          const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).split('\n')[0].trim()
          if (/^(https?|file):\/\//i.test(url)) {
            e.preventDefault()
            newTab(url)
          }
        }}
      />
      {preview && <TabPreview tab={preview.tab} x={preview.x} y={preview.y} />}
    </div>
  )
}

export function WorkspacePill() {
  const ws = useActiveWs()
  const count = useBrowser((s) => s.workspaces.length)
  if (!ws) return null
  const Icon = workspaceIcon(ws.icon)
  return (
    <button className="ws-pill" onClick={() => openOverlay('workspaces')} data-tip={`Workspaces (${count})`} data-kbd={shortcutFor('workspace.switcher')} aria-label={`Workspace: ${ws.name}`}>
      <span className="ws-icon" style={{ background: ws.color + '26', color: ws.color }}>
        <Icon size={11} strokeWidth={2.4} />
      </span>
      <span className="ellipsis" style={{ fontWeight: 500 }}>
        {ws.name}
      </span>
      <ChevronDown size={12} style={{ color: 'var(--fg-3)', flex: 'none' }} />
    </button>
  )
}

function GroupChip({ group, count }: { group: TabGroup; count: number }) {
  const color = GROUP_COLOR_HEX[group.color]
  const onMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    openMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { header: group.name || 'Tab group' },
        {
          label: 'Rename group…',
          icon: <Tag size={14} />,
          run: async () => {
            const name = await promptText({ title: 'Rename group', initial: group.name, placeholder: 'Group name' })
            if (name !== null) updateGroup(group.id, { name: name.trim() })
          }
        },
        {
          label: 'Color',
          icon: <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: 'inline-block' }} />,
          submenu: (Object.keys(GROUP_COLOR_HEX) as GroupColor[]).map((c) => ({
            label: c[0].toUpperCase() + c.slice(1),
            icon: <span style={{ width: 10, height: 10, borderRadius: 3, background: GROUP_COLOR_HEX[c], display: 'inline-block' }} />,
            run: () => updateGroup(group.id, { color: c })
          }))
        },
        { label: group.collapsed ? 'Expand group' : 'Collapse group', icon: <ChevronDown size={14} />, run: () => updateGroup(group.id, { collapsed: !group.collapsed }) },
        { label: 'New tab in group', icon: <Plus size={14} />, run: () => newTab('specter://newtab', { groupId: group.id }) },
        { separator: true },
        { label: 'Ungroup', icon: <Ungroup size={14} />, run: () => ungroup(group.id) },
        { label: 'Close group', icon: <X size={14} />, danger: true, run: () => closeGroup(group.id) }
      ]
    })
  }
  return (
    <div
      className={'group-chip' + (group.name ? '' : ' empty-name') + (group.collapsed ? ' collapsed' : '')}
      style={{ background: color }}
      onClick={() => updateGroup(group.id, { collapsed: !group.collapsed })}
      onContextMenu={onMenu}
      data-tip={`${group.name || 'Unnamed group'} · ${count} tab${count === 1 ? '' : 's'}${group.collapsed ? ' (collapsed)' : ''}`}
      role="button"
      aria-label={`Tab group ${group.name}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(DRAG_MIME)
        if (id) addTabToGroup(id, group.id)
      }}
    >
      {group.name && <span className="ellipsis">{group.name}</span>}
      {group.collapsed && group.name && <span style={{ opacity: 0.7, fontWeight: 500 }}>{count}</span>}
    </div>
  )
}

interface TabItemProps {
  tab: RuntimeTab
  active: boolean
  inSplit: boolean
  groupColor?: string
  dropState: 'before' | 'after' | null
  narrow: boolean
  onDragOverTab: (after: boolean) => void
  onDropTab: (e: React.DragEvent, after: boolean) => void
  onPreview?: (p: { tab: RuntimeTab; x: number; y: number } | null) => void
}

const TabItem = memo(function TabItem({ tab, active, inSplit, groupColor, dropState, narrow, onDragOverTab, onDropTab, onPreview }: TabItemProps) {
  const ref = useRef<HTMLDivElement>(null)
  const hoverTimer = useRef<number | undefined>(undefined)
  const [dragging, setDragging] = useState(false)

  const cls = ['tab', active && 'active', tab.pinned && 'pinned', tab.suspended && 'suspended', inSplit && 'in-split', dragging && 'dragging', dropState && `drop-${dropState}`, narrow && !active && 'narrow'].filter(Boolean).join(' ')

  const onContext = (e: React.MouseEvent) => {
    e.preventDefault()
    onPreview?.(null)
    openMenu({ x: e.clientX, y: e.clientY, items: tabMenu(tab), width: 250 })
  }

  return (
    <div
      ref={ref}
      className={cls}
      role="tab"
      aria-selected={active}
      title=""
      draggable
      onMouseDown={(e) => {
        if (e.button === 0) activateTab(tab.id)
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault()
          closeTab(tab.id)
        }
      }}
      onDoubleClick={() => {
        if (getSetting('tabs.closeOnDoubleClick')) closeTab(tab.id)
      }}
      onContextMenu={onContext}
      onMouseEnter={() => {
        if (!onPreview) return
        clearTimeout(hoverTimer.current)
        hoverTimer.current = window.setTimeout(() => {
          const r = ref.current?.getBoundingClientRect()
          if (r) onPreview({ tab, x: r.left, y: r.bottom + 6 })
        }, 650)
      }}
      onMouseLeave={() => {
        clearTimeout(hoverTimer.current)
        onPreview?.(null)
      }}
      onDragStart={(e) => {
        onPreview?.(null)
        e.dataTransfer.setData(DRAG_MIME, tab.id)
        e.dataTransfer.setData('text/uri-list', tab.url)
        e.dataTransfer.setData('text/plain', tab.url)
        e.dataTransfer.effectAllowed = 'copyMove'
        setDragging(true)
      }}
      onDragEnd={(e) => {
        setDragging(false)
        // Dropped outside the window → tear off into a new window.
        if (e.dataTransfer.dropEffect === 'none' && (e.clientY < -40 || e.clientY > window.innerHeight + 10 || e.clientX < -20 || e.clientX > window.innerWidth + 20)) {
          moveTabToNewWindow(tab.id)
        }
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return
        e.preventDefault()
        const r = ref.current!.getBoundingClientRect()
        onDragOverTab(e.clientX > r.left + r.width / 2)
      }}
      onDrop={(e) => {
        const r = ref.current!.getBoundingClientRect()
        onDropTab(e, e.clientX > r.left + r.width / 2)
      }}
    >
      <span className="tab-favicon">{tab.loading && !tab.suspended ? <span className="tab-spinner" /> : <Favicon src={tab.favicon} url={tab.url} />}</span>
      {!tab.pinned && (
        <>
          <span className="tab-title">{tab.title || hostname(tab.url) || 'New Tab'}</span>
          {tab.note && <span className="tab-note-dot" data-tip={'Note: ' + tab.note} />}
          {(tab.audible || tab.muted) && (
            <button
              className="tab-audio"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                setMuted(tab.id, !tab.muted)
              }}
              aria-label={tab.muted ? 'Unmute tab' : 'Mute tab'}
              data-tip={tab.muted ? 'Unmute tab' : 'Mute tab'}
            >
              {tab.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
            </button>
          )}
          <button
            className="tab-close"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              closeTab(tab.id)
            }}
            aria-label="Close tab"
          >
            <X size={13} />
          </button>
        </>
      )}
      {tab.pinned && (tab.audible || tab.muted) && <span style={{ position: 'absolute', right: 4, top: 5, color: 'var(--fg-1)' }}>{tab.muted ? <VolumeX size={10} /> : <Volume2 size={10} />}</span>}
      {groupColor && <span className="tab-group-line" style={{ background: groupColor }} />}
    </div>
  )
})

function TabPreview({ tab, x, y }: { tab: RuntimeTab; x: number; y: number }) {
  const [thumb, setThumb] = useState<string | null>(null)
  const [mem, setMem] = useState<number | null>(null)
  useEffect(() => {
    const wcId = wcIdFor(tab.id)
    if (wcId === null || tab.suspended) return
    invoke('guest:thumbnail', wcId).then(setThumb).catch(() => undefined)
    invoke('guest:pageMemory', wcId).then(setMem).catch(() => undefined)
  }, [tab.id, tab.suspended])
  const left = Math.min(x, window.innerWidth - 276)
  return (
    <div className="tab-preview pop" style={{ left, top: y }}>
      <div className="tp-title">{tab.title}</div>
      <div className="tp-url ellipsis">{isInternal(tab.url) ? tab.url : hostname(tab.url)}</div>
      <div className="row" style={{ marginTop: 6, gap: 6, flexWrap: 'wrap' }}>
        {tab.suspended ? <span className="badge">Sleeping</span> : <span className="badge ok">Active</span>}
        {tab.suspended && tab.memoryReleasedKB ? <span className="badge">{formatBytes(tab.memoryReleasedKB * 1024)} freed</span> : null}
        {!tab.suspended && mem ? <span className="badge">{formatBytes(mem * 1024)} memory</span> : null}
        {tab.muted && <span className="badge">Muted</span>}
      </div>
      {tab.note && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--warn)' }}>📝 {tab.note}</div>}
      {thumb && <img src={thumb} alt="" />}
    </div>
  )
}

export function tabMenu(tab: RuntimeTab): MenuItem[] {
  const st = useBrowser.getState()
  const ws = st.open[st.activeWsId]
  const groups = ws?.groups ?? []
  const otherWorkspaces = st.workspaces.filter((w) => w.id !== st.activeWsId)
  return [
    { label: 'New tab to the right', icon: <Plus size={14} />, run: () => newTab('specter://newtab', { index: (ws?.tabs.findIndex((t) => t.id === tab.id) ?? 0) + 1 }) },
    { separator: true },
    { label: 'Reload', icon: <RefreshCw size={14} />, shortcut: shortcutFor('browser.reload'), run: () => reload(tab.id) },
    { label: 'Duplicate', icon: <Copy size={14} />, run: () => duplicateTab(tab.id) },
    { label: tab.pinned ? 'Unpin tab' : 'Pin tab', icon: tab.pinned ? <PinOff size={14} /> : <Pin size={14} />, run: () => togglePin(tab.id) },
    { label: tab.muted ? 'Unmute tab' : 'Mute tab', icon: tab.muted ? <Volume2 size={14} /> : <VolumeX size={14} />, run: () => setMuted(tab.id, !tab.muted) },
    { label: 'Mute all other tabs', icon: <BellOff size={14} />, run: () => muteAll(tab.id) },
    {
      label: tab.note ? 'Edit tab note…' : 'Add tab note…',
      icon: <StickyNote size={14} />,
      run: async () => {
        const note = await promptText({ title: 'Tab note', initial: tab.note, placeholder: 'e.g. Need to inspect this API later', multiline: true })
        if (note !== null) setTabNote(tab.id, note)
      }
    },
    { separator: true },
    {
      label: 'Add to group',
      icon: <Layers size={14} />,
      submenu: [
        {
          label: 'New group…',
          icon: <Plus size={14} />,
          run: async () => {
            const name = await promptText({ title: 'New tab group', placeholder: 'Group name (optional)' })
            if (name !== null) createGroup([tab.id], name.trim())
          }
        },
        ...(groups.length ? [{ separator: true } as MenuItem] : []),
        ...groups.map((g) => ({
          label: g.name || 'Unnamed group',
          icon: <span style={{ width: 10, height: 10, borderRadius: 3, background: GROUP_COLOR_HEX[g.color], display: 'inline-block' }} />,
          run: () => addTabToGroup(tab.id, g.id)
        })),
        ...(tab.groupId ? [{ separator: true } as MenuItem, { label: 'Remove from group', icon: <Ungroup size={14} />, run: () => addTabToGroup(tab.id, undefined) }] : [])
      ]
    },
    { label: 'Open in split view', icon: <Columns2 size={14} />, disabled: ws?.activeTabId === tab.id, run: () => splitWith(tab.id) },
    {
      label: 'Move to workspace',
      icon: <FolderInput size={14} />,
      submenu: otherWorkspaces.length
        ? otherWorkspaces.map((w) => {
            const Icon = workspaceIcon(w.icon)
            return {
              label: w.name,
              icon: <Icon size={14} color={w.color} />,
              run: async () => {
                await moveTabToWorkspace(tab.id, w.id)
                toast({ kind: 'ok', title: `Moved to ${w.name}` })
              }
            }
          })
        : [{ label: 'No other workspaces', disabled: true }]
    },
    { label: 'Move to new window', icon: <AppWindow size={14} />, run: () => moveTabToNewWindow(tab.id) },
    tab.suspended
      ? { label: 'Wake tab', icon: <Sun size={14} />, run: () => wakeTab(tab.id) }
      : { label: 'Sleep tab', icon: <Moon size={14} />, disabled: isInternal(tab.url) || ws?.activeTabId === tab.id, run: () => suspendTab(tab.id) },
    { separator: true },
    { label: 'Copy link', icon: <Copy size={14} />, run: () => invoke('app:clipboardWrite', tab.url) },
    { label: 'Bookmark tab', icon: <Bookmark size={14} />, run: () => runCommand('browser.bookmarkPage', { tabId: tab.id }) },
    { label: 'Search tabs…', icon: <Search size={14} />, shortcut: shortcutFor('tabs.search'), run: () => openOverlay('tabSearch') },
    { separator: true },
    { label: 'Close', icon: <X size={14} />, shortcut: shortcutFor('browser.closeTab'), run: () => closeTab(tab.id) },
    { label: 'Close other tabs', icon: <CopyX size={14} />, run: () => closeOtherTabs(tab.id) },
    { label: 'Close tabs to the right', icon: <ArrowRightToLine size={14} />, run: () => closeTabsToRight(tab.id) },
    {
      label: 'Close duplicate tabs',
      icon: <CopyX size={14} />,
      run: () => {
        const n = closeDuplicateTabs()
        toast({ kind: 'info', title: n ? `Closed ${n} duplicate tab${n > 1 ? 's' : ''}` : 'No duplicate tabs' })
      }
    },
    { label: 'Reopen closed tab', icon: <RotateCcw size={14} />, shortcut: shortcutFor('browser.reopenClosedTab'), run: () => reopenClosedTab() }
  ]
}
