import { useMemo, useState } from 'react'
import { ArrowUpDown } from 'lucide-react'
import { CATEGORY_LABELS, convert, formatUnitValue, parseConversion, unitsIn, UNITS, type UnitCategory } from '../lib/units'
import { CopyBtn } from '../ui'

const DEFAULTS: Record<UnitCategory, [string, string]> = {
  length: ['km', 'mi'],
  mass: ['kg', 'lb'],
  temperature: ['°C', '°F'],
  data: ['GB', 'GiB'],
  time: ['h', 'min'],
  speed: ['km/h', 'mph'],
  area: ['m²', 'ft²'],
  volume: ['l', 'gal']
}

export default function Units() {
  const [cat, setCat] = useState<UnitCategory>('length')
  const [from, setFrom] = useState(DEFAULTS.length[0])
  const [to, setTo] = useState(DEFAULTS.length[1])
  const [value, setValue] = useState('1')
  const [quick, setQuick] = useState('')
  const units = unitsIn(cat)
  const n = Number(value.replace(/,/g, ''))
  const valid = value.trim() !== '' && Number.isFinite(n)
  const fromU = UNITS.find((u) => u.id === from && u.category === cat)!
  const toU = UNITS.find((u) => u.id === to && u.category === cat)!
  const result = valid && fromU && toU ? convert(n, fromU, toU) : NaN
  const q = useMemo(() => (quick.trim() ? parseConversion(quick) : null), [quick])

  return (
    <>
      <input className="input mono" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Quick: 10 km to mi, 72 F in C, 5 GB as MiB" aria-label="Quick conversion" />
      {quick.trim() && (
        <div className="row mono" style={{ fontSize: 13 }}>
          {q ? (
            <>
              <span className="grow">
                {formatUnitValue(q.value)} {q.from.id} = <b>{formatUnitValue(q.result)}</b> {q.to.id}
              </span>
              <CopyBtn text={formatUnitValue(q.result)} />
            </>
          ) : (
            <span className="dim">Try “12 ft to m”.</span>
          )}
        </div>
      )}
      <div className="hr" />
      <select
        className="select"
        value={cat}
        onChange={(e) => {
          const c = e.target.value as UnitCategory
          setCat(c)
          setFrom(DEFAULTS[c][0])
          setTo(DEFAULTS[c][1])
        }}
        aria-label="Category"
      >
        {(Object.keys(CATEGORY_LABELS) as UnitCategory[]).map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>
      <div className="row">
        <input className="input mono grow" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" aria-label="Value" />
        <select className="select" style={{ width: 150 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From unit">
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label} ({u.id})
            </option>
          ))}
        </select>
      </div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button
          className="icon-btn sm"
          onClick={() => {
            setFrom(to)
            setTo(from)
          }}
          data-tip="Swap"
          aria-label="Swap units"
        >
          <ArrowUpDown size={13} />
        </button>
      </div>
      <div className="row">
        <div className="input mono grow selectable" style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-1)' }}>
          {valid ? formatUnitValue(result) : '—'}
        </div>
        <select className="select" style={{ width: 150 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To unit">
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label} ({u.id})
            </option>
          ))}
        </select>
        <CopyBtn text={formatUnitValue(result)} disabled={!valid} />
      </div>
      {valid && (
        <div className="tkp-list">
          {units
            .filter((u) => u.id !== from)
            .map((u) => {
              const v = formatUnitValue(convert(n, fromU, u))
              return (
                <div key={u.id} className="tkp-item" style={{ minHeight: 28 }}>
                  <span className="grow mono selectable">{v}</span>
                  <span className="dim" style={{ fontSize: 11.5 }}>
                    {u.label}
                  </span>
                  <span className="mono" style={{ width: 52, fontSize: 11.5 }}>
                    {u.id}
                  </span>
                </div>
              )
            })}
        </div>
      )}
    </>
  )
}
