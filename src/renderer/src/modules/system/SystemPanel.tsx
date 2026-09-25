// Right-rail system panel (also pop-out capable).
import { useState } from 'react'
import { ExternalLink, ListTree, Network } from 'lucide-react'
import { newTab } from '../../stores/browser'
import { invoke } from '../../lib/ipc'
import { formatBytes } from '../../lib/format'
import { Seg } from '../../components/ui'
import { Overview, SamplerFoot } from './Overview'
import Processes from './Processes'
import { fmtPct, useMetrics } from './store'
import './system.css'

export default function SystemPanel({ popout }: { popout?: boolean }) {
  const { latest, history, status } = useMetrics()
  const [view, setView] = useState<'live' | 'processes'>('live')
  const s = latest?.specter
  const open = (sub = '') => (popout ? invoke('window:new', { url: 'specter://system' + sub, focus: true }) : newTab('specter://system' + sub))
  return (
    <div className="sys-panel">
      <div className="row" style={{ gap: 8 }}>
        <Seg
          value={view}
          onChange={setView}
          options={[
            { value: 'live', label: 'Live' },
            { value: 'processes', label: 'Processes' }
          ]}
        />
        <span className="spacer" />
        <button className="icon-btn sm" onClick={() => open('/network')} data-tip="Network diagnostics" aria-label="Network diagnostics">
          <Network size={13} />
        </button>
        <button className="icon-btn sm" onClick={() => open('/performance')} data-tip="SPECTER performance" aria-label="SPECTER performance">
          <ListTree size={13} />
        </button>
        <button className="icon-btn sm" onClick={() => open()} data-tip="Open full monitor" aria-label="Open full monitor">
          <ExternalLink size={13} />
        </button>
      </div>
      {view === 'live' ? (
        <>
          {s && (
            <button className="sys-specter-line" onClick={() => open('/performance')} data-tip="SPECTER’s own processes">
              <span className="label">SPECTER</span>
              <span className="num">CPU {fmtPct(s.cpu, 1)}</span>
              <span className="num">{formatBytes(s.memKB * 1024)}</span>
              <span className="num dim">{s.processes} proc</span>
            </button>
          )}
          <Overview latest={latest} history={history} status={status} compact />
          <SamplerFoot status={status} latest={latest} />
        </>
      ) : (
        <Processes compact />
      )}
    </div>
  )
}
