// specter://cockpit — multi-panel layouts (widgets, side panels, live pages)
// for large or multiple monitors. specter://cockpit/dashboard — widget dashboard.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AppWindow, Check, Copy, Gauge, LayoutGrid, Pencil, Plus, Trash2 } from 'lucide-react'
import type { CockpitLayout, CockpitPanel } from '@shared/modules/automation'
import type { PageProps } from '../../pages/registry'
import { invoke } from '../../lib/ipc'
import { sidePanels } from '../../lib/registry'
import { Seg } from '../../components/ui'
import { confirmAction, promptText } from '../../components/prompt'
import { openMenu, toast } from '../../stores/ui'
import { Dashboard } from './Dashboard'
import { CockpitPanelView } from './CockpitPanel'
import { layoutFromPreset, newKey, PRESETS } from './cockpit'
import { safeHttpUrl } from './cockpitUtil'
import { useStored, useWidgetDefs } from './widgets'
import { openPage } from './util'
import './automation.css'

function DashboardPage({ query }: PageProps) {
  const [editing, setEditing] = useState(query.get('edit') === '1')
  return (
    <div className="page wide">
      <div className="page-h">
        <div className="grow">
          <div className="page-kicker">SPECTER Widgets</div>
          <h1 className="page-title">Dashboard</h1>
          <div className="page-sub">Widgets from SPECTER and its modules. Layout is saved locally.</div>
        </div>
        <button className="btn" onClick={() => openPage('specter://cockpit')}>
          <Gauge size={13} /> Cockpit
        </button>
        {!editing && (
          <button className="btn primary" onClick={() => setEditing(true)}>
            <Pencil size={13} /> Edit widgets
          </button>
        )}
      </div>
      <Dashboard scope="dashboard" editing={editing} onEditingChange={setEditing} />
    </div>
  )
}

export default function CockpitPage(props: PageProps) {
  if (props.sub === 'dashboard') return <DashboardPage {...props} />
  return <Cockpit {...props} />
}

function Cockpit({ query }: PageProps) {
  const [layouts, setLayouts, loaded] = useStored<CockpitLayout[]>('cockpit:layouts', [])
  const [activeId, setActiveId] = useStored<string>('cockpit:active', '')
  const [editing, setEditing] = useState(false)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<CockpitPanel[] | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [rowH, setRowH] = useState(300)
  const defs = useWidgetDefs()

  const wanted = query.get('layout')
  const layout = layouts.find((l) => l.id === (wanted || activeId)) ?? layouts[0]

  // First visit: start from the Monitoring preset.
  useEffect(() => {
    if (loaded && layouts.length === 0) {
      const l = layoutFromPreset(PRESETS.find((p) => p.id === 'monitoring')!)
      setLayouts([l])
      setActiveId(l.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, layouts.length])

  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el || !layout) return
    const measure = () => setRowH(Math.max(170, Math.floor((el.clientHeight - 16 - 10 * (layout.rows - 1)) / layout.rows)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [layout?.rows, layout?.id])

  const update = (patch: Partial<CockpitLayout>) => {
    if (!layout) return
    setLayouts(layouts.map((l) => (l.id === layout.id ? { ...l, ...patch, updatedAt: Date.now() } : l)))
  }
  const select = (id: string) => {
    // A window opened on a specific layout (?layout=, "New window") keeps its own
    // choice; the shared active layout would switch every other cockpit window too.
    if (wanted) openPage('specter://cockpit?layout=' + id)
    else setActiveId(id)
  }
  const addLayout = (l: CockpitLayout) => {
    setLayouts([...layouts, l])
    select(l.id)
  }

  const addPanel = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const add = (p: Omit<CockpitPanel, 'key' | 'colSpan' | 'rowSpan'>) => layout && update({ panels: [...layout.panels, { key: newKey(), colSpan: 1, rowSpan: 1, ...p }] })
    openMenu({
      x: r.left,
      y: r.bottom + 4,
      width: 280,
      items: [
        {
          label: 'Web page…',
          run: async () => {
            const v = await promptText({ title: 'Add web page panel', label: 'URL', placeholder: 'https://…' })
            const url = v ? safeHttpUrl(v) : null
            if (v && !url) toast({ kind: 'error', title: 'Only http(s) pages can be embedded' })
            if (url) add({ kind: 'web', ref: url })
          }
        },
        { separator: true },
        { header: 'Side panels' },
        ...sidePanels
          .list()
          .filter((p) => !p.enabled || p.enabled())
          .map((p) => ({ label: p.title, icon: <p.icon size={14} />, run: () => add({ kind: 'panel', ref: p.id }) })),
        { separator: true },
        { header: 'Widgets' },
        ...defs.map((d) => ({ label: d.title, icon: <d.icon size={14} />, run: () => add({ kind: 'widget', ref: d.id }) }))
      ]
    })
  }

  const presetMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    openMenu({
      x: r.left,
      y: r.bottom + 4,
      width: 320,
      items: [
        { header: 'New layout from preset' },
        ...PRESETS.map((p) => ({ label: `${p.name} — ${p.description}`, run: () => addLayout(layoutFromPreset(p)) })),
        { separator: true },
        { label: 'Empty layout', run: () => addLayout({ id: 'c' + Date.now().toString(36), name: 'Layout ' + (layouts.length + 1), columns: 3, rows: 2, panels: [], updatedAt: Date.now() }) }
      ]
    })
  }

  if (!loaded || !layout) return <div className="empty">Loading cockpit…</div>
  const panels = draft ?? layout.panels

  const dragProps = (p: CockpitPanel) =>
    editing
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            setDragKey(p.key)
            setDraft(layout.panels)
            e.dataTransfer.effectAllowed = 'move'
          },
          onDragOver: (e: React.DragEvent) => {
            e.preventDefault()
            if (!dragKey || dragKey === p.key || !draft) return
            const next = [...draft]
            const a = next.findIndex((x) => x.key === dragKey)
            const b = next.findIndex((x) => x.key === p.key)
            if (a < 0 || b < 0) return
            const [m] = next.splice(a, 1)
            next.splice(b, 0, m)
            setDraft(next)
          },
          onDragEnd: () => {
            if (draft) update({ panels: draft })
            setDraft(null)
            setDragKey(null)
          },
          style: dragKey === p.key ? { opacity: 0.4 } : undefined
        }
      : undefined

  return (
    <div className="cp-root">
      <div className="cp-bar">
        <Gauge size={15} className="accent" />
        <span className="cp-brand">Cockpit</span>
        <select className="select" value={layout.id} onChange={(e) => select(e.target.value)} aria-label="Layout" style={{ height: 26, maxWidth: 200 }}>
          {layouts.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button className="btn sm ghost" onClick={presetMenu}>
          <Plus size={12} /> New layout
        </button>
        <span className="toolbar-divider cp-div" />
        <span className="label">Grid</span>
        <Seg value={String(layout.columns)} options={[2, 3, 4, 6].map((n) => ({ value: String(n), label: `${n} col` }))} onChange={(v) => update({ columns: Number(v) })} />
        <Seg value={String(layout.rows)} options={[1, 2, 3].map((n) => ({ value: String(n), label: `${n} row` }))} onChange={(v) => update({ rows: Number(v) })} />
        <span className="spacer" />
        {editing && (
          <>
            <button className="btn sm" onClick={addPanel}>
              <Plus size={12} /> Add panel
            </button>
            <button
              className="btn sm ghost"
              onClick={async () => {
                const n = await promptText({ title: 'Rename layout', label: 'Name', initial: layout.name })
                if (n?.trim()) update({ name: n.trim().slice(0, 60) })
              }}
            >
              <Pencil size={12} /> Rename
            </button>
            <button className="btn sm ghost" onClick={() => addLayout({ ...structuredClone(layout), id: 'c' + Date.now().toString(36), name: layout.name + ' copy' })}>
              <Copy size={12} /> Duplicate
            </button>
            <button
              className="btn sm ghost"
              disabled={layouts.length <= 1}
              onClick={async () => {
                if (!(await confirmAction('Delete layout?', `“${layout.name}” will be removed.`, 'Delete', true))) return
                const rest = layouts.filter((l) => l.id !== layout.id)
                setLayouts(rest)
                select(rest[0].id)
              }}
            >
              <Trash2 size={12} /> Delete
            </button>
          </>
        )}
        <button className={'btn sm' + (editing ? ' primary' : '')} onClick={() => setEditing(!editing)}>
          {editing ? <Check size={12} /> : <Pencil size={12} />} {editing ? 'Done' : 'Edit'}
        </button>
        <button className="btn sm ghost" onClick={() => invoke('window:new', { url: 'specter://cockpit?layout=' + layout.id })} data-tip="Open this layout in a new window — drag it to another monitor">
          <AppWindow size={12} /> New window
        </button>
        <button className="btn sm ghost" onClick={() => openPage('specter://cockpit/dashboard')} data-tip="Widget dashboard">
          <LayoutGrid size={12} />
        </button>
      </div>
      <div ref={gridRef} className={'cp-grid' + (dragKey ? ' dragging' : '')} style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, gridAutoRows: rowH + 'px' }}>
        {panels.map((p) => (
          <CockpitPanelView
            key={p.key}
            p={p}
            columns={layout.columns}
            editing={editing}
            onChange={(n) => update({ panels: layout.panels.map((x) => (x.key === p.key ? n : x)) })}
            onRemove={() => update({ panels: layout.panels.filter((x) => x.key !== p.key) })}
            dragProps={dragProps(p)}
          />
        ))}
        {panels.length === 0 && (
          <div className="empty cp-empty" style={{ gridColumn: '1 / -1' }}>
            <Gauge size={26} />
            This layout is empty.
            <button className="btn primary sm" onClick={(e) => (setEditing(true), addPanel(e))}>
              <Plus size={12} /> Add panel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
