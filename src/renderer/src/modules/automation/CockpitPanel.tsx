// One cockpit cell: a widget, an inline side panel or a live web page.
import { Suspense, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, ChevronsDownUp, ChevronsLeftRight, ChevronsRightLeft, ChevronsUpDown, ExternalLink, Globe, GripVertical, LayoutGrid, MonitorUp, Pencil, RefreshCw, X } from 'lucide-react'
import type { CockpitPanel } from '@shared/modules/automation'
import { invoke } from '../../lib/ipc'
import { sidePanels } from '../../lib/registry'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { promptText } from '../../components/prompt'
import { newTab } from '../../stores/browser'
import { toast } from '../../stores/ui'
import { CockpitWeb, type CockpitWebHandle } from './CockpitWeb'
import { useWidgetDefs } from './widgets'
import { safeHttpUrl } from './cockpitUtil'

interface Props {
  p: CockpitPanel
  columns: number
  editing: boolean
  onChange: (p: CockpitPanel) => void
  onRemove: () => void
  dragProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean }
}

export function CockpitPanelView({ p, columns, editing, onChange, onRemove, dragProps }: Props) {
  useSyncExternalStore(sidePanels.subscribe, () => sidePanels.list())
  const defs = useWidgetDefs()
  const web = useRef<CockpitWebHandle>(null)
  const [pageTitle, setPageTitle] = useState('')

  const panelDef = p.kind === 'panel' ? sidePanels.get(p.ref) : undefined
  const widgetDef = p.kind === 'widget' ? defs.find((d) => d.id === p.ref) : undefined
  let host = ''
  try {
    host = p.kind === 'web' ? new URL(p.ref).hostname.replace(/^www\./, '') : ''
  } catch {
    host = p.ref
  }
  const Icon = panelDef?.icon ?? widgetDef?.icon ?? (p.kind === 'web' ? Globe : LayoutGrid)
  const title = p.title || panelDef?.title || widgetDef?.title || pageTitle || host || p.ref

  const span = (dc: number, dr: number) =>
    onChange({ ...p, colSpan: Math.max(1, Math.min(columns, p.colSpan + dc)), rowSpan: Math.max(1, Math.min(4, p.rowSpan + dr)) })

  const editUrl = async () => {
    const v = await promptText({ title: 'Panel web page', label: 'URL (https://…)', initial: web.current?.currentUrl() ?? p.ref })
    if (!v) return
    const url = safeHttpUrl(v)
    if (!url) return void toast({ kind: 'error', title: 'Only http(s) pages can be embedded' })
    onChange({ ...p, ref: url, title: undefined })
  }

  const PanelComp = panelDef?.component
  const WidgetComp = widgetDef?.component
  const size = p.colSpan >= 3 ? 'l' : p.colSpan === 2 ? 'm' : 's'

  return (
    <div className={'cp-panel' + (editing ? ' editing' : '')} style={{ gridColumn: `span ${Math.min(p.colSpan, columns)}`, gridRow: `span ${p.rowSpan}` }} {...dragProps}>
      <div className="cp-panel-h">
        {editing && <GripVertical size={12} className="dim aw-grip" />}
        <Icon size={12} className="muted" />
        <span className="ellipsis grow cp-title" title={p.kind === 'web' ? p.ref : title}>
          {title}
          {p.kind === 'web' && host && title !== host && <span className="dim"> · {host}</span>}
        </span>
        {editing ? (
          <>
            <span className="cp-span mono" data-tip="Width / height in grid cells">
              {p.colSpan}×{p.rowSpan}
            </span>
            <button className="icon-btn sm" onClick={() => span(-1, 0)} disabled={p.colSpan <= 1} aria-label="Narrower" data-tip="Narrower">
              <ChevronsRightLeft size={12} />
            </button>
            <button className="icon-btn sm" onClick={() => span(1, 0)} disabled={p.colSpan >= columns} aria-label="Wider" data-tip="Wider">
              <ChevronsLeftRight size={12} />
            </button>
            <button className="icon-btn sm" onClick={() => span(0, -1)} disabled={p.rowSpan <= 1} aria-label="Shorter" data-tip="Shorter">
              <ChevronsDownUp size={12} />
            </button>
            <button className="icon-btn sm" onClick={() => span(0, 1)} disabled={p.rowSpan >= 4} aria-label="Taller" data-tip="Taller">
              <ChevronsUpDown size={12} />
            </button>
            {p.kind === 'web' && (
              <button className="icon-btn sm" onClick={editUrl} aria-label="Change URL" data-tip="Change URL">
                <Pencil size={11} />
              </button>
            )}
            <button className="icon-btn sm" onClick={onRemove} aria-label="Remove panel" data-tip="Remove">
              <X size={12} />
            </button>
          </>
        ) : (
          <>
            {p.kind === 'web' && (
              <>
                <button className="icon-btn sm" onClick={() => web.current?.back()} aria-label="Back" data-tip="Back">
                  <ArrowLeft size={12} />
                </button>
                <button className="icon-btn sm" onClick={() => web.current?.reload()} aria-label="Reload" data-tip="Reload">
                  <RefreshCw size={12} />
                </button>
                <button className="icon-btn sm" onClick={() => newTab(web.current?.currentUrl() ?? p.ref)} aria-label="Open in tab" data-tip="Open in a tab">
                  <ExternalLink size={12} />
                </button>
                <button className="icon-btn sm" onClick={() => invoke('window:new', { url: web.current?.currentUrl() ?? p.ref })} aria-label="Open in new window" data-tip="Send to a new window (move it to another monitor)">
                  <MonitorUp size={12} />
                </button>
              </>
            )}
            {p.kind === 'panel' && panelDef?.popout && (
              <button className="icon-btn sm" onClick={() => invoke('window:popout', panelDef.id, { alwaysOnTop: false })} aria-label="Pop out" data-tip="Send to a floating window (move it to another monitor)">
                <MonitorUp size={12} />
              </button>
            )}
          </>
        )}
      </div>
      <div className={'cp-body' + (p.kind === 'web' ? ' web' : '')}>
        {p.kind === 'web' ? (
          <CockpitWeb ref={web} url={p.ref} onTitle={setPageTitle} />
        ) : p.kind === 'panel' ? (
          PanelComp ? (
            <ErrorBoundary name={panelDef!.title}>
              <Suspense fallback={<div className="empty">Loading…</div>}>
                <PanelComp />
              </Suspense>
            </ErrorBoundary>
          ) : (
            <div className="empty">Panel “{p.ref}” is unavailable — its module is not installed or disabled.</div>
          )
        ) : WidgetComp ? (
          <div className="aw-body">
            <ErrorBoundary name={widgetDef!.title}>
              <WidgetComp size={size} />
            </ErrorBoundary>
          </div>
        ) : (
          <div className="empty">Widget “{p.ref}” is unavailable.</div>
        )}
      </div>
    </div>
  )
}
