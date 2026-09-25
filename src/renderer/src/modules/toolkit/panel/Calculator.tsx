import { useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { CalcError, evaluate, formatResult } from '../lib/calc'
import { CopyBtn } from '../ui'

interface Entry {
  expr: string
  result: string
  value: number
}

const HIST_KEY = 'specter.toolkit.calcHistory'
function loadHist(): Entry[] {
  try {
    return (JSON.parse(localStorage.getItem(HIST_KEY) ?? '[]') as Entry[]).slice(0, 50)
  } catch {
    return []
  }
}

const KEYS: [string, string?, string?][] = [
  ['(', '(', 'op'],
  [')', ')', 'op'],
  ['%', '%', 'op'],
  ['^', '^', 'op'],
  ['÷', '/', 'op'],
  ['7'],
  ['8'],
  ['9'],
  ['√', 'sqrt(', 'op'],
  ['×', '*', 'op'],
  ['4'],
  ['5'],
  ['6'],
  ['π', 'pi', 'op'],
  ['−', '-', 'op'],
  ['1'],
  ['2'],
  ['3'],
  ['ans', 'ans', 'op'],
  ['+', '+', 'op'],
  ['0'],
  ['.'],
  ['⌫', 'BS', 'op'],
  ['C', 'CLR', 'op'],
  ['=', '=', 'eq']
]

export default function Calculator() {
  const [expr, setExpr] = useState('')
  const [hist, setHist] = useState<Entry[]>(loadHist)
  const input = useRef<HTMLInputElement>(null)
  const ans = hist[0]?.value ?? 0

  const live = useMemo(() => {
    if (!expr.trim()) return { text: '', error: false }
    try {
      return { text: formatResult(evaluate(expr, { vars: { ans } })), error: false }
    } catch (err) {
      return { text: err instanceof CalcError ? err.message : 'Invalid expression', error: true }
    }
  }, [expr, ans])

  const commit = () => {
    if (!expr.trim()) return
    try {
      const value = evaluate(expr, { vars: { ans } })
      const next = [{ expr, result: formatResult(value), value }, ...hist].slice(0, 50)
      setHist(next)
      try {
        localStorage.setItem(HIST_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      setExpr(formatResult(value).replace('∞', 'inf'))
    } catch {
      /* live shows the error */
    }
  }

  const press = (k: string, v?: string) => {
    const val = v ?? k
    if (val === '=') commit()
    else if (val === 'CLR') setExpr('')
    else if (val === 'BS') setExpr(expr.slice(0, -1))
    else setExpr(expr + val)
    input.current?.focus()
  }

  return (
    <>
      <input
        ref={input}
        className="input tkp-calc-in"
        value={expr}
        autoFocus
        onChange={(e) => setExpr(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') setExpr('')
          else if (e.key === 'ArrowUp' && hist[0]) {
            e.preventDefault()
            setExpr(hist[0].expr)
          }
        }}
        placeholder="2*(3+4), sqrt(2), 15% * 80…"
        spellCheck={false}
        aria-label="Expression"
      />
      <div className="row" style={{ justifyContent: 'flex-end', minHeight: 30 }}>
        <div className={'tkp-calc-res grow' + (live.error ? ' dim' : '')} style={live.error ? { fontSize: 12 } : undefined}>
          {live.text && !live.error ? '= ' + live.text : live.text}
        </div>
        {live.text && !live.error && <CopyBtn text={live.text} />}
      </div>
      <div className="tkp-keys">
        {KEYS.map(([k, v, cls]) => (
          <button key={k} className={cls} onClick={() => press(k, v)} aria-label={k}>
            {k}
          </button>
        ))}
      </div>
      {hist.length > 0 && (
        <>
          <div className="row">
            <span className="label grow">History</span>
            <button
              className="icon-btn sm"
              onClick={() => {
                setHist([])
                try {
                  localStorage.removeItem(HIST_KEY)
                } catch {
                  /* ignore */
                }
              }}
              data-tip="Clear history"
              aria-label="Clear history"
            >
              <Trash2 size={12} />
            </button>
          </div>
          <div className="tkp-hist">
            {hist.map((h, i) => (
              <button key={i} onClick={() => setExpr(h.expr)} title="Reuse expression">
                <span className="ellipsis">{h.expr}</span>
                <span style={{ color: 'var(--fg-0)' }}>{h.result}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="tk-note">Functions: sqrt, sin, cos, tan, log, ln, abs, round, min, max… · constants pi, e · n! · 15% · ans</div>
    </>
  )
}
