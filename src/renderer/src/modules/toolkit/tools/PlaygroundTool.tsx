import { useCallback, useEffect, useRef, useState } from 'react'
import { Ban, Play, RotateCcw, ShieldCheck } from 'lucide-react'
import { Seg } from '../../../components/ui'
import runnerUrl from './playground-runner.html?url&no-inline'
import { Pane, useToolState } from '../ui'

const DEFAULTS = {
  html: `<main>
  <h1>Hello, playground</h1>
  <button id="btn">Clicked 0 times</button>
</main>`,
  css: `body { font: 15px system-ui, sans-serif; margin: 24px; color: #1d2330; }
h1 { font-weight: 650; letter-spacing: -0.02em; }
button { padding: 8px 14px; border-radius: 8px; border: 1px solid #c7ccd8; background: #f4f6fb; cursor: pointer; }`,
  js: `let n = 0
const btn = document.getElementById('btn')
btn.addEventListener('click', () => {
  btn.textContent = \`Clicked \${++n} times\`
  console.log('click', { n, at: new Date().toISOString() })
})
console.info('Ready — console output appears below.')`
}

type Lang = 'html' | 'css' | 'js'
interface LogLine {
  level: string
  text: string
  n: number
}

/** Tab inserts two spaces; Ctrl/Cmd+Enter runs. */
function onEditorKey(e: React.KeyboardEvent<HTMLTextAreaElement>, run: () => void, set: (v: string) => void) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    run()
    return
  }
  if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault()
    const el = e.currentTarget
    const { selectionStart: s, selectionEnd: en, value } = el
    const next = value.slice(0, s) + '  ' + value.slice(en)
    set(next)
    requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2))
  }
}

export default function PlaygroundTool() {
  const [html, setHtml] = useToolState('pg.html', DEFAULTS.html)
  const [css, setCss] = useToolState('pg.css', DEFAULTS.css)
  const [js, setJs] = useToolState('pg.js', DEFAULTS.js)
  const [tab, setTab] = useToolState<Lang>('pg.tab', 'html')
  const [layout, setLayout] = useToolState<'tabs' | 'stack'>('pg.layout', 'tabs')
  const [auto, setAuto] = useToolState('pg.auto', true)
  const [runId, setRunId] = useState(0)
  const [logs, setLogs] = useState<LogLine[]>([])
  const frame = useRef<HTMLIFrameElement>(null)
  const code = useRef({ html, css, js })
  code.current = { html, css, js }
  const seq = useRef(0)

  const run = useCallback(() => {
    setLogs([])
    setRunId((r) => r + 1)
  }, [])

  // Auto-run (debounced) on edits. The initial render already runs via the iframe's "ready".
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (!auto) return
    const t = setTimeout(run, 500)
    return () => clearTimeout(t)
  }, [html, css, js, auto, run])

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return
      const d = e.data as { __specterPlayground?: boolean; type?: string; level?: string; text?: string }
      if (!d || !d.__specterPlayground) return
      if (d.type === 'ready') frame.current.contentWindow?.postMessage({ type: 'run', ...code.current }, '*')
      else if (d.type === 'clear') setLogs([])
      else if (d.type === 'console') setLogs((l) => [...l.slice(-499), { level: d.level ?? 'log', text: String(d.text ?? ''), n: ++seq.current }])
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  const editors: { id: Lang; label: string; value: string; set: (v: string) => void }[] = [
    { id: 'html', label: 'HTML', value: html, set: setHtml },
    { id: 'css', label: 'CSS', value: css, set: setCss },
    { id: 'js', label: 'JavaScript', value: js, set: setJs }
  ]

  const editor = (ed: (typeof editors)[number]) => <textarea className="tk-editor" value={ed.value} onChange={(e) => ed.set(e.target.value)} onKeyDown={(e) => onEditorKey(e, run, ed.set)} spellCheck={false} aria-label={`${ed.label} code`} />

  return (
    <div className="tk-body fill">
      <div className="tk-bar">
        <button className="btn sm primary" onClick={run} data-tip="Run" data-kbd="Ctrl+Enter">
          <Play size={12} /> Run
        </button>
        <label className="row" style={{ gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-run
        </label>
        <Seg value={layout} onChange={setLayout} options={[{ value: 'tabs', label: 'Tabs' }, { value: 'stack', label: 'Stacked' }]} />
        <button
          className="btn sm ghost"
          onClick={() => {
            setHtml(DEFAULTS.html)
            setCss(DEFAULTS.css)
            setJs(DEFAULTS.js)
          }}
        >
          <RotateCcw size={12} /> Reset example
        </button>
        <button
          className="btn sm ghost"
          onClick={() => {
            setHtml('')
            setCss('')
            setJs('')
          }}
        >
          Blank
        </button>
        <span className="spacer" />
        <span className="tk-note" data-tip="Runs in a sandboxed frame with an opaque origin: no access to SPECTER, cookies, storage or the network.">
          <ShieldCheck size={12} /> Sandboxed · no network
        </span>
      </div>
      <div className="tk-split">
        {layout === 'tabs' ? (
          <Pane label={<Seg value={tab} onChange={setTab} options={editors.map((e) => ({ value: e.id, label: e.label }))} />}>{editor(editors.find((e) => e.id === tab)!)}</Pane>
        ) : (
          <div style={{ display: 'grid', gridTemplateRows: 'repeat(3, minmax(0, 1fr))', gap: 8, minHeight: 0 }}>
            {editors.map((ed) => (
              <Pane key={ed.id} label={ed.label}>
                {editor(ed)}
              </Pane>
            ))}
          </div>
        )}
        <Pane
          label="Preview"
          actions={
            <button className="btn sm ghost" onClick={() => setLogs([])} data-tip="Clear console">
              <Ban size={12} /> Clear
            </button>
          }
        >
          <iframe key={runId} ref={frame} className="tk-frame" src={runnerUrl} sandbox="allow-scripts allow-modals" title="Playground preview" referrerPolicy="no-referrer" />
          <div className="tk-console" aria-label="Console" aria-live="polite">
            {logs.length === 0 ? (
              <div className="tk-console-line dim">Console is empty.</div>
            ) : (
              logs.map((l) => (
                <div key={l.n} className={'tk-console-line ' + l.level}>
                  {l.text}
                </div>
              ))
            )}
          </div>
        </Pane>
      </div>
    </div>
  )
}
