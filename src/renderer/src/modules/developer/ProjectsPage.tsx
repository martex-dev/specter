import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Database,
  ExternalLink,
  File,
  FileSearch,
  Folder,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitFork,
  Globe,
  LayoutGrid,
  Play,
  RefreshCw,
  Search,
  SquareTerminal,
  Trash2,
  X
} from 'lucide-react'
import type { ContentHit, FileContent, FileHit, ProjectDetail, ProjectInfo, TreeEntry } from '@shared/modules/developer'
import { DEV_PORTS } from '@shared/modules/developer'
import type { PageProps } from '../../pages/registry'
import { invoke } from '../../lib/ipc'
import { formatBytes, timeAgo } from '../../lib/format'
import { newTab } from '../../stores/browser'
import { openMenu, toast } from '../../stores/ui'
import { useSetting } from '../../stores/settings'
import { confirmAction, promptText } from '../../components/prompt'
import { Switch } from '../../components/ui'
import { GitView } from './GitView'
import { LANG_COLORS, Markdown, Snippet } from './parts'
import { addProjectFlow, cloneRepoFlow, ensureDevData, errMsg, glyphFor, KIND_LABEL, openTerminalFor, runScriptFlow, setCurrentProject, useDev } from './store'

type Tab = 'overview' | 'files' | 'git' | 'search'

export default function ProjectsPage({ sub, query }: PageProps) {
  ensureDevData()
  const enabled = useSetting('developer.enabled')
  const projects = useDev((s) => s.projects)
  const loaded = useDev((s) => s.loaded)
  const [selId, setSelId] = useState<string | null>(sub || null)
  const [tab, setTab] = useState<Tab>(query.get('file') ? 'files' : ((query.get('tab') as Tab) ?? 'overview'))
  const sel = projects.find((p) => p.id === selId) ?? projects[0] ?? null

  useEffect(() => {
    if (!sel) return
    setCurrentProject(sel.id)
    invoke('projects:open', sel.id).catch(() => undefined)
  }, [sel?.id])

  if (!enabled)
    return (
      <div className="page">
        <div className="empty">Developer tools are turned off in Settings → Developer.</div>
      </div>
    )

  return (
    <div className="dev-page dev-root" style={{ position: 'absolute', inset: 0 }}>
      <aside className="dev-side">
        <div className="dev-side-h">
          <div className="page-kicker">Developer</div>
          <h1>Projects</h1>
        </div>
        <div className="dev-side-actions">
          <button className="btn sm" onClick={() => addProjectFlow().then((id) => id && setSelId(id))}>
            <FolderPlus size={13} /> Add
          </button>
          <button className="btn sm" onClick={() => cloneRepoFlow()}>
            <GitFork size={13} /> Clone
          </button>
        </div>
        <div className="dev-plist">
          {projects.map((p) => (
            <ProjectItem key={p.id} p={p} on={p.id === sel?.id} onClick={() => setSelId(p.id)} />
          ))}
          {loaded && !projects.length && <div className="muted" style={{ padding: 10, fontSize: 12, lineHeight: 1.5 }}>No projects yet.</div>}
        </div>
        <div className="muted" style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', fontSize: 11, lineHeight: 1.45 }}>
          Indexes only folders you add. Everything stays on this computer.
        </div>
      </aside>
      <main className="dev-main">
        {!loaded ? (
          <div className="empty">Loading…</div>
        ) : !sel ? (
          <Onboarding />
        ) : (
          <ProjectView key={sel.id} project={sel} tab={tab} setTab={setTab} initialFile={query.get('file')} onRemoved={() => setSelId(null)} />
        )}
      </main>
    </div>
  )
}

function ProjectItem({ p, on, onClick }: { p: ProjectInfo; on: boolean; onClick: () => void }) {
  const prog = useDev((s) => s.progress[p.id])
  const indexing = p.index.state === 'indexing' || p.index.state === 'queued'
  return (
    <div className={'dev-pitem' + (on ? ' on' : '')} onClick={onClick} title={p.path}>
      <div className="pi-glyph">{glyphFor(p)}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="pi-name ellipsis">{p.name}</div>
        <div className="pi-meta">
          {!p.exists ? (
            <span className="bad">Folder missing</span>
          ) : p.git ? (
            <>
              <GitBranch size={11} />
              <span className="ellipsis mono" style={{ fontSize: 10.5 }}>
                {p.git.branch ?? 'detached'}
              </span>
              {p.git.dirty > 0 && <span className="warn">●{p.git.dirty}</span>}
            </>
          ) : (
            <span>{KIND_LABEL[p.kinds[0]] ?? p.kinds[0]}</span>
          )}
          {indexing && <span className="accent">indexing {prog?.files ? prog.files.toLocaleString() : ''}</span>}
        </div>
      </div>
    </div>
  )
}

function Onboarding() {
  return (
    <div className="page">
      <div className="page-kicker">Developer workspace</div>
      <h1 className="page-title">Your projects, locally</h1>
      <div className="page-sub" style={{ maxWidth: 620, lineHeight: 1.55 }}>
        Register project folders to get a file index with instant filename search, README and scripts at a glance, Git status with diffs, and an integrated terminal. SPECTER never scans your disk on its own and nothing is uploaded.
      </div>
      <div className="row" style={{ gap: 8, marginTop: 20 }}>
        <button className="btn primary" onClick={() => void addProjectFlow()}>
          <FolderPlus size={14} /> Add project folder
        </button>
        <button className="btn" onClick={() => cloneRepoFlow()}>
          <GitFork size={14} /> Clone a repository
        </button>
      </div>
      <div className="grid-3" style={{ marginTop: 30 }}>
        {[
          { icon: FileSearch, t: 'Filename index', d: 'Walks the folder with ignore rules (node_modules, build output, .gitignore…) into a local SQLite FTS index.' },
          { icon: GitBranch, t: 'Git panel', d: 'Branch, staged and unstaged changes, diffs, commit, pull, push — using your installed git.' },
          { icon: SquareTerminal, t: 'Terminal', d: 'PowerShell, CMD, Git Bash or WSL sessions per project. Line-based; commands run only when you press Enter.' }
        ].map((c) => (
          <div key={c.t} className="card card-b">
            <c.icon size={18} style={{ color: 'var(--accent)' }} />
            <div style={{ fontWeight: 600, margin: '8px 0 4px' }}>{c.t}</div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              {c.d}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProjectView({ project, tab, setTab, initialFile, onRemoved }: { project: ProjectInfo; tab: Tab; setTab: (t: Tab) => void; initialFile: string | null; onRemoved: () => void }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const env = useDev((s) => s.env)
  const prog = useDev((s) => s.progress[project.id])

  useEffect(() => {
    let alive = true
    invoke('projects:get', project.id)
      .then((d) => alive && setDetail(d))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [project.id, project.index.indexedAt, project.git?.lastCommit?.hash, project.git?.dirty])

  const indexing = project.index.state === 'indexing' || project.index.state === 'queued'

  const preview = async (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    let open: number[] = []
    try {
      open = await invoke('projects:probePorts', DEV_PORTS)
    } catch {
      /* ignore */
    }
    const go = (port: number) => newTab(`http://localhost:${port}`)
    openMenu({
      x: r.left,
      y: r.bottom + 4,
      width: 240,
      items: [
        { header: open.length ? 'Listening on this computer' : 'No dev server detected on common ports' },
        ...open.map((p) => ({ label: `localhost:${p}`, icon: <Globe size={13} />, run: () => go(p) })),
        { separator: true },
        {
          label: 'Other port…',
          run: async () => {
            const v = await promptText({ title: 'Preview a local port', label: 'Port', placeholder: '3000', confirmLabel: 'Open' })
            const n = Number(v)
            if (v && Number.isInteger(n) && n > 0 && n < 65536) go(n)
            else if (v) toast({ kind: 'warn', title: 'Invalid port' })
          }
        }
      ]
    })
  }

  const remove = async () => {
    const ok = await confirmAction(`Remove ${project.name} from SPECTER?`, 'Its local index is deleted. The folder and its files are not touched.', 'Remove', true)
    if (!ok) return
    try {
      await invoke('projects:remove', project.id)
      onRemoved()
    } catch (err) {
      toast({ kind: 'error', title: 'Could not remove project', body: errMsg(err) })
    }
  }

  return (
    <div className="dev-main-inner">
      <div className="dev-head">
        <div className="pi-glyph" style={{ width: 44, height: 44, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--accent-dim)', color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13, flex: 'none' }}>
          {glyphFor(project)}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 className="ellipsis">{project.name}</h2>
          <div className="dev-path ellipsis" title={project.path}>
            {project.path}
          </div>
          <div className="row" style={{ gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
            {project.kinds.map((k) => (
              <span key={k} className="badge accent">
                {KIND_LABEL[k] ?? k}
              </span>
            ))}
            {project.tags.map((t) => (
              <span key={t} className="badge">
                {t}
              </span>
            ))}
            {detail?.packageManager && <span className="badge">{detail.packageManager}</span>}
            {!project.exists && <span className="badge bad">folder not found</span>}
          </div>
        </div>
      </div>

      <div className="dev-toolbar">
        <button className="btn sm" disabled={!env?.code} onClick={() => invoke('projects:openInCode', project.id).catch((err) => toast({ kind: 'error', title: 'VS Code', body: errMsg(err) }))} data-tip={env?.code ? 'code <folder>' : '“code” not found on PATH'}>
          <Code2 size={13} /> Open in VS Code
        </button>
        <button className="btn sm" onClick={() => invoke('projects:openFolder', project.id).catch((err) => toast({ kind: 'error', title: 'Open folder', body: errMsg(err) }))}>
          <FolderOpen size={13} /> Open folder
        </button>
        <button className="btn sm" onClick={() => void openTerminalFor(project.id)}>
          <SquareTerminal size={13} /> Terminal here
        </button>
        <button className="btn sm" onClick={preview}>
          <Globe size={13} /> Preview <ChevronDown size={12} />
        </button>
        <span className="spacer" />
        {indexing ? (
          <button className="btn sm" onClick={() => invoke('projects:cancelIndex', project.id)}>
            <X size={13} /> Stop indexing{prog?.files ? ` (${prog.files.toLocaleString()})` : ''}
          </button>
        ) : (
          <button className="btn sm" onClick={() => invoke('projects:reindex', project.id)}>
            <RefreshCw size={13} /> Re-index
          </button>
        )}
        <button className="btn sm ghost" onClick={remove} data-tip="Remove from SPECTER (files are kept)">
          <Trash2 size={13} />
        </button>
      </div>

      <div className="dev-tabs" role="tablist">
        {(
          [
            ['overview', 'Overview', LayoutGrid],
            ['files', 'Files', Folder],
            ['git', 'Git', GitBranch],
            ['search', 'Search code', Search]
          ] as const
        ).map(([id, label, Icon]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)} role="tab" aria-selected={tab === id}>
            <Icon size={13} /> {label}
            {id === 'git' && project.git?.dirty ? <span className="badge warn" style={{ fontSize: 10 }}>{project.git.dirty}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview project={project} detail={detail} />}
      {tab === 'files' && <FilesTab project={project} initialFile={initialFile} />}
      {tab === 'git' && (project.isGit ? <GitView projectId={project.id} wide /> : <div className="empty">Not a Git repository.</div>)}
      {tab === 'search' && <SearchTab project={project} />}
    </div>
  )
}

function Overview({ project, detail }: { project: ProjectInfo; detail: ProjectDetail | null }) {
  const prog = useDev((s) => s.progress[project.id])
  const g = detail?.git ?? project.git
  const idx = project.index
  const langTotal = detail?.languages.reduce((n, l) => n + l.files, 0) ?? 0
  const indexing = idx.state === 'indexing' || idx.state === 'queued'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(300px, 1fr)', gap: 14, alignItems: 'start' }}>
      <div className="card">
        <div className="card-h">
          <BookOpen size={14} className="muted" />
          <span style={{ fontWeight: 600 }}>{detail?.readme?.file ?? 'README'}</span>
          <span className="spacer" />
          {detail?.readme?.truncated && <span className="badge">excerpt</span>}
        </div>
        <div className="card-b dev-readme">
          {!detail ? (
            <div className="muted">Loading…</div>
          ) : detail.readme ? (
            <Markdown source={detail.readme.markdown} />
          ) : (
            <div className="muted">{detail.description ?? 'No README found in the project root.'}</div>
          )}
        </div>
      </div>
      <div className="col" style={{ gap: 14 }}>
        {project.isGit && (
          <div className="card">
            <div className="card-h">
              <FolderGit2 size={14} className="muted" />
              <span style={{ fontWeight: 600 }}>Git</span>
            </div>
            <div className="card-b">
              {!g ? (
                <div className="muted">Reading repository…</div>
              ) : (
                <div className="dev-kv">
                  <span>Branch</span>
                  <span className="mono">
                    {g.branch ?? 'detached'}
                    {g.upstream && <span className="muted"> → {g.upstream}</span>}
                  </span>
                  {g.upstream && (
                    <>
                      <span>Sync</span>
                      <span>
                        {g.ahead} ahead · {g.behind} behind
                      </span>
                    </>
                  )}
                  <span>Remote</span>
                  <span className="mono" title={g.remoteUrl ?? ''}>
                    {g.remoteUrl ?? 'none'}
                  </span>
                  <span>Changes</span>
                  <span>{g.dirty === 0 ? <span className="ok">clean</span> : `${g.staged} staged · ${g.unstaged} modified · ${g.untracked} untracked${g.conflicted ? ` · ${g.conflicted} conflicts` : ''}`}</span>
                  <span>Last commit</span>
                  <span title={g.lastCommit ? `${g.lastCommit.subject} — ${g.lastCommit.author}` : ''}>
                    {g.lastCommit ? (
                      <>
                        <span className="mono accent">{g.lastCommit.short}</span> {g.lastCommit.subject} <span className="muted">· {timeAgo(g.lastCommit.date)}</span>
                      </>
                    ) : (
                      'none'
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
        <div className="card">
          <div className="card-h">
            <Play size={14} className="muted" />
            <span style={{ fontWeight: 600 }}>Scripts</span>
            <span className="spacer" />
            {detail && <span className="badge">{detail.scripts.length}</span>}
          </div>
          {!detail ? (
            <div className="card-b muted">Loading…</div>
          ) : detail.scripts.length === 0 ? (
            <div className="card-b muted" style={{ fontSize: 12 }}>
              No package scripts, Makefile targets or standard build commands detected.
            </div>
          ) : (
            <div style={{ maxHeight: 320, overflow: 'auto' }}>
              {detail.scripts.map((s) => (
                <div key={s.source + s.name} className="dev-script">
                  <span className="sc-name">{s.name}</span>
                  <span className="sc-cmd" title={s.detail}>
                    {s.detail}
                  </span>
                  <button className="btn sm" onClick={() => void runScriptFlow(project, s)} data-tip={`Run “${s.command}” in a terminal (asks first)`}>
                    <Play size={12} /> Run
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-h">
            <Database size={14} className="muted" />
            <span style={{ fontWeight: 600 }}>Local index</span>
            <span className="spacer" />
            <span className={'badge ' + (idx.state === 'ready' ? 'ok' : idx.state === 'error' ? 'bad' : indexing ? 'accent' : '')}>{idx.state}</span>
          </div>
          <div className="card-b">
            <div className="dev-kv">
              <span>Files</span>
              <span className="num">
                {(indexing && prog ? prog.files : idx.files).toLocaleString()}
                {idx.truncated && !indexing && <span className="warn"> (capped at 50,000)</span>}
              </span>
              <span>Folders</span>
              <span className="num">{(indexing && prog ? prog.dirs : idx.dirs).toLocaleString()}</span>
              <span>Size</span>
              <span className="num">{formatBytes(idx.bytes)}</span>
              <span>Content</span>
              <span className="num">{project.contentIndex ? `${(indexing && prog ? prog.contentFiles : idx.contentFiles).toLocaleString()} text files indexed` : 'off'}</span>
              <span>Updated</span>
              <span>{idx.indexedAt ? `${timeAgo(idx.indexedAt)} · ${(idx.durationMs / 1000).toFixed(1)} s` : 'never'}</span>
              {idx.error && (
                <>
                  <span>Error</span>
                  <span className="bad">{idx.error}</span>
                </>
              )}
            </div>
            {indexing && prog?.current && (
              <div className="muted mono ellipsis" style={{ fontSize: 11, marginTop: 8 }}>
                {prog.phase === 'content' ? 'Reading file contents…' : prog.current}
              </div>
            )}
            {detail && langTotal > 0 && (
              <>
                <div className="dev-lang-bar">
                  {detail.languages.map((l, i) => (
                    <i key={l.ext} style={{ width: `${(l.files / langTotal) * 100}%`, background: LANG_COLORS[i % LANG_COLORS.length] }} title={`.${l.ext}: ${l.files}`} />
                  ))}
                </div>
                <div className="row" style={{ flexWrap: 'wrap', gap: '4px 10px', fontSize: 11 }}>
                  {detail.languages.slice(0, 8).map((l, i) => (
                    <span key={l.ext} className="muted">
                      <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 2, background: LANG_COLORS[i % LANG_COLORS.length], marginRight: 4 }} />.{l.ext} {l.files}
                    </span>
                  ))}
                </div>
              </>
            )}
            <div className="setting" style={{ padding: '12px 0 0', borderBottom: 'none' }}>
              <div className="st-text">
                <div className="st-title">Index source code contents</div>
                <div className="st-desc">Opt-in. Text files under 512 KB are stored in the local database for full-text search.</div>
              </div>
              <Switch on={project.contentIndex} onChange={(v) => invoke('projects:setContentIndex', project.id, v)} label="Index file contents" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Files ------------------------------------------------------------------------------------------

function TreeNode({ projectId, entry, depth, selected, onOpen }: { projectId: string; entry: TreeEntry; depth: number; selected: string | null; onOpen: (rel: string) => void }) {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<TreeEntry[] | null>(null)
  const toggle = () => {
    if (!entry.dir) return onOpen(entry.rel)
    const next = !open
    setOpen(next)
    if (next && !children)
      invoke('projects:tree', projectId, entry.rel)
        .then(setChildren)
        .catch(() => setChildren([]))
  }
  return (
    <>
      <div className={'dev-node' + (selected === entry.rel ? ' on' : '') + (entry.ignored ? ' ignored' : '')} style={{ paddingLeft: 8 + depth * 14 }} onClick={toggle} title={entry.rel + (entry.ignored ? ' (ignored — not indexed)' : '')}>
        {entry.dir ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : <span style={{ width: 12 }} />}
        {entry.dir ? <Folder size={13} /> : <File size={13} />}
        <span className="ellipsis">{entry.name}</span>
      </div>
      {open &&
        children?.map((c) => <TreeNode key={c.rel} projectId={projectId} entry={c} depth={depth + 1} selected={selected} onOpen={onOpen} />)}
      {open && children && children.length === 0 && (
        <div className="dev-node muted" style={{ paddingLeft: 8 + (depth + 1) * 14 + 17, fontSize: 11 }}>
          empty
        </div>
      )}
    </>
  )
}

function FilesTab({ project, initialFile }: { project: ProjectInfo; initialFile: string | null }) {
  const [root, setRoot] = useState<TreeEntry[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [file, setFile] = useState<string | null>(initialFile)
  const [content, setContent] = useState<FileContent | null>(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<FileHit[] | null>(null)
  const env = useDev((s) => s.env)

  useEffect(() => {
    invoke('projects:tree', project.id, '')
      .then(setRoot)
      .catch((e) => setErr(errMsg(e)))
  }, [project.id])

  useEffect(() => {
    if (!q.trim()) return setHits(null)
    let alive = true
    const t = window.setTimeout(() => {
      invoke('projects:searchFiles', q, { projectId: project.id, limit: 80 })
        .then((h) => alive && setHits(h))
        .catch(() => alive && setHits([]))
    }, 90)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [q, project.id])

  useEffect(() => {
    setContent(null)
    if (!file) return
    // A slow read of a previously clicked file must not replace the one selected now.
    let alive = true
    invoke('projects:readFile', project.id, file)
      .then((c) => alive && setContent(c))
      .catch((e) => {
        if (!alive) return
        setContent(null)
        toast({ kind: 'error', title: 'Cannot open file', body: errMsg(e) })
      })
    return () => {
      alive = false
    }
  }, [file, project.id])

  const lines = useMemo(() => {
    if (!content || content.binary) return []
    const l = content.text.split(/\r?\n/)
    if (l.length > 1 && l[l.length - 1] === '') l.pop()
    return l
  }, [content])
  const shown = lines.slice(0, 6000)

  return (
    <div className="dev-files">
      <div className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 8, borderBottom: '1px solid var(--line)' }}>
          <input className="input" style={{ width: '100%' }} placeholder={project.index.files ? `Search ${project.index.files.toLocaleString()} indexed files…` : 'Search file names…'} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="dev-tree">
          {hits ? (
            hits.length === 0 ? (
              <div className="muted" style={{ padding: 10, fontSize: 12 }}>
                No matching file names{project.index.state !== 'ready' ? ' (index not ready)' : ''}
              </div>
            ) : (
              hits.map((h) => (
                <div key={h.rel} className={'dev-node' + (file === h.rel ? ' on' : '')} onClick={() => setFile(h.rel)} title={h.rel}>
                  <File size={13} />
                  <span className="ellipsis">
                    {h.name} <span className="muted">{h.rel.slice(0, -h.name.length)}</span>
                  </span>
                </div>
              ))
            )
          ) : err ? (
            <div className="bad" style={{ padding: 10 }}>
              {err}
            </div>
          ) : !root ? (
            <div className="muted" style={{ padding: 10 }}>
              Loading…
            </div>
          ) : (
            root.map((e) => <TreeNode key={e.rel} projectId={project.id} entry={e} depth={0} selected={file} onOpen={setFile} />)
          )}
        </div>
      </div>
      <div className="card dev-viewer">
        {!file ? (
          <div className="empty">
            <File size={22} />
            <div>Select a file to preview it (read-only).</div>
          </div>
        ) : (
          <>
            <div className="card-h">
              <span className="mono ellipsis grow" style={{ fontSize: 12 }} title={file}>
                {file}
              </span>
              {content && <span className="muted num" style={{ fontSize: 11 }}>{formatBytes(content.size)}</span>}
              <button className="icon-btn sm" disabled={!env?.code} onClick={() => invoke('projects:openInCode', project.id, file, 1).catch((e) => toast({ kind: 'error', title: 'VS Code', body: errMsg(e) }))} data-tip="Open in VS Code" aria-label="Open in VS Code">
                <Code2 size={13} />
              </button>
              <button className="icon-btn sm" onClick={() => invoke('projects:reveal', project.id, file)} data-tip="Show in folder" aria-label="Show in folder">
                <FolderOpen size={13} />
              </button>
              <button
                className="icon-btn sm"
                onClick={() => {
                  invoke('app:clipboardWrite', project.path + '\\' + file.replace(/\//g, '\\'))
                  toast({ kind: 'ok', title: 'Path copied', ttl: 1500 })
                }}
                data-tip="Copy full path"
                aria-label="Copy path"
              >
                <Copy size={13} />
              </button>
            </div>
            {!content ? (
              <div className="empty">Loading…</div>
            ) : content.binary ? (
              <div className="empty">Binary file — no preview</div>
            ) : (
              <pre className="dev-code">
                {shown.map((l, i) => (
                  <div key={i}>
                    <span className="ln">{i + 1}</span>
                    {l || ' '}
                  </div>
                ))}
                {(content.truncated || lines.length > shown.length) && <div className="muted" style={{ padding: '6px 16px' }}>… preview truncated — open the file in an editor to see everything.</div>}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function SearchTab({ project }: { project: ProjectInfo }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<ContentHit[] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const env = useDev((s) => s.env)
  useEffect(() => inputRef.current?.focus(), [])
  useEffect(() => {
    if (!q.trim()) return setHits(null)
    let alive = true
    const t = window.setTimeout(() => {
      invoke('projects:searchContent', q, { projectId: project.id, limit: 100 })
        .then((h) => alive && setHits(h))
        .catch(() => alive && setHits([]))
    }, 150)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [q, project.id])

  if (!project.contentIndex)
    return (
      <div className="card card-b" style={{ maxWidth: 620 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Code search is off for this project</div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55, marginBottom: 12 }}>
          Enabling it stores the text of source files (under 512 KB, binaries skipped) in SPECTER’s local database so you can search inside them. Nothing is uploaded. You can turn it off again at any time.
        </div>
        <button className="btn primary" onClick={() => invoke('projects:setContentIndex', project.id, true)}>
          <Database size={13} /> Index file contents
        </button>
      </div>
    )
  return (
    <div className="col" style={{ gap: 10 }}>
      <input ref={inputRef} className="input" placeholder={`Search inside ${project.index.contentFiles.toLocaleString()} indexed files (word prefix match)…`} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card" style={{ overflow: 'hidden' }}>
        {hits === null ? (
          <div className="empty">Type to search file contents.</div>
        ) : hits.length === 0 ? (
          <div className="empty">No matches</div>
        ) : (
          hits.map((h) => (
            <div key={h.rel} className="dev-hit" onDoubleClick={() => env?.code && invoke('projects:openInCode', project.id, h.rel, 1)}>
              <div className="row">
                <span className="h-path grow ellipsis">{h.rel}</span>
                <button className="icon-btn sm" disabled={!env?.code} onClick={() => invoke('projects:openInCode', project.id, h.rel, 1)} data-tip="Open in VS Code" aria-label="Open in VS Code">
                  <ExternalLink size={12} />
                </button>
              </div>
              <div className="h-snip">
                <Snippet text={h.snippet} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
