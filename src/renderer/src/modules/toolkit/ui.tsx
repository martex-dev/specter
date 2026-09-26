// Small building blocks shared by the toolkit tools.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, FileUp } from 'lucide-react'
import { invoke } from '../../lib/ipc'
import { toast } from '../../stores/ui'

// ---------------------------------------------------------------- state

const memory = new Map<string, unknown>()

/**
 * useState that survives tool switches within the session (kept in memory
 * only — nothing is written to disk).
 */
export function useToolState<T>(key: string, initial: T | (() => T)): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => (memory.has(key) ? (memory.get(key) as T) : typeof initial === 'function' ? (initial as () => T)() : initial))
  const set = useCallback(
    (nv: T | ((p: T) => T)) => {
      setV((prev) => {
        const next = typeof nv === 'function' ? (nv as (p: T) => T)(prev) : nv
        memory.set(key, next)
        return next
      })
    },
    [key]
  )
  return [v, set]
}

/** Debounced value (for expensive recomputation while typing). */
export function useDebounced<T>(value: T, ms = 150): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * Number field that can be cleared while typing: valid input is committed
 * (clamped) as you type, and the field shows the committed value again on
 * blur. A plain controlled `value={n}` snapped an emptied field straight back
 * to a number, so typing after Backspace produced values like "150".
 */
export function NumberInput({
  value,
  min,
  max,
  onValue,
  ...rest
}: { value: number; min: number; max: number; onValue: (v: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max' | 'type'>) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return (
    <input
      {...rest}
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => {
        const t = e.target.value
        setDraft(t)
        const n = Number(t)
        if (t.trim() !== '' && Number.isFinite(n)) onValue(Math.max(min, Math.min(max, n)))
      }}
      onBlur={(e) => {
        setDraft(String(value))
        rest.onBlur?.(e)
      }}
    />
  )
}

// ---------------------------------------------------------------- clipboard

export async function copyText(text: string, what = 'Copied'): Promise<void> {
  try {
    await invoke('app:clipboardWrite', text)
    toast({ kind: 'ok', title: what, ttl: 1600 })
  } catch {
    toast({ kind: 'error', title: 'Copy failed' })
  }
}

export function CopyBtn({ text, label, disabled, title = 'Copy' }: { text: string | (() => string); label?: string; disabled?: boolean; title?: string }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1200)
    return () => clearTimeout(t)
  }, [done])
  const run = async () => {
    const t = typeof text === 'function' ? text() : text
    try {
      await invoke('app:clipboardWrite', t)
      setDone(true)
    } catch {
      toast({ kind: 'error', title: 'Copy failed' })
    }
  }
  if (label)
    return (
      <button className="btn sm" onClick={run} disabled={disabled} data-tip={title}>
        {done ? <Check size={12} className="ok" /> : <Copy size={12} />}
        {label}
      </button>
    )
  return (
    <button className="icon-btn sm" onClick={run} disabled={disabled} data-tip={title} aria-label={title}>
      {done ? <Check size={12} className="ok" /> : <Copy size={12} />}
    </button>
  )
}

// ---------------------------------------------------------------- layout

export function Pane({ label, actions, children, className, style }: { label: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <section className={'tk-pane' + (className ? ' ' + className : '')} style={style}>
      <header className="tk-pane-h">
        {typeof label === 'string' ? <span className="label">{label}</span> : label}
        <span className="spacer" />
        {actions}
      </header>
      <div className="tk-pane-b">{children}</div>
    </section>
  )
}

export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return <pre className={'tk-code mono selectable' + (className ? ' ' + className : '')}>{children}</pre>
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="tk-error mono">{children}</div>
}

export function KV({ rows }: { rows: [ReactNode, ReactNode, string?][] }) {
  return (
    <div className="tk-kv">
      {rows.map(([k, v, copy], i) => (
        <div key={i} className="tk-kv-row">
          <span className="tk-kv-k">{k}</span>
          <span className="tk-kv-v mono selectable">{v}</span>
          {copy !== undefined ? <CopyBtn text={copy} /> : <span style={{ width: 22 }} />}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- files

/** Opens a local text file through the core file picker (no renderer FS access). */
export async function pickTextFile(filters?: { name: string; extensions: string[] }[]): Promise<{ name: string; text: string } | null> {
  const path = await invoke('app:pickFile', filters)
  if (!path) return null
  try {
    const text = await invoke('app:readTextFile', path)
    return { name: path.split(/[\\/]/).pop() ?? path, text }
  } catch (err) {
    toast({ kind: 'error', title: 'Could not read file', body: err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err) })
    return null
  }
}

export function OpenFileBtn({ onText, filters, label = 'Open file' }: { onText: (text: string, name: string) => void; filters?: { name: string; extensions: string[] }[]; label?: string }) {
  return (
    <button
      className="btn sm"
      onClick={async () => {
        const f = await pickTextFile(filters)
        if (f) onText(f.text, f.name)
      }}
      data-tip="Load a local file (read locally, never uploaded)"
    >
      <FileUp size={12} />
      {label}
    </button>
  )
}

/** Binary file chooser via <input type=file> — the file is read in the renderer only. */
export function FileInputBtn({ accept, onFile, label = 'Choose file', primary }: { accept?: string; onFile: (f: File) => void; label?: string; primary?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button className={'btn sm' + (primary ? ' primary' : '')} onClick={() => ref.current?.click()}>
        <FileUp size={12} />
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
    </>
  )
}

/** Props for a drop target that accepts a single file. */
export function useFileDrop(onFile: (f: File) => void): { dragging: boolean; props: React.HTMLAttributes<HTMLElement> } {
  const [dragging, setDragging] = useState(false)
  return {
    dragging,
    props: {
      onDragOver: (e) => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        setDragging(true)
      },
      onDragLeave: () => setDragging(false),
      onDrop: (e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        e.stopPropagation()
        setDragging(false)
        onFile(e.dataTransfer.files[0])
      }
    }
  }
}

// ---------------------------------------------------------------- JSON tree

type Path = (string | number)[]

function preview(v: unknown): string {
  if (Array.isArray(v)) return `[${v.length}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).length}}`
  return ''
}

function Leaf({ v }: { v: unknown }) {
  if (v === null) return <span className="tk-j-null">null</span>
  if (typeof v === 'string') return <span className="tk-j-str">{JSON.stringify(v)}</span>
  if (typeof v === 'number') return <span className="tk-j-num">{Number.isFinite(v) ? String(v) : String(v)}</span>
  if (typeof v === 'boolean') return <span className="tk-j-bool">{String(v)}</span>
  if (v === undefined) return <span className="tk-j-null">undefined</span>
  return <span>{String(v)}</span>
}

function Node({ name, v, path, depth, openDepth, onPath }: { name?: string | number; v: unknown; path: Path; depth: number; openDepth: number; onPath?: (p: Path) => void }) {
  const isObj = v !== null && typeof v === 'object'
  const [open, setOpen] = useState(depth < openDepth)
  useEffect(() => setOpen(depth < openDepth), [openDepth, depth])
  const entries: [string | number, unknown][] = isObj ? (Array.isArray(v) ? v.map((x, i) => [i, x] as [number, unknown]) : Object.entries(v as object)) : []
  const LIMIT = 500
  const [shown, setShown] = useState(LIMIT)
  const label =
    name === undefined ? null : (
      <span className={typeof name === 'number' ? 'tk-j-idx' : 'tk-j-key'} onClick={() => onPath?.(path)}>
        {typeof name === 'number' ? name : JSON.stringify(name)}
        <span className="dim">: </span>
      </span>
    )
  if (!isObj)
    return (
      <div className="tk-j-row" style={{ paddingLeft: depth * 14 + 16 }}>
        {label}
        <Leaf v={v} />
      </div>
    )
  return (
    <>
      <div className="tk-j-row tk-j-branch" style={{ paddingLeft: depth * 14 }} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {label}
        <span className="dim">{Array.isArray(v) ? 'Array' : 'Object'}</span>
        <span className="tk-j-count">{preview(v)}</span>
      </div>
      {open &&
        entries.slice(0, shown).map(([k, x]) => <Node key={String(k)} name={k} v={x} path={[...path, k]} depth={depth + 1} openDepth={openDepth} onPath={onPath} />)}
      {open && entries.length > shown && (
        <div className="tk-j-row" style={{ paddingLeft: (depth + 1) * 14 + 16 }}>
          <button className="btn sm ghost" onClick={() => setShown(shown + LIMIT)}>
            Show {Math.min(LIMIT, entries.length - shown)} more of {entries.length - shown}
          </button>
        </div>
      )}
    </>
  )
}

export function JsonTree({ value, openDepth = 2, onPath }: { value: unknown; openDepth?: number; onPath?: (p: Path) => void }) {
  return (
    <div className="tk-json-tree mono selectable">
      <Node v={value} path={[]} depth={0} openDepth={openDepth} onPath={onPath} />
    </div>
  )
}

/** Byte size formatter (local; avoids importing core format helpers into every tool). */
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let i = -1
  do {
    v /= 1024
    i++
  } while (v >= 1024 && i < u.length - 1)
  return `${v.toFixed(v < 10 ? 2 : 1)} ${u[i]}`
}
