// Developer toolkit & productivity tools — renderer module entry.
//
// Everything heavy is lazy: the toolkit page, each tool, the Tools side panel
// and even the calculator/unit libraries used by the omnibox load on first use.
import { createElement, lazy } from 'react'
import { Calculator, CalendarPlus, ClipboardList, Hourglass, ListTodo, Pipette, Ruler, Timer, Watch, Wrench } from 'lucide-react'
import { registerCommands, type Command } from '../../lib/commands'
import { registerPage, lazyPage } from '../../pages/registry'
import { sidePanels } from '../../lib/registry'
import { registerOmniboxProvider, type OmniItem } from '../../lib/omnibox'
import { activeTab, loadUrl, newTab } from '../../stores/browser'
import { openSidePanel, toast } from '../../stores/ui'
import { invoke } from '../../lib/ipc'
import { TOOLS } from './tools'
import { setPanelTab, type PanelTab } from './panelState'
import { eyeDropperSupported, pickScreenColor } from './eyedropper'

/** Opens specter://toolkit[/tool], reusing the active tab if it already shows the toolkit. */
export function openToolkit(tool?: string, query?: string): void {
  const url = 'specter://toolkit' + (tool ? '/' + tool : '') + (query ? '?' + query : '')
  const t = activeTab()
  if (t && t.url.startsWith('specter://toolkit')) loadUrl(t.id, url)
  else newTab(url)
}

function openPanelTab(tab: PanelTab): void {
  setPanelTab(tab)
  openSidePanel('tools')
}

let libs: Promise<[typeof import('./lib/calc'), typeof import('./lib/units')]> | null = null
const loadLibs = () => (libs ??= Promise.all([import('./lib/calc'), import('./lib/units')]))

const MATH_CHARS = /^[\s\d.,_+\-*/^%()!×÷−·πτφ°a-z]+$/i
const CONVERSION = /^\s*-?[\d.,_]+(e[+-]?\d+)?\s*[^\d\s].*\s(to|in|as|into|->|→)\s+\S/i

async function copyResult(text: string): Promise<void> {
  try {
    await invoke('app:clipboardWrite', text)
    toast({ kind: 'ok', title: `Copied ${text}`, ttl: 2000 })
  } catch {
    toast({ kind: 'error', title: 'Copy failed' })
  }
}

export function register(): void {
  registerPage({
    id: 'toolkit',
    title: 'Toolkit',
    icon: Wrench,
    component: lazyPage(() => import('./ToolkitPage')),
    listed: true,
    category: 'Developer'
  })

  sidePanels.register({
    id: 'tools',
    title: 'Tools',
    icon: Calculator,
    order: 90,
    component: lazy(() => import('./ToolsPanel')),
    popout: true
  })

  const toolCommands: Command[] = TOOLS.map((t) => ({
    id: `toolkit.${t.id}`,
    title: `Toolkit: ${t.title}`,
    category: 'Developer',
    icon: t.icon,
    keywords: ['toolkit', 'developer', ...t.keywords],
    description: t.description,
    permissions: t.network ? ['network'] : undefined,
    run: (args?: { query?: string }) => openToolkit(t.id, args?.query)
  }))

  const panelCommands: [PanelTab, string, string, typeof Calculator, string[]][] = [
    ['calc', 'tools.calculator', 'Calculator', Calculator, ['calc', 'math', 'calculate', 'arithmetic']],
    ['units', 'tools.units', 'Unit converter', Ruler, ['units', 'convert', 'conversion', 'length', 'mass', 'temperature', 'metric', 'imperial']],
    ['timer', 'tools.timer', 'Timer', Hourglass, ['timer', 'countdown', 'alarm']],
    ['stopwatch', 'tools.stopwatch', 'Stopwatch', Watch, ['stopwatch', 'lap', 'chronometer']],
    ['pomodoro', 'tools.pomodoro', 'Pomodoro timer', Timer, ['pomodoro', 'focus', 'break', 'productivity']],
    ['todo', 'tools.todo', 'Todo list', ListTodo, ['todo', 'tasks', 'checklist']],
    ['calendar', 'tools.calendar', 'Add-to-calendar links', CalendarPlus, ['calendar', 'ics', 'event', 'google calendar', 'outlook']],
    ['snippets', 'tools.snippets', 'Snippets', ClipboardList, ['snippets', 'clipboard', 'text', 'saved']]
  ]

  registerCommands([
    {
      id: 'developer.toolkit',
      title: 'Open developer toolkit',
      category: 'Developer',
      icon: Wrench,
      keywords: ['toolkit', 'tools', 'developer', 'utilities', 'json', 'regex', 'base64'],
      description: 'JSON, regex, JWT, Base64, hashes, colors, diff, cron and more — all local.',
      run: (args?: { tool?: string }) => openToolkit(args?.tool)
    },
    ...toolCommands,
    {
      id: 'toolkit.eyedropper',
      title: 'Pick a color from the screen',
      category: 'Tools',
      icon: Pipette,
      keywords: ['eyedropper', 'color picker', 'pick color', 'hex', 'colour'],
      description: 'Samples any pixel on screen and copies its HEX value.',
      when: () => eyeDropperSupported(),
      run: async () => {
        const hex = await pickScreenColor()
        if (!hex) return
        await invoke('app:clipboardWrite', hex).catch(() => undefined)
        toast({ kind: 'ok', title: `${hex} copied`, body: 'Picked with the eyedropper.', action: { label: 'Open in color tool', run: () => openToolkit('color', 'c=' + encodeURIComponent(hex)) } })
      }
    },
    {
      id: 'tools.panel',
      title: 'Show tools panel',
      category: 'Tools',
      icon: Calculator,
      keywords: ['tools', 'productivity', 'side panel'],
      run: () => openSidePanel('tools')
    },
    ...panelCommands.map(([tab, id, title, icon, keywords]) => ({
      id,
      title,
      category: 'Tools' as const,
      icon,
      keywords,
      run: () => openPanelTab(tab)
    }))
  ])

  // Omnibox: "2*(3+4)" → "= 14", "10 km to mi" → "= 6.2137 mi". Enter copies the result.
  registerOmniboxProvider({
    id: 'toolkit-calc',
    scopes: ['default'],
    async provide(text): Promise<OmniItem[]> {
      const t = text.trim()
      if (t.length < 2 || t.length > 200 || !/\d/.test(t)) return []
      const maybeConv = CONVERSION.test(t)
      const maybeMath = MATH_CHARS.test(t)
      if (!maybeConv && !maybeMath) return []
      const [calc, units] = await loadLibs()
      if (maybeConv) {
        const c = units.parseConversion(t)
        if (c) {
          const r = units.formatUnitValue(c.result)
          return [
            {
              id: 'toolkit:convert',
              kind: 'other',
              title: `= ${r} ${c.to.id}`,
              subtitle: `${units.formatUnitValue(c.value)} ${c.from.label.toLowerCase()} in ${c.to.label.toLowerCase()} · Enter to copy`,
              icon: createElement(Ruler, { size: 15 }),
              score: 1100,
              run: () => void copyResult(r)
            }
          ]
        }
      }
      if (maybeMath && calc.looksLikeMath(t)) {
        try {
          const v = calc.evaluate(t)
          if (!Number.isFinite(v)) return []
          const r = calc.formatResult(v)
          return [
            {
              id: 'toolkit:calc',
              kind: 'other',
              title: `= ${r}`,
              subtitle: `${t} · Enter to copy`,
              icon: createElement(Calculator, { size: 15 }),
              score: 1100,
              run: () => void copyResult(r)
            }
          ]
        } catch {
          return []
        }
      }
      return []
    }
  })
}
