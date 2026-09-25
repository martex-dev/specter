import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Search } from 'lucide-react'
import { DELIMITERS, parseCsv, type Delimiter } from '../lib/csv'
import { CopyBtn, OpenFileBtn, useDebounced, useToolState } from '../ui'

const SAMPLE = `city,country,population,area_km2
Tokyo,Japan,37400068,2194
Delhi,India,28514000,1484
Shanghai,China,25582000,6341
"São Paulo",Brazil,21650000,1521
"Mexico City",Mexico,21581000,1485`

const DELIM_LABEL: Record<Delimiter | 'auto', string> = { auto: 'Auto', ',': 'Comma', ';': 'Semicolon', '\t': 'Tab', '|': 'Pipe' }
const MAX_ROWS = 50_000
const PAGE = 1000

const isNum = (s: string) => /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s.trim())

export default function CsvTool() {
  const [src, setSrc] = useToolState('csv.src', SAMPLE)
  const [name, setName] = useToolState('csv.name', '')
  const [delim, setDelim] = useToolState<Delimiter | 'auto'>('csv.delim', 'auto')
  const [header, setHeader] = useToolState('csv.header', true)
  const [edit, setEdit] = useState(false)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const deb = useDebounced(src, 120)
  const dfilter = useDebounced(filter, 120)

  const res = useMemo(() => parseCsv(deb, { delimiter: delim === 'auto' ? undefined : delim, maxRows: MAX_ROWS }), [deb, delim])
  const cols = Math.max(0, ...res.rows.slice(0, 200).map((r) => r.length))
  const head = header && res.rows.length ? res.rows[0] : Array.from({ length: cols }, (_, i) => `Column ${i + 1}`)
  const body = header ? res.rows.slice(1) : res.rows

  const view = useMemo(() => {
    let rows = body.map((r, i) => ({ r, i }))
    if (dfilter.trim()) {
      const f = dfilter.toLowerCase()
      rows = rows.filter(({ r }) => r.some((c) => c.toLowerCase().includes(f)))
    }
    if (sort) {
      const numeric = rows.slice(0, 100).every(({ r }) => !r[sort.col] || isNum(r[sort.col]))
      rows = [...rows].sort((a, b) => {
        const x = a.r[sort.col] ?? ''
        const y = b.r[sort.col] ?? ''
        const c = numeric ? (Number(x) || 0) - (Number(y) || 0) : x.localeCompare(y, undefined, { numeric: true })
        return c * sort.dir
      })
    }
    return rows
  }, [body, dfilter, sort])

  const numericCols = useMemo(() => head.map((_, c) => body.slice(0, 100).filter((r) => r[c]).every((r) => isNum(r[c]))), [head, body])

  const asJson = () => JSON.stringify(body.map((r) => Object.fromEntries(head.map((h, i) => [h || `col${i + 1}`, r[i] ?? '']))), null, 2)

  return (
    <div className="tk-body fill">
      <div className="tk-bar">
        <OpenFileBtn
          onText={(t, n) => {
            setSrc(t)
            setName(n)
            setEdit(false)
            setSort(null)
          }}
          filters={[{ name: 'Delimited text', extensions: ['csv', 'tsv', 'txt', 'psv'] }, { name: 'All files', extensions: ['*'] }]}
        />
        <button className={'btn sm' + (edit ? ' primary' : '')} onClick={() => setEdit(!edit)}>
          {edit ? 'Show table' : 'Edit / paste'}
        </button>
        <span className="tk-sep" />
        <span className="label">Delimiter</span>
        <select className="select" style={{ height: 26 }} value={delim} onChange={(e) => setDelim(e.target.value as Delimiter | 'auto')} aria-label="Delimiter">
          {(['auto', ...DELIMITERS] as const).map((d) => (
            <option key={d} value={d}>
              {DELIM_LABEL[d]}
              {d === 'auto' ? ` (${DELIM_LABEL[res.delimiter]})` : ''}
            </option>
          ))}
        </select>
        <label className="row" style={{ gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> First row is header
        </label>
        <span className="spacer" />
        <div style={{ position: 'relative' }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--fg-3)' }} />
          <input className="input" style={{ paddingLeft: 26, width: 200, height: 28 }} placeholder="Filter rows" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter rows" />
        </div>
        <CopyBtn text={asJson} label="Copy as JSON" disabled={!body.length} />
      </div>
      <div className="tk-note">
        {name && <span className="mono">{name} ·</span>}
        {body.length.toLocaleString()} rows × {cols} columns
        {dfilter && ` · ${view.length.toLocaleString()} match`}
        {res.ragged > 0 && (
          <span className="warn row" style={{ gap: 4 }}>
            <AlertTriangle size={12} /> {res.ragged} rows have a different number of fields
          </span>
        )}
        {res.truncated && <span className="warn">Showing the first {MAX_ROWS.toLocaleString()} rows</span>}
      </div>
      {edit ? (
        <div className="tk-pane" style={{ flex: 1 }}>
          <textarea className="tk-editor" style={{ flex: 1 }} value={src} onChange={(e) => setSrc(e.target.value)} spellCheck={false} placeholder="Paste CSV / TSV…" aria-label="CSV input" />
        </div>
      ) : !res.rows.length ? (
        <div className="empty">No data. Open a file or paste CSV.</div>
      ) : (
        <div className="tk-pane" style={{ flex: 1 }}>
          <div className="tk-table-wrap">
            <table className="tk-table selectable">
              <thead>
                <tr>
                  <th className="rn">#</th>
                  {head.map((h, i) => (
                    <th key={i} onClick={() => setSort((s) => (s?.col === i ? (s.dir === 1 ? { col: i, dir: -1 } : null) : { col: i, dir: 1 }))} title="Sort">
                      {h || <span className="dim">(empty)</span>}
                      {sort?.col === i && (sort.dir === 1 ? <ArrowUp size={10} style={{ marginLeft: 4 }} /> : <ArrowDown size={10} style={{ marginLeft: 4 }} />)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.slice(0, limit).map(({ r, i }) => (
                  <tr key={i}>
                    <td className="rn">{i + 1}</td>
                    {head.map((_, c) => (
                      <td key={c} className={numericCols[c] ? 'num' : undefined} title={r[c]}>
                        {r[c] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {view.length > limit && (
              <div style={{ padding: 10 }}>
                <button className="btn sm" onClick={() => setLimit(limit + PAGE)}>
                  Show {Math.min(PAGE, view.length - limit).toLocaleString()} more ({(view.length - limit).toLocaleString()} hidden)
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
