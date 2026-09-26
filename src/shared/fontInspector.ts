// Font inspector: pure helpers (font stacks, colours, CSS snippets). No DOM or Node
// APIs here — this module is bundled into the overlay SPECTER injects into web pages.

export interface FontFamily {
  name: string
  /** A CSS generic family keyword (serif, system-ui, …), written unquoted. */
  generic: boolean
}

const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong'])
// Names that must be quoted to be read as a family name rather than a keyword.
const RESERVED = new Set([...GENERIC_FAMILIES, 'inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default'])

export function isGenericFamily(name: string): boolean {
  return GENERIC_FAMILIES.has(name.toLowerCase())
}

/** Splits a `font-family` value into its families, honouring quotes and escapes. `"serif"` (quoted) is a family called serif, not the generic. */
export function parseFontStack(value: string): FontFamily[] {
  const out: FontFamily[] = []
  let i = 0
  while (i < value.length) {
    while (i < value.length && (value[i] === ',' || /\s/.test(value[i]))) i++
    if (i >= value.length) break
    const q = value[i]
    if (q === '"' || q === "'") {
      let name = ''
      i++
      while (i < value.length && value[i] !== q) {
        if (value[i] === '\\' && i + 1 < value.length) i++
        name += value[i++]
      }
      i++
      while (i < value.length && value[i] !== ',') i++
      if (name.trim()) out.push({ name: name.trim(), generic: false })
    } else {
      let raw = ''
      while (i < value.length && value[i] !== ',') {
        if (value[i] === '\\' && i + 1 < value.length) i++
        raw += value[i++]
      }
      const name = raw.trim().replace(/\s+/g, ' ')
      if (name) out.push({ name, generic: !name.includes(' ') && isGenericFamily(name) })
    }
  }
  return out
}

/** Serializes a family for CSS: generics and plain identifiers stay bare, anything else is quoted. */
export function formatFamily(f: FontFamily): string {
  if (f.generic) return f.name
  const bare = f.name.split(' ').every((w) => /^-?[A-Za-z_][\w-]*$/.test(w)) && !RESERVED.has(f.name.toLowerCase())
  return bare ? f.name : `"${f.name.replace(/["\\]/g, '\\$&')}"`
}

export function formatFontStack(stack: FontFamily[]): string {
  return stack.map(formatFamily).join(', ')
}

/** Index of the stack entry a platform font name corresponds to, or -1 (a generic or a fallback font was used). */
export function matchStackEntry(stack: FontFamily[], platformFamily: string): number {
  const want = platformFamily.trim().toLowerCase()
  return stack.findIndex((f) => !f.generic && f.name.toLowerCase() === want)
}

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** Parses the colour forms `getComputedStyle` produces for sRGB colours: hex, rgb()/rgba() (legacy or space syntax) and `transparent`. Returns null for anything else (oklch(), color(), …). */
export function parseCssColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase()
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s)
  if (hex) {
    let h = hex[1]
    if (h.length <= 4) h = [...h].map((c) => c + c).join('')
    const n = (k: number) => parseInt(h.slice(k, k + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? Math.round((n(6) / 255) * 1000) / 1000 : 1 }
  }
  const fn = /^rgba?\(\s*([^)]*)\)$/.exec(s)
  if (!fn) return null
  const body = fn[1]
  let parts: string[]
  let alpha: string | undefined
  if (body.includes(',')) {
    parts = body.split(',').map((p) => p.trim())
    if (parts.length === 4) alpha = parts.pop()
  } else {
    const [rgb, a] = body.split('/').map((p) => p.trim())
    parts = rgb.split(/\s+/)
    alpha = a
  }
  if (parts.length !== 3) return null
  const channel = (p: string) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p))
  const [r, g, b] = parts.map(channel)
  const a = alpha === undefined ? 1 : alpha.endsWith('%') ? parseFloat(alpha) / 100 : parseFloat(alpha)
  if ([r, g, b, a].some((v) => !Number.isFinite(v))) return null
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v))
  return { r: Math.round(clamp(r, 255)), g: Math.round(clamp(g, 255)), b: Math.round(clamp(b, 255)), a: clamp(a, 1) }
}

/** `#rrggbb`, or `#rrggbbaa` when the colour is translucent. */
export function toHex(c: Rgba): string {
  const two = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return '#' + two(c.r) + two(c.g) + two(c.b) + (c.a < 1 ? two(c.a * 255) : '')
}

const WEIGHT_NAMES: [number, string][] = [
  [150, 'Thin'],
  [250, 'Extra Light'],
  [350, 'Light'],
  [450, 'Regular'],
  [550, 'Medium'],
  [650, 'Semi Bold'],
  [750, 'Bold'],
  [850, 'Extra Bold'],
  [Infinity, 'Black']
]

/** Conventional name of a numeric weight (variable fonts get the nearest name). */
export function weightName(weight: string | number): string {
  const w = typeof weight === 'number' ? weight : weight === 'normal' ? 400 : weight === 'bold' ? 700 : parseFloat(weight)
  if (!Number.isFinite(w)) return String(weight)
  return WEIGHT_NAMES.find(([max]) => w < max)![1]
}

/** Unitless line-height ratio ("1.5") from computed px values; null for `normal` or unparsable input. */
export function lineHeightRatio(lineHeight: string, fontSize: string): string | null {
  const lh = parseFloat(lineHeight)
  const fs = parseFloat(fontSize)
  if (!/px$/.test(lineHeight.trim()) || !Number.isFinite(lh) || !Number.isFinite(fs) || fs <= 0) return null
  return String(Math.round((lh / fs) * 100) / 100)
}

/** Rounds noisy computed lengths ("15.9999px" → "16px"). */
export function tidyLength(value: string): string {
  return value.replace(/(-?\d*\.\d+)px/g, (_m, n: string) => String(Math.round(parseFloat(n) * 100) / 100) + 'px')
}

export interface FontStyleInfo {
  family: string
  size: string
  weight: string
  style: string
  lineHeight: string
  letterSpacing: string
  color: string
}

/** CSS declarations that reproduce an element's text style; defaults (normal style / letter-spacing) are left out. */
export function cssSnippet(info: FontStyleInfo): string {
  const color = parseCssColor(info.color)
  const lines: [string, string][] = [
    ['font-family', formatFontStack(parseFontStack(info.family))],
    ['font-size', tidyLength(info.size)],
    ['font-weight', info.weight],
    ['font-style', info.style],
    ['line-height', tidyLength(info.lineHeight)],
    ['letter-spacing', tidyLength(info.letterSpacing)],
    ['color', color ? toHex(color) : info.color]
  ]
  return lines
    .filter(([k, v]) => v && !((k === 'font-style' || k === 'letter-spacing') && (v === 'normal' || v === '0px')))
    .map(([k, v]) => `${k}: ${v};`)
    .join('\n')
}

/** Collapses whitespace and shortens text for samples and labels. */
export function clipText(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
}

export interface FamilyUse {
  family: string
  stack: string
  weight: string
  sample: string
}

export interface FamilyTally {
  family: string
  count: number
  sample: string
  stacks: string[]
  weights: string[]
}

/** Groups per-element font uses by the family that renders them, most used first. */
export function tallyFamilies(uses: FamilyUse[]): FamilyTally[] {
  const map = new Map<string, FamilyTally>()
  for (const u of uses) {
    let t = map.get(u.family)
    if (!t) map.set(u.family, (t = { family: u.family, count: 0, sample: '', stacks: [], weights: [] }))
    t.count++
    if (!t.sample && u.sample.trim()) t.sample = clipText(u.sample, 80)
    if (!t.stacks.includes(u.stack)) t.stacks.push(u.stack)
    if (!t.weights.includes(u.weight)) t.weights.push(u.weight)
  }
  for (const t of map.values()) t.weights.sort((a, b) => parseFloat(a) - parseFloat(b))
  return [...map.values()].sort((a, b) => b.count - a.count || a.family.localeCompare(b.family))
}

// ---------------------------------------------------------------- UI ↔ main ↔ overlay

/** `guest:fontInspector` request from the UI. Without `enable` it toggles. */
export interface FontInspectorRequest {
  enable?: boolean
}

/** What the overlay reports to the main process; its `next()` resolves with one of these. */
export type InspectorEvent = { type: 'exit' }
