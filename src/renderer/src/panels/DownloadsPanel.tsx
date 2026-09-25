import { useEffect, useState } from 'react'
import { Download, File, FolderOpen, Pause, Play, RotateCw, Trash2, X } from 'lucide-react'
import type { DownloadInfo } from '@shared/types'
import { invoke, on } from '../lib/ipc'
import { formatBytes, formatDuration, timeAgo } from '../lib/format'

export function useDownloads(): DownloadInfo[] {
  const [list, setList] = useState<DownloadInfo[]>([])
  useEffect(() => {
    const reload = () => invoke('downloads:list').then(setList)
    reload()
    window.addEventListener('specter:downloads-reload', reload)
    const off = on('downloads:changed', (d) =>
      setList((l) => {
        const i = l.findIndex((x) => x.id === d.id)
        if (i < 0) return [d, ...l]
        const next = [...l]
        next[i] = d
        return next
      })
    )
    return () => {
      off()
      window.removeEventListener('specter:downloads-reload', reload)
    }
  }, [])
  return list
}

export const reloadDownloads = () => window.dispatchEvent(new Event('specter:downloads-reload'))

const STATE_LABEL: Record<DownloadInfo['state'], string> = { progressing: 'Downloading', paused: 'Paused', completed: 'Completed', cancelled: 'Cancelled', interrupted: 'Failed' }

export function DownloadRow({ d, onRemoved }: { d: DownloadInfo; onRemoved?: () => void }) {
  const pct = d.totalBytes > 0 ? Math.min(100, (d.receivedBytes / d.totalBytes) * 100) : null
  const eta = d.state === 'progressing' && d.speed > 0 && d.totalBytes > 0 ? (d.totalBytes - d.receivedBytes) / d.speed : null
  const active = d.state === 'progressing' || d.state === 'paused'
  return (
    <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ width: 30, height: 30, borderRadius: 7, background: 'var(--bg-2)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', flex: 'none' }}>
          <File size={15} className="muted" />
        </div>
        <div className="grow">
          <div className="ellipsis" style={{ fontWeight: 500, color: d.state === 'cancelled' || d.state === 'interrupted' ? 'var(--fg-2)' : undefined, textDecoration: d.state === 'cancelled' ? 'line-through' : undefined }} title={d.savePath}>
            {d.filename}
          </div>
          <div className="muted num" style={{ fontSize: 11.5, marginTop: 2 }}>
            {active ? (
              <>
                {formatBytes(d.receivedBytes)} of {d.totalBytes ? formatBytes(d.totalBytes) : 'unknown size'}
                {d.state === 'progressing' && d.speed > 0 && ` · ${formatBytes(d.speed)}/s`}
                {eta !== null && ` · ${formatDuration(eta)} left`}
                {d.state === 'paused' && ' · Paused'}
              </>
            ) : (
              <>
                <span className={d.state === 'completed' ? '' : d.state === 'interrupted' ? 'bad' : ''}>{STATE_LABEL[d.state]}</span> · {formatBytes(d.totalBytes || d.receivedBytes)} · {timeAgo(d.endedAt ?? d.startedAt)}
              </>
            )}
          </div>
          <div className="dim ellipsis" style={{ fontSize: 11 }}>
            {new URL(d.url).hostname}
          </div>
        </div>
        <div className="row" style={{ gap: 2 }}>
          {d.state === 'progressing' && (
            <button className="icon-btn sm" onClick={() => invoke('downloads:pause', d.id)} data-tip="Pause" aria-label="Pause">
              <Pause size={13} />
            </button>
          )}
          {d.state === 'paused' && (
            <button className="icon-btn sm" onClick={() => invoke('downloads:resume', d.id)} data-tip="Resume" aria-label="Resume">
              <Play size={13} />
            </button>
          )}
          {active && (
            <button className="icon-btn sm" onClick={() => invoke('downloads:cancel', d.id)} data-tip="Cancel" aria-label="Cancel">
              <X size={13} />
            </button>
          )}
          {(d.state === 'interrupted' || d.state === 'cancelled') && (
            <button className="icon-btn sm" onClick={() => invoke('downloads:retry', d.id).then(onRemoved)} data-tip="Retry" aria-label="Retry">
              <RotateCw size={13} />
            </button>
          )}
          {d.state === 'completed' && (
            <button className="icon-btn sm" onClick={() => invoke('downloads:open', d.id)} data-tip="Open file" aria-label="Open">
              <File size={13} />
            </button>
          )}
          <button className="icon-btn sm" onClick={() => invoke('downloads:showInFolder', d.id)} data-tip="Show in folder" aria-label="Show in folder">
            <FolderOpen size={13} />
          </button>
          {!active && (
            <button className="icon-btn sm" onClick={() => invoke('downloads:remove', d.id).then(onRemoved)} data-tip="Remove from list" aria-label="Remove">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
      {active && (
        <div style={{ height: 3, borderRadius: 2, background: 'var(--bg-3)', marginTop: 8, overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: pct !== null ? `${pct}%` : '30%',
              background: d.state === 'paused' ? 'var(--fg-3)' : 'var(--accent)',
              transition: 'width 250ms linear',
              animation: pct === null ? 'progress-sweep 1.2s var(--ease) infinite' : undefined
            }}
          />
        </div>
      )}
    </div>
  )
}

export default function DownloadsPanel() {
  const list = useDownloads()
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'failed'>('all')
  const shown = list.filter((d) =>
    filter === 'all' ? true : filter === 'active' ? d.state === 'progressing' || d.state === 'paused' : filter === 'completed' ? d.state === 'completed' : d.state === 'interrupted' || d.state === 'cancelled'
  )
  const reload = reloadDownloads
  return (
    <div className="col" style={{ gap: 0, height: '100%' }}>
      <div className="row" style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)' }}>
        <div className="seg">
          {(['all', 'active', 'completed', 'failed'] as const).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button
          className="btn sm ghost"
          onClick={() => invoke('downloads:clearFinished').then(reload)}
        >
          Clear
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {shown.length === 0 ? (
          <div className="empty">
            <Download size={26} />
            <div>No downloads{filter !== 'all' ? ` (${filter})` : ''}</div>
          </div>
        ) : (
          shown.map((d) => <DownloadRow key={d.id} d={d} onRemoved={reload} />)
        )}
      </div>
    </div>
  )
}
