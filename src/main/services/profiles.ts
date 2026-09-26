// Browser profiles. Each profile has its own Chromium session partition
// (cookies, local storage, cache, service workers) and its own rows in the
// history / bookmarks / workspaces tables. One profile is active at a time;
// switching profile re-opens SPECTER's windows under the other profile.
import { session } from 'electron'
import type { Profile } from '@shared/types'
import { all, get, run, uid } from '../db'
import { handle } from '../ipc'
import { getSetting, setSetting } from './settings'

type Row = { id: string; name: string; color: string; partition: string; created_at: number }
const toProfile = (r: Row): Profile => ({ id: r.id, name: r.name, color: r.color, partition: r.partition, createdAt: r.created_at })

let switchHandler: ((profileId: string) => void) | null = null

export function ensureDefaultProfile(): void {
  if (!get('SELECT id FROM profiles WHERE id = ?', 'default')) {
    run('INSERT INTO profiles(id, name, color, partition, created_at) VALUES(?, ?, ?, ?, ?)', 'default', 'Personal', '#8b9cff', 'persist:specter-default', Date.now())
  }
  if (!get('SELECT id FROM profiles WHERE id = ?', getSetting('general.activeProfile'))) setSetting('general.activeProfile', 'default')
}

export function listProfiles(): Profile[] {
  return all<Row>('SELECT * FROM profiles ORDER BY created_at').map(toProfile)
}

export function activeProfileId(): string {
  return getSetting('general.activeProfile') || 'default'
}

export function activeProfile(): Profile {
  const r = get<Row>('SELECT * FROM profiles WHERE id = ?', activeProfileId()) ?? get<Row>('SELECT * FROM profiles WHERE id = ?', 'default')!
  return toProfile(r)
}

export function activeSession(): Electron.Session {
  return session.fromPartition(activeProfile().partition)
}

export function getProfile(id: string): Profile | null {
  const r = get<Row>('SELECT * FROM profiles WHERE id = ?', id)
  return r ? toProfile(r) : null
}

/** Creates a profile with its own session partition (used by the UI and the browser importer). */
export function createProfile(name: string, color: string): Profile {
  const id = uid('p_')
  run('INSERT INTO profiles(id, name, color, partition, created_at) VALUES(?, ?, ?, ?, ?)', id, name.trim() || 'Profile', color, 'persist:specter-' + id, Date.now())
  return toProfile(get<Row>('SELECT * FROM profiles WHERE id = ?', id)!)
}

export function onProfileSwitch(fn: (profileId: string) => void): void {
  switchHandler = fn
}

export function registerProfilesIpc(): void {
  handle('profiles:list', () => listProfiles())
  handle('profiles:create', (_e, name, color) => createProfile(name, color))
  handle('profiles:delete', async (_e, id) => {
    if (id === 'default' || id === activeProfileId()) throw new Error('Cannot delete the default or active profile')
    const p = get<Row>('SELECT * FROM profiles WHERE id = ?', id)
    if (!p) return
    await session.fromPartition(p.partition).clearStorageData()
    run('DELETE FROM history WHERE profile_id = ?', id)
    run('DELETE FROM bookmarks WHERE profile_id = ?', id)
    run('DELETE FROM workspaces WHERE profile_id = ?', id)
    run('DELETE FROM window_sessions WHERE profile_id = ?', id)
    run('DELETE FROM video_speeds WHERE profile_id = ?', id)
    try {
      // Sidebar web apps are per profile too (table owned by the optional webapps module).
      run('DELETE FROM webapps WHERE profile_id = ?', id)
    } catch {
      /* webapps module not initialised */
    }
    // Saved passwords and "never save" sites (tables owned by the password manager).
    for (const table of ['logins', 'login_never']) {
      try {
        run(`DELETE FROM ${table} WHERE profile_id = ?`, id)
      } catch {
        /* password manager not initialised */
      }
    }
    run('DELETE FROM profiles WHERE id = ?', id)
  })
  handle('profiles:openWindow', (_e, id) => {
    if (id === activeProfileId()) return
    if (!get('SELECT id FROM profiles WHERE id = ?', id)) throw new Error('Unknown profile')
    switchHandler?.(id)
  })
}
