import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, CloudDownload, CloudUpload, GitBranch, GitCommitHorizontal, Minus, Plus, RefreshCw, RotateCcw, Undo2, UploadCloud, X } from 'lucide-react'
import type { DiffResult, GitBranch as Branch, GitCommitInfo, GitFileChange, GitOpResult, GitRemoteOp, GitStatus } from '@shared/modules/developer'
import { invoke, on } from '../../lib/ipc'
import { timeAgo } from '../../lib/format'
import { openMenu, toast } from '../../stores/ui'
import { confirmAction, promptText } from '../../components/prompt'
import { stripAnsi } from './ansi'
import { DiffView } from './parts'
import { errMsg } from './store'

type Sel = { kind: 'file'; path: string; staged: boolean; untracked: boolean } | { kind: 'commit'; hash: string } | null

const opId = () => 'op' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

function codeFor(f: GitFileChange, staged: boolean): string {
  if (f.kind === 'untracked') return '?'
  if (f.conflicted) return 'U'
  const c = staged ? f.x : f.y
  return c === '.' ? '' : c
}

function FileRow({ f, staged, sel, onSelect, actions }: { f: GitFileChange; staged: boolean; sel: boolean; onSelect: () => void; actions: React.ReactNode }) {
  const code = codeFor(f, staged)
  const slash = f.path.lastIndexOf('/')
  return (
    <div className={'git-file' + (sel ? ' on' : '')} onClick={onSelect} title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}>
      <span className={'gf-code gc-' + code}>{code}</span>
      <span className="gf-name">
        <bdi>
          {slash >= 0 && <span className="muted">{f.path.slice(0, slash + 1)}</span>}
          {f.path.slice(slash + 1)}
        </bdi>
      </span>
      <span className="gf-actions" onClick={(e) => e.stopPropagation()}>
        {actions}
      </span>
    </div>
  )
}

export function GitView({ projectId, wide = false }: { projectId: string; wide?: boolean }) {
  const [st, setSt] = useState<GitStatus | null>(null)
  const [log, setLog] = useState<GitCommitInfo[]>([])
  const [sel, setSel] = useState<Sel>(null)
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [diffErr, setDiffErr] = useState<string | null>(null)
  const [commitInfo, setCommitInfo] = useState<{ commit: GitCommitInfo | null; body: string } | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [output, setOutput] = useState<{ title: string; text: string; ok: boolean | null } | null>(null)
  const outRef = useRef<HTMLPreElement>(null)
  const loading = useRef(false)

  const refresh = useCallback(async () => {
    if (loading.current) return
    loading.current = true
    try {
      const [s, l] = await Promise.all([invoke('git:status', projectId), invoke('git:log', projectId, 40)])
      setSt(s)
      setLog(l)
    } catch (err) {
      setSt({ isRepo: false, branch: null, oid: null, detached: false, upstream: null, ahead: 0, behind: 0, files: [], initial: false, error: errMsg(err) })
    } finally {
      loading.current = false
    }
  }, [projectId])

  useEffect(() => {
    setSt(null)
    setSel(null)
    setDiff(null)
    setOutput(null)
    void refresh()
    const off = on('git:changed', (e) => e.projectId === projectId && void refresh())
    // Light polling only while this view is mounted and the window is visible.
    const t = window.setInterval(() => document.visibilityState === 'visible' && void refresh(), 5000)
    const focus = () => void refresh()
    window.addEventListener('focus', focus)
    return () => {
      off()
      window.clearInterval(t)
      window.removeEventListener('focus', focus)
    }
  }, [projectId, refresh])

  // Load the diff for the selection.
  useEffect(() => {
    let cancelled = false
    setDiff(null)
    setDiffErr(null)
    setCommitInfo(null)
    if (!sel) return
    const p =
      sel.kind === 'file'
        ? invoke('git:diff', projectId, sel.path, { staged: sel.staged, untracked: sel.untracked })
        : invoke('git:show', projectId, sel.hash).then((r) => {
            if (!cancelled) setCommitInfo({ commit: r.commit, body: r.body })
            return r.diff
          })
    p.then((d) => !cancelled && setDiff(d)).catch((err) => !cancelled && setDiffErr(errMsg(err)))
    return () => {
      cancelled = true
    }
  }, [sel, projectId, st?.files.length])

  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight
  }, [output?.text])

  const report = (title: string, r: GitOpResult, quietOk = false) => {
    if (!r.ok) {
      setOutput({ title, text: r.output || 'Failed', ok: false })
      toast({ kind: 'error', title: `${title} failed`, body: r.output.split('\n').slice(-3).join('\n') })
    } else if (!quietOk) toast({ kind: 'ok', title, body: r.output.split('\n').slice(0, 2).join('\n') || undefined, ttl: 2500 })
    void refresh()
  }

  const run = async (label: string, fn: () => Promise<GitOpResult>, quietOk = true) => {
    setBusy(label)
    try {
      report(label, await fn(), quietOk)
    } catch (err) {
      toast({ kind: 'error', title: `${label} failed`, body: errMsg(err) })
    } finally {
      setBusy(null)
    }
  }

  const remote = async (op: GitRemoteOp) => {
    const id = opId()
    const title = op === 'publish' ? 'Publish branch' : op[0].toUpperCase() + op.slice(1)
    setOutput({ title, text: '', ok: null })
    setBusy(op)
    const off = on('git:output', (e) => {
      if (e.opId === id) setOutput((o) => (o ? { ...o, text: o.text + e.chunk } : o))
    })
    try {
      const r = await invoke('git:remote', projectId, op, id)
      setOutput((o) => (o ? { ...o, ok: r.ok } : o))
      if (!r.ok) toast({ kind: 'error', title: `${title} failed`, body: 'See the command output in the Git panel.' })
      else toast({ kind: 'ok', title: `${title} complete`, ttl: 2200 })
    } catch (err) {
      setOutput((o) => (o ? { ...o, text: o.text + '\n' + errMsg(err), ok: false } : o))
    } finally {
      off()
      setBusy(null)
      void refresh()
    }
  }

  const commit = async (amend = false) => {
    if (!msg.trim() && !amend) {
      toast({ kind: 'warn', title: 'Write a commit message first' })
      return
    }
    const staged = st?.files.filter((f) => f.staged && !f.conflicted).length ?? 0
    if (!staged && !amend) {
      const stageAll = await confirmAction('Nothing is staged', 'Stage all changes (including untracked files) and commit them?', 'Stage all & commit')
      if (!stageAll) return
      const r = await invoke('git:stage', projectId, ['.'])
      if (!r.ok) return report('Stage', r)
    }
    setBusy('commit')
    try {
      const r = await invoke('git:commit', projectId, msg, { amend })
      if (r.ok) {
        setMsg('')
        setSel(null)
      }
      report(amend ? 'Amended last commit' : 'Committed', r)
    } catch (err) {
      toast({ kind: 'error', title: 'Commit failed', body: errMsg(err) })
    } finally {
      setBusy(null)
    }
  }

  const discard = async (files: GitFileChange[]) => {
    if (!files.length) return
    const untracked = files.filter((f) => f.kind === 'untracked').length
    const ok = await confirmAction(
      files.length === 1 ? `Discard changes to ${files[0].path}?` : `Discard changes to ${files.length} files?`,
      `Your uncommitted edits will be lost${untracked ? `; ${untracked} untracked file(s) will be moved to the Recycle Bin` : ''}. This cannot be undone from SPECTER.`,
      'Discard',
      true
    )
    if (!ok) return
    await run('Discard', () => invoke('git:discard', projectId, files.map((f) => f.path)), false)
    setSel(null)
  }

  const branchMenu = async (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    let list: Branch[] = []
    try {
      list = await invoke('git:branches', projectId)
    } catch {
      /* ignore */
    }
    const dirty = st?.files.some((f) => f.kind !== 'untracked' && f.kind !== 'ignored') ?? false
    const switchTo = async (name: string) => {
      if (dirty) {
        const ok = await confirmAction(
          `Switch to ${name}?`,
          'You have uncommitted changes. Git will carry them over if they don’t conflict, and refuse to switch if they would be overwritten — nothing is discarded silently.',
          'Switch branch'
        )
        if (!ok) return
      }
      await run(`Switch to ${name}`, () => invoke('git:checkout', projectId, name), false)
    }
    const local = list.filter((b) => !b.remote)
    const remotes = list.filter((b) => b.remote && !local.some((l) => b.name.endsWith('/' + l.name)))
    openMenu({
      x: r.left,
      y: r.bottom + 4,
      width: 260,
      items: [
        {
          label: 'New branch…',
          icon: <Plus size={13} />,
          run: async () => {
            const name = await promptText({ title: 'Create branch', label: 'Branch name', placeholder: 'feature/my-change', confirmLabel: 'Create & switch' })
            if (name?.trim()) await run('Create branch', () => invoke('git:createBranch', projectId, name.trim()), false)
          }
        },
        { separator: true },
        { header: 'Local branches' },
        ...local.slice(0, 25).map((b) => ({ label: b.name, checked: b.current, disabled: b.current, run: () => void switchTo(b.name) })),
        ...(remotes.length ? [{ separator: true }, { header: 'Remote branches' }, ...remotes.slice(0, 20).map((b) => ({ label: b.name, run: () => void switchTo(b.name) }))] : [])
      ]
    })
  }

  const moreMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    openMenu({
      x: r.left,
      y: r.bottom + 4,
      items: [
        { label: 'Amend last commit', icon: <GitCommitHorizontal size={13} />, disabled: !log.length, run: () => void commit(true) },
        {
          label: 'Undo last commit (keep changes)…',
          icon: <Undo2 size={13} />,
          disabled: log.length < 2,
          danger: true,
          run: async () => {
            const ok = await confirmAction('Undo the last commit?', `“${log[0]?.subject ?? ''}” will be removed from the branch history (git reset --soft HEAD~1). Its changes stay staged. If the commit was already pushed, you will need to force-push.`, 'Undo commit', true)
            if (ok) await run('Undo commit', () => invoke('git:undoCommit', projectId), false)
          }
        }
      ]
    })
  }

  if (!st) return <div className="empty">Reading repository…</div>
  if (!st.isRepo)
    return (
      <div className="empty">
        <GitBranch size={22} />
        <div>This project is not a Git repository.</div>
      </div>
    )

  const hasRemote = (st.remotes?.length ?? 0) > 0
  const conflicts = st.files.filter((f) => f.conflicted)
  const staged = st.files.filter((f) => f.staged && !f.conflicted)
  const unstaged = st.files.filter((f) => f.unstaged && !f.conflicted && f.kind !== 'untracked' && f.kind !== 'ignored')
  const untracked = st.files.filter((f) => f.kind === 'untracked')
  const isSel = (f: GitFileChange, stagedSide: boolean) => sel?.kind === 'file' && sel.path === f.path && sel.staged === stagedSide
  const pick = (f: GitFileChange, stagedSide: boolean) => setSel({ kind: 'file', path: f.path, staged: stagedSide, untracked: f.kind === 'untracked' })

  const group = (title: string, files: GitFileChange[], stagedSide: boolean, headerActions: React.ReactNode, rowActions: (f: GitFileChange) => React.ReactNode) =>
    files.length > 0 && (
      <div>
        <div className="git-group-h">
          <span className="label">{title}</span>
          <span className="badge">{files.length}</span>
          <span className="spacer" />
          {headerActions}
        </div>
        {files.slice(0, 500).map((f) => (
          <FileRow key={title + f.path} f={f} staged={stagedSide} sel={isSel(f, stagedSide)} onSelect={() => pick(f, stagedSide)} actions={rowActions(f)} />
        ))}
        {files.length > 500 && <div className="muted" style={{ padding: '4px 10px', fontSize: 11 }}>…and {files.length - 500} more</div>}
      </div>
    )

  const btn = (title: string, icon: React.ReactNode, onClick: () => void, danger = false) => (
    <button className="icon-btn sm" data-tip={title} aria-label={title} onClick={onClick} style={danger ? { color: 'var(--bad)' } : undefined}>
      {icon}
    </button>
  )

  const lists = (
    <div className="col" style={{ gap: 0, minWidth: 0 }}>
      <div className="git-commit-box">
        <textarea
          className="textarea"
          placeholder={`Commit message (Ctrl+Enter to commit on ${st.branch ?? 'HEAD'})`}
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              e.preventDefault()
              void commit()
            }
          }}
        />
        <div className="row" style={{ gap: 6, marginTop: 6 }}>
          <button className="btn primary sm grow" style={{ justifyContent: 'center' }} disabled={!!busy || conflicts.length > 0} onClick={() => void commit()}>
            <Check size={13} /> Commit{staged.length ? ` ${staged.length} staged` : ''}
          </button>
          <button className="btn sm" onClick={moreMenu} aria-label="More commit actions">
            <ChevronDown size={13} />
          </button>
        </div>
      </div>
      {st.error && <div className="bad" style={{ padding: 10, fontSize: 12 }}>{st.error}</div>}
      {conflicts.length + staged.length + unstaged.length + untracked.length === 0 && (
        <div className="muted" style={{ padding: '14px 10px', fontSize: 12 }}>
          <Check size={13} style={{ verticalAlign: -2 }} /> Working tree clean
        </div>
      )}
      {group('Conflicts', conflicts, false, null, (f) => btn('Mark resolved (stage)', <Plus size={13} />, () => void run('Stage', () => invoke('git:stage', projectId, [f.path]))))}
      {group(
        'Staged',
        staged,
        true,
        btn('Unstage all', <Minus size={13} />, () => void run('Unstage', () => invoke('git:unstage', projectId, staged.map((f) => f.path)))),
        (f) => btn('Unstage', <Minus size={13} />, () => void run('Unstage', () => invoke('git:unstage', projectId, [f.path])))
      )}
      {group(
        'Changes',
        unstaged,
        false,
        <>
          {btn('Discard all changes…', <RotateCcw size={13} />, () => void discard(unstaged), true)}
          {btn('Stage all', <Plus size={13} />, () => void run('Stage', () => invoke('git:stage', projectId, unstaged.map((f) => f.path))))}
        </>,
        (f) => (
          <>
            {btn('Discard changes…', <RotateCcw size={13} />, () => void discard([f]), true)}
            {btn('Stage', <Plus size={13} />, () => void run('Stage', () => invoke('git:stage', projectId, [f.path])))}
          </>
        )
      )}
      {group(
        'Untracked',
        untracked,
        false,
        btn('Stage all untracked', <Plus size={13} />, () => void run('Stage', () => invoke('git:stage', projectId, untracked.map((f) => f.path)))),
        (f) => (
          <>
            {btn('Delete (to Recycle Bin)…', <X size={13} />, () => void discard([f]), true)}
            {btn('Stage', <Plus size={13} />, () => void run('Stage', () => invoke('git:stage', projectId, [f.path])))}
          </>
        )
      )}
      <div className="git-group-h" style={{ marginTop: 8 }}>
        <span className="label">Recent commits</span>
      </div>
      {log.length === 0 && <div className="muted" style={{ padding: '4px 10px', fontSize: 12 }}>No commits yet</div>}
      {log.map((c) => (
        <div key={c.hash} className={'git-log-item' + (sel?.kind === 'commit' && sel.hash === c.hash ? ' on' : '')} onClick={() => setSel({ kind: 'commit', hash: c.hash })} title={`${c.subject}\n${c.author} <${c.email}>\n${new Date(c.date).toLocaleString()}`}>
          <span className="gl-hash">{c.short}</span>
          <span className="gl-subj">
            {c.refs && <span className="badge accent" style={{ marginRight: 6, fontSize: 10 }}>{c.refs.replace(/^HEAD -> /, '')}</span>}
            {c.subject}
          </span>
          <span className="gl-meta">{timeAgo(c.date)}</span>
        </div>
      ))}
    </div>
  )

  const detail = sel && (
    <div className="col" style={{ gap: 8, minWidth: 0 }}>
      <div className="row" style={{ gap: 6 }}>
        {!wide && (
          <button className="btn sm ghost" onClick={() => setSel(null)}>
            <ArrowLeft size={13} /> Back
          </button>
        )}
        {sel.kind === 'file' ? (
          <span className="mono ellipsis grow" style={{ fontSize: 12 }}>
            {sel.path} <span className="muted">· {sel.untracked ? 'untracked' : sel.staged ? 'staged' : 'working tree'}</span>
          </span>
        ) : (
          <span className="ellipsis grow" style={{ fontSize: 12 }}>
            <span className="mono accent">{commitInfo?.commit?.short ?? sel.hash.slice(0, 7)}</span> {commitInfo?.commit?.subject}
            {commitInfo?.commit && (
              <span className="muted">
                {' '}
                · {commitInfo.commit.author} · {new Date(commitInfo.commit.date).toLocaleString()}
              </span>
            )}
          </span>
        )}
      </div>
      {commitInfo?.body && <pre className="git-output" style={{ maxHeight: 120 }}>{commitInfo.body}</pre>}
      {diffErr ? <div className="bad">{diffErr}</div> : <DiffView diff={diff} empty={sel.kind === 'file' ? 'No differences' : 'Empty commit'} />}
    </div>
  )

  return (
    <div className="git-view">
      <div className="git-bar" style={{ padding: wide ? '0 0 12px' : '10px 10px 8px', borderBottom: wide ? undefined : '1px solid var(--line)' }}>
        <button className="git-branch" onClick={branchMenu} title="Switch or create branch">
          <GitBranch size={13} />
          <span className="ellipsis">{st.branch ?? (st.detached ? `detached @ ${st.oid?.slice(0, 7)}` : 'no branch')}</span>
          <ChevronDown size={12} />
        </button>
        {st.upstream ? (
          <span className="muted mono" style={{ fontSize: 11 }} title={`Tracking ${st.upstream}`}>
            <ArrowUp size={11} style={{ verticalAlign: -1 }} />
            {st.ahead} <ArrowDown size={11} style={{ verticalAlign: -1 }} />
            {st.behind}
          </span>
        ) : (
          st.branch && <span className="badge">no upstream</span>
        )}
        <span className="spacer" />
        <button className="btn sm" disabled={!!busy || !hasRemote} onClick={() => void remote('fetch')} data-tip={hasRemote ? 'git fetch --all --prune' : 'No remote configured'}>
          <RefreshCw size={12} className={busy === 'fetch' ? 'spin' : ''} /> Fetch
        </button>
        <button className="btn sm" disabled={!!busy || !st.upstream} onClick={() => void remote('pull')} data-tip={st.upstream ? `git pull (${st.upstream})` : 'No upstream branch'}>
          <CloudDownload size={12} /> Pull
        </button>
        {st.upstream || !st.branch ? (
          <button className="btn sm" disabled={!!busy || !st.upstream} onClick={() => void remote('push')} data-tip="git push">
            <CloudUpload size={12} /> Push{st.ahead ? ` ${st.ahead}` : ''}
          </button>
        ) : (
          <button className="btn sm" disabled={!!busy || !hasRemote} onClick={() => void remote('publish')} data-tip={hasRemote ? `git push -u ${st.remotes?.includes('origin') ? 'origin' : st.remotes?.[0]} ${st.branch}` : 'No remote configured — add one with git remote add'}>
            <UploadCloud size={12} /> Publish
          </button>
        )}
        <button className="icon-btn sm" onClick={() => void refresh()} data-tip="Refresh" aria-label="Refresh">
          <RefreshCw size={13} />
        </button>
      </div>
      {output && (
        <div style={{ padding: wide ? '0 0 12px' : '8px 10px', borderBottom: wide ? undefined : '1px solid var(--line)' }}>
          <div className="row" style={{ marginBottom: 4 }}>
            <span className="label">{output.title}</span>
            {output.ok === null ? <span className="badge accent">running</span> : output.ok ? <span className="badge ok">done</span> : <span className="badge bad">failed</span>}
            <span className="spacer" />
            <button className="icon-btn sm" onClick={() => setOutput(null)} aria-label="Close output">
              <X size={12} />
            </button>
          </div>
          <pre className="git-output" ref={outRef}>
            {renderProgress(output.text) || '…'}
          </pre>
        </div>
      )}
      {wide ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 360px) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            {lists}
          </div>
          <div style={{ minWidth: 0 }}>{detail || <div className="empty">Select a changed file or a commit to see its diff.</div>}</div>
        </div>
      ) : sel ? (
        <div style={{ padding: 10, overflow: 'auto' }}>{detail}</div>
      ) : (
        <div style={{ overflow: 'auto' }}>{lists}</div>
      )}
    </div>
  )
}

/** Collapses carriage-return progress updates to their final state for display. */
function renderProgress(text: string): string {
  return stripAnsi(text)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
}
