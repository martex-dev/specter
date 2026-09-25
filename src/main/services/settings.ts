import { dialog } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { DEFAULT_SETTINGS, type SettingKey, type Settings } from '@shared/settings'
import { all, run } from '../db'
import { broadcast, handle, windowOf } from '../ipc'
import { bus } from '../bus'
import { createLogger, setLogLevel } from '../logger'

const log = createLogger('settings')
let cache: Settings | null = null
const listeners = new Set<(key: SettingKey, value: unknown) => void>()

export function loadSettings(): Settings {
  const rows = all<{ key: string; value: string }>('SELECT key, value FROM settings')
  const s: Settings = structuredClone(DEFAULT_SETTINGS)
  for (const r of rows) {
    if (r.key in DEFAULT_SETTINGS) {
      try {
        ;(s as any)[r.key] = JSON.parse(r.value)
      } catch {
        log.warn(`corrupt setting ${r.key}; using default`)
      }
    }
  }
  cache = s
  setLogLevel(s['advanced.logLevel'])
  return s
}

export function getSettings(): Settings {
  return cache ?? loadSettings()
}

export function getSetting<K extends SettingKey>(key: K): Settings[K] {
  return getSettings()[key]
}

export function setSetting<K extends SettingKey>(key: K, value: Settings[K]): void {
  if (!(key in DEFAULT_SETTINGS)) throw new Error('Unknown setting ' + key)
  const s = getSettings()
  s[key] = value
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value))
  if (key === 'advanced.logLevel') setLogLevel(value as Settings['advanced.logLevel'])
  for (const l of listeners) {
    try {
      l(key, value)
    } catch (err) {
      log.error('settings listener failed', err)
    }
  }
  broadcast('settings:changed', { key, value })
  bus.emit('SETTINGS_CHANGED', { key })
}

export function onSettingChanged(fn: (key: SettingKey, value: unknown) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function registerSettingsIpc(): void {
  handle('settings:getAll', () => getSettings())
  handle('settings:set', (_e, key, value) => setSetting(key, value as never))
  handle('settings:reset', (_e, key) => {
    if (key) {
      run('DELETE FROM settings WHERE key = ?', key)
      setSetting(key, structuredClone(DEFAULT_SETTINGS[key]) as never)
    } else {
      const onboarded = getSettings()['general.onboarded']
      run('DELETE FROM settings')
      loadSettings()
      setSetting('general.onboarded', onboarded)
      for (const k of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) broadcast('settings:changed', { key: k, value: getSettings()[k] })
    }
  })
  handle('settings:export', async (e) => {
    const win = windowOf(e)
    const opts = { defaultPath: 'specter-settings.json', filters: [{ name: 'JSON', extensions: ['json'] }] }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, JSON.stringify({ format: 'specter-settings', version: 1, settings: getSettings() }, null, 2))
    return r.filePath
  })
  handle('settings:import', async (e) => {
    const win = windowOf(e)
    const opts = { properties: ['openFile' as const], filters: [{ name: 'JSON', extensions: ['json'] }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return false
    const data = JSON.parse(readFileSync(r.filePaths[0], 'utf8'))
    const incoming = data?.settings ?? data
    for (const [k, v] of Object.entries(incoming)) {
      if (k in DEFAULT_SETTINGS && typeof v === typeof (DEFAULT_SETTINGS as any)[k]) setSetting(k as SettingKey, v as never)
    }
    return true
  })
}
