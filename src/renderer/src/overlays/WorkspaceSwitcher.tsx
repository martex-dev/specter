import { useEffect, useState } from 'react'
import { Camera, Plus, Settings2 } from 'lucide-react'
import { invoke } from '../lib/ipc'
import { workspaceIcon, WORKSPACE_COLORS } from '../lib/icons'
import { timeAgo } from '../lib/format'
import { createWorkspaceAndSwitch, newTab, refreshWorkspaceList, switchWorkspace, useBrowser } from '../stores/browser'
import { closeOverlay, toast } from '../stores/ui'
import { Kbd } from '../components/ui'
import { promptText } from '../components/prompt'

export function WorkspaceSwitcher() {
  const workspaces = useBrowser((s) => s.workspaces)
  const open = useBrowser((s) => s.open)
  const activeWsId = useBrowser((s) => s.activeWsId)
  const [sel, setSel] = useState(Math.max(0, workspaces.findIndex((w) => w.id === activeWsId)))

  useEffect(() => {
    refreshWorkspaceList()
  }, [])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeOverlay()
      else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault()
        setSel((s) => (s + 1) % workspaces.length)
      } else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault()
        setSel((s) => (s - 1 + workspaces.length) % workspaces.length)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSel((s) => Math.min(workspaces.length - 1, s + 4))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSel((s) => Math.max(0, s - 4))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        pick(workspaces[sel]?.id)
      } else if (/^[1-9]$/.test(e.key) && !e.ctrlKey) {
        pick(workspaces[Number(e.key) - 1]?.id)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const pick = (id?: string) => {
    if (!id) return
    closeOverlay()
    switchWorkspace(id)
  }

  const create = async () => {
    const name = await promptText({ title: 'New workspace', placeholder: 'e.g. Thesis, Side project, Travel' })
    if (!name?.trim()) return
    closeOverlay()
    await createWorkspaceAndSwitch(name.trim(), 'layers', WORKSPACE_COLORS[workspaces.length % WORKSPACE_COLORS.length])
  }

  const snapshot = async () => {
    const snap = await invoke('workspaces:snapshot', activeWsId, undefined)
    toast({ kind: 'ok', title: 'Snapshot saved', body: `${snap.tabCount} tabs · ${new Date(snap.createdAt).toLocaleTimeString()}` })
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closeOverlay()}>
      <div className="palette pop" style={{ width: 'min(820px, calc(100vw - 40px))' }} role="dialog" aria-label="Workspaces">
        <div className="palette-input-row" style={{ height: 48 }}>
          <span className="label" style={{ fontSize: 11 }}>
            Workspaces
          </span>
          <span className="spacer" />
          <button className="btn sm" onClick={snapshot}>
            <Camera size={13} /> Snapshot current
          </button>
          <button
            className="btn sm"
            onClick={() => {
              closeOverlay()
              newTab('specter://workspaces')
            }}
          >
            <Settings2 size={13} /> Manage
          </button>
          <button className="btn sm primary" onClick={create}>
            <Plus size={13} /> New
          </button>
        </div>
        <div className="ws-grid">
          {workspaces.map((w, i) => {
            const Icon = workspaceIcon(w.icon)
            const live = open[w.id]
            const tabs = live ? live.tabs : w.state.tabs
            return (
              <button key={w.id} className={'ws-card' + (i === sel ? ' sel' : '') + (w.id === activeWsId ? ' current' : '')} onMouseEnter={() => setSel(i)} onClick={() => pick(w.id)}>
                <div className="row">
                  <span className="ws-glyph" style={{ background: w.color + '22', color: w.color }}>
                    <Icon size={16} />
                  </span>
                  <span className="spacer" />
                  {i < 9 && <Kbd keys={String(i + 1)} />}
                </div>
                <div className="ws-name ellipsis">{w.name}</div>
                <div className="muted" style={{ fontSize: 11.5 }}>
                  {tabs.filter((t) => t.url !== 'specter://newtab').length} tabs · {w.id === activeWsId ? 'current' : live ? 'open' : timeAgo(w.updatedAt)}
                </div>
                <div className="row" style={{ gap: 3, minHeight: 14 }}>
                  {tabs
                    .filter((t) => t.favicon)
                    .slice(0, 8)
                    .map((t) => (
                      <img key={t.id} src={t.favicon} width={13} height={13} style={{ borderRadius: 3, opacity: 0.85 }} alt="" />
                    ))}
                </div>
              </button>
            )
          })}
        </div>
        <div className="palette-foot">
          <span>
            <Kbd keys="1" />–<Kbd keys="9" /> jump
          </span>
          <span>
            <Kbd keys="Enter" /> switch
          </span>
          <span className="spacer" />
          <span>{workspaces.length} workspaces</span>
        </div>
      </div>
    </div>
  )
}
