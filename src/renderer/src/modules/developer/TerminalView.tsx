import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { ChevronDown, Copy, Eraser, Octagon, Plus, RotateCw, SquareTerminal, WrapText, X } from 'lucide-react'
import type { ShellId, TerminalSession } from '@shared/modules/developer'
import { invoke } from '../../lib/ipc'
import { openMenu, toast } from '../../stores/ui'
import { useSetting } from '../../stores/settings'
import { confirmAction } from '../../components/prompt'
import type { AnsiSpan, AnsiStyle, TermLine } from './ansi'
import { ensureDevData, useDev } from './store'
import { createTerminal, ensureTerminalData, getHistory, modelFor, submitLine, useTerm } from './termStore'

function spanStyle(st: AnsiStyle): CSSProperties | undefined {
  if (st.fg === undefined && st.bg === undefined && !st.bold && !st.dim && !st.italic && !st.underline && !st.inverse && !st.strike) return undefined
  let fg = st.fg
  let bg = st.bg
  if (st.inverse) {
    ;[fg, bg] = [bg ?? 'var(--bg-0)', fg ?? 'var(--fg-0)']
  }
  return {
    color: fg,
    background: bg,
    fontWeight: st.bold ? 700 : undefined,
    opacity: st.dim ? 0.62 : undefined,
    fontStyle: st.italic ? 'italic' : undefined,
    textDecoration: st.underline ? 'underline' : st.strike ? 'line-through' : undefined
  }
}

const Line = memo(function Line({ line }: { line: TermLine }) {
  return (
    <div className="term-line">
      {line.spans.map((s: AnsiSpan, i: number) => {
        const style = spanStyle(s.style)
        return style ? (
          <span key={i} style={style}>
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        )
      })}
    </div>
  )
})

function useModel(id: string) {
  const model = modelFor(id)
  const version = useSyncExternalStore(
    useCallback(
      (cb: () => void) => {
        let raf = 0
        const l = () => {
          if (!raf) raf = requestAnimationFrame(() => ((raf = 0), cb()))
        }
        model.listeners.add(l)
        return () => {
          model.listeners.delete(l)
          if (raf) cancelAnimationFrame(raf)
        }
      },
      [model]
    ),
    () => model.term.version
  )
  return { model, version }
}

const SHELL_SYM: Record<ShellId, string> = { powershell: 'PS>', pwsh: 'PS>', cmd: '>', gitbash: '$', wsl: '$' }
const SHELL_SHORT: Record<ShellId, string> = { powershell: 'PS', pwsh: 'PS7', cmd: 'CMD', gitbash: 'BASH', wsl: 'WSL' }

function Output({ session, wrap }: { session: TerminalSession; wrap: boolean }) {
  const { model } = useModel(session.id)
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const lines = model.term.lines

  useLayoutEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })

  // Report columns so PowerShell formats tables to the visible width.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const probe = document.createElement('span')
    probe.textContent = 'MMMMMMMMMM'
    probe.style.visibility = 'hidden'
    probe.style.position = 'absolute'
    el.appendChild(probe)
    const cw = probe.getBoundingClientRect().width / 10 || 7.5
    probe.remove()
    let t = 0
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t)
      t = window.setTimeout(() => {
        const cols = Math.floor((el.clientWidth - 28) / cw)
        if (cols > 20) invoke('terminal:resize', session.id, cols).catch(() => undefined)
      }, 150)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      window.clearTimeout(t)
    }
  }, [session.id])

  return (
    <div
      ref={ref}
      className={'term-out' + (wrap ? ' wrap' : '')}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      }}
      onMouseUp={() => {
        // Clicking (without selecting) focuses the input like a real terminal.
        if (!window.getSelection()?.toString()) ref.current?.parentElement?.querySelector<HTMLInputElement>('.term-in input')?.focus()
      }}
      aria-live="polite"
      role="log"
    >
      {lines.map((l) => (
        <Line key={l.id} line={l} />
      ))}
    </div>
  )
}

function InputRow({ session }: { session: TerminalSession }) {
  const [value, setValue] = useState('')
  const histIdx = useRef<number | null>(null)
  const draft = useRef('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
    setValue('')
    histIdx.current = null
  }, [session.id])

  const interrupt = () => invoke('terminal:interrupt', session.id).catch(() => undefined)
  const sym = SHELL_SYM[session.shell]
  return (
    <div className="term-in">
      {session.running ? <span className="ti-sym" style={{ color: 'var(--warn)' }}>stdin›</span> : <span className="ti-cwd" title={session.cwd}>{session.cwd}</span>}
      {!session.running && <span className="ti-sym">{sym}</span>}
      <input
        ref={inputRef}
        value={value}
        spellCheck={false}
        autoComplete="off"
        aria-label="Terminal input"
        placeholder={!session.alive ? 'Session ended — press Enter to restart' : session.running ? `Running ${session.runningCommand ?? ''} — input goes to the program · Ctrl+C to stop` : 'Type a command and press Enter'}
        onChange={(e) => setValue(e.target.value)}
        onPaste={async (e) => {
          const text = e.clipboardData.getData('text').replace(/\r\n/g, '\n').replace(/\n+$/, '')
          if (!text.includes('\n')) return
          // Multi-line paste runs as one script — only after the user confirms.
          e.preventDefault()
          const lines = text.split('\n')
          const ok = await confirmAction(
            `Run ${lines.length} pasted lines?`,
            `They run together as one script in this ${session.shell === 'cmd' ? 'Command Prompt' : 'shell'} session: ${lines.slice(0, 3).join(' ⏎ ').slice(0, 220)}${lines.length > 3 ? ' ⏎ …' : ''}`,
            'Run'
          )
          if (ok) {
            void submitLine(session.id, value + text)
            setValue('')
          }
          inputRef.current?.focus()
        }}
        onKeyDown={(e) => {
          const hist = getHistory()
          if (e.key === 'Enter') {
            e.preventDefault()
            const line = value
            setValue('')
            histIdx.current = null
            void submitLine(session.id, line)
          } else if (e.key === 'ArrowUp') {
            if (!hist.length) return
            e.preventDefault()
            if (histIdx.current === null) {
              draft.current = value
              histIdx.current = hist.length - 1
            } else histIdx.current = Math.max(0, histIdx.current - 1)
            setValue(hist[histIdx.current])
          } else if (e.key === 'ArrowDown') {
            if (histIdx.current === null) return
            e.preventDefault()
            if (histIdx.current >= hist.length - 1) {
              histIdx.current = null
              setValue(draft.current)
            } else {
              histIdx.current++
              setValue(hist[histIdx.current])
            }
          } else if ((e.key === 'c' || e.key === 'C') && e.ctrlKey && !e.shiftKey) {
            const el = e.currentTarget
            if (el.selectionStart === el.selectionEnd) {
              e.preventDefault()
              setValue('')
              void interrupt()
            }
          } else if (e.key === 'Escape') {
            setValue('')
            histIdx.current = null
          }
        }}
      />
    </div>
  )
}

export function TerminalView({ compact = false }: { compact?: boolean }) {
  ensureTerminalData()
  ensureDevData()
  const enabled = useSetting('developer.enabled')
  const sessions = useTerm((s) => s.sessions)
  const activeId = useTerm((s) => s.activeId)
  const loaded = useTerm((s) => s.loaded)
  const env = useDev((s) => s.env)
  const currentId = useDev((s) => s.currentId)
  const projects = useDev((s) => s.projects)
  const [wrap, setWrap] = useState(true)
  const active = sessions.find((s) => s.id === activeId) ?? null
  const shells = env?.shells.filter((s) => s.available) ?? []

  const newSession = (shell?: ShellId, projectId: string | null = currentId) => void createTerminal(projectId, shell)

  const newMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    openMenu({
      x: r.left,
      y: r.bottom + 4,
      items: [
        ...shells.map((s) => ({ label: `New ${s.label}${s.id === env?.defaultShell ? ' (default)' : ''}`, run: () => newSession(s.id) })),
        { separator: true },
        ...projects.slice(0, 12).map((p) => ({ label: `Open in ${p.name}`, run: () => newSession(undefined, p.id) })),
        { label: 'Open in home folder', run: () => newSession(undefined, null) }
      ]
    })
  }

  if (!enabled) {
    return (
      <div className="term dev-root">
        <div className="term-empty">Developer tools are turned off in Settings → Developer.</div>
      </div>
    )
  }

  return (
    <div className="term dev-root">
      <div className="term-tabs">
        <div className="term-tabs-scroll">
          {sessions.map((s) => (
            <div key={s.id} className={'term-tab' + (s.id === activeId ? ' on' : '')} onClick={() => useTerm.setState({ activeId: s.id })} title={`${s.cwd}${s.runningCommand ? ' — ' + s.runningCommand : ''}`}>
              <span className={'tt-dot' + (!s.alive ? ' dead' : s.running ? ' run' : '')} />
              <span className="label" style={{ fontSize: 9 }}>
                {SHELL_SHORT[s.shell]}
              </span>
              <span className="ellipsis">{s.title}</span>
              <button
                className="icon-btn sm tt-x"
                style={{ width: 18, height: 18 }}
                aria-label="Close terminal"
                onClick={(e) => {
                  e.stopPropagation()
                  void invoke('terminal:close', s.id)
                }}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
        <button className="icon-btn sm" onClick={() => newSession()} data-tip="New terminal" aria-label="New terminal">
          <Plus size={14} />
        </button>
        <button className="icon-btn sm" onClick={newMenu} data-tip="Choose shell / folder" aria-label="Choose shell">
          <ChevronDown size={13} />
        </button>
        {active && (
          <>
            <span style={{ width: 1, height: 16, background: 'var(--line-strong)', margin: '0 2px' }} />
            <button className="icon-btn sm" disabled={!active.running} onClick={() => invoke('terminal:interrupt', active.id)} data-tip="Interrupt (Ctrl+C)" aria-label="Interrupt">
              <Octagon size={13} />
            </button>
            <button className="icon-btn sm" onClick={() => invoke('terminal:clear', active.id)} data-tip="Clear" aria-label="Clear">
              <Eraser size={13} />
            </button>
            <button
              className="icon-btn sm"
              onClick={() => {
                const text = modelFor(active.id).term.plainText()
                invoke('app:clipboardWrite', text)
                toast({ kind: 'ok', title: 'Terminal output copied', body: `${text.split('\n').length} lines`, ttl: 1800 })
              }}
              data-tip="Copy output"
              aria-label="Copy output"
            >
              <Copy size={13} />
            </button>
            {!compact && (
              <button className={'icon-btn sm' + (wrap ? ' on' : '')} onClick={() => setWrap(!wrap)} data-tip="Wrap long lines" aria-label="Wrap">
                <WrapText size={13} />
              </button>
            )}
            <button className="icon-btn sm" onClick={() => invoke('terminal:restart', active.id)} data-tip="Restart session" aria-label="Restart">
              <RotateCw size={13} />
            </button>
          </>
        )}
      </div>
      {active ? (
        <>
          <Output key={active.id} session={active} wrap={wrap} />
          <InputRow session={active} />
          <div className="term-foot">
            <span>Line-based terminal · no PTY — full-screen apps (vim, less, htop) won’t work</span>
            <span className="spacer" />
            {!compact && <span>Enter run · ↑↓ history · Ctrl+C stop</span>}
            {active.lastExitCode !== null && !active.running && <span className={active.lastExitCode === 0 ? '' : 'bad'}>exit {active.lastExitCode}</span>}
          </div>
        </>
      ) : (
        <div className="term-empty">
          <div className="col" style={{ alignItems: 'center', gap: 10, maxWidth: 380 }}>
            <SquareTerminal size={28} style={{ color: 'var(--fg-3)' }} />
            <div style={{ color: 'var(--fg-0)', fontWeight: 600 }}>{loaded ? 'No terminal sessions' : 'Loading…'}</div>
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              Commands run locally on this computer in a persistent {env ? (shells.find((s) => s.id === env.defaultShell)?.label ?? 'shell') : 'shell'} process. This is a line-based terminal: interactive full-screen programs are not supported.
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn primary" onClick={() => newSession()}>
                <Plus size={13} /> New terminal{currentId ? ` in ${projects.find((p) => p.id === currentId)?.name ?? 'project'}` : ''}
              </button>
              {shells.length > 1 && (
                <button className="btn" onClick={newMenu}>
                  Shell <ChevronDown size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function TerminalPanel({ popout }: { popout?: boolean }) {
  return <TerminalView compact={!popout} />
}
