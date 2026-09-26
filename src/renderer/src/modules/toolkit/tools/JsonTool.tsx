import { useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Crosshair } from 'lucide-react'
import { Seg } from '../../../components/ui'
import { jsonStats, parseJson, pathString, sortKeysDeep } from '../lib/json'
import { CopyBtn, ErrorNote, JsonTree, OpenFileBtn, Pane, bytes, copyText, useDebounced, useToolState } from '../ui'

const SAMPLE = '{"name":"SPECTER","version":1,"features":["tabs","workspaces",{"toolkit":true}],"nested":{"b":2,"a":1,"empty":null}}'

type Indent = '2' | '4' | 'tab' | 'min'

export default function JsonTool() {
  const [src, setSrc] = useToolState('json.src', SAMPLE)
  const [indent, setIndent] = useToolState<Indent>('json.indent', '2')
  const [sort, setSort] = useToolState('json.sort', false)
  const [view, setView] = useToolState<'text' | 'tree'>('json.view', 'text')
  const [depth, setDepth] = useState(2)
  // Bumped by Expand all / Collapse so they re-apply even when `depth` is unchanged
  // (nodes toggled by hand keep their own open state otherwise).
  const [treeKey, setTreeKey] = useState(0)
  const setAllDepth = (d: number) => {
    setDepth(d)
    setTreeKey((k) => k + 1)
  }
  const ta = useRef<HTMLTextAreaElement>(null)
  const deb = useDebounced(src, src.length > 200_000 ? 300 : 60)

  const parsed = useMemo(() => (deb.trim() ? parseJson(deb) : null), [deb])
  const value = parsed?.ok ? (sort ? sortKeysDeep(parsed.value) : parsed.value) : undefined
  const output = useMemo(() => {
    if (!parsed?.ok) return ''
    return indent === 'min' ? JSON.stringify(value) : JSON.stringify(value, null, indent === 'tab' ? '\t' : Number(indent))
  }, [parsed, value, indent])
  const stats = useMemo(() => (parsed?.ok ? jsonStats(parsed.value) : null), [parsed])

  const goToError = () => {
    if (!parsed || parsed.ok || !ta.current) return
    const el = ta.current
    const off = Math.max(0, Math.min(parsed.error.offset, src.length))
    el.focus()
    el.setSelectionRange(off, Math.min(src.length, off + 1))
    // Scroll roughly to the line.
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 19
    el.scrollTop = Math.max(0, (parsed.error.line - 4) * lh)
  }

  return (
    <div className="tk-body fill">
      <div className="tk-bar">
        <Seg value={indent} onChange={setIndent} options={[{ value: '2', label: '2 spaces' }, { value: '4', label: '4 spaces' }, { value: 'tab', label: 'Tab' }, { value: 'min', label: 'Minify' }]} />
        <button className={'btn sm' + (sort ? ' primary' : '')} onClick={() => setSort(!sort)} aria-pressed={sort}>
          Sort keys
        </button>
        <span className="tk-sep" />
        <button className="btn sm" disabled={!parsed?.ok} onClick={() => setSrc(output)} data-tip="Replace the input with the formatted output">
          Apply to input
        </button>
        <OpenFileBtn onText={(t) => setSrc(t)} filters={[{ name: 'JSON', extensions: ['json', 'jsonc', 'geojson', 'map', 'txt'] }, { name: 'All files', extensions: ['*'] }]} />
        <button className="btn sm ghost" onClick={() => setSrc('')}>
          Clear
        </button>
      </div>
      <div className="tk-split">
        <Pane label="Input" actions={<span className="dim mono" style={{ fontSize: 11 }}>{bytes(new TextEncoder().encode(deb).length)}</span>}>
          <textarea ref={ta} className="tk-editor" value={src} onChange={(e) => setSrc(e.target.value)} spellCheck={false} placeholder="Paste JSON…" aria-label="JSON input" />
          {parsed && !parsed.ok && (
            <ErrorNote>
              <div className="row" style={{ gap: 6 }}>
                <AlertCircle size={13} />
                <span className="grow">
                  Line {parsed.error.line}, column {parsed.error.column}: {parsed.error.message}
                </span>
                <button className="btn sm" onClick={goToError}>
                  <Crosshair size={12} /> Go to
                </button>
              </div>
            </ErrorNote>
          )}
          {parsed?.ok && stats && (
            <div className="tk-ok">
              <span className="ok row" style={{ gap: 4 }}>
                <CheckCircle2 size={12} /> Valid JSON
              </span>
              <span>{stats.objects} objects</span>
              <span>{stats.arrays} arrays</span>
              <span>{stats.keys} keys</span>
              <span>depth {stats.depth}</span>
            </div>
          )}
        </Pane>
        <Pane
          label={
            <Seg
              value={view}
              onChange={setView}
              options={[
                { value: 'text', label: 'Output' },
                { value: 'tree', label: 'Tree' }
              ]}
            />
          }
          actions={
            <>
              {view === 'tree' && (
                <>
                  <button className="btn sm ghost" onClick={() => setAllDepth(99)}>
                    Expand all
                  </button>
                  <button className="btn sm ghost" onClick={() => setAllDepth(1)}>
                    Collapse
                  </button>
                </>
              )}
              <CopyBtn text={output} disabled={!output} label="Copy" />
            </>
          }
        >
          {!parsed ? (
            <div className="empty">Paste or open JSON to format it.</div>
          ) : !parsed.ok ? (
            <div className="empty">Fix the error to see the output.</div>
          ) : view === 'text' ? (
            <textarea className="tk-editor" readOnly value={output} spellCheck={false} aria-label="Formatted JSON" />
          ) : (
            <>
              <JsonTree key={treeKey} value={value} openDepth={depth} onPath={(p) => copyText(pathString(p), `Copied ${pathString(p)}`)} />
              <div className="tk-ok">Click a key to copy its path.</div>
            </>
          )}
        </Pane>
      </div>
    </div>
  )
}
