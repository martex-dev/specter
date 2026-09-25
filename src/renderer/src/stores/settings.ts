import { create } from 'zustand'
import { DEFAULT_SETTINGS, type SettingKey, type Settings } from '@shared/settings'
import { resolveBindings } from '@shared/keys'
import { invoke, on } from '../lib/ipc'
import { setBindings } from '../lib/commands'

interface SettingsStore {
  loaded: boolean
  s: Settings
  load: () => Promise<void>
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  loaded: false,
  s: DEFAULT_SETTINGS,
  load: async () => {
    const s = await invoke('settings:getAll')
    setBindings(resolveBindings(s['keyboard.bindings']))
    set({ s, loaded: true })
  }
}))

on('settings:changed', ({ key, value }) => {
  useSettingsStore.setState((st) => ({ s: { ...st.s, [key]: value } }))
  if (key === 'keyboard.bindings') setBindings(resolveBindings(value as Record<string, string>))
})

export function useSetting<K extends SettingKey>(key: K): Settings[K] {
  return useSettingsStore((st) => st.s[key])
}

export function getSetting<K extends SettingKey>(key: K): Settings[K] {
  return useSettingsStore.getState().s[key]
}

export function setSetting<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
  // Optimistic update so UI responds instantly.
  useSettingsStore.setState((st) => ({ s: { ...st.s, [key]: value } }))
  return invoke('settings:set', key, value as never)
}
