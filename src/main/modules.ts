// Registration point for optional power-tool modules (AI, markets, system,
// knowledge, developer…). Each module registers its own IPC handlers,
// migrations and diagnostics. A failing module must never take down the
// browser, so every registration is isolated.
import { createLogger } from './logger'
import { register as aiRegister } from './modules/ai'
import { register as marketsRegister } from './modules/markets'
import { register as systemRegister } from './modules/system'
import { register as knowledgeRegister } from './modules/knowledge'
import { register as developerRegister } from './modules/developer'
import { register as automationRegister } from './modules/automation'
import { register as toolkitRegister } from './modules/toolkit'
import { register as webappsRegister } from './modules/webapps'
import { register as widgetsRegister } from './modules/widgets'
import { register as controlRegister } from './modules/control'

const log = createLogger('modules')

type ModuleEntry = { name: string; register: () => void | Promise<void> }

const MODULES: ModuleEntry[] = [
  { name: 'ai', register: aiRegister },
  { name: 'markets', register: marketsRegister },
  { name: 'system', register: systemRegister },
  { name: 'knowledge', register: knowledgeRegister },
  { name: 'developer', register: developerRegister },
  { name: 'automation', register: automationRegister },
  { name: 'toolkit', register: toolkitRegister },
  { name: 'webapps', register: webappsRegister },
  { name: 'widgets', register: widgetsRegister },
  { name: 'control', register: controlRegister }
]

export function registerModules(): void {
  for (const m of MODULES) {
    try {
      const r = m.register()
      if (r instanceof Promise) r.catch((err) => log.error(`module ${m.name} failed to start`, err))
    } catch (err) {
      log.error(`module ${m.name} failed to register`, err)
    }
  }
}
