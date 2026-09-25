// Workspaces, snapshots, saved layouts and closed-tab history.
import { dialog } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import type { ClosedTab, SavedLayout, Workspace, WorkspaceSnapshot, WorkspaceState } from '@shared/types'
import { all, get, json, run, tx, uid } from '../db'
import { broadcast, handle, windowOf } from '../ipc'
import { activeProfileId } from './profiles'

type Row = { id: string; profile_id: string; name: string; icon: string; color: string; sort: number; created_at: number; updated_at: number; state: string }

export const DEFAULT_WORKSPACES: { name: string; icon: string; color: string }[] = [
  { name: 'Personal', icon: 'user', color: '#8b9cff' },
  { name: 'Development', icon: 'code', color: '#5eead4' },
  { name: 'AI / ML', icon: 'cpu', color: '#c084fc' },
  { name: 'Research', icon: 'book-open', color: '#fbbf24' },
  { name: 'Trading', icon: 'candlestick-chart', color: '#34d399' },
  { name: 'Crypto', icon: 'bitcoin', color: '#f59e0b' },
  { name: 'Finance', icon: 'landmark', color: '#60a5fa' },
  { name: 'Entertainment', icon: 'clapperboard', color: '#f472b6' }
]

export function newTabId(): string {
  return uid('t_')
}

export function emptyState(url = 'specter://newtab'): WorkspaceState {
  const id = newTabId()
  const now = Date.now()
  return {
    tabs: [{ id, url, title: 'New Tab', pinned: false, muted: false, suspended: false, lastActive: now, createdAt: now }],
    groups: [],
    activeTabId: id,
    layout: { preset: 'single', panes: [] }
  }
}

function sanitizeState(s: WorkspaceState): WorkspaceState {
  const tabs = (s.tabs ?? []).filter((t) => !t.temporary && typeof t.url === 'string')
  const groups = (s.groups ?? []).filter((g) => tabs.some((t) => t.groupId === g.id))
  const activeTabId = tabs.some((t) => t.id === s.activeTabId) ? s.activeTabId : tabs[0]?.id
  const panes = (s.layout?.panes ?? []).filter((p) => tabs.some((t) => t.id === p))
  return { tabs, groups, activeTabId, layout: { preset: panes.length > 1 ? (s.layout?.preset ?? 'single') : 'single', panes: panes.length > 1 ? panes : [], sizes: s.layout?.sizes } }
}

const toWorkspace = (r: Row): Workspace => ({
  id: r.id,
  profileId: r.profile_id,
  name: r.name,
  icon: r.icon,
  color: r.color,
  sort: r.sort,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  state: sanitizeState(json<WorkspaceState>(r.state, emptyState()))
})

export function ensureDefaultWorkspaces(): void {
  const count = get<{ c: number }>('SELECT COUNT(*) AS c FROM workspaces WHERE profile_id = ?', activeProfileId())?.c ?? 0
  if (count > 0) return
  tx(() => DEFAULT_WORKSPACES.forEach((w, i) => createWorkspace({ ...w, sort: i })))
}

export function createWorkspace(w: { name: string; icon?: string; color?: string; state?: WorkspaceState; sort?: number }): Workspace {
  const id = uid('ws_')
  const now = Date.now()
  const sort = w.sort ?? (get<{ m: number }>('SELECT COALESCE(MAX(sort), -1) AS m FROM workspaces WHERE profile_id = ?', activeProfileId())?.m ?? -1) + 1
  run(
    'INSERT INTO workspaces(id, profile_id, name, icon, color, sort, created_at, updated_at, state) VALUES(?,?,?,?,?,?,?,?,?)',
    id,
    activeProfileId(),
    w.name.trim() || 'Workspace',
    w.icon ?? 'layers',
    w.color ?? '#8b9cff',
    sort,
    now,
    now,
    JSON.stringify(w.state ? sanitizeState(w.state) : emptyState())
  )
  return getWorkspace(id)!
}

export function getWorkspace(id: string): Workspace | null {
  const r = get<Row>('SELECT * FROM workspaces WHERE id = ?', id)
  return r ? toWorkspace(r) : null
}

export function listWorkspaces(): Workspace[] {
  return all<Row>('SELECT * FROM workspaces WHERE profile_id = ? ORDER BY sort, created_at', activeProfileId()).map(toWorkspace)
}

export function saveWorkspaceState(id: string, state: WorkspaceState): void {
  run('UPDATE workspaces SET state = ?, updated_at = ? WHERE id = ?', JSON.stringify(sanitizeState(state)), Date.now(), id)
}

export function snapshotWorkspace(id: string, label?: string): WorkspaceSnapshot | null {
  const ws = getWorkspace(id)
  if (!ws) return null
  const snap: WorkspaceSnapshot = {
    id: uid('snap_'),
    workspaceId: id,
    label: label || new Date().toLocaleString(),
    createdAt: Date.now(),
    tabCount: ws.state.tabs.length,
    state: ws.state
  }
  run('INSERT INTO workspace_snapshots(id, workspace_id, label, created_at, tab_count, state) VALUES(?,?,?,?,?,?)', snap.id, id, snap.label, snap.createdAt, snap.tabCount, JSON.stringify(snap.state))
  // Keep the 50 most recent snapshots per workspace.
  run('DELETE FROM workspace_snapshots WHERE workspace_id = ? AND id NOT IN (SELECT id FROM workspace_snapshots WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50)', id, id)
  return snap
}

type SnapRow = { id: string; workspace_id: string; label: string; created_at: number; tab_count: number; state: string }
const toSnapshot = (r: SnapRow): WorkspaceSnapshot => ({
  id: r.id,
  workspaceId: r.workspace_id,
  label: r.label,
  createdAt: r.created_at,
  tabCount: r.tab_count,
  state: json<WorkspaceState>(r.state, emptyState())
})

export function getSnapshot(id: string): WorkspaceSnapshot | null {
  const r = get<SnapRow>('SELECT * FROM workspace_snapshots WHERE id = ?', id)
  return r ? toSnapshot(r) : null
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function exportWorkspace(ws: Workspace, format: 'json' | 'markdown' | 'html'): string {
  const tabs = ws.state.tabs
  if (format === 'json') return JSON.stringify({ format: 'specter-workspace', version: 1, workspace: { name: ws.name, icon: ws.icon, color: ws.color, state: ws.state } }, null, 2)
  const groupName = (id?: string) => ws.state.groups.find((g) => g.id === id)?.name
  if (format === 'markdown') {
    let md = `# ${ws.name}\n\n_Exported from SPECTER on ${new Date().toLocaleString()}_\n\n`
    const byGroup = new Map<string, typeof tabs>()
    for (const t of tabs) {
      const k = groupName(t.groupId) ?? ''
      byGroup.set(k, [...(byGroup.get(k) ?? []), t])
    }
    for (const [g, ts] of byGroup) {
      if (g) md += `## ${g}\n\n`
      for (const t of ts) md += `- [${t.title.replace(/[[\]]/g, '')}](${t.url})${t.note ? ` — ${t.note}` : ''}\n`
      md += '\n'
    }
    return md
  }
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>${escapeHtml(ws.name)}</TITLE>\n<H1>${escapeHtml(ws.name)}</H1>\n<DL><p>\n${tabs
    .map((t) => `    <DT><A HREF="${escapeHtml(t.url)}">${escapeHtml(t.title)}</A>`)
    .join('\n')}\n</DL><p>\n`
}

export function pushClosedTab(t: Omit<ClosedTab, 'id' | 'closedAt'>): void {
  if (!t.url || t.url === 'specter://newtab') return
  run('INSERT INTO closed_tabs(url, title, favicon, workspace_id, closed_at, idx) VALUES(?,?,?,?,?,?)', t.url, t.title, t.favicon ?? null, t.workspaceId ?? null, Date.now(), t.index)
  run('DELETE FROM closed_tabs WHERE id NOT IN (SELECT id FROM closed_tabs ORDER BY id DESC LIMIT 100)')
}

type ClosedRow = { id: number; url: string; title: string; favicon: string | null; workspace_id: string | null; closed_at: number; idx: number }
const toClosed = (r: ClosedRow): ClosedTab => ({ id: r.id, url: r.url, title: r.title, favicon: r.favicon ?? undefined, workspaceId: r.workspace_id ?? undefined, closedAt: r.closed_at, index: r.idx })

export function registerWorkspacesIpc(): void {
  handle('workspaces:list', () => listWorkspaces())
  handle('workspaces:create', (_e, w) => {
    const ws = createWorkspace(w)
    broadcast('workspaces:changed', { id: ws.id })
    return ws
  })
  handle('workspaces:update', (_e, id, patch) => {
    const ws = getWorkspace(id)
    if (!ws) return
    run('UPDATE workspaces SET name = ?, icon = ?, color = ?, sort = ?, updated_at = ? WHERE id = ?', patch.name ?? ws.name, patch.icon ?? ws.icon, patch.color ?? ws.color, patch.sort ?? ws.sort, Date.now(), id)
    broadcast('workspaces:changed', { id })
  })
  handle('workspaces:delete', (_e, id) => {
    const count = get<{ c: number }>('SELECT COUNT(*) AS c FROM workspaces WHERE profile_id = ?', activeProfileId())?.c ?? 0
    if (count <= 1) throw new Error('Cannot delete the last workspace')
    run('DELETE FROM workspaces WHERE id = ?', id)
    broadcast('workspaces:changed', { id })
  })
  handle('workspaces:saveState', (_e, id, state) => saveWorkspaceState(id, state))
  handle('workspaces:snapshot', (_e, id, label) => {
    const s = snapshotWorkspace(id, label)
    if (!s) throw new Error('Workspace not found')
    return s
  })
  handle('workspaces:snapshots', (_e, id) => all<SnapRow>('SELECT * FROM workspace_snapshots WHERE workspace_id = ? ORDER BY created_at DESC', id).map(toSnapshot))
  handle('workspaces:deleteSnapshot', (_e, id) => {
    run('DELETE FROM workspace_snapshots WHERE id = ?', id)
  })
  handle('workspaces:getSnapshot', (_e, id) => getSnapshot(id))
  handle('workspaces:export', async (e, id, format) => {
    const ws = getWorkspace(id)
    if (!ws) return null
    const ext = format === 'json' ? 'json' : format === 'markdown' ? 'md' : 'html'
    const win = windowOf(e)
    const opts = { defaultPath: `${ws.name.replace(/[^\w-]+/g, '_')}.${ext}`, filters: [{ name: format.toUpperCase(), extensions: [ext] }] }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, exportWorkspace(ws, format))
    return r.filePath
  })
  handle('workspaces:import', async (e) => {
    const win = windowOf(e)
    const opts = { properties: ['openFile' as const], filters: [{ name: 'SPECTER workspace', extensions: ['json'] }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    const data = JSON.parse(readFileSync(r.filePaths[0], 'utf8'))
    const w = data?.workspace
    if (!w || !w.state || !Array.isArray(w.state.tabs)) throw new Error('Not a SPECTER workspace export')
    // Re-key tabs so imported ids never collide with live ones.
    const idMap = new Map<string, string>()
    const tabs = w.state.tabs.map((t: any) => {
      const nid = newTabId()
      idMap.set(t.id, nid)
      return { ...t, id: nid, suspended: true }
    })
    const state: WorkspaceState = { ...w.state, tabs, activeTabId: idMap.get(w.state.activeTabId) ?? tabs[0]?.id, layout: { preset: 'single', panes: [] } }
    const ws = createWorkspace({ name: String(w.name ?? 'Imported'), icon: w.icon, color: w.color, state })
    broadcast('workspaces:changed', { id: ws.id })
    return ws
  })
  handle('workspaces:layouts', () =>
    all<{ id: string; name: string; layout: string; urls: string }>('SELECT * FROM saved_layouts ORDER BY name').map((r) => ({ id: r.id, name: r.name, layout: json(r.layout, { preset: 'single', panes: [] }), urls: json<string[]>(r.urls, []) }))
  )
  handle('workspaces:saveLayout', (_e, l) => {
    const saved: SavedLayout = { ...l, id: uid('lay_') }
    run('INSERT INTO saved_layouts(id, name, layout, urls) VALUES(?,?,?,?)', saved.id, saved.name, JSON.stringify(saved.layout), JSON.stringify(saved.urls))
    return saved
  })
  handle('workspaces:deleteLayout', (_e, id) => {
    run('DELETE FROM saved_layouts WHERE id = ?', id)
  })

  handle('session:closedTabPush', (_e, t) => pushClosedTab(t))
  handle('session:closedTabPop', () => {
    const r = get<ClosedRow>('SELECT * FROM closed_tabs ORDER BY id DESC LIMIT 1')
    if (!r) return null
    run('DELETE FROM closed_tabs WHERE id = ?', r.id)
    return toClosed(r)
  })
  handle('session:closedTabs', (_e, limit) => all<ClosedRow>('SELECT * FROM closed_tabs ORDER BY id DESC LIMIT ?', limit).map(toClosed))
}
