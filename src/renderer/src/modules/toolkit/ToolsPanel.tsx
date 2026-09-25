// "Tools" side panel: lightweight productivity tools behind a compact tab switcher.
import { Suspense, lazy, useSyncExternalStore } from 'react'
import { Calculator, CalendarPlus, ClipboardList, Hourglass, ListTodo, Ruler, Timer, Watch, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { newTab } from '../../stores/browser'
import { getPanelTab, setPanelTab, subscribePanelTab, type PanelTab } from './panelState'
import './toolkit.css'

const CalculatorView = lazy(() => import('./panel/Calculator'))
const UnitsView = lazy(() => import('./panel/Units'))
const TimerView = lazy(() => import('./panel/Timers').then((m) => ({ default: m.TimerView })))
const StopwatchView = lazy(() => import('./panel/Timers').then((m) => ({ default: m.StopwatchView })))
const PomodoroView = lazy(() => import('./panel/Timers').then((m) => ({ default: m.PomodoroView })))
const TodoView = lazy(() => import('./panel/Todo'))
const CalendarView = lazy(() => import('./panel/CalendarLinks'))
const SnippetsView = lazy(() => import('./panel/Snippets'))

const TABS: { id: PanelTab; title: string; icon: LucideIcon; C: React.ComponentType }[] = [
  { id: 'calc', title: 'Calculator', icon: Calculator, C: CalculatorView },
  { id: 'units', title: 'Unit converter', icon: Ruler, C: UnitsView },
  { id: 'timer', title: 'Timer', icon: Hourglass, C: TimerView },
  { id: 'stopwatch', title: 'Stopwatch', icon: Watch, C: StopwatchView },
  { id: 'pomodoro', title: 'Pomodoro', icon: Timer, C: PomodoroView },
  { id: 'todo', title: 'Todo', icon: ListTodo, C: TodoView },
  { id: 'calendar', title: 'Add to calendar', icon: CalendarPlus, C: CalendarView },
  { id: 'snippets', title: 'Snippets', icon: ClipboardList, C: SnippetsView }
]

export default function ToolsPanel({ popout }: { popout?: boolean }) {
  const tab = useSyncExternalStore(subscribePanelTab, getPanelTab)
  const cur = TABS.find((t) => t.id === tab) ?? TABS[0]
  return (
    <div className="tkp">
      <div className="tkp-tabs" role="tablist" aria-label="Tools">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === cur.id} className={'tkp-tab' + (t.id === cur.id ? ' on' : '')} onClick={() => setPanelTab(t.id)} data-tip={t.title} aria-label={t.title}>
            <t.icon size={14} />
            {t.id === cur.id && <span>{t.title}</span>}
          </button>
        ))}
        <span className="spacer" />
        {!popout && (
          <button className="tkp-tab" onClick={() => newTab('specter://toolkit')} data-tip="Open the developer toolkit" aria-label="Developer toolkit">
            <Wrench size={14} />
          </button>
        )}
      </div>
      <div className="tkp-body" role="tabpanel">
        <Suspense fallback={<div className="empty">Loading…</div>}>
          <cur.C key={cur.id} />
        </Suspense>
      </div>
    </div>
  )
}
