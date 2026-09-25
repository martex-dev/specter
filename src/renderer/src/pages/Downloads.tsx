import { FolderOpen } from 'lucide-react'
import { invoke } from '../lib/ipc'
import { useDownloads, DownloadRow, reloadDownloads } from '../panels/DownloadsPanel'
import { useSetting } from '../stores/settings'
import type { PageProps } from './registry'

export default function Downloads(_: PageProps) {
  const list = useDownloads()
  const dir = useSetting('downloads.directory')
  const groups: [string, typeof list][] = [
    ['Downloading', list.filter((d) => d.state === 'progressing')],
    ['Paused', list.filter((d) => d.state === 'paused')],
    ['Failed', list.filter((d) => d.state === 'interrupted' || d.state === 'cancelled')],
    ['Completed', list.filter((d) => d.state === 'completed')]
  ]
  return (
    <div className="page">
      <div className="page-h">
        <div className="grow">
          <div className="page-kicker">Browser</div>
          <h1 className="page-title">Downloads</h1>
          <div className="page-sub">Saving to {dir || 'your Downloads folder'}</div>
        </div>
        <button className="btn" onClick={() => invoke('downloads:openFolder')}>
          <FolderOpen size={14} /> Open folder
        </button>
        <button className="btn" onClick={() => invoke('downloads:clearFinished').then(reloadDownloads)}>
          Clear finished
        </button>
      </div>
      {list.length === 0 && <div className="empty">No downloads yet.</div>}
      {groups.map(([name, items]) =>
        items.length ? (
          <div key={name} className="section">
            <div className="section-title">
              {name} <span className="badge">{items.length}</span>
            </div>
            <div className="card">
              {items.map((d) => (
                <DownloadRow key={d.id} d={d} />
              ))}
            </div>
          </div>
        ) : null
      )}
    </div>
  )
}
