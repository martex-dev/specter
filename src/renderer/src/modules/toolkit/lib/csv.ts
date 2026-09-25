// RFC 4180 CSV parsing with delimiter detection.

export const DELIMITERS = [',', ';', '\t', '|'] as const
export type Delimiter = (typeof DELIMITERS)[number]

/** Counts delimiter occurrences per line (outside quotes) on the first lines and picks the most consistent one. */
export function detectDelimiter(text: string): Delimiter {
  const sample = text.slice(0, 64 * 1024)
  let best: Delimiter = ','
  let bestScore = -1
  for (const d of DELIMITERS) {
    const counts: number[] = []
    let inQ = false
    let n = 0
    for (let i = 0; i < sample.length && counts.length < 50; i++) {
      const c = sample[i]
      if (c === '"') {
        if (inQ && sample[i + 1] === '"') i++
        else inQ = !inQ
      } else if (!inQ && c === d) n++
      else if (!inQ && (c === '\n' || c === '\r')) {
        if (c === '\r' && sample[i + 1] === '\n') i++
        counts.push(n)
        n = 0
      }
    }
    if (n > 0 || counts.length === 0) counts.push(n)
    const nonEmpty = counts.filter((x) => x > 0)
    if (!nonEmpty.length) continue
    const mode = modeOf(counts)
    const consistent = counts.filter((x) => x === mode).length / counts.length
    const score = mode > 0 ? consistent * 100 + Math.min(mode, 50) : 0
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

function modeOf(xs: number[]): number {
  const m = new Map<number, number>()
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
  let best = 0
  let bestN = -1
  for (const [k, v] of m) if (v > bestN || (v === bestN && k > best)) [best, bestN] = [k, v]
  return best
}

export interface CsvResult {
  rows: string[][]
  delimiter: Delimiter
  /** Rows whose field count differs from the first row. */
  ragged: number
  /** Parse stopped at maxRows. */
  truncated: boolean
}

export function parseCsv(text: string, opts: { delimiter?: Delimiter; maxRows?: number } = {}): CsvResult {
  const d = opts.delimiter ?? detectDelimiter(text)
  const max = opts.maxRows ?? Infinity
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQ = false
  let i = 0
  const s = text.replace(/^﻿/, '')
  let truncated = false
  while (i < s.length) {
    const c = s[i]
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQ = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"' && field === '') {
      inQ = true
      i++
    } else if (c === d) {
      row.push(field)
      field = ''
      i++
    } else if (c === '\n' || c === '\r') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += c === '\r' && s[i + 1] === '\n' ? 2 : 1
      if (rows.length >= max) {
        truncated = i < s.length
        break
      }
    } else {
      field += c
      i++
    }
  }
  if (!truncated && (field !== '' || row.length)) {
    row.push(field)
    rows.push(row)
  }
  const width = rows[0]?.length ?? 0
  const ragged = rows.filter((r) => r.length !== width).length
  return { rows, delimiter: d, ragged, truncated }
}

export function toCsv(rows: string[][], delimiter = ','): string {
  const esc = (v: string) => (/["\r\n]/.test(v) || v.includes(delimiter) ? '"' + v.replace(/"/g, '""') + '"' : v)
  return rows.map((r) => r.map(esc).join(delimiter)).join('\n')
}
