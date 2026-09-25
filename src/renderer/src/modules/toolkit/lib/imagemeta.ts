// Local image header parsing: format sniffing, dimensions from headers,
// JPEG EXIF (APP1) basics, PNG chunk info. Never throws on malformed input —
// unknown fields are simply omitted.

export interface ImageMeta {
  format: string
  mime: string
  width?: number
  height?: number
  bitDepth?: number
  colorType?: string
  progressive?: boolean
  interlaced?: boolean
  animated?: boolean
  frames?: number
  hasAlpha?: boolean
  /** EXIF / text metadata as label → value. */
  exif: Record<string, string>
  gps?: { lat: number; lon: number }
  notes: string[]
}

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n))

export function sniffFormat(b: Uint8Array): { format: string; mime: string } {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { format: 'JPEG', mime: 'image/jpeg' }
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return { format: 'PNG', mime: 'image/png' }
  if (b.length >= 6 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) return { format: 'GIF', mime: 'image/gif' }
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { format: 'WebP', mime: 'image/webp' }
  if (b.length >= 2 && ascii(b, 0, 2) === 'BM') return { format: 'BMP', mime: 'image/bmp' }
  if (b.length >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return { format: 'ICO', mime: 'image/x-icon' }
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4)
    if (brand === 'avif' || brand === 'avis') return { format: 'AVIF', mime: 'image/avif' }
    if (/^(heic|heix|hevc|mif1|msf1)$/.test(brand)) return { format: 'HEIF/HEIC', mime: 'image/heic' }
  }
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42))) return { format: 'TIFF', mime: 'image/tiff' }
  if (b.length >= 12 && ascii(b, 0, 4) === '\u0000\u0000\u0000\u000c' && ascii(b, 4, 4) === 'jP  ') return { format: 'JPEG 2000', mime: 'image/jp2' }
  const head = new TextDecoder().decode(b.subarray(0, 512)).trimStart()
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return { format: 'SVG', mime: 'image/svg+xml' }
  return { format: 'Unknown', mime: 'application/octet-stream' }
}

// ---------------------------------------------------------------- TIFF / EXIF

const TAGS: Record<number, string> = {
  0x010f: 'Camera make',
  0x0110: 'Camera model',
  0x0112: 'Orientation',
  0x011a: 'X resolution',
  0x011b: 'Y resolution',
  0x0131: 'Software',
  0x0132: 'Modified',
  0x013b: 'Artist',
  0x8298: 'Copyright',
  0x829a: 'Exposure time',
  0x829d: 'F-number',
  0x8827: 'ISO',
  0x9003: 'Taken',
  0x9004: 'Digitized',
  0x9209: 'Flash',
  0x920a: 'Focal length',
  0xa002: 'EXIF width',
  0xa003: 'EXIF height',
  0xa405: 'Focal length (35mm)',
  0xa433: 'Lens make',
  0xa434: 'Lens model',
  0xa001: 'Color space'
}

const ORIENTATION = ['', 'Normal', 'Mirrored', 'Rotated 180°', 'Mirrored vertically', 'Mirrored + rotated 90° CCW', 'Rotated 90° CW', 'Mirrored + rotated 90° CW', 'Rotated 90° CCW']

interface Entry {
  tag: number
  type: number
  count: number
  valueOffset: number
}

class Tiff {
  le: boolean
  constructor(
    private b: Uint8Array,
    private base: number
  ) {
    this.le = b[base] === 0x49
  }
  u16(o: number): number {
    const p = this.base + o
    return this.le ? this.b[p] | (this.b[p + 1] << 8) : (this.b[p] << 8) | this.b[p + 1]
  }
  u32(o: number): number {
    const p = this.base + o
    return (this.le ? this.b[p] | (this.b[p + 1] << 8) | (this.b[p + 2] << 16) | (this.b[p + 3] << 24) : (this.b[p] << 24) | (this.b[p + 1] << 16) | (this.b[p + 2] << 8) | this.b[p + 3]) >>> 0
  }
  i32(o: number): number {
    return this.u32(o) | 0
  }
  inRange(o: number, n = 1): boolean {
    return this.base + o >= 0 && this.base + o + n <= this.b.length
  }
  entries(ifd: number): Entry[] {
    if (!this.inRange(ifd, 2)) return []
    const n = this.u16(ifd)
    const out: Entry[] = []
    for (let i = 0; i < n && i < 512; i++) {
      const e = ifd + 2 + i * 12
      if (!this.inRange(e, 12)) break
      out.push({ tag: this.u16(e), type: this.u16(e + 2), count: this.u32(e + 4), valueOffset: e + 8 })
    }
    return out
  }
  /** Reads an entry's value(s) as numbers or a string. */
  value(e: Entry): string | number[] | null {
    const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }
    const size = sizes[e.type]
    if (!size) return null
    const total = size * e.count
    const off = total <= 4 ? e.valueOffset : this.u32(e.valueOffset)
    if (!this.inRange(off, Math.min(total, 4096))) return null
    if (e.type === 2) {
      const bytes = this.b.subarray(this.base + off, this.base + off + Math.min(e.count, 4096))
      const z = bytes.indexOf(0)
      return new TextDecoder().decode(z >= 0 ? bytes.subarray(0, z) : bytes).trim()
    }
    const vals: number[] = []
    for (let i = 0; i < Math.min(e.count, 64); i++) {
      const p = off + i * size
      if (e.type === 1 || e.type === 7) vals.push(this.b[this.base + p])
      else if (e.type === 3) vals.push(this.u16(p))
      else if (e.type === 4) vals.push(this.u32(p))
      else if (e.type === 9) vals.push(this.i32(p))
      else if (e.type === 5) vals.push(this.u32(p) / (this.u32(p + 4) || 1))
      else if (e.type === 10) vals.push(this.i32(p) / (this.i32(p + 4) || 1))
    }
    return vals
  }
}

function fmtExif(tag: number, v: string | number[]): string {
  if (typeof v === 'string') return v
  const n = v[0]
  switch (tag) {
    case 0x0112:
      return ORIENTATION[n] ?? String(n)
    case 0x829a:
      return n >= 1 ? `${n} s` : `1/${Math.round(1 / n)} s`
    case 0x829d:
      return `f/${n.toFixed(1)}`
    case 0x920a:
      return `${Math.round(n * 10) / 10} mm`
    case 0xa405:
      return `${n} mm`
    case 0x9209:
      return n & 1 ? 'Fired' : 'Did not fire'
    case 0xa001:
      return n === 1 ? 'sRGB' : n === 0xffff ? 'Uncalibrated' : String(n)
    default:
      return v.length > 1 ? v.slice(0, 8).join(', ') : String(Math.round(n * 1000) / 1000)
  }
}

/** Parses a TIFF-structured EXIF block starting at `base` (the "II"/"MM" header). */
export function parseExif(b: Uint8Array, base: number, meta: ImageMeta): void {
  const t = new Tiff(b, base)
  if (!t.inRange(0, 8) || t.u16(2) !== 42) return
  const ifd0 = t.u32(4)
  const read = (ifd: number) => {
    for (const e of t.entries(ifd)) {
      if (e.tag === 0x8769 || e.tag === 0x8825) continue
      const label = TAGS[e.tag]
      if (!label) continue
      const v = t.value(e)
      if (v === null || (typeof v === 'string' && !v)) continue
      meta.exif[label] = fmtExif(e.tag, v)
    }
  }
  read(ifd0)
  const ptr = (tag: number) => t.entries(ifd0).find((e) => e.tag === tag)
  const exifPtr = ptr(0x8769)
  if (exifPtr) read(t.u32(exifPtr.valueOffset))
  const gpsPtr = ptr(0x8825)
  if (gpsPtr) {
    const g = new Map<number, string | number[] | null>()
    for (const e of t.entries(t.u32(gpsPtr.valueOffset))) g.set(e.tag, t.value(e))
    const dms = (v: unknown) => (Array.isArray(v) && v.length >= 3 ? v[0] + v[1] / 60 + v[2] / 3600 : NaN)
    const lat = dms(g.get(2)) * (g.get(1) === 'S' ? -1 : 1)
    const lon = dms(g.get(4)) * (g.get(3) === 'W' ? -1 : 1)
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      meta.gps = { lat, lon }
      meta.notes.push('Contains GPS location')
    }
  }
}

// ---------------------------------------------------------------- per-format

function parseJpeg(b: Uint8Array, meta: ImageMeta): void {
  let o = 2
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) break
    const marker = b[o + 1]
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      o += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) break // EOI / start of scan
    const len = (b[o + 2] << 8) | b[o + 3]
    const seg = o + 4
    // SOFn (not DHT C4, JPG C8, DAC CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      meta.bitDepth = b[seg]
      meta.height = (b[seg + 1] << 8) | b[seg + 2]
      meta.width = (b[seg + 3] << 8) | b[seg + 4]
      const comps = b[seg + 5]
      meta.colorType = comps === 1 ? 'Grayscale' : comps === 3 ? 'YCbCr' : comps === 4 ? 'CMYK' : `${comps} components`
      meta.progressive = marker === 0xc2 || marker === 0xc6 || marker === 0xca || marker === 0xce
      if (comps === 3 && seg + 6 + 9 <= b.length) {
        const h0 = b[seg + 7] >> 4
        const v0 = b[seg + 7] & 15
        const sub = h0 === 2 && v0 === 2 ? '4:2:0' : h0 === 2 && v0 === 1 ? '4:2:2' : h0 === 1 && v0 === 1 ? '4:4:4' : `${h0}x${v0}`
        meta.exif['Chroma subsampling'] = sub
      }
    } else if (marker === 0xe1 && ascii(b, seg, 4) === 'Exif') {
      parseExif(b, seg + 6, meta)
    } else if (marker === 0xe1 && ascii(b, seg, 28).startsWith('http://ns.adobe.com/xap/1.0/')) {
      meta.notes.push('Contains XMP metadata')
    } else if (marker === 0xe2 && ascii(b, seg, 11) === 'ICC_PROFILE') {
      meta.notes.push('Embedded ICC color profile')
    } else if (marker === 0xee && ascii(b, seg, 5) === 'Adobe') {
      meta.notes.push('Adobe APP14 segment')
    }
    o += 2 + len
  }
}

const PNG_COLOR: Record<number, string> = { 0: 'Grayscale', 2: 'RGB', 3: 'Indexed', 4: 'Grayscale + alpha', 6: 'RGBA' }

function parsePng(b: Uint8Array, meta: ImageMeta): void {
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
  let o = 8
  let text = 0
  while (o + 8 <= b.length) {
    const len = u32(o)
    const type = ascii(b, o + 4, 4)
    const d = o + 8
    if (type === 'IHDR') {
      meta.width = u32(d)
      meta.height = u32(d + 4)
      meta.bitDepth = b[d + 8]
      meta.colorType = PNG_COLOR[b[d + 9]] ?? String(b[d + 9])
      meta.hasAlpha = b[d + 9] === 4 || b[d + 9] === 6
      meta.interlaced = b[d + 12] === 1
    } else if (type === 'acTL') {
      meta.animated = true
      meta.frames = u32(d)
    } else if (type === 'tRNS') meta.hasAlpha = true
    else if (type === 'eXIf') parseExif(b, d, meta)
    else if (type === 'iCCP') meta.notes.push('Embedded ICC color profile')
    else if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      text++
      if (type === 'tEXt' && len < 2048) {
        const raw = b.subarray(d, d + len)
        const z = raw.indexOf(0)
        if (z > 0) meta.exif['Text: ' + ascii(raw, 0, z)] = new TextDecoder('latin1').decode(raw.subarray(z + 1)).slice(0, 200)
      }
    } else if (type === 'IEND') break
    o += 12 + len
  }
  if (text) meta.notes.push(`${text} text chunk${text > 1 ? 's' : ''}`)
}

function parseGif(b: Uint8Array, meta: ImageMeta): void {
  meta.width = b[6] | (b[7] << 8)
  meta.height = b[8] | (b[9] << 8)
  meta.colorType = 'Indexed'
  // Count image descriptors (frames) by walking blocks.
  let o = 13
  if (b[10] & 0x80) o += 3 * (1 << ((b[10] & 7) + 1))
  let frames = 0
  while (o < b.length) {
    const c = b[o]
    if (c === 0x2c) {
      frames++
      let p = o + 10
      if (b[o + 9] & 0x80) p += 3 * (1 << ((b[o + 9] & 7) + 1))
      p++ // LZW min code size
      while (p < b.length && b[p]) p += b[p] + 1
      o = p + 1
    } else if (c === 0x21) {
      let p = o + 2
      while (p < b.length && b[p]) p += b[p] + 1
      o = p + 1
    } else break
  }
  meta.frames = frames
  meta.animated = frames > 1
}

function parseWebp(b: Uint8Array, meta: ImageMeta): void {
  const chunk = ascii(b, 12, 4)
  const d = 20
  if (chunk === 'VP8 ') {
    meta.width = (b[d + 6] | (b[d + 7] << 8)) & 0x3fff
    meta.height = (b[d + 8] | (b[d + 9] << 8)) & 0x3fff
    meta.colorType = 'Lossy'
  } else if (chunk === 'VP8L') {
    const bits = b[d + 1] | (b[d + 2] << 8) | (b[d + 3] << 16) | (b[d + 4] << 24)
    meta.width = (bits & 0x3fff) + 1
    meta.height = ((bits >> 14) & 0x3fff) + 1
    meta.hasAlpha = ((bits >> 28) & 1) === 1
    meta.colorType = 'Lossless'
  } else if (chunk === 'VP8X') {
    const flags = b[d]
    meta.hasAlpha = (flags & 0x10) !== 0
    meta.animated = (flags & 0x02) !== 0
    meta.width = (b[d + 4] | (b[d + 5] << 8) | (b[d + 6] << 16)) + 1
    meta.height = (b[d + 7] | (b[d + 8] << 8) | (b[d + 9] << 16)) + 1
    meta.colorType = 'Extended'
    if (flags & 0x08) meta.notes.push('Contains EXIF metadata')
    if (flags & 0x04) meta.notes.push('Contains XMP metadata')
  }
}

function parseBmp(b: Uint8Array, meta: ImageMeta): void {
  const i32 = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)
  meta.width = i32(18)
  meta.height = Math.abs(i32(22))
  meta.bitDepth = b[28] | (b[29] << 8)
}

export function readImageMeta(b: Uint8Array): ImageMeta {
  const { format, mime } = sniffFormat(b)
  const meta: ImageMeta = { format, mime, exif: {}, notes: [] }
  try {
    if (format === 'JPEG') parseJpeg(b, meta)
    else if (format === 'PNG') parsePng(b, meta)
    else if (format === 'GIF') parseGif(b, meta)
    else if (format === 'WebP') parseWebp(b, meta)
    else if (format === 'BMP') parseBmp(b, meta)
    else if (format === 'TIFF') parseExif(b, 0, meta)
  } catch {
    meta.notes.push('Header could not be fully parsed')
  }
  return meta
}
