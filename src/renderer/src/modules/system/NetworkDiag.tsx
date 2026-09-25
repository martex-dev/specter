// On-demand network diagnostics. Nothing runs until the user presses a button,
// and each card says exactly what will be contacted. No port scanning.
import { useState, type ReactNode } from 'react'
import { Globe, Lock, Play, Radio, Timer } from 'lucide-react'
import type { ConnectivityResult, DnsResult, HttpsResult, NetDiagRequest, NetDiagResult, TlsResult } from '@shared/modules/system'
import { invoke } from '../../lib/ipc'

function useDiag<T extends NetDiagResult>() {
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<T | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [at, setAt] = useState<number | null>(null)
  const run = async (req: NetDiagRequest) => {
    setBusy(true)
    setErr(null)
    try {
      setRes((await invoke('system:netDiag', req)) as T)
    } catch (e) {
      setRes(null)
      setErr(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
      setAt(Date.now())
    }
  }
  return { busy, res, err, at, run }
}

function DiagCard({ icon, title, note, children, onRun, busy, input, at }: { icon: ReactNode; title: string; note: ReactNode; children?: ReactNode; onRun: () => void; busy: boolean; input?: ReactNode; at: number | null }) {
  return (
    <section className="card sys-card">
      <div className="sys-card-h">
        <span className="sys-card-icon">{icon}</span>
        <span className="label">{title}</span>
        <span className="spacer" />
        {at && <span className="dim" style={{ fontSize: 11 }}>{new Date(at).toLocaleTimeString()}</span>}
      </div>
      <div className="sys-sub">{note}</div>
      <form
        className="row"
        style={{ gap: 8, marginTop: 8 }}
        onSubmit={(e) => {
          e.preventDefault()
          onRun()
        }}
      >
        {input}
        <button className="btn sm primary" type="submit" disabled={busy}>
          <Play size={12} className={busy ? 'spin' : ''} /> {busy ? 'Running…' : 'Run'}
        </button>
      </form>
      {children && <div className="sys-diag-out">{children}</div>}
    </section>
  )
}

const ok = (b: boolean) => <span className={'badge ' + (b ? 'ok' : 'bad')}>{b ? 'ok' : 'fail'}</span>
const msv = (v: number | undefined) => (v === undefined ? '—' : `${v.toFixed(v < 10 ? 1 : 0)} ms`)

function Err({ children }: { children: ReactNode }) {
  return <div className="sys-unavail"><span className="badge bad">Error</span><span className="selectable">{children}</span></div>
}

function Connectivity() {
  const d = useDiag<ConnectivityResult>()
  return (
    <DiagCard icon={<Radio size={14} />} title="Connectivity" note="Sends one HEAD request each to www.gstatic.com/generate_204 and to 1.1.1.1 by IP (separates DNS problems from connectivity). Redirects are not followed; any HTTP answer counts as reachable." onRun={() => d.run({ kind: 'connectivity' })} busy={d.busy} at={d.at}>
      {d.err && <Err>{d.err}</Err>}
      {d.res && (
        <table className="table sys-mini">
          <tbody>
            <tr>
              <td>Operating system reports</td>
              <td style={{ textAlign: 'right' }}>{d.res.online ? <span className="badge ok">online</span> : <span className="badge bad">offline</span>}</td>
            </tr>
            {d.res.checks.map((c) => (
              <tr key={c.target}>
                <td className="mono ellipsis" style={{ maxWidth: 280 }}>{c.target.replace('https://', '')}</td>
                <td style={{ textAlign: 'right' }} className="num">
                  {c.ok ? `${c.status} · ${msv(c.ms)} ` : <span className="dim">{c.error ?? `HTTP ${c.status}`} </span>}
                  {ok(c.ok)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </DiagCard>
  )
}

function Dns() {
  const d = useDiag<DnsResult>()
  const [host, setHost] = useState('example.com')
  const r = d.res
  return (
    <DiagCard
      icon={<Globe size={14} />}
      title="DNS lookup"
      note="Resolves the host with the Windows resolver (may be answered from its cache) and queries your configured DNS servers directly."
      onRun={() => d.run({ kind: 'dns', host })}
      busy={d.busy}
      at={d.at}
      input={<input className="input grow" value={host} onChange={(e) => setHost(e.target.value)} placeholder="host name" aria-label="Host" spellCheck={false} />}
    >
      {d.err && <Err>{d.err}</Err>}
      {r && (
        <table className="table sys-mini">
          <tbody>
            <tr>
              <td>OS resolver</td>
              <td style={{ textAlign: 'right' }} className="num">{'error' in r.lookup ? <span className="bad">{r.lookup.error}</span> : msv(r.lookup.ms)}</td>
            </tr>
            {!('error' in r.lookup) && (
              <tr>
                <td className="dim">Addresses</td>
                <td className="mono selectable" style={{ textAlign: 'right', fontSize: 11 }}>{r.lookup.addresses.map((a) => a.address).join(', ')}</td>
              </tr>
            )}
            <tr>
              <td>Direct query (A + AAAA)</td>
              <td style={{ textAlign: 'right' }} className="num">{'error' in r.query ? <span className="dim">{r.query.error}</span> : msv(r.query.ms)}</td>
            </tr>
            {!('error' in r.query) && (
              <tr>
                <td className="dim">Records</td>
                <td className="mono selectable" style={{ textAlign: 'right', fontSize: 11 }}>{[...r.query.a, ...r.query.aaaa].join(', ') || '—'}</td>
              </tr>
            )}
            <tr>
              <td className="dim">DNS servers</td>
              <td className="mono" style={{ textAlign: 'right', fontSize: 11 }}>{r.servers.join(', ') || '—'}</td>
            </tr>
          </tbody>
        </table>
      )}
    </DiagCard>
  )
}

function Https() {
  const d = useDiag<HttpsResult>()
  const [url, setUrl] = useState('https://www.gstatic.com/generate_204')
  const r = d.res
  const phases = r && !r.error ? ([['DNS', r.dnsMs], ['TCP connect', r.connectMs], ['TLS handshake', r.tlsMs], ['Server response', r.ttfbMs]] as [string, number | undefined][]) : []
  const total = phases.reduce((a, [, v]) => a + (v ?? 0), 0) || 1
  return (
    <DiagCard
      icon={<Timer size={14} />}
      title="HTTPS latency"
      note="One HEAD request over a fresh connection (no keep-alive) to the URL below, port 443 only. Sent directly from SPECTER’s main process."
      onRun={() => d.run({ kind: 'https', url })}
      busy={d.busy}
      at={d.at}
      input={<input className="input grow" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="URL" spellCheck={false} />}
    >
      {d.err && <Err>{d.err}</Err>}
      {r?.error && <Err>{r.error}</Err>}
      {r && !r.error && (
        <>
          <div className="sys-phases">
            {phases.map(([k, v], i) => (
              <i key={k} className={'p' + i} style={{ width: `${((v ?? 0) / total) * 100}%` }} data-tip={`${k} ${msv(v)}`} />
            ))}
          </div>
          <table className="table sys-mini">
            <tbody>
              {phases.map(([k, v], i) => (
                <tr key={k}>
                  <td>
                    <span className={'sys-dot p' + i} />
                    {k}
                  </td>
                  <td className="num" style={{ textAlign: 'right' }}>{msv(v)}</td>
                </tr>
              ))}
              <tr>
                <td><b>Total</b></td>
                <td className="num" style={{ textAlign: 'right' }}><b>{msv(r.totalMs)}</b></td>
              </tr>
              <tr>
                <td className="dim">Response</td>
                <td className="mono" style={{ textAlign: 'right', fontSize: 11 }}>HTTP/{r.httpVersion} {r.status} · {r.remoteAddress}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </DiagCard>
  )
}

function Tls() {
  const d = useDiag<TlsResult>()
  const [host, setHost] = useState('github.com')
  const r = d.res
  return (
    <DiagCard
      icon={<Lock size={14} />}
      title="TLS certificate"
      note="Opens one TLS connection to the host on port 443, reads the negotiated protocol and certificate chain, then closes it."
      onRun={() => d.run({ kind: 'tls', host })}
      busy={d.busy}
      at={d.at}
      input={<input className="input grow" value={host} onChange={(e) => setHost(e.target.value)} placeholder="host name" aria-label="Host" spellCheck={false} />}
    >
      {d.err && <Err>{d.err}</Err>}
      {r?.error && <Err>{r.error}</Err>}
      {r && !r.error && (
        <table className="table sys-mini">
          <tbody>
            <tr>
              <td>Trust</td>
              <td style={{ textAlign: 'right' }}>{r.authorized ? <span className="badge ok">valid chain</span> : <span className="badge bad">{r.authorizationError ?? 'not trusted'}</span>}</td>
            </tr>
            <tr>
              <td>Protocol · cipher</td>
              <td className="mono" style={{ textAlign: 'right', fontSize: 11 }}>{r.protocol} · {r.cipher}{r.alpn ? ` · ALPN ${r.alpn}` : ''}</td>
            </tr>
            <tr>
              <td>Handshake</td>
              <td className="num" style={{ textAlign: 'right' }}>{msv(r.ms)} · <span className="mono">{r.remoteAddress}</span></td>
            </tr>
            {r.cert && (
              <>
                <tr>
                  <td>Subject</td>
                  <td className="selectable" style={{ textAlign: 'right' }}>{r.cert.subject}</td>
                </tr>
                <tr>
                  <td>Issuer</td>
                  <td className="selectable" style={{ textAlign: 'right' }}>{r.cert.issuer}</td>
                </tr>
                <tr>
                  <td>Valid</td>
                  <td style={{ textAlign: 'right' }}>
                    {new Date(r.cert.validFrom).toLocaleDateString()} → {new Date(r.cert.validTo).toLocaleDateString()}{' '}
                    <span className={'badge ' + (r.cert.daysRemaining < 0 ? 'bad' : r.cert.daysRemaining < 14 ? 'warn' : 'ok')}>
                      {r.cert.daysRemaining < 0 ? 'expired' : `${r.cert.daysRemaining} days left`}
                    </span>
                  </td>
                </tr>
                {r.cert.keyBits && (
                  <tr>
                    <td>Key</td>
                    <td className="num" style={{ textAlign: 'right' }}>{r.cert.keyBits} bit</td>
                  </tr>
                )}
                <tr>
                  <td>Names</td>
                  <td className="mono selectable" style={{ textAlign: 'right', fontSize: 11 }}>{r.cert.altNames.join(', ') || '—'}</td>
                </tr>
                <tr>
                  <td>SHA-256</td>
                  <td className="mono selectable" style={{ textAlign: 'right', fontSize: 10, wordBreak: 'break-all' }}>{r.cert.fingerprint256}</td>
                </tr>
              </>
            )}
            {r.chain && r.chain.length > 1 && (
              <tr>
                <td>Chain</td>
                <td style={{ textAlign: 'right', fontSize: 11.5 }}>{r.chain.map((c) => c.subject).join(' ← ')}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </DiagCard>
  )
}

export default function NetworkDiag() {
  return (
    <div className="sys-grid">
      <Connectivity />
      <Dns />
      <Https />
      <Tls />
    </div>
  )
}
