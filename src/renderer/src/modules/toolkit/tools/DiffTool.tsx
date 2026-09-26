import { useMemo, useState, type ReactNode } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { Seg } from '../../../components/ui'
import { diffLines, diffStats, diffWords, sideBySide, unifiedHunks, unifiedText, type DiffLine, type SideRow } from '../lib/diff'
import { CopyBtn, OpenFileBtn, Pane, useDebounced, useToolState } from '../ui'

const A = `server {
  listen 80;
  server_name example.com;
  root /var/www/html;
  index index.html;
}
`
const B = `server {
  listen 443 ssl;
  server_name example.com www.example.com;
  root /var/www/html;
  index index.html index.htm;
  ssl_certificate /etc/ssl/cert.pem;
}
`

const MAX_ROWS = 5000

/** Word-level highlight for a paired delete/insert. */
function Words({ a, b, side }: { a: string; b: string; side: 'a' | 'b' }): ReactNode {
  const parts = diffWords(a, b)
  return parts.map((p, i) => {
    if (p.op === 'equal') return <span key={i}>{p.text}</span>
    if (side === 'a' && p.op === 'delete') return <mark key={i} className="d">{p.text}</mark>
    if (side === 'b' && p.op === 'insert') return <mark key={i} className="i">{p.text}</mark>
    return null
  })
}

function SideBySide({ rows, context }: { rows: SideRow[]; context: number | null }) {
  // Optionally collapse long unchanged stretches.
  const visible: (SideRow | { gap: number })[] = []
  if (context === null) visible.push(...rows)
  else {
    const changed = rows.map((r) => r.left?.op !== 'equal' || r.right?.op !== 'equal')
    let gap = 0
    rows.forEach((r, i) => {
      let near = false
      for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) if (changed[k]) near = true
      if (near) {
        if (gap) visible.push({ gap })
        gap = 0
        visible.push(r)
      } else gap++
    })
    if (gap) visible.push({ gap })
  }
  return (
    <div className="tk-diff selectable">
      {visible.slice(0, MAX_ROWS).map((r, i) =>
        'gap' in r ? (
          <div key={i} className="tk-diff-row">
            <div className="hunk">⋯ {r.gap} unchanged line{r.gap === 1 ? '' : 's'}</div>
          </div>
        ) : (
          <div key={i} className="tk-diff-row">
            <div className="ln">{r.left?.line ?? ''}</div>
            <div className={'tx ' + (r.left ? (r.left.op === 'delete' ? 'del' : '') : 'empty-side')}>{r.left && r.right && r.left.op === 'delete' ? <Words a={r.left.text} b={r.right.text} side="a" /> : r.left?.text}</div>
            <div className="ln">{r.right?.line ?? ''}</div>
            <div className={'tx ' + (r.right ? (r.right.op === 'insert' ? 'ins' : '') : 'empty-side')}>{r.left && r.right && r.right.op === 'insert' ? <Words a={r.left.text} b={r.right.text} side="b" /> : r.right?.text}</div>
          </div>
        )
      )}
      {visible.length > MAX_ROWS && <div className="hunk">{(visible.length - MAX_ROWS).toLocaleString()} more rows not shown</div>}
    </div>
  )
}

function Unified({ lines, context }: { lines: DiffLine[]; context: number | null }) {
  const hunks = context === null ? [{ header: '', lines }] : unifiedHunks(lines, context)
  let n = 0
  return (
    <div className="tk-diff unified selectable">
      {hunks.map((h, hi) => (
        <div key={hi}>
          {h.header && (
            <div className="tk-diff-row">
              <div className="hunk">{h.header}</div>
            </div>
          )}
          {h.lines.map((l, i) => {
            if (n++ > MAX_ROWS) return null
            return (
              <div key={i} className="tk-diff-row">
                <div className="ln">{l.aLine ?? ''}</div>
                <div className="ln">{l.bLine ?? ''}</div>
                <div className={'tx sign ' + (l.op === 'delete' ? 'del' : l.op === 'insert' ? 'ins' : '')}>{l.op === 'delete' ? '−' : l.op === 'insert' ? '+' : ' '}</div>
                <div className={'tx ' + (l.op === 'delete' ? 'del' : l.op === 'insert' ? 'ins' : '')}>{l.text}</div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export default function DiffTool() {
  const [a, setA] = useToolState('diff.a', A)
  const [b, setB] = useToolState('diff.b', B)
  const [mode, setMode] = useToolState<'side' | 'unified'>('diff.mode', 'side')
  const [ws, setWs] = useToolState('diff.ws', false)
  const [ic, setIc] = useToolState('diff.ic', false)
  const [collapse, setCollapse] = useToolState('diff.collapse', true)
  const [edit, setEdit] = useState(true)
  const da = useDebounced(a, 150)
  const db = useDebounced(b, 150)

  const { lines, ms } = useMemo(() => {
    const t0 = performance.now()
    const lines = diffLines(da, db, { ignoreWhitespace: ws, ignoreCase: ic })
    return { lines, ms: performance.now() - t0 }
  }, [da, db, ws, ic])
  const stats = diffStats(lines)
  const rows = useMemo(() => sideBySide(lines), [lines])
  const patch = () => unifiedText(da, db, { ignoreWhitespace: ws, ignoreCase: ic, aName: 'original', bName: 'modified' })
  const context = collapse ? 3 : null

  return (
    <div className="tk-body fill">
      <div className="tk-bar">
        <Seg value={mode} onChange={setMode} options={[{ value: 'side', label: 'Side by side' }, { value: 'unified', label: 'Unified' }]} />
        <button className={'btn sm' + (edit ? ' primary' : '')} onClick={() => setEdit(!edit)}>
          {edit ? 'Hide inputs' : 'Edit inputs'}
        </button>
        <button
          className="btn sm"
          onClick={() => {
            setA(b)
            setB(a)
          }}
          data-tip="Swap sides"
        >
          <ArrowLeftRight size={12} /> Swap
        </button>
        <span className="tk-sep" />
        <label className="row" style={{ gap: 5, fontSize: 12 }}>
          <input type="checkbox" checked={ws} onChange={(e) => setWs(e.target.checked)} /> Ignore whitespace
        </label>
        <label className="row" style={{ gap: 5, fontSize: 12 }}>
          <input type="checkbox" checked={ic} onChange={(e) => setIc(e.target.checked)} /> Ignore case
        </label>
        <label className="row" style={{ gap: 5, fontSize: 12 }}>
          <input type="checkbox" checked={collapse} onChange={(e) => setCollapse(e.target.checked)} /> Collapse unchanged
        </label>
        <span className="spacer" />
        <span className="tk-note mono">
          <span className="up">+{stats.added}</span>
          <span className="down">−{stats.removed}</span>
          <span>={stats.unchanged}</span>
          <span className="dim">{ms < 1 ? '<1' : Math.round(ms)} ms</span>
        </span>
        <CopyBtn text={patch} label="Copy patch" disabled={!stats.added && !stats.removed} />
      </div>
      {edit && (
        <div className="tk-split" style={{ flex: '0 0 34%' }}>
          <Pane label="Original" actions={<OpenFileBtn label="Open" onText={(t) => setA(t)} />}>
            <textarea className="tk-editor" value={a} onChange={(e) => setA(e.target.value)} spellCheck={false} placeholder="Original text…" aria-label="Original text" />
          </Pane>
          <Pane label="Modified" actions={<OpenFileBtn label="Open" onText={(t) => setB(t)} />}>
            <textarea className="tk-editor" value={b} onChange={(e) => setB(e.target.value)} spellCheck={false} placeholder="Modified text…" aria-label="Modified text" />
          </Pane>
        </div>
      )}
      <Pane label={stats.added || stats.removed ? 'Differences' : 'No differences'} style={{ flex: 1 }}>
        {!da && !db ? (
          <div className="empty">Paste two texts to compare.</div>
        ) : !stats.added && !stats.removed ? (
          <div className="empty">
            {da === db
              ? 'The texts are identical.'
              : ws || ic
                ? 'No differences with the current ignore options.'
                : 'No line differences — the texts differ only in line endings (CRLF / LF) or the final newline.'}
          </div>
        ) : mode === 'side' ? (
          <SideBySide rows={rows} context={context} />
        ) : (
          <Unified lines={lines} context={context} />
        )}
      </Pane>
    </div>
  )
}
