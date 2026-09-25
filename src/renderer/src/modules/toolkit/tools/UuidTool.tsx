import { useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Seg } from '../../../components/ui'
import { inspectUuid, uuidV7 } from '../lib/time'
import { CopyBtn, KV, Pane, useToolState } from '../ui'

type Version = 'v4' | 'v7'

function format(u: string, upper: boolean, hyphens: boolean, braces: boolean): string {
  let s = hyphens ? u : u.replace(/-/g, '')
  if (upper) s = s.toUpperCase()
  return braces ? `{${s}}` : s
}

export default function UuidTool() {
  const [version, setVersion] = useToolState<Version>('uuid.ver', 'v4')
  const [count, setCount] = useToolState('uuid.count', 10)
  const [upper, setUpper] = useToolState('uuid.upper', false)
  const [hyphens, setHyphens] = useToolState('uuid.hyphens', true)
  const [braces, setBraces] = useToolState('uuid.braces', false)
  const [seed, setSeed] = useState(0)
  const [inspect, setInspect] = useToolState('uuid.inspect', '')

  const list = useMemo(() => {
    void seed
    const n = Math.max(1, Math.min(10000, count || 1))
    return Array.from({ length: n }, () => (version === 'v4' ? crypto.randomUUID() : uuidV7()))
  }, [version, count, seed])
  const text = list.map((u) => format(u, upper, hyphens, braces)).join('\n')
  const info = inspect.trim() ? inspectUuid(inspect) : null

  return (
    <div className="tk-body">
      <div className="tk-bar">
        <Seg value={version} onChange={setVersion} options={[{ value: 'v4', label: 'v4 random' }, { value: 'v7', label: 'v7 time-ordered' }]} />
        <label className="row" style={{ gap: 6, fontSize: 12 }}>
          Count
          <input className="input mono" type="number" min={1} max={10000} style={{ width: 84, height: 28 }} value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="How many" />
        </label>
        <label className="row" style={{ gap: 5, fontSize: 12 }}>
          <input type="checkbox" checked={upper} onChange={(e) => setUpper(e.target.checked)} /> Uppercase
        </label>
        <label className="row" style={{ gap: 5, fontSize: 12 }}>
          <input type="checkbox" checked={hyphens} onChange={(e) => setHyphens(e.target.checked)} /> Hyphens
        </label>
        <label className="row" style={{ gap: 5, fontSize: 12 }}>
          <input type="checkbox" checked={braces} onChange={(e) => setBraces(e.target.checked)} /> Braces
        </label>
        <span className="spacer" />
        <button className="btn sm primary" onClick={() => setSeed(seed + 1)}>
          <RefreshCw size={12} /> Generate
        </button>
        <CopyBtn text={text} label={`Copy ${list.length > 1 ? 'all' : ''}`} />
      </div>
      <Pane label={`${list.length} UUID${list.length === 1 ? '' : 's'} · ${version === 'v4' ? 'crypto.randomUUID()' : 'RFC 9562 v7 (unix ms + random)'}`} style={{ flex: '1 1 300px', minHeight: 200 }}>
        <textarea className="tk-editor" readOnly value={text} aria-label="Generated UUIDs" />
      </Pane>
      <Pane label="Inspect a UUID" style={{ flex: 'none' }}>
        <div style={{ padding: 10 }}>
          <input className="input mono" style={{ width: '100%' }} placeholder="Paste a UUID…" value={inspect} onChange={(e) => setInspect(e.target.value)} aria-label="UUID to inspect" />
        </div>
        {info &&
          (info.valid ? (
            <KV
              rows={[
                ['Valid', 'Yes'],
                ...(info.nil ? ([['Special', 'Nil UUID (all zeros)']] as [string, string][]) : []),
                ...(info.max ? ([['Special', 'Max UUID (all ones)']] as [string, string][]) : []),
                ...(info.version !== undefined ? ([['Version', String(info.version)]] as [string, string][]) : []),
                ...(info.variant ? ([['Variant', info.variant]] as [string, string][]) : []),
                ...(info.time ? ([['Embedded time', `${info.time.toISOString()} (${info.time.toLocaleString()})`]] as [string, string][]) : [])
              ]}
            />
          ) : (
            <div className="tk-error">Not a valid UUID.</div>
          ))}
      </Pane>
    </div>
  )
}
