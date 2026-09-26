import { useEffect, useState } from 'react'
import { CheckCircle2, FileUp, Loader2, XCircle } from 'lucide-react'
import { Seg } from '../../../components/ui'
import { Md5, toHex } from '../lib/md5'
import { bytesToBase64 } from '../lib/encoding'
import { CopyBtn, FileInputBtn, Pane, bytes, useDebounced, useFileDrop, useToolState } from '../ui'

const ALGOS = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as const
type Algo = (typeof ALGOS)[number]
type Digests = Partial<Record<Algo, Uint8Array>>

const MAX_FILE = 1024 * 1024 * 1024

async function digestAll(data: Uint8Array<ArrayBuffer>): Promise<Digests> {
  const out: Digests = { MD5: new Md5().update(data).digest() }
  await Promise.all(
    (['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as const).map(async (a) => {
      out[a] = new Uint8Array(await crypto.subtle.digest(a, data))
    })
  )
  return out
}

export default function HashTool() {
  const [mode, setMode] = useToolState<'text' | 'file'>('hash.mode', 'text')
  const [text, setText] = useToolState('hash.text', 'The quick brown fox jumps over the lazy dog')
  const [fmt, setFmt] = useToolState<'hex' | 'HEX' | 'base64'>('hash.fmt', 'hex')
  const [expected, setExpected] = useToolState('hash.expected', '')
  const [digests, setDigests] = useState<Digests>({})
  const [file, setFile] = useState<{ name: string; size: number; digests: Digests; ms: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const deb = useDebounced(text, 80)

  useEffect(() => {
    if (mode !== 'text') return
    let alive = true
    digestAll(new TextEncoder().encode(deb)).then((d) => alive && setDigests(d))
    return () => {
      alive = false
    }
  }, [deb, mode])

  const hashFile = async (f: File) => {
    // The drop zone stays live while hashing; a second file would race the first.
    if (busy) return
    setErr(null)
    if (f.size > MAX_FILE) return setErr(`File is ${bytes(f.size)} — the limit is ${bytes(MAX_FILE)}.`)
    setBusy(true)
    setProgress(0)
    const t0 = performance.now()
    try {
      // Read in chunks (progress + incremental MD5), then SHA over the whole buffer.
      const buf = new Uint8Array(f.size)
      const md5 = new Md5()
      const reader = f.stream().getReader()
      let off = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf.set(value, off)
        md5.update(value)
        off += value.byteLength
        setProgress(off / Math.max(1, f.size))
      }
      const d: Digests = { MD5: md5.digest() }
      await Promise.all(
        (['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as const).map(async (a) => {
          d[a] = new Uint8Array(await crypto.subtle.digest(a, buf))
        })
      )
      setFile({ name: f.name, size: f.size, digests: d, ms: performance.now() - t0 })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const drop = useFileDrop(hashFile)

  const show = (b?: Uint8Array) => (!b ? '' : fmt === 'base64' ? bytesToBase64(b) : fmt === 'HEX' ? toHex(b).toUpperCase() : toHex(b))
  const current = mode === 'text' ? digests : (file?.digests ?? {})
  const exp = expected.trim().toLowerCase().replace(/^(md5|sha(1|256|384|512))[:=\s]+/i, '')
  const matchAlgo = exp ? ALGOS.find((a) => current[a] && (toHex(current[a]!) === exp || bytesToBase64(current[a]!).toLowerCase() === exp)) : undefined

  return (
    <div className="tk-body">
      <div className="tk-bar">
        <Seg value={mode} onChange={setMode} options={[{ value: 'text', label: 'Text' }, { value: 'file', label: 'File' }]} />
        <Seg value={fmt} onChange={setFmt} options={[{ value: 'hex', label: 'hex' }, { value: 'HEX', label: 'HEX' }, { value: 'base64', label: 'Base64' }]} />
      </div>
      {mode === 'text' ? (
        <Pane label={`Text · ${bytes(new TextEncoder().encode(deb).length)} UTF-8`} style={{ flex: 'none' }}>
          <textarea className="tk-editor wrap" style={{ minHeight: 110, height: 120 }} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Text to hash" />
        </Pane>
      ) : (
        <div className={'tk-drop' + (drop.dragging ? ' over' : '')} {...drop.props}>
          {busy ? <Loader2 size={22} className="spin" /> : <FileUp size={22} />}
          {busy ? (
            <div style={{ width: 260 }}>
              <div className="tkp-progress">
                <div style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <div className="mono dim" style={{ fontSize: 11, marginTop: 6 }}>
                Hashing… {Math.round(progress * 100)}%
              </div>
            </div>
          ) : (
            <>
              <div>{file ? `${file.name} · ${bytes(file.size)} · ${Math.round(file.ms)} ms` : 'Drop a file here or'}</div>
              <FileInputBtn onFile={hashFile} primary label={file ? 'Choose another file' : 'Choose file'} />
            </>
          )}
          <div className="dim" style={{ fontSize: 11 }}>
            Hashed locally — the file never leaves this device.
          </div>
          {err && <div className="bad">{err}</div>}
        </div>
      )}
      <Pane label="Digests" style={{ flex: 'none' }}>
        <div className="tk-kv">
          {ALGOS.map((a) => (
            <div key={a} className="tk-kv-row" style={matchAlgo === a ? { background: 'color-mix(in srgb, var(--ok) 10%, transparent)' } : undefined}>
              <span className="tk-kv-k mono" style={{ width: 90 }}>
                {a}
                {a === 'MD5' || a === 'SHA-1' ? <span className="dim" title="Not collision-resistant — use for checksums only"> *</span> : null}
              </span>
              <span className="tk-kv-v mono">{show(current[a]) || <span className="dim">—</span>}</span>
              <CopyBtn text={show(current[a])} disabled={!current[a]} />
            </div>
          ))}
        </div>
      </Pane>
      <div className="row">
        <input className="input mono grow" placeholder="Paste an expected hash to compare…" value={expected} onChange={(e) => setExpected(e.target.value)} aria-label="Expected hash" />
        {exp &&
          (matchAlgo ? (
            <span className="badge ok">
              <CheckCircle2 size={11} /> Matches {matchAlgo}
            </span>
          ) : (
            <span className="badge bad">
              <XCircle size={11} /> No match
            </span>
          ))}
      </div>
      <div className="tk-note">* MD5 and SHA-1 are broken for security purposes; fine for integrity checksums.</div>
    </div>
  )
}
