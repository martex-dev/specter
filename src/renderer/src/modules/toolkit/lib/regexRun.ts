// Pure regex evaluation shared by the worker and the inline fallback.

export interface RegexRequest {
  id: number
  pattern: string
  flags: string
  text: string
  replacement: string | null
  max: number
}

export interface RegexMatch {
  index: number
  end: number
  text: string
  groups: (string | undefined)[]
  named: Record<string, string | undefined> | null
}

export interface RegexResponse {
  id: number
  matches: RegexMatch[]
  total: number
  replaced: string | null
  error?: string
  ms: number
}

export function runRegex(req: RegexRequest): RegexResponse {
  const t0 = Date.now()
  let re: RegExp
  try {
    re = new RegExp(req.pattern, req.flags)
  } catch (err) {
    return { id: req.id, matches: [], total: 0, replaced: null, error: err instanceof Error ? err.message : String(err), ms: 0 }
  }
  const matches: RegexMatch[] = []
  let total = 0
  const push = (m: RegExpExecArray | RegExpMatchArray) => {
    total++
    if (matches.length < req.max) {
      const index = m.index ?? 0
      matches.push({ index, end: index + m[0].length, text: m[0], groups: m.slice(1), named: m.groups ? { ...m.groups } : null })
    }
  }
  if (re.global || re.sticky) {
    if (re.global) {
      for (const m of req.text.matchAll(re)) {
        push(m)
        if (total > 100_000) break
      }
    } else {
      const m = re.exec(req.text)
      if (m) push(m)
    }
  } else {
    const m = re.exec(req.text)
    if (m) push(m)
  }
  let replaced: string | null = null
  if (req.replacement !== null) {
    re.lastIndex = 0
    replaced = req.text.replace(re, req.replacement)
  }
  return { id: req.id, matches, total, replaced, ms: Date.now() - t0 }
}
