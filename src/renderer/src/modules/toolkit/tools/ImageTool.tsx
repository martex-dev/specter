import { useEffect, useState } from 'react'
import { ImageIcon, MapPin } from 'lucide-react'
import { readImageMeta, type ImageMeta } from '../lib/imagemeta'
import { CopyBtn, FileInputBtn, KV, Pane, bytes, useFileDrop } from '../ui'

const MAX = 200 * 1024 * 1024

interface Loaded {
  name: string
  size: number
  lastModified: number
  url: string
  meta: ImageMeta
  natural?: { w: number; h: number }
  decodeError?: boolean
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a
}

export default function ImageTool() {
  const [img, setImg] = useState<Loaded | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const url = img?.url
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [img?.url])

  const load = async (f: File) => {
    setErr(null)
    if (f.size > MAX) return setErr(`File is ${bytes(f.size)}; the limit is ${bytes(MAX)}.`)
    const buf = new Uint8Array(await f.arrayBuffer())
    const meta = readImageMeta(buf)
    if (meta.format === 'Unknown' && !f.type.startsWith('image/')) return setErr('This does not look like an image file.')
    const url = URL.createObjectURL(new Blob([buf], { type: meta.mime !== 'application/octet-stream' ? meta.mime : f.type }))
    setImg({ name: f.name, size: f.size, lastModified: f.lastModified, url, meta })
  }
  const drop = useFileDrop(load)

  const w = img?.meta.width ?? img?.natural?.w
  const h = img?.meta.height ?? img?.natural?.h
  const px = w && h ? w * h : 0
  const g = w && h ? gcd(w, h) : 1

  return (
    <div className="tk-body">
      <div className={'tk-drop' + (drop.dragging ? ' over' : '')} {...drop.props} style={img ? { padding: 14, flexDirection: 'row' } : undefined}>
        <ImageIcon size={img ? 16 : 22} />
        <div>{img ? img.name : 'Drop an image here or'}</div>
        <FileInputBtn accept="image/*,.heic,.heif,.avif,.tif,.tiff,.ico,.svg" onFile={load} primary={!img} label={img ? 'Choose another' : 'Choose image'} />
        {!img && (
          <div className="dim" style={{ fontSize: 11 }}>
            Analysed locally — the image is never uploaded.
          </div>
        )}
      </div>
      {err && <div className="tk-error">{err}</div>}
      {img && (
        <div className="tk-split" style={{ flex: 'none', alignItems: 'start' }}>
          <Pane label="Preview">
            <div style={{ padding: 12, display: 'flex', justifyContent: 'center' }}>
              {img.decodeError ? (
                <div className="empty">This browser can’t render {img.meta.format} — metadata below is read from the file header.</div>
              ) : (
                <img
                  src={img.url}
                  alt={img.name}
                  className="tk-img-preview"
                  onLoad={(e) => {
                    const el = e.currentTarget
                    setImg((p) => (p ? { ...p, natural: { w: el.naturalWidth, h: el.naturalHeight } } : p))
                  }}
                  onError={() => setImg((p) => (p ? { ...p, decodeError: true } : p))}
                />
              )}
            </div>
          </Pane>
          <div className="col" style={{ gap: 12 }}>
            <Pane label="File">
              <KV
                rows={[
                  ['Format', `${img.meta.format}${img.meta.animated ? ' (animated)' : ''}`],
                  ['MIME type', img.meta.mime, img.meta.mime],
                  ['File size', `${bytes(img.size)} (${img.size.toLocaleString()} bytes)`],
                  ['Dimensions', w && h ? `${w} × ${h} px` : 'Unavailable', w && h ? `${w}x${h}` : undefined],
                  ['Megapixels', px ? (px / 1e6).toFixed(2) + ' MP' : '—'],
                  ['Aspect ratio', w && h ? `${w / g}:${h / g} (${(w / h).toFixed(3)})` : '—'],
                  ['Bytes per pixel', px ? (img.size / px).toFixed(3) : '—'],
                  ['Bits per pixel', px ? ((img.size * 8) / px).toFixed(2) : '—'],
                  ['Compression vs raw RGBA', px ? `${((img.size / (px * 4)) * 100).toFixed(1)}% of ${bytes(px * 4)}` : '—'],
                  ...(img.meta.bitDepth ? ([['Bit depth', `${img.meta.bitDepth} bits/sample`]] as [string, string][]) : []),
                  ...(img.meta.colorType ? ([['Color', img.meta.colorType + (img.meta.hasAlpha ? ' · alpha' : '')]] as [string, string][]) : []),
                  ...(img.meta.progressive !== undefined ? ([['Encoding', img.meta.progressive ? 'Progressive' : 'Baseline']] as [string, string][]) : []),
                  ...(img.meta.interlaced !== undefined ? ([['Interlaced', img.meta.interlaced ? 'Yes (Adam7)' : 'No']] as [string, string][]) : []),
                  ...(img.meta.frames !== undefined ? ([['Frames', String(img.meta.frames)]] as [string, string][]) : []),
                  ['Modified', new Date(img.lastModified).toLocaleString()]
                ]}
              />
            </Pane>
            <Pane label="Metadata">
              {Object.keys(img.meta.exif).length || img.meta.notes.length ? (
                <>
                  {img.meta.gps && (
                    <div className="tk-ok warn" style={{ borderTop: 'none', borderBottom: '1px solid var(--line)' }}>
                      <MapPin size={12} /> GPS location embedded: {img.meta.gps.lat.toFixed(5)}, {img.meta.gps.lon.toFixed(5)}
                      <CopyBtn text={`${img.meta.gps.lat}, ${img.meta.gps.lon}`} />
                    </div>
                  )}
                  <KV rows={Object.entries(img.meta.exif).map(([k, v]) => [k, v] as [string, string])} />
                  {img.meta.notes.length > 0 && <div className="tk-ok">{img.meta.notes.join(' · ')}</div>}
                </>
              ) : (
                <div className="empty" style={{ padding: 20 }}>
                  {img.meta.format === 'JPEG' || img.meta.format === 'PNG' || img.meta.format === 'TIFF' ? 'No EXIF metadata in this file.' : 'Metadata unavailable for this format.'}
                </div>
              )}
            </Pane>
          </div>
        </div>
      )}
    </div>
  )
}
