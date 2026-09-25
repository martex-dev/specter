// Markets, crypto & finance — renderer module entry.
// Registers commands, pages, side panel, HUD/status items, new-tab widget and
// omnibox providers. Heavy UI is lazy-loaded.
import { createElement, lazy } from 'react'
import { Bell, BookOpen, Briefcase, Calculator, CandlestickChart, FlaskConical, LineChart, ListPlus } from 'lucide-react'
import type { AlertKind } from '@shared/modules/markets'
import { ALERT_KIND_LABEL, KNOWN_SYMBOLS, looksLikeAddress, normalizeSymbol } from '@shared/modules/markets'
import { registerCommands } from '../../lib/commands'
import { hudItems, newTabWidgets, sidePanels, statusItems } from '../../lib/registry'
import { registerOmniboxProvider, type OmniItem } from '../../lib/omnibox'
import { invoke, on } from '../../lib/ipc'
import { lazyPage, registerPage } from '../../pages/registry'
import { activateTab, activeTab, loadUrl, newTab, useBrowser } from '../../stores/browser'
import { getSetting } from '../../stores/settings'
import { toast, toggleSidePanel } from '../../stores/ui'
import { promptText } from '../../components/prompt'
import { cachedQuote, watchedSymbols } from './store'
import { HudTicker, MarketStatusItem, MarketStrip } from './widgets'
import { px } from './ui'
import './markets.css'

const enabled = () => getSetting('markets.enabled')

/** Opens a SPECTER page, reusing an existing tab of that page in this workspace. */
function openPage(url: string): void {
  const page = url.slice('specter://'.length).split(/[/?]/)[0]
  const st = useBrowser.getState()
  const ws = st.open[st.activeWsId]
  const base = 'specter://' + page
  const existing = ws?.tabs.find((t) => t.url === base || t.url.startsWith(base + '/') || t.url.startsWith(base + '?'))
  if (existing) {
    activateTab(existing.id)
    if (existing.url !== url && url !== base) loadUrl(existing.id, url)
    return
  }
  const t = activeTab()
  if (t && (t.url === 'specter://newtab' || t.url === '')) loadUrl(t.id, url)
  else newTab(url)
}

function chartUrl(symbol?: string): string {
  const s = symbol ? normalizeSymbol(symbol) : null
  return 'specter://markets' + (s ? '/' + s : '')
}

async function addAlertFlow(args?: { symbol?: string; kind?: AlertKind; threshold?: number; repeat?: boolean; cooldownMin?: number; note?: string }): Promise<void> {
  if (!enabled()) {
    toast({ kind: 'warn', title: 'Market tools are disabled', body: 'Enable them in Settings → Markets.' })
    return
  }
  let symbol = args?.symbol ? normalizeSymbol(args.symbol) : null
  if (!symbol) {
    const s = await promptText({ title: 'New price alert', label: 'Symbol', placeholder: 'BTC' })
    if (!s) return
    symbol = normalizeSymbol(s)
    if (!symbol) return void toast({ kind: 'warn', title: 'Invalid symbol' })
  }
  let kind = args?.kind
  let threshold = args?.threshold
  if (!kind || threshold === undefined) {
    const current = cachedQuote(symbol)
    const t = await promptText({
      title: `Alert for ${symbol}`,
      label: 'Condition — e.g. “> 70000”, “< 60000”, “% > 5”, “% < -5”, “vol > 1e9”',
      initial: current ? `> ${Number(current.price.toPrecision(6))}` : '> ',
      confirmLabel: 'Create alert'
    })
    if (!t) return
    const m = /^\s*(%|vol(?:ume)?)?\s*([<>])\s*(-?[\d.,e+]+)\s*$/i.exec(t)
    if (!m) return void toast({ kind: 'warn', title: 'Could not parse condition', body: 'Use “> 70000”, “< 60000”, “% > 5” or “vol > 1e9”.' })
    const [, what, op, num] = m
    threshold = Number(num.replace(/,/g, ''))
    kind = !what ? (op === '>' ? 'price_above' : 'price_below') : what === '%' ? (op === '>' ? 'change_above' : 'change_below') : 'volume_above'
    if (what && what !== '%' && op === '<') return void toast({ kind: 'warn', title: 'Only “volume above” alerts are supported' })
  }
  if (!isFinite(threshold)) return void toast({ kind: 'warn', title: 'Threshold must be a number' })
  try {
    await invoke('alerts:create', { symbol, kind, threshold, repeat: args?.repeat, cooldownMin: args?.cooldownMin, note: args?.note })
    toast({ kind: 'ok', title: `Alert armed: ${symbol} ${ALERT_KIND_LABEL[kind].toLowerCase()} ${threshold}`, action: { label: 'View', run: () => openPage('specter://markets?view=alerts') } })
  } catch (e: any) {
    toast({ kind: 'error', title: 'Could not create alert', body: String(e?.message ?? e) })
  }
}

export function register(): void {
  // ---------------------------------------------------------------- pages
  registerPage({ id: 'markets', title: 'Markets', icon: CandlestickChart, component: lazyPage(() => import('./MarketsPage')), listed: true, category: 'Markets' })
  registerPage({ id: 'portfolio', title: 'Portfolio', icon: Briefcase, component: lazyPage(() => import('./PortfolioPage')), listed: true, category: 'Markets' })
  registerPage({ id: 'paper', title: 'Paper Trading', icon: FlaskConical, component: lazyPage(() => import('./PaperPage')), listed: true, category: 'Markets' })
  registerPage({ id: 'crypto', title: 'Crypto Research', icon: BookOpen, component: lazyPage(() => import('./CryptoPage')), listed: true, category: 'Markets' })
  registerPage({ id: 'finance', title: 'Finance Toolkit', icon: Calculator, component: lazyPage(() => import('./FinancePage')), listed: true, category: 'Finance' })

  // ---------------------------------------------------------------- panel / HUD / status / new tab
  sidePanels.register({ id: 'markets', title: 'Markets', icon: LineChart, order: 40, component: lazy(() => import('./widgets')), popout: true, enabled, shortcutCommand: 'market.watchlist' })
  hudItems.register({ id: 'market-ticker', order: 60, component: HudTicker, enabled: () => enabled() && getSetting('markets.showTickerInHud') && getSetting('markets.tickerSymbols').length > 0 })
  statusItems.register({ id: 'market', side: 'right', order: 40, component: MarketStatusItem })
  newTabWidgets.register({ id: 'markets', title: 'Markets', order: 30, component: MarketStrip, defaultOn: true })

  // ---------------------------------------------------------------- commands
  const when = enabled
  registerCommands([
    { id: 'market.open', title: 'Open Markets', category: 'Markets', icon: CandlestickChart, keywords: ['chart', 'price', 'crypto', 'ticker', 'watchlist'], description: 'Watchlists, charts and alerts', when, run: (a?: { symbol?: string }) => openPage(chartUrl(a?.symbol)) },
    { id: 'market.watchlist', title: 'Toggle Market Watchlist Panel', category: 'Markets', icon: LineChart, keywords: ['side panel', 'prices'], when, run: () => toggleSidePanel('markets') },
    { id: 'market.alerts', title: 'Market Alerts', category: 'Markets', icon: Bell, keywords: ['price alert', 'notify'], when, run: () => openPage('specter://markets?view=alerts') },
    { id: 'market.addAlert', title: 'Add Price Alert…', category: 'Markets', icon: Bell, keywords: ['alert', 'notify', 'price above', 'price below'], when, run: (a) => addAlertFlow(a) },
    { id: 'market.portfolio', title: 'Open Portfolio Tracker', category: 'Markets', icon: Briefcase, keywords: ['holdings', 'p/l', 'profit'], when, run: () => openPage('specter://portfolio') },
    { id: 'market.paper', title: 'Open Paper Trading', category: 'Markets', icon: FlaskConical, keywords: ['simulator', 'practice', 'virtual'], when, run: (a?: { symbol?: string }) => openPage('specter://paper' + (a?.symbol ? '/' + normalizeSymbol(a.symbol) : '')) },
    { id: 'market.crypto', title: 'Crypto Research', category: 'Markets', icon: BookOpen, keywords: ['token', 'dex', 'contract', 'risk', 'research'], when, run: (a?: { query?: string }) => openPage('specter://crypto' + (a?.query ? '/' + encodeURIComponent(a.query) : '')) },
    { id: 'finance.toolkit', title: 'Finance Toolkit', category: 'Finance', icon: Calculator, keywords: ['calculator', 'compound', 'cagr', 'position size', 'currency', 'liquidation'], run: () => openPage('specter://finance') }
  ])

  // ---------------------------------------------------------------- omnibox
  const quoteSubtitle = (s: string): string => {
    const q = cachedQuote(s)
    if (!q) return 'Chart, watchlist and alerts'
    const ch = q.changePct24h !== null ? ` ${q.changePct24h >= 0 ? '+' : ''}${q.changePct24h.toFixed(2)}%` : ''
    return `${px(q.price)} ${q.quote}${ch} · ${q.source}`
  }
  const icon = () => createElement(CandlestickChart, { size: 15 })

  registerOmniboxProvider({
    id: 'markets',
    scopes: ['market', 'default'],
    async provide(text, scope) {
      if (!enabled()) {
        return scope === 'market' ? [{ id: 'mk:off', kind: 'market', title: 'Market tools are disabled', subtitle: 'Open Settings → Markets to enable', icon: icon(), score: 100, run: () => openPage('specter://settings') }] : []
      }
      const raw = text.trim()
      if (scope === 'default') {
        // Only exact, uppercase-looking tickers that are in a watchlist.
        if (!/^\$?[A-Z][A-Z0-9]{1,9}$/.test(raw)) return []
        const s = raw.replace(/^\$/, '')
        const known = await watchedSymbols()
        if (!known.has(s)) return []
        return [{ id: 'mk:chart:' + s, kind: 'market', title: `Open ${s} chart`, subtitle: quoteSubtitle(s), icon: icon(), score: 950, run: ({ newTab: nt }) => (nt ? newTab(chartUrl(s)) : openPage(chartUrl(s))) }]
      }
      // market scope: `$btc` / `@market eth`
      const items: OmniItem[] = []
      const up = raw.toUpperCase()
      if (!raw) {
        const known = [...(await watchedSymbols())].slice(0, 8)
        known.forEach((s, i) => items.push({ id: 'mk:w:' + s, kind: 'market', title: `${s} chart`, subtitle: quoteSubtitle(s), icon: icon(), score: 300 - i, run: () => openPage(chartUrl(s)) }))
        items.push({ id: 'mk:open', kind: 'market', title: 'Open Markets', subtitle: 'Watchlists, charts, alerts', icon: icon(), score: 100, run: () => openPage('specter://markets') })
        return items
      }
      if (looksLikeAddress(raw)) {
        return [{ id: 'mk:addr', kind: 'market', title: `Research token ${raw.slice(0, 8)}…${raw.slice(-4)}`, subtitle: 'CoinGecko · DexScreener · GoPlus', icon: createElement(BookOpen, { size: 15 }), score: 400, run: () => openPage('specter://crypto/' + encodeURIComponent(raw)) }]
      }
      const sym = normalizeSymbol(raw)
      const known = await watchedSymbols()
      const pool = [...new Set([...known, ...KNOWN_SYMBOLS])]
      const matches = pool.filter((s) => s.startsWith(up)).sort((a, b) => (a === up ? -1 : b === up ? 1 : (known.has(b) ? 1 : 0) - (known.has(a) ? 1 : 0) || a.length - b.length)).slice(0, 6)
      if (sym && !matches.includes(sym)) matches.unshift(sym)
      matches.forEach((s, i) => items.push({ id: 'mk:c:' + s, kind: 'market', title: `Open ${s} chart`, subtitle: quoteSubtitle(s), icon: icon(), score: 400 - i, run: ({ newTab: nt }) => (nt ? newTab(chartUrl(s)) : openPage(chartUrl(s))) }))
      if (sym) {
        items.push({ id: 'mk:r:' + sym, kind: 'market', title: `Research ${sym}`, subtitle: 'Market cap, DEX pairs, risk indicators', icon: createElement(BookOpen, { size: 15 }), score: 200, run: () => openPage('specter://crypto/' + sym) })
        items.push({ id: 'mk:a:' + sym, kind: 'market', title: `Add alert for ${sym}…`, icon: createElement(Bell, { size: 15 }), score: 190, run: () => addAlertFlow({ symbol: sym }) })
        items.push({ id: 'mk:p:' + sym, kind: 'market', title: `Paper trade ${sym}`, subtitle: 'Simulated — virtual balance', icon: createElement(FlaskConical, { size: 15 }), score: 180, run: () => openPage('specter://paper/' + sym) })
        if (!known.has(sym))
          items.push({
            id: 'mk:add:' + sym,
            kind: 'market',
            title: `Add ${sym} to watchlist`,
            icon: createElement(ListPlus, { size: 15 }),
            score: 170,
            run: async () => {
              const lists = await invoke('market:watchlists')
              const w = lists[0]
              if (w) await invoke('market:watchlistSetSymbols', w.id, [...w.symbols, sym])
              toast({ kind: 'ok', title: `${sym} added to ${w?.name ?? 'watchlist'}` })
            }
          })
      }
      return items
    }
  })

  // ---------------------------------------------------------------- in-app alert toasts
  // notify() raises desktop toasts only when SPECTER is unfocused; show an in-app one too.
  try {
    on('alerts:triggered', (ev) => {
      if (!document.hasFocus()) return
      toast({ kind: 'warn', title: `Alert · ${ev.symbol}`, body: ev.message, ttl: 10_000, action: { label: 'Open', run: () => openPage(chartUrl(ev.symbol)) } })
    })
  } catch {
    /* IPC bridge unavailable (tests) */
  }
}
