// Text utilities: statistics, case conversion, whitespace cleanup, line ops.

export interface TextStats {
  chars: number
  charsNoSpaces: number
  words: number
  lines: number
  sentences: number
  paragraphs: number
  bytes: number
  readingMinutes: number
}

export function textStats(s: string): TextStats {
  const words = s.match(/[\p{L}\p{N}]+(?:['’\-_.][\p{L}\p{N}]+)*/gu)?.length ?? 0
  return {
    chars: [...s].length,
    charsNoSpaces: [...s.replace(/\s/g, '')].length,
    words,
    lines: s === '' ? 0 : s.split(/\r\n|\r|\n/).length,
    sentences: s.trim() ? (s.match(/[^.!?…]+(?:[.!?…]+|$)/g) ?? []).filter((x) => /[\p{L}\p{N}]/u.test(x)).length : 0,
    paragraphs: s.trim() ? s.split(/\n\s*\n/).filter((p) => p.trim()).length : 0,
    bytes: new TextEncoder().encode(s).length,
    readingMinutes: words / 238
  }
}

/** Splits identifiers and phrases into words: "fooBar_baz-qux 2x" → [foo, Bar, baz, qux, 2x]. */
export function splitWords(s: string): string[] {
  return (
    s
      .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
      .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
}

const cap = (w: string) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)

export type CaseKind = 'lower' | 'upper' | 'title' | 'sentence' | 'camel' | 'pascal' | 'snake' | 'kebab' | 'constant' | 'dot' | 'invert'

export const CASES: { id: CaseKind; label: string }[] = [
  { id: 'lower', label: 'lower case' },
  { id: 'upper', label: 'UPPER CASE' },
  { id: 'title', label: 'Title Case' },
  { id: 'sentence', label: 'Sentence case' },
  { id: 'camel', label: 'camelCase' },
  { id: 'pascal', label: 'PascalCase' },
  { id: 'snake', label: 'snake_case' },
  { id: 'kebab', label: 'kebab-case' },
  { id: 'constant', label: 'CONSTANT_CASE' },
  { id: 'dot', label: 'dot.case' },
  { id: 'invert', label: 'iNVERT cASE' }
]

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'vs', 'via'])

/** Converts case. Identifier styles (camel/snake/…) apply per line. */
export function convertCase(s: string, kind: CaseKind): string {
  switch (kind) {
    case 'lower':
      return s.toLowerCase()
    case 'upper':
      return s.toUpperCase()
    case 'invert':
      return [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('')
    case 'title':
      return s.replace(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu, (w, offset: number) => {
        const lower = w.toLowerCase()
        const first = offset === 0 || /[.:!?]\s*$/.test(s.slice(0, offset))
        return !first && SMALL.has(lower) ? lower : cap(w)
      })
    case 'sentence':
      return s.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_m, pre: string, ch: string) => pre + ch.toUpperCase())
    default:
      return s
        .split('\n')
        .map((line) => {
          const words = splitWords(line)
          if (!words.length) return line
          switch (kind) {
            case 'camel':
              return words.map((w, i) => (i === 0 ? w.toLowerCase() : cap(w))).join('')
            case 'pascal':
              return words.map(cap).join('')
            case 'snake':
              return words.map((w) => w.toLowerCase()).join('_')
            case 'kebab':
              return words.map((w) => w.toLowerCase()).join('-')
            case 'constant':
              return words.map((w) => w.toUpperCase()).join('_')
            case 'dot':
              return words.map((w) => w.toLowerCase()).join('.')
            default:
              return line
          }
        })
        .join('\n')
  }
}

export type LineOp = 'trim' | 'collapse' | 'removeBlank' | 'tabsToSpaces' | 'sortAsc' | 'sortDesc' | 'sortNatural' | 'sortLength' | 'dedupe' | 'reverse' | 'shuffle' | 'number' | 'stripNonAscii'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function applyLineOp(s: string, op: LineOp, rand: () => number = Math.random): string {
  const lines = s.split(/\r\n|\r|\n/)
  switch (op) {
    case 'trim':
      return lines.map((l) => l.trim()).join('\n')
    case 'collapse':
      return lines.map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
    case 'removeBlank':
      return lines.filter((l) => l.trim()).join('\n')
    case 'tabsToSpaces':
      return s.replace(/\t/g, '  ')
    case 'sortAsc':
      return [...lines].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join('\n')
    case 'sortDesc':
      return [...lines].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)).join('\n')
    case 'sortNatural':
      return [...lines].sort(collator.compare).join('\n')
    case 'sortLength':
      return [...lines].sort((a, b) => a.length - b.length).join('\n')
    case 'dedupe': {
      const seen = new Set<string>()
      return lines.filter((l) => (seen.has(l) ? false : (seen.add(l), true))).join('\n')
    }
    case 'reverse':
      return [...lines].reverse().join('\n')
    case 'shuffle': {
      const a = [...lines]
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[a[i], a[j]] = [a[j], a[i]]
      }
      return a.join('\n')
    }
    case 'number': {
      const w = String(lines.length).length
      return lines.map((l, i) => `${String(i + 1).padStart(w)}  ${l}`).join('\n')
    }
    case 'stripNonAscii':
      return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '')
  }
}

/** Frequency of words (lower-cased), most common first. */
export function wordFrequency(s: string, limit = 20): [string, number][] {
  const m = new Map<string, number>()
  for (const w of s.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? []) m.set(w, (m.get(w) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limit)
}
