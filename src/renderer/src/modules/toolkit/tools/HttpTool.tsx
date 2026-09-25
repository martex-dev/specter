import { useMemo, useState } from 'react'
import { AlertTriangle, Globe, Loader2, Send } from 'lucide-react'
import { Seg } from '../../../components/ui'
import { invoke } from '../../../lib/ipc'
import type { HttpToolResponse } from '@shared/modules/toolkit'
import { parseJson } from '../lib/json'
import { CopyBtn, ErrorNote, JsonTree, Pane, bytes, useToolState } from '../ui'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

function parseHeaders(text: string): [string, string][] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf(':')
      return i > 0 ? ([l.slice(0, i).trim(), l.slice(i + 1).trim()] as [string, string]) : ([l, ''] as [string, string])
    })
}

function statusClass(s: number): string {
  return s >= 200 && s < 300 ? 'ok' : s >= 300 && s < 400 ? 'accent' : s >= 400 ? 'bad' : ''
}

function curlFor(method: string, url: string, headers: [string, string][], body: string): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  const parts = ['curl', method !== 'GET' ? `-X ${method}` : '', q(url), ...headers.map(([k, v]) => `-H ${q(`${k}: ${v}`)}`), body && method !== 'GET' && method !== 'HEAD' ? `--data-raw ${q(body)}` : '']
  return parts.filter(Boolean).join(' \\\n  ')
}

export default function HttpTool() {
  const [method, setMethod] = useToolState<string>('http.method', 'GET')
  const [url, setUrl] = useToolState('http.url', 'https://httpbin.org/get?hello=specter')
  const [headers, setHeaders] = useToolState('http.headers', 'Accept: application/json')
  const [body, setBody] = useToolState('http.body', '')
  const [timeout, setTimeoutS] = useToolState('http.timeout', 30)
  const [follow, setFollow] = useToolState('http.follow', true)
  const [reqTab, setReqTab] = useToolState<'headers' | 'body'>('http.reqTab', 'headers')
  const [resTab, setResTab] = useToolState<'body' | 'tree' | 'headers'>('http.resTab', 'body')
  const [res, setRes] = useState<HttpToolResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [unwired, setUnwired] = useState(false)

  const hdrs = useMemo(() => parseHeaders(headers), [headers])
  const validUrl = /^https?:\/\/[^\s]+$/i.test(url.trim())

  const send = async () => {
    if (!validUrl || busy) return
    setBusy(true)
    setUnwired(false)
    try {
      setRes(await invoke('tools:http', { method, url: url.trim(), headers: hdrs, body: body || undefined, timeoutMs: timeout * 1000, followRedirects: follow }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/No handler registered/i.test(msg)) setUnwired(true)
      else setRes({ ok: false, status: 0, statusText: '', url, redirected: false, headers: [], body: '', binary: false, truncated: false, bytes: 0, ttfbMs: 0, totalMs: 0, error: msg })
    } finally {
      setBusy(false)
    }
  }

  const ctype = res?.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
  const json = useMemo(() => {
    if (!res?.body || !(/json/i.test(ctype) || /^\s*[[{]/.test(res.body))) return null
    const p = parseJson(res.body)
    return p.ok ? p.value : null
  }, [res, ctype])
  const pretty = json !== null ? JSON.stringify(json, null, 2) : (res?.body ?? '')

  return (
    <div className="tk-body fill">
      <div className="tk-note warn" style={{ flex: 'none' }}>
        <Globe size={12} /> Requests are sent from this computer to the URL you enter when you press Send — nowhere else. Cookies from your browsing are not included.
      </div>
      <div className="tk-bar" style={{ flexWrap: 'nowrap' }}>
        <select className="select mono" style={{ height: 34, width: 110 }} value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Method">
          {METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input className="input mono grow" style={{ height: 34, fontSize: 13 }} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="https://api.example.com/v1/items" spellCheck={false} aria-label="URL" />
        <button className="btn primary" style={{ height: 34 }} onClick={send} disabled={!validUrl || busy}>
          {busy ? <Loader2 size={13} className="spin" /> : <Send size={13} />} Send
        </button>
      </div>
      {unwired && (
        <div className="tk-pane" style={{ flex: 'none' }}>
          <ErrorNote>The HTTP tester’s main-process handler (tools:http) is not registered in this build — add the toolkit main module to src/main/modules.ts.</ErrorNote>
        </div>
      )}
      <div className="tk-split">
        <Pane
          label={<Seg value={reqTab} onChange={setReqTab} options={[{ value: 'headers', label: `Headers · ${hdrs.length}` }, { value: 'body', label: 'Body' }]} />}
          actions={
            <>
              <label className="row" style={{ gap: 4, fontSize: 11.5 }} data-tip="Follow 3xx redirects">
                <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Redirects
              </label>
              <label className="row" style={{ gap: 4, fontSize: 11.5 }}>
                Timeout
                <input className="input mono" type="number" min={1} max={120} style={{ width: 54, height: 22, padding: '0 6px' }} value={timeout} onChange={(e) => setTimeoutS(Math.max(1, Math.min(120, Number(e.target.value) || 30)))} aria-label="Timeout seconds" />s
              </label>
              <CopyBtn text={() => curlFor(method, url.trim(), hdrs, body)} title="Copy as cURL" />
            </>
          }
        >
          {reqTab === 'headers' ? (
            <textarea className="tk-editor" value={headers} onChange={(e) => setHeaders(e.target.value)} spellCheck={false} placeholder={'Header-Name: value\nAuthorization: Bearer …'} aria-label="Request headers" />
          ) : (
            <>
              <textarea className="tk-editor" value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} placeholder={method === 'GET' || method === 'HEAD' ? `${method} requests don't send a body` : '{"key": "value"}'} disabled={method === 'GET' || method === 'HEAD'} aria-label="Request body" />
              {body && !hdrs.some(([k]) => k.toLowerCase() === 'content-type') && (
                <div className="tk-ok">
                  <AlertTriangle size={12} className="warn" /> No Content-Type header set.
                  {/^\s*[[{]/.test(body) && (
                    <button className="btn sm" onClick={() => setHeaders((headers.trim() ? headers.trim() + '\n' : '') + 'Content-Type: application/json')}>
                      Add application/json
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </Pane>
        <Pane
          label={
            res && !res.error ? (
              <span className="row" style={{ gap: 10 }}>
                <span className={'tk-status ' + statusClass(res.status)}>
                  {res.status} {res.statusText}
                </span>
                <span className="mono dim" style={{ fontSize: 11 }}>
                  {Math.round(res.totalMs)} ms · TTFB {Math.round(res.ttfbMs)} ms · {bytes(res.bytes)}
                </span>
              </span>
            ) : (
              'Response'
            )
          }
          actions={
            res &&
            !res.error && (
              <>
                <Seg
                  value={resTab}
                  onChange={setResTab}
                  options={[
                    { value: 'body', label: 'Body' },
                    ...(json !== null ? [{ value: 'tree' as const, label: 'Tree' }] : []),
                    { value: 'headers', label: `Headers · ${res.headers.length}` }
                  ]}
                />
                <CopyBtn text={resTab === 'headers' ? res.headers.map(([k, v]) => `${k}: ${v}`).join('\n') : pretty} />
              </>
            )
          }
        >
          {busy ? (
            <div className="empty">
              <Loader2 size={18} className="spin" /> Waiting for response…
            </div>
          ) : !res ? (
            <div className="empty">Press Send to make the request.</div>
          ) : res.error ? (
            <ErrorNote>{res.error}</ErrorNote>
          ) : resTab === 'headers' ? (
            <div className="tk-kv">
              {res.headers.map(([k, v], i) => (
                <div key={i} className="tk-kv-row">
                  <span className="tk-kv-k mono" style={{ width: 200 }}>
                    {k}
                  </span>
                  <span className="tk-kv-v mono">{v}</span>
                </div>
              ))}
            </div>
          ) : resTab === 'tree' && json !== null ? (
            <JsonTree value={json} openDepth={2} />
          ) : res.binary ? (
            <div className="empty">Binary response ({ctype || 'unknown type'}, {bytes(res.bytes)}) — not displayed.</div>
          ) : (
            <>
              {(res.redirected || res.truncated) && (
                <div className="tk-ok" style={{ borderTop: 'none', borderBottom: '1px solid var(--line)' }}>
                  {res.redirected && <span>Redirected to {res.url}</span>}
                  {res.truncated && <span className="warn">Body truncated at 5 MB</span>}
                </div>
              )}
              <textarea className="tk-editor" readOnly value={pretty} aria-label="Response body" />
            </>
          )}
        </Pane>
      </div>
    </div>
  )
}
