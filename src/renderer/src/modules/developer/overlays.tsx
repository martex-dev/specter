import { useEffect, useMemo, useRef, useState } from 'react'
import { File, FolderGit2, FolderOpen, GitFork, Search } from 'lucide-react'
import type { FileHit } from '@shared/modules/developer'
import { fuzzyBest } from '@shared/fuzzy'
import { invoke, on } from '../../lib/ipc'
import { timeAgo } from '../../lib/format'
import { closeOverlay, toast, useUi } from '../../stores/ui'
import { Kbd, Modal } from '../../components/ui'
import { stripAnsi } from './ansi'
import { ensureDevData, errMsg, glyphFor, KIND_LABEL, openProjectPage, reloadProjects, setCurrentProject, useDev } from './store'

// Clone ------------------------------------------------------------------------------------------

export function CloneOverlay() {
  const arg = useUi((s) => s.overlayArg) as { url?: string } | undefined
  const [url, setUrl] = useState(arg?.url ?? '')
  const [dest, setDest] = useState<string | null>(null)
  const [log, setLog] = useState('')
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'failed'>('idle')
  const [result, setResult] = useState<{ projectId?: string; path?: string } | null>(null)
  const opRef = useRef<string | null>(null)
  const outRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight
  }, [log])

  const pick = async () => {
    const p = await invoke('app:pickFolder', 'Choose where to clone the repository')
    if (p) setDest(p)
  }

  const start = async () => {
    if (!url.trim()) return toast({ kind: 'warn', title: 'Enter a repository URL' })
    let parent = dest
    if (!parent) {
      parent = await invoke('app:pickFolder', 'Choose where to clone the repository')
      if (!parent) return
      setDest(parent)
    }
    const id = 'clone' + Date.now().toString(36)
    opRef.current = id
    setLog('')
    setState('running')
    const off = on('git:output', (e) => e.opId === id && setLog((l) => l + e.chunk))
    try {
      const r = await invoke('git:clone', url.trim(), parent, id)
      if (!r.ok) {
        setState('failed')
        if (!r.output.includes('$ git')) setLog((l) => l + r.output + '\n')
      } else {
        setState('done')
        setResult({ projectId: r.projectId, path: r.path })
        await reloadProjects()
        if (r.projectId) setCurrentProject(r.projectId)
      }
    } catch (err) {
      setState('failed')
      setLog((l) => l + errMsg(err) + '\n')
    } finally {
      off()
      opRef.current = null
    }
  }

  const close = () => {
    if (state === 'running' && opRef.current) invoke('git:cancel', opRef.current)
    closeOverlay()
  }

  return (
    <Modal
      title="Clone repository"
      icon={<GitFork size={16} style={{ color: 'var(--accent)' }} />}
      onClose={close}
      width={620}
      footer={
        state === 'done' ? (
          <>
            <button className="btn ghost" onClick={closeOverlay}>
              Close
            </button>
            <button
              className="btn primary"
              onClick={() => {
                closeOverlay()
                openProjectPage(result?.projectId)
              }}
            >
              <FolderGit2 size={13} /> Open project
            </button>
          </>
        ) : (
          <>
            <button className="btn ghost" onClick={close}>
              {state === 'running' ? 'Cancel clone' : 'Cancel'}
            </button>
            <button className="btn primary" disabled={state === 'running' || !url.trim()} onClick={start}>
              {state === 'failed' ? 'Retry' : 'Clone'}
            </button>
          </>
        )
      }
    >
      <div className="col dev-root" style={{ gap: 10 }}>
        <div className="col" style={{ gap: 6 }}>
          <span className="label">Repository URL</span>
          <input className="input mono" autoFocus value={url} disabled={state === 'running'} placeholder="https://github.com/user/repo.git" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && state !== 'running' && void start()} />
        </div>
        <div className="col" style={{ gap: 6 }}>
          <span className="label">Destination</span>
          <div className="row" style={{ gap: 6 }}>
            <div className="input mono ellipsis grow" style={{ display: 'flex', alignItems: 'center', color: dest ? 'var(--fg-0)' : 'var(--fg-3)' }}>
              {dest ? dest : 'Choose a parent folder…'}
            </div>
            <button className="btn" disabled={state === 'running'} onClick={pick}>
              <FolderOpen size={13} /> Browse
            </button>
          </div>
          <span className="muted" style={{ fontSize: 11.5 }}>
            Runs <span className="mono">git clone</span> with your installed Git. The new folder is registered as a project and its file names are indexed locally.
          </span>
        </div>
        {state !== 'idle' && (
          <pre ref={outRef} className="git-output dev-clone-out">
            {stripAnsi(log) || 'Starting…'}
          </pre>
        )}
        {state === 'done' && <div className="ok">Cloned to {result?.path}</div>}
      </div>
    </Modal>
  )
}

// Project picker --------------------------------------------------------------------------------

function Picker<T>({ placeholder, items, render, onPick, footer, onQuery }: { placeholder: string; items: T[]; render: (t: T, sel: boolean) => React.ReactNode; onPick: (t: T) => void; footer?: React.ReactNode; onQuery: (q: string) => void }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    onQuery(q)
    setSel(0)
  }, [q])
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.sel')?.scrollIntoView({ block: 'nearest' })
  }, [sel])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closeOverlay()}>
      <div className="palette pop dev-root" role="dialog" aria-label={placeholder}>
        <div className="palette-input-row">
          <Search size={18} />
          <input
            className="palette-input"
            autoFocus
            value={q}
            placeholder={placeholder}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((s) => Math.min(items.length - 1, s + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((s) => Math.max(0, s - 1))
              } else if (e.key === 'Enter') {
                const it = items[sel]
                if (it) onPick(it)
              } else if (e.key === 'Escape') closeOverlay()
            }}
          />
          <Kbd keys="Escape" />
        </div>
        <div className="palette-list" ref={listRef}>
          {items.map((it, i) => (
            <div key={i} className={'palette-item' + (i === sel ? ' sel' : '')} onMouseMove={() => setSel(i)} onClick={() => onPick(it)}>
              {render(it, i === sel)}
            </div>
          ))}
          {!items.length && <div className="empty">{q ? 'No matches' : 'Nothing here yet'}</div>}
        </div>
        {footer && <div className="palette-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function ProjectPickerOverlay() {
  ensureDevData()
  const projects = useDev((s) => s.projects)
  const [q, setQ] = useState('')
  const items = useMemo(() => {
    if (!q.trim()) return projects
    return projects
      .map((p) => ({ p, s: fuzzyBest(q, [p.name, p.path, ...p.kinds]) }))
      .filter((x): x is { p: (typeof projects)[number]; s: number } => x.s !== null)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.p)
  }, [projects, q])
  return (
    <Picker
      placeholder={`Open one of ${projects.length} project(s)…`}
      items={items}
      onQuery={setQ}
      onPick={(p) => {
        closeOverlay()
        openProjectPage(p.id)
      }}
      render={(p) => (
        <>
          <span className="pi-icon mono" style={{ fontSize: 9.5, fontWeight: 700 }}>
            {glyphFor(p)}
          </span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="ellipsis">{p.name}</div>
            <div className="pi-sub ellipsis">{p.path}</div>
          </div>
          {p.git?.branch && <span className="badge mono">{p.git.branch}</span>}
          <span className="badge">{KIND_LABEL[p.kinds[0]] ?? p.kinds[0]}</span>
          {p.lastOpened && <span className="muted" style={{ fontSize: 11 }}>{timeAgo(p.lastOpened)}</span>}
        </>
      )}
      footer={
        <>
          <span>
            <Kbd keys="Enter" /> open project
          </span>
          <span className="spacer" />
          <span>Projects are folders you added — nothing else is scanned</span>
        </>
      }
    />
  )
}

export function FileSearchOverlay() {
  ensureDevData()
  const env = useDev((s) => s.env)
  const count = useDev((s) => s.projects.reduce((n, p) => n + p.index.files, 0))
  const [hits, setHits] = useState<FileHit[]>([])
  const timer = useRef(0)
  const onQuery = (q: string) => {
    window.clearTimeout(timer.current)
    if (!q.trim()) return setHits([])
    timer.current = window.setTimeout(() => {
      invoke('projects:searchFiles', q, { limit: 60 })
        .then(setHits)
        .catch(() => setHits([]))
    }, 70)
  }
  const open = (h: FileHit, reveal: boolean) => {
    closeOverlay()
    if (reveal || !env?.code) invoke('projects:reveal', h.projectId, h.rel)
    else invoke('projects:openInCode', h.projectId, h.rel, 1).catch((e) => toast({ kind: 'error', title: 'VS Code', body: errMsg(e) }))
  }
  return (
    <Picker
      placeholder={`Search ${count.toLocaleString()} indexed files by name…`}
      items={hits}
      onQuery={onQuery}
      onPick={(h) => open(h, false)}
      render={(h) => (
        <>
          <span className="pi-icon">
            <File size={14} />
          </span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="ellipsis">{h.name}</div>
            <div className="pi-sub ellipsis mono">{h.rel}</div>
          </div>
          <span className="badge">{h.projectName}</span>
          <button
            className="icon-btn sm"
            data-tip="Show in folder"
            aria-label="Show in folder"
            onClick={(e) => {
              e.stopPropagation()
              open(h, true)
            }}
          >
            <FolderOpen size={13} />
          </button>
          <button
            className="icon-btn sm"
            data-tip="Open in project page"
            aria-label="Open in project page"
            onClick={(e) => {
              e.stopPropagation()
              closeOverlay()
              openProjectPage(`${h.projectId}?file=${encodeURIComponent(h.rel)}`)
            }}
          >
            <FolderGit2 size={13} />
          </button>
        </>
      )}
      footer={
        <>
          <span>
            <Kbd keys="Enter" /> {env?.code ? 'open in VS Code' : 'show in folder'}
          </span>
          <span className="spacer" />
          <span>Local filename index</span>
        </>
      }
    />
  )
}
