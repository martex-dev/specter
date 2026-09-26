import { register as aiRegister } from './ai'
import { register as marketsRegister } from './markets'
import { register as systemRegister } from './system'
import { register as knowledgeRegister } from './knowledge'
import { register as developerRegister } from './developer'
import { register as automationRegister } from './automation'
import { register as toolkitRegister } from './toolkit'
import { register as webappsRegister } from './webapps'
import { register as widgetsRegister } from './widgets'
import { register as controlRegister } from './control'


// Renderer-side registration of optional power-tool modules. Each module
// registers its commands, pages, side panels, HUD/status items and omnibox
// providers. A module that throws during registration is skipped — the
// browser keeps working.
type ModuleRegistration = { name: string; register: () => void }

const MODULES: ModuleRegistration[] = [
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
      m.register()
    } catch (err) {
      console.error(`[modules] ${m.name} failed to register`, err)
    }
  }
}
