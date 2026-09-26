// Vertical tab sidebar (optional layout). Collapses to favicons and expands
// on hover unless pinned open. Reuses the same tab model, menus and drag data
// as the horizontal strip.
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen, Plus, Search, Volume2, VolumeX, X } from 'lucide-react'
import { GROUP_COLOR_HEX } from '../lib/icons'
import { addTabToGroup, activateTab, closeTab, moveTab, newTab, setMuted, updateGroup, useActiveWs, visibleTabIds, type RuntimeTab } from '../stores/browser'
import { openMenu, openOverlay } from '../stores/ui'
import { setSetting, useSetting } from '../stores/settings'
import { Favicon } from '../components/ui'
import { tabMenu } from './TabStrip'

const DRAG_MIME = 'application/x-specter-tab'

export function VerticalTabs() {
  const ws = useActiveWs()
  const pinnedOpen = useSetting('appearance.verticalTabsOpen')
  const [hover, setHover] = useState(false)
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const listRef = useRef<HTMLDivElement>(null)
  const expanded = pinnedOpen || hover

  useEffect(() => {
    listRef.current?.querySelector('.vtab.active')?.scrollIntoView({ block: 'nearest' })
  }, [ws?.activeTabId])

  if (!ws) return null
  const visible = new Set(visibleTabIds(ws))
  const pinned = ws.tabs.filter((t) => t.pinned)
  const rest = ws.tabs.filter((t) => !t.pinned)

  const onDrop = (e: React.DragEvent, target: RuntimeTab, after: boolean) => {
    const id = e.dataTransfer.getData(DRAG_MIME)
    setDrop(null)
    if (!id || id === target.id) return
    e.preventDefault()
    const from = ws.tabs.findIndex((t) => t.id === id)
    let to = ws.tabs.findIndex((t) => t.id === target.id) + (after ? 1 : 0)
    if (from < to) to--
    moveTab(id, to)
    if (target.groupId !== ws.tabs[from]?.groupId) addTabToGroup(id, target.groupId)
  }

  const row = (t: RuntimeTab) => {
    const g = t.groupId ? ws.groups.find((x) => x.id === t.groupId) : undefined
    if (g?.collapsed && t.id !== ws.activeTabId) return null
    return (
      <div
        key={t.id}
        className={['vtab', t.id === ws.activeTabId && 'active', visible.has(t.id) && 'in-view', t.suspended && 'suspended', drop?.id === t.id && (drop.after ? 'drop-after' : 'drop-before')].filter(Boolean).join(' ')}
        style={g ? ({ '--group': GROUP_COLOR_HEX[g.color] } as React.CSSProperties) : undefined}
        onMouseDown={(e) => e.button === 0 && activateTab(t.id)}
        onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          openMenu({ x: e.clientX, y: e.clientY, items: tabMenu(t), width: 250 })
        }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_MIME, t.id)
          e.dataTransfer.setData('text/uri-list', t.url)
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_MIME)) return
          e.preventDefault()
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          setDrop({ id: t.id, after: e.clientY > r.top + r.height / 2 })
        }}
        onDrop={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          onDrop(e, t, e.clientY > r.top + r.height / 2)
        }}
        title={expanded ? undefined : t.title}
        role="tab"
        aria-selected={t.id === ws.activeTabId}
      >
        <span className="vtab-icon">{t.loading ? <span className="tab-spinner" /> : <Favicon src={t.favicon} url={t.url} />}</span>
        {expanded && (
          <>
            <span className="vtab-title">{t.title || t.url}</span>
            {(t.audible || t.muted) && (
              <button className="icon-btn sm" onMouseDown={(e) => e.stopPropagation()} onClick={() => setMuted(t.id, !t.muted)} aria-label={t.muted ? 'Unmute' : 'Mute'}>
                {t.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
              </button>
            )}
            <button className="icon-btn sm vtab-close" onMouseDown={(e) => e.stopPropagation()} onClick={() => closeTab(t.id)} aria-label="Close tab">
              <X size={12} />
            </button>
          </>
        )}
      </div>
    )
  }

  let lastGroup: string | undefined
  return (
    <div className={'vtabs-slot' + (pinnedOpen ? ' open' : '')}>
    <aside
      className={'vtabs' + (expanded ? ' expanded' : '') + (pinnedOpen ? ' pinned-open' : '')}
      onMouseEnter={() => {
        clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setHover(true), 180)
      }}
      onMouseLeave={() => {
        clearTimeout(timer.current)
        setHover(false)
      }}
      aria-label="Tabs"
    >
      <div className="vtabs-head">
        <button className="icon-btn sm" onClick={() => setSetting('appearance.verticalTabsOpen', !pinnedOpen)} data-tip={pinnedOpen ? 'Collapse tab sidebar' : 'Keep tab sidebar open'} aria-label="Toggle tab sidebar">
          {pinnedOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
        </button>
        {expanded && (
          <>
            <span className="label grow">{ws.tabs.length} tabs</span>
            <button className="icon-btn sm" onClick={() => openOverlay('tabSearch')} data-tip="Search tabs" aria-label="Search tabs">
              <Search size={13} />
            </button>
          </>
        )}
      </div>
      {pinned.length > 0 && <div className={'vtabs-pinned' + (expanded ? '' : ' col')}>{pinned.map((t) => row(t))}</div>}
      <div className="vtabs-list" ref={listRef} role="tablist">
        {rest.map((t) => {
          const g = t.groupId ? ws.groups.find((x) => x.id === t.groupId) : undefined
          const header =
            g && g.id !== lastGroup ? (
              <button key={'g' + g.id} className="vtab-group" style={{ color: GROUP_COLOR_HEX[g.color] }} onClick={() => updateGroup(g.id, { collapsed: !g.collapsed })}>
                {g.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                {expanded ? <span className="ellipsis">{g.name || 'Group'}</span> : <span className="vtab-group-dot" style={{ background: GROUP_COLOR_HEX[g.color] }} />}
              </button>
            ) : null
          lastGroup = g?.id
          return [header, row(t)]
        })}
      </div>
      <button className="vtab vtab-new" onClick={() => newTab()} aria-label="New tab">
        <span className="vtab-icon">
          <Plus size={15} />
        </span>
        {expanded && <span className="vtab-title">New tab</span>}
      </button>
    </aside>
    </div>
  )
}
