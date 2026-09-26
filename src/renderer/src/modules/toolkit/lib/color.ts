// Color parsing/conversion (sRGB, HSL, HSV, OKLab/OKLCH) and WCAG 2.x contrast.

export interface RGBA {
  r: number // 0-255 (may be fractional)
  g: number
  b: number
  a: number // 0-1
}

export interface HSL {
  h: number // 0-360
  s: number // 0-100
  l: number // 0-100
}

export interface OKLCH {
  l: number // 0-1
  c: number // 0-~0.4
  h: number // 0-360
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round = (v: number, d = 0) => {
  const f = 10 ** d
  return Math.round(v * f) / f
}

// ---------------------------------------------------------------- parsing

function parseHex(s: string): RGBA | null {
  const m = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s)
  if (!m) return null
  let h = m[1]
  if (h.length <= 4) h = [...h].map((c) => c + c).join('')
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? round(n(6) / 255, 3) : 1 }
}

/** Splits the argument list of a CSS color function (comma or space/slash syntax). */
function fnArgs(s: string, name: RegExp): string[] | null {
  const m = new RegExp(`^(?:${name.source})\\(\\s*([^)]*)\\)$`, 'i').exec(s)
  if (!m) return null
  return m[1]
    .replace(/\s*\/\s*/, ' / ')
    .split(/\s*,\s*|\s+/)
    .filter((p) => p && p !== '/')
}

function num(p: string, percentScale: number): number {
  if (p.endsWith('%')) return (parseFloat(p) / 100) * percentScale
  return parseFloat(p)
}

/** Alpha 0..1, or NaN when the component isn't a number. */
function alpha(p: string | undefined): number {
  if (p === undefined) return 1
  const v = p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p)
  return Number.isNaN(v) ? NaN : clamp(v, 0, 1)
}

function hue(p: string): number {
  const v = parseFloat(p)
  // "grad" must be checked before "rad" (it ends with "rad" too).
  if (p.endsWith('grad')) return v * 0.9
  if (p.endsWith('rad')) return (v * 180) / Math.PI
  if (p.endsWith('turn')) return v * 360
  return v
}

/** Parses hex, rgb()/rgba(), hsl()/hsla(), oklch() and a few keywords. */
export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase()
  if (!s) return null
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (s === 'black') return { r: 0, g: 0, b: 0, a: 1 }
  if (s === 'white') return { r: 255, g: 255, b: 255, a: 1 }
  const hex = parseHex(s)
  if (hex) return hex
  let a = fnArgs(s, /rgba?/)
  if (a && (a.length === 3 || a.length === 4)) {
    const [r, g, b] = a.slice(0, 3).map((p) => num(p, 255))
    const al = alpha(a[3])
    if ([r, g, b, al].some((v) => Number.isNaN(v))) return null
    return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: al }
  }
  a = fnArgs(s, /hsla?/)
  if (a && (a.length === 3 || a.length === 4)) {
    const h = hue(a[0])
    const sat = parseFloat(a[1])
    const l = parseFloat(a[2])
    const al = alpha(a[3])
    if ([h, sat, l, al].some((v) => Number.isNaN(v))) return null
    return { ...hslToRgb({ h, s: clamp(sat, 0, 100), l: clamp(l, 0, 100) }), a: al }
  }
  a = fnArgs(s, /oklch/)
  if (a && (a.length === 3 || a.length === 4)) {
    const l = a[0].endsWith('%') ? parseFloat(a[0]) / 100 : parseFloat(a[0])
    const c = a[1].endsWith('%') ? (parseFloat(a[1]) / 100) * 0.4 : parseFloat(a[1])
    const h = a[2] === 'none' ? 0 : hue(a[2])
    const al = alpha(a[3])
    if ([l, c, h, al].some((v) => Number.isNaN(v))) return null
    return { ...oklchToRgb({ l, c, h }).rgb, a: al }
  }
  return null
}

// ---------------------------------------------------------------- HSL / HSV

export function rgbToHsl({ r, g, b }: RGBA): HSL {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  const d = max - min
  if (d > 1e-9) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) * 60
    else if (max === G) h = ((B - R) / d + 2) * 60
    else h = ((R - G) / d + 4) * 60
  }
  return { h, s: s * 100, l: l * 100 }
}

export function hslToRgb({ h, s, l }: HSL): Omit<RGBA, 'a'> {
  const S = s / 100
  const L = l / 100
  const k = (n: number) => (n + ((((h % 360) + 360) % 360) / 30)) % 12
  const A = S * Math.min(L, 1 - L)
  const f = (n: number) => L - A * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 }
}

export function rgbToHsv({ r, g, b }: RGBA): { h: number; s: number; v: number } {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const d = max - Math.min(R, G, B)
  const { h } = rgbToHsl({ r, g, b, a: 1 })
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 }
}

// ---------------------------------------------------------------- OKLab / OKLCH

const toLinear = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255

export function rgbToOklab({ r, g, b }: RGBA): { l: number; a: number; b: number } {
  const R = toLinear(r)
  const G = toLinear(g)
  const B = toLinear(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  }
}

export function rgbToOklch(c: RGBA): OKLCH {
  const lab = rgbToOklab(c)
  const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b)
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI
  if (h < 0) h += 360
  return { l: lab.l, c: C, h: C < 1e-4 ? 0 : h }
}

/** OKLCH → sRGB; `inGamut` is false when channels had to be clipped. */
export function oklchToRgb({ l, c, h }: OKLCH): { rgb: Omit<RGBA, 'a'>; inGamut: boolean } {
  const hr = (h * Math.PI) / 180
  const A = c * Math.cos(hr)
  const B = c * Math.sin(hr)
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3
  const lin = [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_]
  const eps = 1e-4
  const inGamut = lin.every((v) => v >= -eps && v <= 1 + eps)
  const [r, g, b] = lin.map((v) => clamp(fromLinear(clamp(v, 0, 1)), 0, 255))
  return { rgb: { r, g, b }, inGamut }
}

// ---------------------------------------------------------------- formatting

const hex2 = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')

export function toHex(c: RGBA, withAlpha = c.a < 1): string {
  return '#' + hex2(c.r) + hex2(c.g) + hex2(c.b) + (withAlpha ? hex2(c.a * 255) : '')
}

export function toRgbString(c: RGBA): string {
  const [r, g, b] = [c.r, c.g, c.b].map((v) => Math.round(v))
  return c.a < 1 ? `rgb(${r} ${g} ${b} / ${round(c.a, 3)})` : `rgb(${r} ${g} ${b})`
}

export function toHslString(c: RGBA): string {
  const { h, s, l } = rgbToHsl(c)
  const body = `${round(h, 1)} ${round(s, 1)}% ${round(l, 1)}%`
  return c.a < 1 ? `hsl(${body} / ${round(c.a, 3)})` : `hsl(${body})`
}

export function toOklchString(c: RGBA): string {
  const { l, c: C, h } = rgbToOklch(c)
  const body = `${round(l * 100, 2)}% ${round(C, 4)} ${round(h, 2)}`
  return c.a < 1 ? `oklch(${body} / ${round(c.a, 3)})` : `oklch(${body})`
}

// ---------------------------------------------------------------- WCAG contrast

/** WCAG 2.x relative luminance (0-1). */
export function luminance(c: RGBA): number {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b)
}

/** Alpha-composites `fg` over an opaque `bg`. */
export function composite(fg: RGBA, bg: RGBA): RGBA {
  const a = fg.a
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 }
}

/** Contrast ratio 1…21. Semi-transparent foregrounds are composited over the background. */
export function contrastRatio(fg: RGBA, bg: RGBA): number {
  const back = bg.a < 1 ? composite(bg, { r: 255, g: 255, b: 255, a: 1 }) : bg
  const front = fg.a < 1 ? composite(fg, back) : fg
  const l1 = luminance(front)
  const l2 = luminance(back)
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

export interface WcagResult {
  ratio: number
  aaNormal: boolean
  aaLarge: boolean
  aaaNormal: boolean
  aaaLarge: boolean
  /** Non-text UI components (WCAG 1.4.11). */
  uiComponents: boolean
}

export function wcag(fg: RGBA, bg: RGBA): WcagResult {
  const ratio = contrastRatio(fg, bg)
  // WCAG compares the unrounded ratio against the thresholds.
  return { ratio, aaNormal: ratio >= 4.5, aaLarge: ratio >= 3, aaaNormal: ratio >= 7, aaaLarge: ratio >= 4.5, uiComponents: ratio >= 3 }
}

/** Formats a ratio like browsers' devtools: truncated (not rounded) to 2 decimals. */
export function formatRatio(r: number): string {
  return (Math.floor(r * 100) / 100).toFixed(2) + ':1'
}
