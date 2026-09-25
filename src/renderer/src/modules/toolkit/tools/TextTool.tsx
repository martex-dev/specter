import { useMemo, useState } from 'react'
import { Redo2, Undo2 } from 'lucide-react'
import { CASES, applyLineOp, convertCase, textStats, wordFrequency, type CaseKind, type LineOp } from '../lib/text'
import { CopyBtn, OpenFileBtn, Pane, useDebounced, useToolState } from '../ui'

const LINE_OPS: { id: LineOp; label: string; tip: string }[] = [
  { id: 'trim', label: 'Trim lines', tip: 'Remove leading/trailing whitespace on every line' },
  { id: 'collapse', label: 'Collapse spaces', tip: 'Collapse runs of spaces/tabs to a single space' },
  { id: 'removeBlank', label: 'Remove blank lines', tip: 'Delete empty or whitespace-only lines' },
  { id: 'tabsToSpaces', label: 'Tabs → spaces', tip: 'Replace tabs with two spaces' },
  { id: 'stripNonAscii', label: 'Strip non-ASCII', tip: 'Remove characters outside printable ASCII' },
  { id: 'sortAsc', label: 'Sort A→Z', tip: 'Sort lines (code-point order)' },
  { id: 'sortDesc', label: 'Sort Z→A', tip: 'Sort lines descending' },
  { id: 'sortNatural', label: 'Natural sort', tip: 'Case-insensitive, numbers compared numerically' },
  { id: 'sortLength', label: 'Sort by length', tip: 'Shortest lines first' },
  { id: 'dedupe', label: 'Dedupe', tip: 'Remove duplicate lines, keeping the first' },
  { id: 'reverse', label: 'Reverse', tip: 'Reverse line order' },
  { id: 'shuffle', label: 'Shuffle', tip: 'Random line order' },
  { id: 'number', label: 'Number lines', tip: 'Prefix each line with its number' }
]

export default function TextTool() {
  const [text, setText] = useToolState('text.src', 'Paste or type text here.\nThe quick brown fox jumps over the lazy dog.\nthe quick brown fox jumps over the lazy dog.\n  userAccountId, HTTPServer_config  ')
  const [history, setHistory] = useState<string[]>([])
  const [future, setFuture] = useState<string[]>([])
  const deb = useDebounced(text, 100)
  const stats = useMemo(() => textStats(deb), [deb])
  const freq = useMemo(() => wordFrequency(deb, 12), [deb])

  const apply = (next: string) => {
    if (next === text) return
    setHistory((h) => [...h.slice(-49), text])
    setFuture([])
    setText(next)
  }
  const undo = () => {
    const prev = history[history.length - 1]
    if (prev === undefined) return
    setHistory(history.slice(0, -1))
    setFuture((f) => [text, ...f])
    setText(prev)
  }
  const redo = () => {
    const nx = future[0]
    if (nx === undefined) return
    setFuture(future.slice(1))
    setHistory((h) => [...h, text])
    setText(nx)
  }

  const stat = (label: string, v: string | number) => (
    <div className="card stat" style={{ padding: '8px 12px' }}>
      <div className="label">{label}</div>
      <div className="mono" style={{ fontSize: 17, marginTop: 2 }}>
        {typeof v === 'number' ? v.toLocaleString() : v}
      </div>
    </div>
  )

  return (
    <div className="tk-body fill">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, flex: 'none' }}>
        {stat('Characters', stats.chars)}
        {stat('No spaces', stats.charsNoSpaces)}
        {stat('Words', stats.words)}
        {stat('Lines', stats.lines)}
        {stat('Sentences', stats.sentences)}
        {stat('Paragraphs', stats.paragraphs)}
        {stat('UTF-8 bytes', stats.bytes)}
        {stat('Reading', stats.words ? `${Math.max(1, Math.round(stats.readingMinutes))} min` : '—')}
      </div>
      <div className="tk-bar">
        <span className="label" style={{ width: 44 }}>
          Case
        </span>
        {CASES.map((c) => (
          <button key={c.id} className="btn sm" onClick={() => apply(convertCase(text, c.id as CaseKind))}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="tk-bar">
        <span className="label" style={{ width: 44 }}>
          Lines
        </span>
        {LINE_OPS.map((o) => (
          <button key={o.id} className="btn sm" data-tip={o.tip} onClick={() => apply(applyLineOp(text, o.id))}>
            {o.label}
          </button>
        ))}
      </div>
      <div className="tk-split" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 1fr)' }}>
        <Pane
          label="Text"
          actions={
            <>
              <button className="icon-btn sm" onClick={undo} disabled={!history.length} data-tip="Undo transform" aria-label="Undo">
                <Undo2 size={13} />
              </button>
              <button className="icon-btn sm" onClick={redo} disabled={!future.length} data-tip="Redo" aria-label="Redo">
                <Redo2 size={13} />
              </button>
              <OpenFileBtn label="Open" onText={(t) => apply(t)} />
              <CopyBtn text={text} label="Copy" />
              <button className="btn sm ghost" onClick={() => apply('')}>
                Clear
              </button>
            </>
          }
        >
          <textarea className="tk-editor wrap" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Text" />
        </Pane>
        <Pane label="Top words">
          {freq.length ? (
            <div className="tk-kv">
              {freq.map(([w, n]) => (
                <div key={w} className="tk-kv-row" style={{ minHeight: 26 }}>
                  <span className="tk-kv-v mono">{w}</span>
                  <span className="mono dim">{n}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">No words yet.</div>
          )}
        </Pane>
      </div>
    </div>
  )
}
