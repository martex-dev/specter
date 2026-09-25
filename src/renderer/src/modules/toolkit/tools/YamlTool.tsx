import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { Seg } from '../../../components/ui'
import { parseYamlAll, YamlError } from '../lib/yaml'
import { pathString } from '../lib/json'
import { CopyBtn, ErrorNote, JsonTree, OpenFileBtn, Pane, copyText, useDebounced, useToolState } from '../ui'

const SAMPLE = `# docker-compose style example
services:
  web:
    image: nginx:1.27
    ports:
      - "8080:80"
    environment: &env
      LOG_LEVEL: info
      DEBUG: false
  worker:
    image: app:latest
    environment:
      <<: *env
      QUEUE: jobs
    command: >
      node worker.js
      --concurrency 4
`

const LIMITS =
  'Supported: block & flow collections, quoted/plain/block scalars, comments, multiple documents, anchors/aliases, merge keys (<<), core-schema types. Not supported: complex "?" keys, custom tags, YAML 1.1 yes/no booleans.'

export default function YamlTool() {
  const [src, setSrc] = useToolState('yaml.src', SAMPLE)
  const [view, setView] = useToolState<'tree' | 'json'>('yaml.view', 'tree')
  const [doc, setDoc] = useState(0)
  const deb = useDebounced(src, 80)

  const result = useMemo(() => {
    if (!deb.trim()) return null
    try {
      return { ok: true as const, docs: parseYamlAll(deb) }
    } catch (err) {
      return { ok: false as const, error: err instanceof YamlError ? err.message : String(err) }
    }
  }, [deb])

  const docs = result?.ok ? result.docs : []
  const cur = docs[Math.min(doc, docs.length - 1)]
  const json = useMemo(() => (result?.ok ? JSON.stringify(docs.length === 1 ? docs[0] : docs, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v), 2) : ''), [result, docs])

  return (
    <div className="tk-body fill">
      <div className="tk-bar">
        <OpenFileBtn onText={(t) => setSrc(t)} filters={[{ name: 'YAML', extensions: ['yaml', 'yml'] }, { name: 'All files', extensions: ['*'] }]} />
        <button className="btn sm ghost" onClick={() => setSrc('')}>
          Clear
        </button>
        <span className="spacer" />
        <span className="tk-note" data-tip={LIMITS}>
          <Info size={12} /> Local subset parser — hover for limitations
        </span>
      </div>
      <div className="tk-split">
        <Pane label="YAML">
          <textarea className="tk-editor" value={src} onChange={(e) => setSrc(e.target.value)} spellCheck={false} placeholder="Paste YAML…" aria-label="YAML input" />
          {result && !result.ok && (
            <ErrorNote>
              <AlertCircle size={12} style={{ verticalAlign: -2, marginRight: 6 }} />
              {result.error}
            </ErrorNote>
          )}
          {result?.ok && (
            <div className="tk-ok">
              <span className="ok row" style={{ gap: 4 }}>
                <CheckCircle2 size={12} /> Parsed
              </span>
              <span>
                {docs.length} document{docs.length === 1 ? '' : 's'}
              </span>
            </div>
          )}
        </Pane>
        <Pane
          label={<Seg value={view} onChange={setView} options={[{ value: 'tree', label: 'Tree' }, { value: 'json', label: 'JSON' }]} />}
          actions={
            <>
              {docs.length > 1 && view === 'tree' && (
                <select className="select" style={{ height: 24, fontSize: 11.5 }} value={doc} onChange={(e) => setDoc(Number(e.target.value))} aria-label="Document">
                  {docs.map((_, i) => (
                    <option key={i} value={i}>
                      Document {i + 1}
                    </option>
                  ))}
                </select>
              )}
              <CopyBtn text={json} disabled={!json} label="Copy JSON" />
            </>
          }
        >
          {!result ? (
            <div className="empty">Paste or open a YAML file.</div>
          ) : !result.ok ? (
            <div className="empty">Fix the error to see the result.</div>
          ) : view === 'tree' ? (
            <JsonTree value={cur} openDepth={3} onPath={(p) => copyText(pathString(p), `Copied ${pathString(p)}`)} />
          ) : (
            <textarea className="tk-editor" readOnly value={json} aria-label="JSON output" />
          )}
        </Pane>
      </div>
    </div>
  )
}
