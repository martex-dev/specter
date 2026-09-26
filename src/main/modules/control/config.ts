// Control module configuration, persisted in the app database (meta table).
import { DEFAULT_CONTROL_CONFIG, mergeControlConfig, type ControlConfig, type DeepPartial } from '@shared/modules/control'
import { json, metaGet, metaSet } from '../../db'

const KEY = 'control:config'
let current: ControlConfig | null = null
const listeners = new Set<(c: ControlConfig, prev: ControlConfig) => void>()

export function getConfig(): ControlConfig {
  if (!current) {
    let stored: unknown = null
    try {
      stored = json(metaGet(KEY), null)
    } catch {
      stored = null
    }
    current = mergeControlConfig(DEFAULT_CONTROL_CONFIG, stored)
  }
  return current
}

export function setConfig(patch: DeepPartial<ControlConfig>): ControlConfig {
  const prev = getConfig()
  const next = mergeControlConfig(prev, patch)
  current = next
  try {
    metaSet(KEY, JSON.stringify(next))
  } catch {
    /* DB unavailable — keep in memory */
  }
  for (const l of listeners) {
    try {
      l(next, prev)
    } catch {
      /* listener errors never break config updates */
    }
  }
  return next
}

export function onConfig(fn: (c: ControlConfig, prev: ControlConfig) => void): void {
  listeners.add(fn)
}
