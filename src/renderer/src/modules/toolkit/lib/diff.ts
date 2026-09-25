// Myers O(ND) difference algorithm, linear-space variant (divide & conquer on
// the "middle snake"), producing a minimal edit script. Works on any sequence
// of strings; lines are interned to integers first for fast comparison.

export type DiffOp = 'equal' | 'insert' | 'delete'

export interface DiffEdit {
  op: DiffOp
  /** Index in a (for equal/delete), -1 for insert. */
  ai: number
  /** Index in b (for equal/insert), -1 for delete. */
  bi: number
}

/** Minimal edit script turning `a` into `b`. */
export function myersDiff(a: readonly string[], b: readonly string[], key: (s: string) => string = (s) => s): DiffEdit[] {
  // Intern to integers.
  const ids = new Map<string, number>()
  const intern = (s: string) => {
    const k = key(s)
    let id = ids.get(k)
    if (id === undefined) ids.set(k, (id = ids.size))
    return id
  }
  const A = Int32Array.from(a, intern)
  const B = Int32Array.from(b, intern)
  const out: DiffEdit[] = []
  diffRange(A, B, 0, A.length, 0, B.length, out)
  return out
}

function diffRange(A: Int32Array, B: Int32Array, aLo: number, aHi: number, bLo: number, bHi: number, out: DiffEdit[]): void {
  // Common prefix.
  while (aLo < aHi && bLo < bHi && A[aLo] === B[bLo]) {
    out.push({ op: 'equal', ai: aLo++, bi: bLo++ })
  }
  // Common suffix (emitted after the middle part).
  let suffix = 0
  while (aHi - suffix > aLo && bHi - suffix > bLo && A[aHi - suffix - 1] === B[bHi - suffix - 1]) suffix++
  const aEnd = aHi - suffix
  const bEnd = bHi - suffix

  if (aLo === aEnd) {
    for (let j = bLo; j < bEnd; j++) out.push({ op: 'insert', ai: -1, bi: j })
  } else if (bLo === bEnd) {
    for (let i = aLo; i < aEnd; i++) out.push({ op: 'delete', ai: i, bi: -1 })
  } else {
    const [x1, y1, x2, y2] = middleSnake(A, B, aLo, aEnd, bLo, bEnd)
    diffRange(A, B, aLo, x1, bLo, y1, out)
    // The snake is at most one insert/delete plus diagonal moves (in either
    // order). Walking diagonal-first, then the single step, then diagonal
    // again always yields a valid path of the same cost.
    let x = x1
    let y = y1
    while (x < x2 && y < y2 && A[x] === B[y]) out.push({ op: 'equal', ai: x++, bi: y++ })
    if (x2 - x > y2 - y) out.push({ op: 'delete', ai: x++, bi: -1 })
    else if (y2 - y > x2 - x) out.push({ op: 'insert', ai: -1, bi: y++ })
    while (x < x2 && y < y2) out.push({ op: 'equal', ai: x++, bi: y++ })
    diffRange(A, B, x2, aEnd, y2, bEnd, out)
  }
  for (let k = 0; k < suffix; k++) out.push({ op: 'equal', ai: aEnd + k, bi: bEnd + k })
}

/**
 * Finds the middle snake of the box [left,right)×[top,bottom): a segment
 * (x1,y1)→(x2,y2) on an optimal path made of at most one insert/delete and a
 * run of diagonal (equal) moves.
 */
function middleSnake(A: Int32Array, B: Int32Array, left: number, right: number, top: number, bottom: number): [number, number, number, number] {
  const width = right - left
  const height = bottom - top
  const size = width + height
  const delta = width - height
  const max = Math.ceil(size / 2)
  const off = max + 1
  const vf = new Int32Array(2 * max + 3)
  const vb = new Int32Array(2 * max + 3)
  vf[off + 1] = left
  vb[off + 1] = bottom
  const odd = (delta & 1) !== 0

  for (let d = 0; d <= max; d++) {
    // Forward pass.
    for (let k = d; k >= -d; k -= 2) {
      const c = k - delta
      let px: number
      let x: number
      if (k === -d || (k !== d && vf[off + k - 1] < vf[off + k + 1])) {
        px = x = vf[off + k + 1]
      } else {
        px = vf[off + k - 1]
        x = px + 1
      }
      let y = top + (x - left) - k
      const py = d === 0 || x !== px ? y : y - 1
      while (x < right && y < bottom && A[x] === B[y]) {
        x++
        y++
      }
      vf[off + k] = x
      if (odd && c >= -(d - 1) && c <= d - 1 && y >= vb[off + c]) {
        return [px, py, x, y]
      }
    }
    // Backward pass.
    for (let c = d; c >= -d; c -= 2) {
      const k = c + delta
      let py: number
      let y: number
      if (c === -d || (c !== d && vb[off + c - 1] > vb[off + c + 1])) {
        py = y = vb[off + c + 1]
      } else {
        py = vb[off + c - 1]
        y = py - 1
      }
      let x = left + (y - top) + k
      const px = d === 0 || y !== py ? x : x + 1
      while (x > left && y > top && A[x - 1] === B[y - 1]) {
        x--
        y--
      }
      vb[off + c] = y
      if (!odd && k >= -d && k <= d && x <= vf[off + k]) {
        return [x, y, px, py]
      }
    }
  }
  // Unreachable for valid input.
  return [left, top, right, bottom]
}

// ---------------------------------------------------------------- line diff helpers

export interface DiffLine {
  op: DiffOp
  text: string
  /** 1-based line numbers (undefined on the side where the line doesn't exist). */
  aLine?: number
  bLine?: number
}

export interface DiffOptions {
  ignoreWhitespace?: boolean
  ignoreCase?: boolean
}

export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split(/\r\n|\r|\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

export function diffLines(a: string, b: string, opts: DiffOptions = {}): DiffLine[] {
  const A = splitLines(a)
  const B = splitLines(b)
  const key = (s: string) => {
    let k = s
    if (opts.ignoreWhitespace) k = k.replace(/\s+/g, ' ').trim()
    if (opts.ignoreCase) k = k.toLowerCase()
    return k
  }
  return myersDiff(A, B, key).map((e) =>
    e.op === 'insert' ? { op: e.op, text: B[e.bi], bLine: e.bi + 1 } : e.op === 'delete' ? { op: e.op, text: A[e.ai], aLine: e.ai + 1 } : { op: e.op, text: B[e.bi], aLine: e.ai + 1, bLine: e.bi + 1 }
  )
}

export interface DiffStats {
  added: number
  removed: number
  unchanged: number
}

export function diffStats(lines: DiffLine[]): DiffStats {
  const s = { added: 0, removed: 0, unchanged: 0 }
  for (const l of lines) {
    if (l.op === 'insert') s.added++
    else if (l.op === 'delete') s.removed++
    else s.unchanged++
  }
  return s
}

/** Side-by-side rows: deletions and insertions within a change block are paired. */
export interface SideRow {
  left?: { line: number; text: string; op: 'equal' | 'delete' }
  right?: { line: number; text: string; op: 'equal' | 'insert' }
}

export function sideBySide(lines: DiffLine[]): SideRow[] {
  const rows: SideRow[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (l.op === 'equal') {
      rows.push({ left: { line: l.aLine!, text: l.text, op: 'equal' }, right: { line: l.bLine!, text: l.text, op: 'equal' } })
      i++
      continue
    }
    const dels: DiffLine[] = []
    const ins: DiffLine[] = []
    while (i < lines.length && lines[i].op !== 'equal') {
      if (lines[i].op === 'delete') dels.push(lines[i])
      else ins.push(lines[i])
      i++
    }
    const n = Math.max(dels.length, ins.length)
    for (let k = 0; k < n; k++) {
      rows.push({
        left: dels[k] ? { line: dels[k].aLine!, text: dels[k].text, op: 'delete' } : undefined,
        right: ins[k] ? { line: ins[k].bLine!, text: ins[k].text, op: 'insert' } : undefined
      })
    }
  }
  return rows
}

export interface Hunk {
  header: string
  lines: DiffLine[]
}

/** Groups a line diff into unified-diff hunks with `context` lines around changes. */
export function unifiedHunks(lines: DiffLine[], context = 3): Hunk[] {
  const changeIdx: number[] = []
  lines.forEach((l, i) => l.op !== 'equal' && changeIdx.push(i))
  if (!changeIdx.length) return []
  const ranges: [number, number][] = []
  for (const i of changeIdx) {
    const lo = Math.max(0, i - context)
    const hi = Math.min(lines.length - 1, i + context)
    const last = ranges[ranges.length - 1]
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi)
    else ranges.push([lo, hi])
  }
  return ranges.map(([lo, hi]) => {
    const slice = lines.slice(lo, hi + 1)
    // Line numbers where the hunk starts on each side.
    let aStart = 0
    let bStart = 0
    for (let j = lo; j >= 0 && (!aStart || !bStart); j--) {
      /* find nearest known numbers at or before lo */
      if (!aStart && lines[j].aLine) aStart = lines[j].aLine! + (j < lo ? 1 : 0)
      if (!bStart && lines[j].bLine) bStart = lines[j].bLine! + (j < lo ? 1 : 0)
    }
    if (!aStart) aStart = 1
    if (!bStart) bStart = 1
    const aCount = slice.filter((l) => l.op !== 'insert').length
    const bCount = slice.filter((l) => l.op !== 'delete').length
    const fmt = (start: number, count: number) => (count === 0 ? `${start - 1},0` : count === 1 ? `${start}` : `${start},${count}`)
    return { header: `@@ -${fmt(aStart, aCount)} +${fmt(bStart, bCount)} @@`, lines: slice }
  })
}

/** Standard unified diff text. */
export function unifiedText(a: string, b: string, opts: DiffOptions & { context?: number; aName?: string; bName?: string } = {}): string {
  const hunks = unifiedHunks(diffLines(a, b, opts), opts.context ?? 3)
  if (!hunks.length) return ''
  const out = [`--- ${opts.aName ?? 'a'}`, `+++ ${opts.bName ?? 'b'}`]
  for (const h of hunks) {
    out.push(h.header)
    for (const l of h.lines) out.push((l.op === 'insert' ? '+' : l.op === 'delete' ? '-' : ' ') + l.text)
  }
  return out.join('\n')
}

/** Word-level diff of two lines for intra-line highlighting. */
export function diffWords(a: string, b: string): { op: DiffOp; text: string }[] {
  const tok = (s: string) => s.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? []
  const A = tok(a)
  const B = tok(b)
  const out: { op: DiffOp; text: string }[] = []
  for (const e of myersDiff(A, B)) {
    const text = e.op === 'insert' ? B[e.bi] : A[e.ai]
    const last = out[out.length - 1]
    if (last && last.op === e.op) last.text += text
    else out.push({ op: e.op, text })
  }
  return out
}
