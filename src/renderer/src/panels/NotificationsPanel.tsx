import { useEffect, useState } from 'react'
import { Bell, CheckCheck, Trash2 } from 'lucide-react'
import type { NotificationItem } from '@shared/types'
import { invoke, on } from '../lib/ipc'
import { timeAgo } from '../lib/format'

const CATS: NotificationItem['category'][] = ['browser', 'downloads', 'market', 'ai', 'research', 'system', 'projects']

export default function NotificationsPanel() {
  const [list, setList] = useState<NotificationItem[]>([])
  const [cat, setCat] = useState<string>('all')
  useEffect(() => {
    invoke('notifications:list').then(setList)
    invoke('notifications:markRead', undefined).then(() => window.dispatchEvent(new Event('specter:notifications-read')))
    return on('notifications:new', (n) => setList((l) => [n, ...l]))
  }, [])
  const shown = cat === 'all' ? list : list.filter((n) => n.category === cat)
  return (
    <div className="col" style={{ gap: 0, height: '100%' }}>
      <div className="row" style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
        <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} style={{ height: 26 }}>
          <option value="all">All categories</option>
          {CATS.map((c) => (
            <option key={c} value={c}>
              {c[0].toUpperCase() + c.slice(1)}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button className="icon-btn sm" onClick={() => invoke('notifications:markRead', undefined).then(() => setList((l) => l.map((n) => ({ ...n, read: true }))))} data-tip="Mark all read">
          <CheckCheck size={14} />
        </button>
        <button className="icon-btn sm" onClick={() => invoke('notifications:clear').then(() => setList([]))} data-tip="Clear all">
          <Trash2 size={14} />
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {shown.length === 0 ? (
          <div className="empty">
            <Bell size={24} />
            No notifications
          </div>
        ) : (
          shown.map((n) => (
            <div key={n.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
              <div className="row">
                {!n.read && <span className="status-dot ok" />}
                <span style={{ fontWeight: 500 }} className="grow ellipsis">
                  {n.title}
                </span>
                <span className="badge">{n.category}</span>
              </div>
              {n.body && (
                <div className="muted selectable" style={{ fontSize: 12, marginTop: 3, wordBreak: 'break-word' }}>
                  {n.body}
                </div>
              )}
              <div className="dim" style={{ fontSize: 10.5, marginTop: 3 }}>
                {timeAgo(n.createdAt)}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="dim" style={{ padding: '8px 12px', fontSize: 11, borderTop: '1px solid var(--line)' }}>
        Configure categories in Settings → Notifications.
      </div>
    </div>
  )
}
