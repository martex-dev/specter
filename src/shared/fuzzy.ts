// Small, fast fuzzy matcher used by the command palette, tab search and omnibox.
// Scores contiguous matches, word starts and prefix matches higher.

export interface FuzzyResult {
  score: number
  /** Indices of matched characters in the target (for highlighting). */
  positions: number[]
}

export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  if (!query) return { score: 0, positions: [] }
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  // Fast path: substring match.
  const idx = t.indexOf(q)
  if (idx >= 0) {
    const positions = Array.from({ length: q.length }, (_, i) => idx + i)
    const wordStart = idx === 0 || /[\s\-_/.:@]/.test(t[idx - 1])
    return { score: 100 + (idx === 0 ? 60 : 0) + (wordStart ? 30 : 0) - Math.min(idx, 40) - t.length * 0.05, positions }
  }

  let score = 0
  let ti = 0
  let prev = -2
  const positions: number[] = []
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    if (ch === ' ') continue
    let found = -1
    // Prefer a word-start occurrence ahead.
    for (let j = ti; j < t.length; j++) {
      if (t[j] === ch && (j === 0 || /[\s\-_/.:@]/.test(t[j - 1]))) {
        found = j
        break
      }
    }
    if (found === -1) found = t.indexOf(ch, ti)
    if (found === -1) return null
    positions.push(found)
    if (found === prev + 1) score += 8
    if (found === 0 || /[\s\-_/.:@]/.test(t[found - 1])) score += 10
    score += 1
    prev = found
    ti = found + 1
  }
  score -= (positions[positions.length - 1] - positions[0]) * 0.3
  score -= t.length * 0.05
  return { score, positions }
}

/** Match against several fields; returns the best score or null. */
export function fuzzyBest(query: string, fields: (string | undefined)[]): number | null {
  let best: number | null = null
  fields.forEach((f, i) => {
    if (!f) return
    const r = fuzzyMatch(query, f)
    if (r) {
      const s = r.score - i * 5 // earlier fields weigh more
      if (best === null || s > best) best = s
    }
  })
  return best
}

export function fuzzyFilter<T>(query: string, items: T[], fields: (item: T) => (string | undefined)[], limit = 50): T[] {
  if (!query.trim()) return items.slice(0, limit)
  const scored: { item: T; score: number }[] = []
  for (const item of items) {
    const s = fuzzyBest(query.trim(), fields(item))
    if (s !== null) scored.push({ item, score: s })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => s.item)
}
