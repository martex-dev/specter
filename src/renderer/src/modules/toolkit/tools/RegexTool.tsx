import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { runRegex, type RegexRequest, type RegexResponse } from '../lib/regexRun'
import { CopyBtn, ErrorNote, Pane, useDebounced, useToolState } from '../ui'

const FLAGS: { f: string; tip: string }[] = [
  { f: 'g', tip: 'global — find all matches' },
  { f: 'i', tip: 'ignore case' },
  { f: 'm', tip: 'multiline — ^ and $ match at line breaks' },
  { f: 's', tip: 'dotAll — . matches newlines' },
  { f: 'u', tip: 'unicode' },
  { f: 'v', tip: 'unicode sets (u + set notation)' },
  { f: 'y', tip: 'sticky — match only at lastIndex' }
]

const TIMEOUT_MS = 1500
const MAX_MATCHES = 2000

const CHEATS: [string, string][] = [
  ['\\d \\w \\s', 'digit, word char, whitespace'],
  ['. ^ $', 'any char, start, end'],
  ['[abc] [^abc]', 'set, negated set'],
  ['a* a+ a? a{2,5}', 'quantifiers (add ? for lazy)'],
  ['(x) (?:x) (?<n>x)', 'group, non-capturing, named'],
  ['(?=x) (?!x) (?<=x)', 'lookahead / lookbehind'],
  ['\\b \\1 \\k<n>', 'word boundary, backreferences'],
  ['$1 $<n> $& $$', 'replacement tokens']
]

/** Runs regexes in a worker so a runaway pattern can be killed. */
class RegexRunner {
  private worker: Worker | null = null
  private seq = 0
  private pending = new Map<number, { resolve: (r: RegexResponse) => void; timer: number }>()
  private broken = false

  private ensure(): Worker | null {
    if (this.broken) return null
    if (this.worker) return this.worker
    try {
      this.worker = new Worker(new URL('../lib/regex.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent<RegexResponse>) => {
        const p = this.pending.get(e.data.id)
        if (!p) return
        clearTimeout(p.timer)
        this.pending.delete(e.data.id)
        p.resolve(e.data)
      }
      this.worker.onerror = () => {
        this.broken = true
        this.kill()
      }
      return this.worker
    } catch {
      this.broken = true
      return null
    }
  }

  kill(): void {
    this.worker?.terminate()
    this.worker = null
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      p.resolve({ id, matches: [], total: 0, replaced: null, error: 'Stopped', ms: 0 })
    }
    this.pending.clear()
  }

  run(req: Omit<RegexRequest, 'id'>): Promise<RegexResponse & { inline?: boolean }> {
    const id = ++this.seq
    const w = this.ensure()
    if (!w) {
      // Fallback: synchronous on the UI thread, with a size guard.
      if (req.text.length > 200_000) return Promise.resolve({ id, matches: [], total: 0, replaced: null, error: 'Text too large for inline evaluation', ms: 0 })
      return Promise.resolve({ ...runRegex({ ...req, id }), inline: true })
    }
    // Only the newest request matters: cancel older ones.
    for (const [pid, p] of this.pending) {
      clearTimeout(p.timer)
      p.resolve({ id: pid, matches: [], total: 0, replaced: null, error: 'superseded', ms: 0 })
    }
    this.pending.clear()
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        this.worker?.terminate()
        this.worker = null
        resolve({ id, matches: [], total: 0, replaced: null, error: `Timed out after ${TIMEOUT_MS} ms — the pattern may backtrack catastrophically`, ms: TIMEOUT_MS })
      }, TIMEOUT_MS)
      this.pending.set(id, { resolve, timer })
      w.postMessage({ ...req, id })
    })
  }
}

export default function RegexTool() {
  const [pattern, setPattern] = useToolState('regex.pattern', '(?<user>[\\w.+-]+)@(?<domain>[\\w-]+\\.[\\w.]+)')
  const [flags, setFlags] = useToolState('regex.flags', 'gm')
  const [text, setText] = useToolState('regex.text', 'Contact: ada@example.com, grace.hopper@navy.mil\nInvalid: foo@bar\nsupport+tag@specter.dev')
  const [replacement, setReplacement] = useToolState('regex.replace', '$<user> at $<domain>')
  const [showReplace, setShowReplace] = useToolState('regex.showReplace', true)
  const [res, setRes] = useState<(RegexResponse & { inline?: boolean }) | null>(null)
  const [busy, setBusy] = useState(false)
  const runner = useRef<RegexRunner | null>(null)
  const dp = useDebounced(pattern, 120)
  const dt = useDebounced(text, 120)
  const dr = useDebounced(replacement, 120)

  useEffect(() => {
    runner.current = new RegexRunner()
    return () => runner.current?.kill()
  }, [])

  useEffect(() => {
    if (!runner.current) return
    if (!dp) {
      setRes(null)
      return
    }
    let alive = true
    setBusy(true)
    runner.current.run({ pattern: dp, flags, text: dt, replacement: showReplace ? dr : null, max: MAX_MATCHES }).then((r) => {
      if (!alive || r.error === 'superseded') return
      setBusy(false)
      setRes(r)
    })
    return () => {
      alive = false
    }
  }, [dp, flags, dt, dr, showReplace])

  const toggle = (f: string) => {
    let next = flags.includes(f) ? flags.replace(f, '') : flags + f
    if (f === 'u' && next.includes('u')) next = next.replace('v', '')
    if (f === 'v' && next.includes('v')) next = next.replace('u', '')
    setFlags(
      next
        .split('')
        .sort((a, b) => 'dgimsuvy'.indexOf(a) - 'dgimsuvy'.indexOf(b))
        .join('')
    )
  }

  const highlighted = useMemo(() => {
    if (!res || res.error || !res.matches.length) return null
    const out: ReactNode[] = []
    let pos = 0
    res.matches.forEach((m, i) => {
      if (m.index > pos) out.push(dt.slice(pos, m.index))
      out.push(
        <mark key={i} className={i % 2 ? 'alt' : ''} title={`Match ${i + 1} @ ${m.index}`}>
          {m.text || '​'}
        </mark>
      )
      pos = Math.max(pos, m.end)
    })
    out.push(dt.slice(pos))
    return out
  }, [res, dt])

  const groupNames = res?.matches[0]?.named ? Object.keys(res.matches[0].named) : []
  const groupCount = res?.matches.reduce((n, m) => Math.max(n, m.groups.length), 0) ?? 0

  return (
    <div className="tk-body">
      <div className="tk-bar" style={{ flexWrap: 'nowrap' }}>
        <div className="row grow" style={{ gap: 0 }}>
          <span className="mono dim" style={{ fontSize: 16, padding: '0 6px' }}>
            /
          </span>
          <input className="input mono grow" style={{ height: 32, fontSize: 13.5 }} value={pattern} onChange={(e) => setPattern(e.target.value)} spellCheck={false} placeholder="pattern" aria-label="Regular expression" autoFocus />
          <span className="mono dim" style={{ fontSize: 16, padding: '0 6px' }}>
            /{flags}
          </span>
        </div>
        {FLAGS.map(({ f, tip }) => (
          <button key={f} className={'tk-flag' + (flags.includes(f) ? ' on' : '')} onClick={() => toggle(f)} data-tip={tip} aria-pressed={flags.includes(f)}>
            {f}
          </button>
        ))}
        <CopyBtn text={() => `/${pattern}/${flags}`} title="Copy as /pattern/flags" />
      </div>
      {res?.error && res.error !== 'Stopped' && (
        <div className="tk-pane" style={{ flex: 'none' }}>
          <ErrorNote>
            <AlertCircle size={12} style={{ verticalAlign: -2, marginRight: 6 }} />
            {res.error}
          </ErrorNote>
        </div>
      )}
      <div className="tk-split" style={{ minHeight: 260, flex: 'none' }}>
        <Pane label="Test string">
          <textarea className="tk-editor wrap" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Test string" style={{ minHeight: 220 }} />
        </Pane>
        <Pane
          label={
            <span className="label">
              {busy ? (
                <Loader2 size={11} className="spin" style={{ verticalAlign: -1 }} />
              ) : res && !res.error ? (
                `${res.total.toLocaleString()} match${res.total === 1 ? '' : 'es'}${res.total > res.matches.length ? ` (showing ${res.matches.length})` : ''} · ${res.ms} ms`
              ) : (
                'Matches'
              )}
            </span>
          }
        >
          <div className="tk-hl selectable">{highlighted ?? <span className="dim">{dt || 'No text'}</span>}</div>
        </Pane>
      </div>

      <div className="tk-pane" style={{ flex: 'none' }}>
        <header className="tk-pane-h">
          <label className="row label" style={{ gap: 6 }}>
            <input type="checkbox" checked={showReplace} onChange={(e) => setShowReplace(e.target.checked)} /> Replace
          </label>
          <input className="input mono grow" style={{ height: 24 }} value={replacement} onChange={(e) => setReplacement(e.target.value)} disabled={!showReplace} placeholder="Replacement — $1, $<name>, $&" aria-label="Replacement" />
          {showReplace && res?.replaced != null && <CopyBtn text={res.replaced} label="Copy result" />}
        </header>
        {showReplace && res?.replaced != null && <pre className="tk-code wrap mono selectable" style={{ maxHeight: 200 }}>{res.replaced}</pre>}
      </div>

      {res && !res.error && res.matches.length > 0 && (
        <Pane label="Groups">
          <div className="tk-table-wrap" style={{ maxHeight: 320 }}>
            <table className="tk-table selectable" style={{ cursor: 'auto' }}>
              <thead>
                <tr>
                  <th className="rn">#</th>
                  <th>Index</th>
                  <th>Match</th>
                  {Array.from({ length: groupCount }, (_, i) => (
                    <th key={i}>${i + 1}</th>
                  ))}
                  {groupNames.map((n) => (
                    <th key={n}>{n}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {res.matches.slice(0, 500).map((m, i) => (
                  <tr key={i}>
                    <td className="rn">{i + 1}</td>
                    <td className="num">
                      {m.index}–{m.end}
                    </td>
                    <td className="mono">{m.text || <span className="dim">(empty)</span>}</td>
                    {Array.from({ length: groupCount }, (_, g) => (
                      <td key={g} className="mono">
                        {m.groups[g] ?? <span className="dim">undefined</span>}
                      </td>
                    ))}
                    {groupNames.map((n) => (
                      <td key={n} className="mono">
                        {m.named?.[n] ?? <span className="dim">undefined</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Pane>
      )}

      <details className="tk-note" style={{ display: 'block' }}>
        <summary style={{ cursor: 'pointer' }}>Cheat sheet {res?.inline ? '· running inline (worker unavailable)' : ''}</summary>
        <div className="tk-kv" style={{ marginTop: 6 }}>
          {CHEATS.map(([k, v]) => (
            <div key={k} className="tk-kv-row" style={{ minHeight: 24 }}>
              <span className="tk-kv-k mono" style={{ width: 200 }}>
                {k}
              </span>
              <span className="tk-kv-v">{v}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}
