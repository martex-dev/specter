// Unread-count badge on the News dock button (kept out of the lazy panel chunk).
import { useEffect, useState } from 'react'
import { invoke, on } from '../../lib/ipc'

export function NewsBadge() {
  const [n, setN] = useState(0)
  useEffect(() => {
    invoke('news:unread')
      .then(setN)
      .catch(() => undefined)
    return on('news:changed', (e) => setN(e.unread))
  }, [])
  if (!n) return null
  return <span className="dock-badge soft">{n > 99 ? '99+' : n}</span>
}
