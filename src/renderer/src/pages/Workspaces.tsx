import { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Camera, Copy, Download, GitCompare, Layers, Pencil, Play, Plus, RotateCcw, Trash2, Upload } from 'lucide-react'
import type { SavedLayout, Workspace, WorkspaceSnapshot } from '@shared/types'
import { invoke } from '../lib/ipc'
import { WORKSPACE_COLORS, WORKSPACE_ICONS, workspaceIcon } from '../lib/icons'
import { timeAgo } from '../lib/format'
import { activeWs, createWorkspaceAndSwitch, newTab, refreshWorkspaceList, restoreSnapshotIntoWorkspace, setLayout, switchWorkspace, useBrowser, flushAll } from '../stores/browser'
import { openMenu, toast } from '../stores/ui'
import { confirmAction, promptText } from '../components/prompt'
import { Favicon, Modal } from '../components/ui'
import type { PageProps } from './registry'

export default function Workspaces({ sub }: PageProps) {
  const workspaces = useBrowser((s) => s.workspaces)
  const activeWsId = useBrowser((s) => s.activeWsId)
  const [sel, setSel] = useState<string>(activeWsId)
  const [snaps, setSnaps] = useState<WorkspaceSnapshot[]>([])
  const [compare, setCompare] = useState<[WorkspaceSnapshot, WorkspaceSnapshot] | null>(null)
  const [pick, setPick] = useState<string[]>([])
  const [layouts, setLayouts] = useState<SavedLayout[]>([])
  const ws = workspaces.find((w) => w.id === sel) ?? workspaces[0]

  const loadSnaps = () => ws && invoke('workspaces:snapshots', ws.id).then(setSnaps)
  useEffect(() => {
    refreshWorkspaceList()
    invoke('workspaces:layouts').then(setLayouts)
  }, [])
  useEffect(() => {
    loadSnaps()
    setPick([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws?.id])

  if (!ws) return null
  const Icon = workspaceIcon(ws.icon)

  const edit = async () => {
    const name = await promptText({ title: 'Rename workspace', initial: ws.name })
    if (name?.trim()) {
      await invoke('workspaces:update', ws.id, { name: name.trim() })
      refreshWorkspaceList()
    }
  }

  return (
    <div className="page wide">
      <div className="page-h">
        <div className="grow">
          <div className="page-kicker">Workspaces</div>
          <h1 className="page-title">Workspaces & snapshots</h1>
          <div className="page-sub">Each workspace keeps its own tabs, groups and split layout. Snapshots are point-in-time copies you can restore or compare.</div>
        </div>
        <button className="btn" onClick={() => invoke('workspaces:import').then((w) => w && (refreshWorkspaceList(), toast({ kind: 'ok', title: `Imported ${w.name}` })))}>
          <Upload size={14} /> Import
        </button>
        <button
          className="btn primary"
          onClick={async () => {
            const name = await promptText({ title: 'New workspace', placeholder: 'Workspace name' })
            if (name?.trim()) await createWorkspaceAndSwitch(name.trim(), 'layers', WORKSPACE_COLORS[workspaces.length % WORKSPACE_COLORS.length])
          }}
        >
          <Plus size={14} /> New workspace
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20 }}>
        <div className="col" style={{ gap: 4 }}>
          {workspaces.map((w, i) => {
            const WIcon = workspaceIcon(w.icon)
            return (
              <div
                key={w.id}
                className="list-row"
                style={{ height: 40, background: w.id === ws.id ? 'var(--bg-3)' : undefined }}
                onClick={() => setSel(w.id)}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('ws', w.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={async (e) => {
                  const id = e.dataTransfer.getData('ws')
                  if (!id || id === w.id) return
                  const order = workspaces.map((x) => x.id).filter((x) => x !== id)
                  order.splice(i, 0, id)
                  await Promise.all(order.map((wid, idx) => invoke('workspaces:update', wid, { sort: idx })))
                  refreshWorkspaceList()
                }}
              >
                <span className="ws-glyph" style={{ width: 24, height: 24, borderRadius: 6, display: 'grid', placeItems: 'center', background: w.color + '22', color: w.color }}>
                  <WIcon size={13} />
                </span>
                <span className="grow ellipsis">{w.name}</span>
                {w.id === activeWsId && <span className="badge accent">current</span>}
                <span className="dim mono" style={{ fontSize: 10.5 }}>
                  {w.state.tabs.length}
                </span>
              </div>
            )
          })}
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card" style={{ padding: 18 }}>
            <div className="row" style={{ gap: 12 }}>
              <span style={{ width: 44, height: 44, borderRadius: 11, display: 'grid', placeItems: 'center', background: ws.color + '22', color: ws.color }}>
                <Icon size={22} />
              </span>
              <div className="grow">
                <div style={{ fontSize: 18, fontWeight: 600 }}>{ws.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {ws.state.tabs.length} tabs · {ws.state.groups.length} groups · updated {timeAgo(ws.updatedAt)}
                </div>
              </div>
              {ws.id !== activeWsId && (
                <button className="btn primary" onClick={() => switchWorkspace(ws.id)}>
                  <ArrowRightLeft size={13} /> Switch
                </button>
              )}
              <button className="btn" onClick={edit}>
                <Pencil size={13} /> Rename
              </button>
              <button
                className="btn"
                onClick={(e) =>
                  openMenu({
                    x: e.clientX - 200,
                    y: e.clientY + 10,
                    width: 230,
                    items: [
                      { header: 'Icon' },
                      ...Object.keys(WORKSPACE_ICONS).map((k) => {
                        const I = WORKSPACE_ICONS[k]
                        return { label: k, icon: <I size={14} />, checked: ws.icon === k, run: () => invoke('workspaces:update', ws.id, { icon: k }).then(refreshWorkspaceList) }
                      })
                    ]
                  })
                }
              >
                Icon
              </button>
              <input type="color" value={ws.color} onChange={(e) => invoke('workspaces:update', ws.id, { color: e.target.value }).then(refreshWorkspaceList)} aria-label="Workspace color" style={{ width: 30, height: 28, border: 'none', background: 'none', cursor: 'pointer' }} />
            </div>
            <div className="row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
              <button
                className="btn"
                onClick={async () => {
                  flushAll()
                  await new Promise((r) => setTimeout(r, 80))
                  const label = await promptText({ title: 'Snapshot label', placeholder: 'Optional — defaults to date & time' })
                  if (label === null) return
                  await invoke('workspaces:snapshot', ws.id, label || undefined)
                  loadSnaps()
                  toast({ kind: 'ok', title: 'Snapshot saved' })
                }}
              >
                <Camera size={13} /> Snapshot
              </button>
              <button
                className="btn"
                onClick={async () => {
                  const name = await promptText({ title: 'Duplicate workspace', initial: ws.name + ' copy' })
                  if (!name) return
                  await invoke('workspaces:create', { name, icon: ws.icon, color: ws.color, state: { ...ws.state, tabs: ws.state.tabs.map((t) => ({ ...t, id: 't_' + Math.random().toString(36).slice(2), suspended: true })) } })
                  refreshWorkspaceList()
                }}
              >
                <Copy size={13} /> Duplicate
              </button>
              {(['markdown', 'json', 'html'] as const).map((f) => (
                <button key={f} className="btn" onClick={() => invoke('workspaces:export', ws.id, f).then((p) => p && toast({ kind: 'ok', title: 'Exported', body: p }))}>
                  <Download size={13} /> {f === 'markdown' ? 'Markdown' : f.toUpperCase()}
                </button>
              ))}
              <span className="spacer" />
              <button
                className="btn danger"
                disabled={workspaces.length <= 1 || ws.id === activeWsId}
                onClick={async () => {
                  if (!(await confirmAction(`Delete workspace “${ws.name}”?`, `Its ${ws.state.tabs.length} tabs and all snapshots are deleted.`, 'Delete', true))) return
                  await invoke('workspaces:delete', ws.id)
                  setSel(activeWsId)
                  refreshWorkspaceList()
                }}
                data-tip={ws.id === activeWsId ? 'Switch to another workspace first' : undefined}
              >
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <Layers size={14} className="muted" />
              <b style={{ fontSize: 12.5 }}>Tabs</b>
            </div>
            <div style={{ maxHeight: 260, overflow: 'auto', padding: 6 }}>
              {ws.state.tabs.map((t) => (
                <div key={t.id} className="list-row" onClick={() => newTab(t.url)}>
                  <Favicon src={t.favicon} url={t.url} size={14} />
                  <span className="ellipsis grow">{t.title}</span>
                  {t.pinned && <span className="badge">pinned</span>}
                  {t.note && <span className="badge warn">note</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <Camera size={14} className="muted" />
              <b style={{ fontSize: 12.5 }} className="grow">
                Snapshots
              </b>
              {pick.length === 2 && (
                <button className="btn sm" onClick={() => setCompare([snaps.find((s) => s.id === pick[0])!, snaps.find((s) => s.id === pick[1])!])}>
                  <GitCompare size={12} /> Compare selected
                </button>
              )}
              {pick.length < 2 && snaps.length > 1 && <span className="dim" style={{ fontSize: 11 }}>Select two to compare</span>}
            </div>
            {snaps.length === 0 && <div className="empty">No snapshots yet.</div>}
            {snaps.map((s) => (
              <div key={s.id} className="history-item" style={{ height: 40 }}>
                <input type="checkbox" checked={pick.includes(s.id)} onChange={(e) => setPick(e.target.checked ? [...pick, s.id].slice(-2) : pick.filter((x) => x !== s.id))} aria-label="Select snapshot" />
                <span className="grow ellipsis">{s.label}</span>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {s.tabCount} tabs · {timeAgo(s.createdAt)}
                </span>
                <button
                  className="btn sm"
                  onClick={async () => {
                    if (!(await confirmAction('Restore this snapshot?', `The workspace’s current tabs are snapshotted first, then replaced with ${s.tabCount} tabs.`, 'Restore'))) return
                    await restoreSnapshotIntoWorkspace(s.id)
                    await refreshWorkspaceList()
                    loadSnaps()
                    toast({ kind: 'ok', title: 'Snapshot restored' })
                  }}
                >
                  <RotateCcw size={12} /> Restore
                </button>
                <button
                  className="btn sm"
                  onClick={async () => {
                    await invoke('workspaces:create', { name: `${ws.name} · ${s.label}`.slice(0, 60), icon: ws.icon, color: ws.color, state: s.state })
                    refreshWorkspaceList()
                    toast({ kind: 'ok', title: 'Snapshot opened as new workspace' })
                  }}
                >
                  As new
                </button>
                <button className="icon-btn sm" onClick={() => invoke('workspaces:deleteSnapshot', s.id).then(loadSnaps)} aria-label="Delete snapshot">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>

          <div className="card" id="layouts">
            <div className="card-h">
              <Layers size={14} className="muted" />
              <b style={{ fontSize: 12.5 }}>Saved split layouts</b>
              {sub === 'layouts' && <span className="badge accent">jumped here</span>}
            </div>
            {layouts.length === 0 && <div className="empty">Save a split layout from the toolbar’s split button.</div>}
            {layouts.map((l) => (
              <div key={l.id} className="history-item" style={{ height: 40 }}>
                <span className="grow">{l.name}</span>
                <span className="badge">{l.layout.preset}</span>
                <span className="muted ellipsis" style={{ fontSize: 11, maxWidth: 300 }}>
                  {l.urls.join(' · ')}
                </span>
                <button
                  className="btn sm"
                  onClick={() => {
                    const ids = l.urls.map((u) => newTab(u, { background: true }))
                    setLayout(l.layout.preset, ids)
                  }}
                >
                  <Play size={12} /> Open
                </button>
                <button className="icon-btn sm" onClick={() => invoke('workspaces:deleteLayout', l.id).then(() => invoke('workspaces:layouts').then(setLayouts))} aria-label="Delete layout">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
      {compare && <CompareModal a={compare[0]} b={compare[1]} onClose={() => setCompare(null)} />}
      {activeWs() && null}
    </div>
  )
}

function CompareModal({ a, b, onClose }: { a: WorkspaceSnapshot; b: WorkspaceSnapshot; onClose: () => void }) {
  const [older, newer] = a.createdAt < b.createdAt ? [a, b] : [b, a]
  const diff = useMemo(() => {
    const o = new Set(older.state.tabs.map((t) => t.url))
    const n = new Set(newer.state.tabs.map((t) => t.url))
    return {
      added: newer.state.tabs.filter((t) => !o.has(t.url)),
      removed: older.state.tabs.filter((t) => !n.has(t.url)),
      kept: newer.state.tabs.filter((t) => o.has(t.url))
    }
  }, [older, newer])
  return (
    <Modal title="Compare snapshots" icon={<GitCompare size={16} />} onClose={onClose} width={720}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        {older.label} → {newer.label}
      </div>
      {(
        [
          ['Added', diff.added, 'ok'],
          ['Removed', diff.removed, 'bad'],
          ['Unchanged', diff.kept, '']
        ] as const
      ).map(([label, list, cls]) => (
        <div key={label} style={{ marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 6 }}>
            <span className={cls}>{label}</span> · {list.length}
          </div>
          {list.slice(0, 50).map((t) => (
            <div key={t.id} className="row" style={{ height: 26, fontSize: 12 }}>
              <Favicon src={t.favicon} url={t.url} size={13} />
              <span className="ellipsis">{t.title}</span>
            </div>
          ))}
        </div>
      ))}
    </Modal>
  )
}

export type { Workspace }
