// Widget dashboard: add, remove, drag to reorder, resize (S/M/L) and a layout
// persisted in SQLite. Used by specter://cockpit/dashboard and the new tab.
import { Suspense, useEffect, useRef, useState } from 'react'
import { Check, GripVertical, LayoutGrid, Pencil, Plus, X } from 'lucide-react'
import type { DashboardLayout, WidgetItem, WidgetSize } from '@shared/modules/automation'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { openMenu } from '../../stores/ui'
import { useStored, useWidgetDefs, type DashboardWidgetDef } from './widgets'

export type DashboardScope = 'dashboard' | 'newtab'

const DEFAULTS: Record<DashboardScope, DashboardLayout> = {
  dashboard: {
    items: [
      { key: 'd1', widget: 'clock', size: 'm' },
      { key: 'd2', widget: 'tasks', size: 'm' },
      { key: 'd3', widget: 'quicklinks', size: 'm' },
      { key: 'd4', widget: 'downloads', size: 's' },
      { key: 'd5', widget: 'automations', size: 's' }
    ]
  },
  newtab: { items: [] }
}

const SIZE_LABEL: Record<WidgetSize, string> = { s: 'S', m: 'M', l: 'L' }

export function WidgetFrame({ def, item, editing, onSize, onRemove, dragProps }: {
  def: DashboardWidgetDef | undefined
  item: WidgetItem
  editing: boolean
  onSize?: (s: WidgetSize) => void
  onRemove?: () => void
  dragProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean }
}) {
  const Icon = def?.icon ?? LayoutGrid
  const C = def?.component
  return (
    <div className={'card aw-card size-' + item.size + (editing ? ' editing' : '')} {...dragProps}>
      <div className="aw-card-h">
        {editing && <GripVertical size={13} className="dim aw-grip" />}
        <Icon size={13} className="muted" />
        <span className="label ellipsis grow">{def?.title ?? item.widget}</span>
        {editing && onSize && (
          <div className="seg aw-size" role="group" aria-label="Widget size">
            {(['s', 'm', 'l'] as WidgetSize[]).map((s) => (
              <button key={s} className={item.size === s ? 'on' : ''} onClick={() => onSize(s)} aria-label={`Size ${SIZE_LABEL[s]}`}>
                {SIZE_LABEL[s]}
              </button>
            ))}
          </div>
        )}
        {editing && onRemove && (
          <button className="icon-btn sm" onClick={onRemove} aria-label="Remove widget" data-tip="Remove">
            <X size={13} />
          </button>
        )}
      </div>
      <div className="aw-body">
        {C ? (
          <ErrorBoundary name={def!.title}>
            <Suspense fallback={<div className="dim">Loading…</div>}>
              <C size={item.size} />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <div className="dim" style={{ fontSize: 12 }}>
            Widget “{item.widget}” is unavailable — its module is not installed or disabled.
          </div>
        )}
      </div>
    </div>
  )
}

export function Dashboard({ scope, editing, onEditingChange, compact }: { scope: DashboardScope; editing: boolean; onEditingChange?: (v: boolean) => void; compact?: boolean }) {
  const defs = useWidgetDefs()
  const [layout, setLayout, loaded] = useStored<DashboardLayout>('dashboard:' + scope, DEFAULTS[scope])
  const [items, setItems] = useState<WidgetItem[]>(layout.items)
  const dragKey = useRef<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  useEffect(() => setItems(layout.items), [layout])

  const commit = (next: WidgetItem[]) => {
    setItems(next)
    setLayout({ items: next })
  }

  const addMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const used = new Set(items.map((i) => i.widget))
    openMenu({
      x: r.left,
      y: r.bottom + 4,
      width: 280,
      items: [
        { header: 'Add widget' },
        ...defs.map((d) => ({
          label: `${d.title} — ${d.description}`,
          icon: <d.icon size={14} />,
          disabled: used.has(d.id),
          run: () => commit([...items, { key: 'w' + Date.now().toString(36), widget: d.id, size: d.defaultSize }])
        }))
      ]
    })
  }

  const byId = new Map(defs.map((d) => [d.id, d]))

  if (!loaded) return null

  return (
    <div className={'aw-dash' + (compact ? ' compact' : '')}>
      {(editing || (scope === 'newtab' && items.length === 0)) && (
        <div className="row aw-dash-bar">
          {editing ? (
            <>
              <span className="label">{scope === 'newtab' ? 'New tab widgets' : 'Edit dashboard'} · drag to reorder · S/M/L to resize</span>
              <span className="spacer" />
              <button className="btn sm" onClick={addMenu}>
                <Plus size={13} /> Add widget
              </button>
              {onEditingChange && (
                <button className="btn sm primary" onClick={() => onEditingChange(false)}>
                  <Check size={13} /> Done
                </button>
              )}
            </>
          ) : (
            onEditingChange && (
              <button className="btn sm ghost aw-add-ntp" onClick={() => onEditingChange(true)}>
                <LayoutGrid size={13} /> Add widgets to the new tab
              </button>
            )
          )}
        </div>
      )}
      {items.length > 0 && (
        <div className="aw-grid">
          {items.map((it) => (
            <WidgetFrame
              key={it.key}
              def={byId.get(it.widget)}
              item={it}
              editing={editing}
              onSize={(s) => commit(items.map((x) => (x.key === it.key ? { ...x, size: s } : x)))}
              onRemove={() => commit(items.filter((x) => x.key !== it.key))}
              dragProps={
                editing
                  ? {
                      draggable: true,
                      onDragStart: (e) => {
                        dragKey.current = it.key
                        setDragging(it.key)
                        e.dataTransfer.effectAllowed = 'move'
                      },
                      onDragOver: (e) => {
                        e.preventDefault()
                        const from = dragKey.current
                        if (!from || from === it.key) return
                        const next = [...items]
                        const a = next.findIndex((x) => x.key === from)
                        const b = next.findIndex((x) => x.key === it.key)
                        if (a < 0 || b < 0) return
                        const [moved] = next.splice(a, 1)
                        next.splice(b, 0, moved)
                        setItems(next)
                      },
                      onDragEnd: () => {
                        dragKey.current = null
                        setDragging(null)
                        commit(items)
                      },
                      style: dragging === it.key ? { opacity: 0.45 } : undefined
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}
      {!editing && items.length > 0 && onEditingChange && scope === 'newtab' && (
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
          <button className="btn sm ghost" onClick={() => onEditingChange(true)}>
            <Pencil size={12} /> Edit widgets
          </button>
        </div>
      )}
    </div>
  )
}

/** New-tab widget: a user-chosen, persisted set of dashboard widgets. */
export function NewTabWidgets() {
  const [editing, setEditing] = useState(false)
  return (
    <div style={{ gridColumn: '1 / -1' }}>
      <Dashboard scope="newtab" editing={editing} onEditingChange={setEditing} compact />
    </div>
  )
}
