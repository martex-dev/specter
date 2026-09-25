import { useMemo, useState } from 'react'
import { AlertCircle, Plus, X } from 'lucide-react'
import { Seg } from '../../../components/ui'
import { CopyBtn, ErrorNote, KV, Pane, useToolState } from '../ui'

type Mode = 'component' | 'uri' | 'form'

function encode(s: string, mode: Mode): string {
  if (mode === 'uri') return encodeURI(s)
  if (mode === 'form') return encodeURIComponent(s).replace(/%20/g, '+')
  return encodeURIComponent(s)
}
function decode(s: string, mode: Mode): string {
  if (mode === 'uri') return decodeURI(s)
  if (mode === 'form') return decodeURIComponent(s.replace(/\+/g, ' '))
  return decodeURIComponent(s)
}

function Codec() {
  const [plain, setPlain] = useToolState('url.plain', 'name=Ada Lovelace&note=a+b/c?d#e ✓')
  const [mode, setMode] = useToolState<Mode>('url.mode', 'component')
  const [enc, setEnc] = useToolState('url.enc', () => encodeURIComponent('name=Ada Lovelace&note=a+b/c?d#e ✓'))
  const [err, setErr] = useState<string | null>(null)
  return (
    <>
      <div className="tk-bar">
        <Seg
          value={mode}
          onChange={(m) => {
            setMode(m)
            setEnc(encode(plain, m))
            setErr(null)
          }}
          options={[
            { value: 'component', label: 'Component' },
            { value: 'uri', label: 'Full URI' },
            { value: 'form', label: 'Form (+ for space)' }
          ]}
        />
        <span className="tk-note">{mode === 'component' ? 'encodeURIComponent — escapes everything except A–Z a–z 0–9 - _ . ! ~ * \' ( )' : mode === 'uri' ? 'encodeURI — keeps URL structure characters like : / ? # & =' : 'application/x-www-form-urlencoded'}</span>
      </div>
      <div className="tk-split" style={{ flex: '0 0 200px' }}>
        <Pane label="Decoded" actions={<CopyBtn text={plain} />}>
          <textarea
            className="tk-editor wrap"
            value={plain}
            onChange={(e) => {
              setPlain(e.target.value)
              setEnc(encode(e.target.value, mode))
              setErr(null)
            }}
            spellCheck={false}
            aria-label="Decoded text"
          />
        </Pane>
        <Pane label="Encoded" actions={<CopyBtn text={enc} />}>
          <textarea
            className="tk-editor wrap"
            style={{ wordBreak: 'break-all' }}
            value={enc}
            onChange={(e) => {
              setEnc(e.target.value)
              try {
                setPlain(decode(e.target.value, mode))
                setErr(null)
              } catch {
                setErr('Malformed percent-encoding (e.g. a lone % or an invalid UTF-8 sequence)')
              }
            }}
            spellCheck={false}
            aria-label="Encoded text"
          />
          {err && (
            <ErrorNote>
              <AlertCircle size={12} style={{ verticalAlign: -2, marginRight: 6 }} />
              {err}
            </ErrorNote>
          )}
        </Pane>
      </div>
    </>
  )
}

const sd = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function Parser() {
  const [raw, setRaw] = useToolState('url.raw', 'https://user:pass@example.com:8443/path/to/page.html?q=search+terms&lang=en&tag=a&tag=b#section-2')
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, u: new URL(raw.trim()) }
    } catch {
      return { ok: false as const }
    }
  }, [raw])
  const params = parsed.ok ? [...parsed.u.searchParams.entries()] : []
  const [edit, setEdit] = useState<[string, string][] | null>(null)
  const rows = edit ?? params

  const rebuild = (next: [string, string][]) => {
    setEdit(next)
    if (!parsed.ok) return
    const u = new URL(parsed.u.toString())
    u.search = ''
    for (const [k, v] of next) if (k) u.searchParams.append(k, v)
    setRaw(u.toString())
  }

  return (
    <>
      <Pane label="URL" actions={<CopyBtn text={raw} />} style={{ flex: 'none' }}>
        <textarea
          className="tk-editor wrap"
          style={{ minHeight: 60, height: 64, wordBreak: 'break-all' }}
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value)
            setEdit(null)
          }}
          spellCheck={false}
          aria-label="URL to parse"
        />
        {!parsed.ok && raw.trim() && <ErrorNote>Not an absolute URL (include the scheme, e.g. https://).</ErrorNote>}
      </Pane>
      {parsed.ok && (
        <div className="tk-split" style={{ flex: 'none' }}>
          <Pane label="Parts">
            <KV
              rows={[
                ['Protocol', parsed.u.protocol, parsed.u.protocol],
                ['Username', parsed.u.username || <span className="dim">—</span>, sd(parsed.u.username)],
                ['Password', parsed.u.password ? '•'.repeat(Math.min(12, parsed.u.password.length)) : <span className="dim">—</span>, sd(parsed.u.password)],
                ['Host', parsed.u.hostname, parsed.u.hostname],
                ['Port', parsed.u.port || <span className="dim">default</span>, parsed.u.port],
                ['Origin', parsed.u.origin, parsed.u.origin],
                ['Path', sd(parsed.u.pathname), parsed.u.pathname],
                ['Query', parsed.u.search || <span className="dim">—</span>, parsed.u.search],
                ['Fragment', parsed.u.hash ? sd(parsed.u.hash) : <span className="dim">—</span>, parsed.u.hash]
              ]}
            />
          </Pane>
          <Pane
            label={`Query parameters · ${rows.length}`}
            actions={
              <button className="btn sm" onClick={() => rebuild([...rows, ['', '']])}>
                <Plus size={12} /> Add
              </button>
            }
          >
            {rows.length ? (
              <div className="tk-kv">
                {rows.map(([k, v], i) => (
                  <div key={i} className="tk-kv-row">
                    <input className="input mono" style={{ width: 150, height: 26 }} value={k} onChange={(e) => rebuild(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} aria-label="Parameter name" />
                    <input className="input mono grow" style={{ height: 26 }} value={v} onChange={(e) => rebuild(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} aria-label="Parameter value" />
                    <button className="icon-btn sm" onClick={() => rebuild(rows.filter((_, j) => j !== i))} aria-label="Remove parameter">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">No query parameters.</div>
            )}
          </Pane>
        </div>
      )}
    </>
  )
}

export default function UrlTool() {
  const [tab, setTab] = useToolState<'codec' | 'parse'>('url.tab', 'codec')
  return (
    <div className="tk-body">
      <div className="tk-bar">
        <Seg value={tab} onChange={setTab} options={[{ value: 'codec', label: 'Encode / decode' }, { value: 'parse', label: 'Parse & edit URL' }]} />
      </div>
      {tab === 'codec' ? <Codec /> : <Parser />}
    </div>
  )
}
