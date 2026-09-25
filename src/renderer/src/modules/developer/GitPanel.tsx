import { FolderPlus, GitBranch } from 'lucide-react'
import { useSetting } from '../../stores/settings'
import { GitView } from './GitView'
import { addProjectFlow, ensureDevData, setCurrentProject, useDev } from './store'

export default function GitPanel() {
  ensureDevData()
  const enabled = useSetting('developer.enabled')
  const projects = useDev((s) => s.projects)
  const loaded = useDev((s) => s.loaded)
  const currentId = useDev((s) => s.currentId)
  const repos = projects.filter((p) => p.isGit)
  const current = repos.find((p) => p.id === currentId) ?? repos[0]

  if (!enabled) return <div className="empty">Developer tools are turned off in Settings → Developer.</div>
  if (!loaded) return <div className="empty">Loading…</div>
  if (!repos.length)
    return (
      <div className="empty dev-root">
        <GitBranch size={24} />
        <div>No Git repositories registered.</div>
        <div style={{ fontSize: 12, maxWidth: 260, lineHeight: 1.5 }}>Add a project folder that contains a Git repository. SPECTER never scans your disk on its own.</div>
        <button className="btn primary" onClick={() => void addProjectFlow()}>
          <FolderPlus size={13} /> Add project
        </button>
      </div>
    )

  return (
    <div className="dev-root col" style={{ gap: 0, height: '100%', minHeight: 0 }}>
      <div className="row" style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)', gap: 8 }}>
        <span className="label">Repo</span>
        <select className="select grow" style={{ height: 28 }} value={current?.id ?? ''} onChange={(e) => setCurrentProject(e.target.value)} aria-label="Repository">
          {repos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.git?.dirty ? ` · ${p.git.dirty} changed` : ''}
            </option>
          ))}
        </select>
      </div>
      {current && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <GitView key={current.id} projectId={current.id} />
        </div>
      )}
    </div>
  )
}
