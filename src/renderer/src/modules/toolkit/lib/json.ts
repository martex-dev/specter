// JSON helpers: validation with line/column, key sorting, stats.

export interface JsonParseError {
  message: string
  line: number
  column: number
  offset: number
}

export type JsonParseResult = { ok: true; value: unknown } | { ok: false; error: JsonParseError }

export function lineColAt(text: string, offset: number): { line: number; column: number } {
  let line = 1
  let last = -1
  const end = Math.min(offset, text.length)
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      last = i
    }
  }
  return { line, column: end - last }
}

/** Parses JSON, reporting the error position as line/column (1-based). */
export function parseJson(text: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    let offset = -1
    const pos = /position (\d+)/.exec(raw)
    const lc = /line (\d+) column (\d+)/.exec(raw)
    let line: number
    let column: number
    if (lc) {
      line = Number(lc[1])
      column = Number(lc[2])
      offset = pos ? Number(pos[1]) : -1
    } else if (pos) {
      offset = Number(pos[1])
      ;({ line, column } = lineColAt(text, offset))
    } else {
      // "Unexpected end of JSON input" and similar.
      offset = text.length
      ;({ line, column } = lineColAt(text, offset))
    }
    const message = raw.replace(/\s*\(line \d+ column \d+\)/, '').replace(/ in JSON at position \d+/, '').replace(/^JSON\.parse: /, '')
    return { ok: false, error: { message, line, column, offset } }
  }
}

export function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as object).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) out[k] = sortKeysDeep((v as Record<string, unknown>)[k])
    return out
  }
  return v
}

export interface JsonStats {
  objects: number
  arrays: number
  keys: number
  strings: number
  numbers: number
  booleans: number
  nulls: number
  depth: number
}

export function jsonStats(v: unknown): JsonStats {
  const s: JsonStats = { objects: 0, arrays: 0, keys: 0, strings: 0, numbers: 0, booleans: 0, nulls: 0, depth: 0 }
  const walk = (x: unknown, d: number) => {
    s.depth = Math.max(s.depth, d)
    if (Array.isArray(x)) {
      s.arrays++
      x.forEach((y) => walk(y, d + 1))
    } else if (x === null) s.nulls++
    else if (typeof x === 'object') {
      s.objects++
      for (const [, y] of Object.entries(x as object)) {
        s.keys++
        walk(y, d + 1)
      }
    } else if (typeof x === 'string') s.strings++
    else if (typeof x === 'number') s.numbers++
    else if (typeof x === 'boolean') s.booleans++
  }
  walk(v, 0)
  return s
}

/** JSONPath-ish accessor string for a path of keys/indices. */
export function pathString(path: (string | number)[]): string {
  let s = '$'
  for (const p of path) s += typeof p === 'number' ? `[${p}]` : /^[A-Za-z_$][\w$]*$/.test(p) ? `.${p}` : `[${JSON.stringify(p)}]`
  return s
}
