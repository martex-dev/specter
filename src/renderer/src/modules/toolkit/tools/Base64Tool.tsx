import { useMemo, useState } from 'react'
import { AlertCircle, FileUp } from 'lucide-react'
import { Seg } from '../../../components/ui'
import { base64ToBytes, bytesToBase64, encodeBase64, hexDump, isProbablyText } from '../lib/encoding'
import { sniffFormat } from '../lib/imagemeta'
import { CopyBtn, ErrorNote, FileInputBtn, Pane, bytes, useFileDrop, useToolState } from '../ui'

const MAX_FILE = 25 * 1024 * 1024

function TextMode() {
  const [plain, setPlain] = useToolState('b64.plain', 'Hello, SPECTER ✓')
  const [urlSafe, setUrlSafe] = useToolState('b64.url', false)
  const [encoded, setEncoded] = useToolState('b64.enc', () => encodeBase64('Hello, SPECTER ✓'))
  const [err, setErr] = useState<string | null>(null)
  const [binary, setBinary] = useState<Uint8Array | null>(null)

  const onPlain = (v: string) => {
    setPlain(v)
    setEncoded(encodeBase64(v, urlSafe))
    setErr(null)
    setBinary(null)
  }
  const onEncoded = (v: string) => {
    setEncoded(v)
    if (!v.trim()) {
      setPlain('')
      setErr(null)
      setBinary(null)
      return
    }
    try {
      const b = base64ToBytes(v.replace(/^data:[^,]*;base64,/, ''))
      if (isProbablyText(b)) {
        setPlain(new TextDecoder().decode(b))
        setBinary(null)
      } else {
        setBinary(b)
        setPlain('')
      }
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  const imgFormat = binary ? sniffFormat(binary) : null
  const previewUrl = useMemo(() => (binary && imgFormat && imgFormat.mime.startsWith('image/') ? `data:${imgFormat.mime};base64,${bytesToBase64(binary)}` : null), [binary, imgFormat])

  return (
    <>
      <div className="tk-bar">
        <label className="row" style={{ gap: 6, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={urlSafe}
            onChange={(e) => {
              setUrlSafe(e.target.checked)
              setEncoded(encodeBase64(plain, e.target.checked))
            }}
          />
          URL-safe alphabet (-_ , no padding)
        </label>
        <span className="tk-note">Edit either side — UTF-8 is handled correctly. Decoding accepts both alphabets and data: URLs.</span>
      </div>
      <div className="tk-split">
        <Pane label="Text" actions={<CopyBtn text={plain} label="Copy" disabled={!plain} />}>
          {binary ? (
            <>
              <div className="tk-ok">
                Decoded {bytes(binary.length)} of binary data{imgFormat && imgFormat.format !== 'Unknown' ? ` · looks like ${imgFormat.format}` : ''}
              </div>
              {previewUrl && <img src={previewUrl} alt="Decoded" className="tk-img-preview" style={{ margin: 12, alignSelf: 'flex-start' }} />}
              <pre className="tk-code">{hexDump(binary, 512)}</pre>
            </>
          ) : (
            <textarea className="tk-editor wrap" value={plain} onChange={(e) => onPlain(e.target.value)} spellCheck={false} aria-label="Plain text" />
          )}
        </Pane>
        <Pane label="Base64" actions={<CopyBtn text={encoded} label="Copy" disabled={!encoded} />}>
          <textarea className="tk-editor wrap" value={encoded} onChange={(e) => onEncoded(e.target.value)} spellCheck={false} aria-label="Base64" style={{ wordBreak: 'break-all' }} />
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

function FileMode() {
  const [file, setFile] = useState<{ name: string; size: number; type: string; dataUrl: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = async (f: File) => {
    setErr(null)
    if (f.size > MAX_FILE) return setErr(`File is ${bytes(f.size)} — the limit is ${bytes(MAX_FILE)} to keep the UI responsive.`)
    const buf = new Uint8Array(await f.arrayBuffer())
    const type = f.type || sniffFormat(buf).mime
    setFile({ name: f.name, size: f.size, type, dataUrl: `data:${type};base64,${bytesToBase64(buf)}` })
  }
  const drop = useFileDrop(load)
  const b64 = file ? file.dataUrl.slice(file.dataUrl.indexOf(',') + 1) : ''
  return (
    <>
      <div className={'tk-drop' + (drop.dragging ? ' over' : '')} {...drop.props}>
        <FileUp size={22} />
        <div>Drop a file here or</div>
        <FileInputBtn onFile={load} primary label="Choose file" />
        <div className="dim" style={{ fontSize: 11 }}>
          The file is read in this window only — nothing is uploaded.
        </div>
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      {file && (
        <Pane
          label={`${file.name} · ${bytes(file.size)} → ${bytes(file.dataUrl.length)} as data URL`}
          actions={
            <>
              <CopyBtn text={file.dataUrl} label="Copy data URL" />
              <CopyBtn text={b64} label="Copy Base64" />
            </>
          }
          style={{ flex: 1 }}
        >
          {file.type.startsWith('image/') && <img src={file.dataUrl} alt={file.name} className="tk-img-preview" style={{ margin: 12, alignSelf: 'flex-start', maxHeight: 200 }} />}
          <pre className="tk-code wrap" style={{ wordBreak: 'break-all' }}>
            {file.dataUrl.length > 200_000 ? file.dataUrl.slice(0, 200_000) + `\n… (${(file.dataUrl.length - 200_000).toLocaleString()} more characters — use Copy)` : file.dataUrl}
          </pre>
        </Pane>
      )}
    </>
  )
}

export default function Base64Tool() {
  const [mode, setMode] = useToolState<'text' | 'file'>('b64.mode', 'text')
  return (
    <div className="tk-body fill">
      <div className="tk-bar">
        <Seg value={mode} onChange={setMode} options={[{ value: 'text', label: 'Text' }, { value: 'file', label: 'File → data URL' }]} />
      </div>
      {mode === 'text' ? <TextMode /> : <FileMode />}
    </div>
  )
}
