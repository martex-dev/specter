import { Notification, BrowserWindow } from 'electron'
import type { NotificationItem } from '@shared/types'
import { all, run, uid } from '../db'
import { broadcast, handle } from '../ipc'
import { getSetting } from './settings'

export function notify(n: { category: NotificationItem['category']; title: string; body?: string; silentDesktop?: boolean }): NotificationItem {
  const item: NotificationItem = { id: uid('n_'), category: n.category, title: n.title, body: n.body, createdAt: Date.now(), read: false }
  try {
    run('INSERT INTO notifications(id, category, title, body, created_at, read) VALUES(?,?,?,?,?,0)', item.id, item.category, item.title, item.body ?? null, item.createdAt)
    run('DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY created_at DESC LIMIT 300)')
  } catch {
    /* db may be closing */
  }
  broadcast('notifications:new', item)
  const enabled = getSetting('notifications.enabled') && getSetting('notifications.categories')[n.category] !== false
  const focused = BrowserWindow.getFocusedWindow()
  // Desktop toasts only when SPECTER isn't focused (in-app toasts cover the focused case).
  if (enabled && !n.silentDesktop && !focused && Notification.isSupported()) {
    const toast = new Notification({ title: n.title, body: n.body ?? '', silent: false })
    toast.on('click', () => {
      const w = BrowserWindow.getAllWindows()[0]
      if (w) {
        if (w.isMinimized()) w.restore()
        w.focus()
      }
    })
    toast.show()
  }
  return item
}

export function registerNotificationsIpc(): void {
  handle('notifications:list', () =>
    all<{ id: string; category: NotificationItem['category']; title: string; body: string | null; created_at: number; read: number }>(
      'SELECT * FROM notifications ORDER BY created_at DESC LIMIT 200'
    ).map((r) => ({ id: r.id, category: r.category, title: r.title, body: r.body ?? undefined, createdAt: r.created_at, read: !!r.read }))
  )
  handle('notifications:markRead', (_e, id) => {
    if (id) run('UPDATE notifications SET read = 1 WHERE id = ?', id)
    else run('UPDATE notifications SET read = 1')
  })
  handle('notifications:clear', () => {
    run('DELETE FROM notifications')
  })
  handle('app:notify', (_e, n) => {
    notify(n)
  })
}
