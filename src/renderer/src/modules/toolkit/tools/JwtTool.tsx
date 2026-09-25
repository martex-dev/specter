import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { canVerifyHmac, decodeJwt, verifyHmac } from '../lib/jwt'
import { relativeTime } from '../lib/time'
import { CopyBtn, ErrorNote, JsonTree, Pane, useToolState } from '../ui'

const SAMPLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

const CLAIMS: Record<string, string> = {
  iss: 'Issuer',
  sub: 'Subject',
  aud: 'Audience',
  exp: 'Expiration time',
  nbf: 'Not before',
  iat: 'Issued at',
  jti: 'JWT ID',
  scope: 'Scopes',
  azp: 'Authorized party',
  alg: 'Signing algorithm',
  typ: 'Token type',
  kid: 'Key ID'
}

export default function JwtTool() {
  const [token, setToken] = useToolState('jwt.token', SAMPLE)
  const [secret, setSecret] = useState('')
  const [b64, setB64] = useState(false)
  const [verdict, setVerdict] = useState<null | 'valid' | 'invalid' | { error: string }>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(t)
  }, [])

  const decoded = useMemo(() => {
    if (!token.trim()) return null
    try {
      return { ok: true as const, d: decodeJwt(token, now) }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  }, [token, now])

  useEffect(() => setVerdict(null), [token, secret, b64])

  const verify = async () => {
    try {
      setVerdict((await verifyHmac(token, secret, b64)) ? 'valid' : 'invalid')
    } catch (err) {
      setVerdict({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  const d = decoded?.ok ? decoded.d : null
  const parts = token.trim().replace(/^Bearer\s+/i, '').split('.')

  return (
    <div className="tk-body">
      <Pane label="Encoded token" actions={<CopyBtn text={token} label="Copy" />} style={{ flex: 'none' }}>
        <textarea className="tk-editor wrap" style={{ minHeight: 90, height: 96 }} value={token} onChange={(e) => setToken(e.target.value)} spellCheck={false} placeholder="Paste a JWT (header.payload.signature)…" aria-label="JWT" />
        {decoded && !decoded.ok && (
          <ErrorNote>
            <AlertCircle size={12} style={{ verticalAlign: -2, marginRight: 6 }} />
            {decoded.error}
          </ErrorNote>
        )}
        {d && (
          <div className="tk-ok mono" style={{ wordBreak: 'break-all' }}>
            <span style={{ color: 'var(--bad)' }}>{parts[0].slice(0, 24)}…</span>
            <span style={{ color: 'var(--accent)' }}>{parts[1].slice(0, 24)}…</span>
            <span style={{ color: 'var(--info)' }}>{parts[2] ? parts[2].slice(0, 24) + '…' : '(no signature)'}</span>
          </div>
        )}
      </Pane>

      {d && (
        <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {d.status === 'valid' && <span className="badge ok">Not expired</span>}
            {d.status === 'expired' && <span className="badge bad">Expired</span>}
            {d.status === 'not-yet-valid' && <span className="badge warn">Not yet valid</span>}
            {d.status === 'no-exp' && <span className="badge warn">No expiry (exp) claim</span>}
            <span className="badge">{d.alg ?? 'no alg'}</span>
            {d.alg === 'none' && <span className="badge bad">Unsigned (alg: none)</span>}
            <span className="tk-note">Decoded locally. Decoding does not prove the token is authentic.</span>
          </div>

          <div className="tk-split" style={{ flex: 'none' }}>
            <Pane label="Header" actions={<CopyBtn text={JSON.stringify(d.header, null, 2)} />}>
              <JsonTree value={d.header} openDepth={3} />
            </Pane>
            <Pane label="Payload" actions={<CopyBtn text={d.payload !== undefined ? JSON.stringify(d.payload, null, 2) : (d.payloadText ?? '')} />}>
              {d.payload !== undefined ? <JsonTree value={d.payload} openDepth={3} /> : <pre className="tk-code wrap">{d.payloadText}</pre>}
            </Pane>
          </div>

          {(d.times.length > 0 || (d.payload && typeof d.payload === 'object')) && (
            <Pane label="Claims" style={{ flex: 'none' }}>
              <div className="tk-kv">
                {d.times.map((t) => (
                  <div key={t.claim} className="tk-kv-row">
                    <span className="tk-kv-k">
                      {t.label} <span className="mono dim">{t.claim}</span>
                    </span>
                    <span className="tk-kv-v mono">
                      {t.date.toLocaleString()} <span className="dim">· {t.date.toISOString()} · {relativeTime(t.date, now)}</span>
                    </span>
                  </div>
                ))}
                {d.payload && typeof d.payload === 'object'
                  ? Object.entries(d.payload as Record<string, unknown>)
                      .filter(([k]) => CLAIMS[k] && !['exp', 'nbf', 'iat'].includes(k))
                      .map(([k, v]) => (
                        <div key={k} className="tk-kv-row">
                          <span className="tk-kv-k">
                            {CLAIMS[k]} <span className="mono dim">{k}</span>
                          </span>
                          <span className="tk-kv-v mono">{typeof v === 'string' ? v : JSON.stringify(v)}</span>
                        </div>
                      ))
                  : null}
              </div>
            </Pane>
          )}

          <Pane label="Verify signature" style={{ flex: 'none' }}>
            <div style={{ padding: 12 }} className="col">
              {canVerifyHmac(d.alg) ? (
                <>
                  <div className="row">
                    <input className="input mono grow" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={`${d.alg} shared secret`} aria-label="Secret" onKeyDown={(e) => e.key === 'Enter' && secret && verify()} />
                    <label className="row" style={{ gap: 5, fontSize: 12 }}>
                      <input type="checkbox" checked={b64} onChange={(e) => setB64(e.target.checked)} /> Secret is Base64
                    </label>
                    <button className="btn primary sm" disabled={!secret} onClick={verify}>
                      Verify
                    </button>
                  </div>
                  {verdict === 'valid' && (
                    <div className="ok row" style={{ gap: 6 }}>
                      <ShieldCheck size={14} /> Signature verified with this secret.
                    </div>
                  )}
                  {verdict === 'invalid' && (
                    <div className="bad row" style={{ gap: 6 }}>
                      <ShieldAlert size={14} /> Invalid signature for this secret.
                    </div>
                  )}
                  {verdict && typeof verdict === 'object' && <div className="bad">{verdict.error}</div>}
                  <div className="tk-note">The secret stays in memory on this device (WebCrypto HMAC) and is never stored.</div>
                </>
              ) : (
                <div className="tk-note">
                  <ShieldQuestion size={13} /> Signature not verified. Only HMAC tokens (HS256/384/512) can be checked here; {d.alg ?? 'this algorithm'} needs the issuer’s public key.
                </div>
              )}
            </div>
          </Pane>
        </>
      )}
    </div>
  )
}
