// specter://widgets — choose which widgets appear in the dock and on the new tab page.
import { ExternalLink, LayoutGrid, PanelRight, ShieldCheck } from 'lucide-react'
import type { WidgetId } from '@shared/modules/widgets'
import { Switch } from '../../components/ui'
import { getSetting, setSetting, useSetting } from '../../stores/settings'
import { openSidePanel } from '../../stores/ui'
import { newTab } from '../../stores/browser'
import { WIDGETS } from './catalog'
import { useConfig } from './store'
import './widgets.css'

export default function WidgetsPage() {
  const [cfg, setCfg] = useConfig()
  const hidden = useSetting('sidebar.hiddenItems')

  const setDock = (id: WidgetId, panelId: string, on: boolean) => {
    setCfg({ ...cfg, dock: { ...cfg.dock, [id]: on } })
    // Showing a widget should also undo an earlier "Hide from sidebar".
    if (on && hidden.includes(panelId))
      setSetting(
        'sidebar.hiddenItems',
        getSetting('sidebar.hiddenItems').filter((x) => x !== panelId)
      )
  }
  const setNewTab = (id: WidgetId, on: boolean) => setCfg({ ...cfg, newtab: { ...cfg.newtab, [id]: on } })

  return (
    <div className="page wg-page">
      <div className="page-h">
        <div>
          <div className="page-kicker">Widgets</div>
          <h1 className="page-title">Your widgets</h1>
          <div className="page-sub">Pick what lives in the sidebar dock and on the new tab page. Every widget is also in the command palette.</div>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => newTab('specter://newtab')}>
          <LayoutGrid size={14} /> Open new tab
        </button>
      </div>

      <div className="wg-page-grid">
        {WIDGETS.map((w) => {
          const dockOn = cfg.dock[w.id] && !hidden.includes(w.panelId)
          return (
            <div key={w.id} className="card wg-page-card">
              <div className="wg-page-card-h">
                <span className="wg-page-icon">
                  <w.icon size={20} />
                </span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="wg-page-title">{w.title}</div>
                  <div className="dim" style={{ fontSize: 12 }}>
                    {w.description}
                  </div>
                </div>
              </div>
              <div className="wg-page-net">
                <ShieldCheck size={12} /> {w.network}
              </div>
              <div className="wg-page-toggles">
                <label className="row">
                  <Switch on={dockOn} onChange={(v) => setDock(w.id, w.panelId, v)} label={`${w.title} in sidebar dock`} />
                  <span>Sidebar dock</span>
                </label>
                <label className="row">
                  <Switch on={w.newtab && cfg.newtab[w.id]} onChange={(v) => setNewTab(w.id, v)} disabled={!w.newtab} label={`${w.title} on new tab`} />
                  <span>New tab</span>
                </label>
                <span className="spacer" />
                <button className="btn sm ghost" onClick={() => openSidePanel(w.panelId)}>
                  <PanelRight size={12} /> Open
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="section wg-page-foot">
        <p className="dim">
          Widgets never poll in the background: they refresh only while their panel or new-tab card is visible. External data always shows its source and when it was last updated. Free, keyless sources only —{' '}
          <a
            href="https://open-meteo.com/"
            onClick={(e) => {
              e.preventDefault()
              newTab('https://open-meteo.com/')
            }}
          >
            Open-Meteo <ExternalLink size={10} />
          </a>
          ,{' '}
          <a
            href="https://www.exchangerate-api.com"
            onClick={(e) => {
              e.preventDefault()
              newTab('https://www.exchangerate-api.com')
            }}
          >
            ExchangeRate-API <ExternalLink size={10} />
          </a>
          ,{' '}
          <a
            href="https://frankfurter.dev"
            onClick={(e) => {
              e.preventDefault()
              newTab('https://frankfurter.dev')
            }}
          >
            Frankfurter <ExternalLink size={10} />
          </a>{' '}
          and Cloudflare’s speed test.
        </p>
      </div>
    </div>
  )
}
