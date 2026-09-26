// Declarative plugins: <userData>/plugins/<id>/manifest.json. Manifests are
// validated against a strict schema; plugins can only use the same safe
// action types as automations and never execute code.
import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginInfo } from '@shared/modules/automation'
import { BUS_EVENT_NAMES } from '../../bus'
import { metaGet, metaSet } from '../../db'
import { createLogger } from '../../logger'
import { EXAMPLE_PLUGIN, validateManifest } from './manifest'
import { pluginState } from './store'

const log = createLogger('plugins')
let plugins: PluginInfo[] = []

export function pluginsDir(): string {
  return join(app.getPath('userData'), 'plugins')
}

/** Writes the bundled example plugin once (deleting it later is respected). */
export function seedExamplePlugin(): void {
  if (metaGet('automation:exampleSeeded') === '1') return
  try {
    const dir = join(pluginsDir(), EXAMPLE_PLUGIN.id)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'manifest.json')
    if (!existsSync(file)) writeFileSync(file, JSON.stringify(EXAMPLE_PLUGIN, null, 2) + '\n', 'utf8')
    metaSet('automation:exampleSeeded', '1')
  } catch (err) {
    log.warn('could not write example plugin', String(err))
  }
}

export function loadPlugins(): PluginInfo[] {
  const dir = pluginsDir()
  const out: PluginInfo[] = []
  try {
    mkdirSync(dir, { recursive: true })
    for (const folder of readdirSync(dir)) {
      const path = join(dir, folder)
      try {
        if (!statSync(path).isDirectory()) continue
      } catch {
        continue
      }
      const file = join(path, 'manifest.json')
      const info: PluginInfo = { id: folder, folder, path, enabled: false, manifest: null, errors: [], settings: {}, example: folder === EXAMPLE_PLUGIN.id }
      try {
        if (!existsSync(file)) throw new Error('manifest.json not found')
        if (statSync(file).size > 256 * 1024) throw new Error('manifest.json is larger than 256 KB')
        // Notepad and PowerShell 5 save UTF-8 with a byte order mark, which JSON.parse rejects.
        const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))
        const res = validateManifest(raw, folder, BUS_EVENT_NAMES)
        if (!res.ok) info.errors = res.errors
        else {
          info.manifest = res.manifest
          const st = pluginState(folder)
          info.enabled = st.enabled
          const defaults = Object.fromEntries(res.manifest.settings.map((s) => [s.key, s.default]))
          // Stored values only count when they still match the declared type.
          const stored = Object.fromEntries(Object.entries(st.settings).filter(([k, v]) => res.manifest.settings.some((s) => s.key === k && typeof v === s.type)))
          info.settings = { ...defaults, ...stored }
        }
      } catch (err) {
        info.errors = [err instanceof SyntaxError ? 'manifest.json is not valid JSON: ' + err.message : err instanceof Error ? err.message : String(err)]
      }
      out.push(info)
    }
  } catch (err) {
    log.warn('could not read plugins folder', String(err))
  }
  plugins = out.sort((a, b) => a.id.localeCompare(b.id))
  log.info(`loaded ${plugins.length} plugin(s), ${plugins.filter((p) => p.enabled).length} enabled`)
  return plugins
}

export function listPlugins(): PluginInfo[] {
  return plugins
}

export function getPlugin(id: string): PluginInfo | undefined {
  return plugins.find((p) => p.id === id)
}
