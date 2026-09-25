// Markets, crypto & finance — main-process module entry.
// Registers migrations, IPC handlers, diagnostics and the alert engine.
// With `markets.enabled` off, no market request is ever made.
import type { ProviderHealth, Timeframe } from '@shared/modules/markets'
import { normalizeSymbol, PROVIDERS, sourceLabel, TIMEFRAMES } from '@shared/modules/markets'
import { broadcast, handle } from '../../ipc'
import { createLogger } from '../../logger'
import { registerDiagnostic } from '../../services/diagnostics'
import { getSetting, onSettingChanged } from '../../services/settings'
import { reloadAlerts } from './alerts'
import { fxRates } from './fx'
import { fetchQuotes, isEnabled, probe, providerHealth, reschedule, resetHub, settingQuote, status, stopAll, streamInfo, subscribe, unsubscribe } from './hub'
import { placePaperOrder, paperState, resetPaperAccount } from './paper'
import { applyRateLimits, describeError, NotListedError, PROVIDER_IMPL } from './providers'
import { research } from './research'
import * as store from './store'

const log = createLogger('markets')

const cleanList = (symbols: unknown): string[] =>
  Array.isArray(symbols) ? [...new Set(symbols.map((s) => normalizeSymbol(String(s))).filter((s): s is string => !!s))].slice(0, 100) : []

function requireEnabled(): void {
  if (!isEnabled()) throw new Error('Market tools are disabled in Settings')
}

export function register(): void {
  store.registerMarketMigrations()
  applyRateLimits()

  // ---------------------------------------------------------------- quotes & charts
  handle('market:status', () => status())
  handle('market:subscribe', (e, subId, symbols, opts) => {
    if (!isEnabled()) return { quotes: [], errors: [] }
    return subscribe(String(subId), e.sender.id, cleanList(symbols), !!opts?.live)
  })
  handle('market:unsubscribe', (_e, subId) => unsubscribe(String(subId)))
  handle('market:quotes', (_e, symbols, opts) => fetchQuotes(cleanList(symbols), Math.max(0, Number(opts?.maxAgeMs ?? 5000))))
  handle('market:candles', async (_e, rawSymbol, tf) => {
    const symbol = normalizeSymbol(String(rawSymbol)) ?? ''
    const timeframe: Timeframe = TIMEFRAMES.includes(tf) ? tf : '1h'
    const base = { symbol, timeframe, candles: [], source: null, quote: settingQuote(), fetchedAt: Date.now(), hasVolume: false }
    if (!isEnabled()) return { ...base, error: 'Market tools are disabled in Settings' }
    if (!symbol) return { ...base, error: 'Invalid symbol' }
    const pref = getSetting('markets.provider')
    const order = [pref, ...PROVIDERS.filter((p) => p !== pref)]
    const reasons: string[] = []
    for (const p of order) {
      const impl = PROVIDER_IMPL[p]
      if (!impl.supportsTimeframe(timeframe)) {
        reasons.push(`${sourceLabel(p)}: no ${timeframe} candles`)
        continue
      }
      try {
        const r = await impl.candles(symbol, timeframe, settingQuote())
        if (!r.candles.length) {
          reasons.push(`${sourceLabel(p)}: no candles returned`)
          continue
        }
        const note = [p !== pref ? `Fallback: ${reasons.join('; ')}` : '', r.note ?? ''].filter(Boolean).join(' · ') || undefined
        return { ...base, candles: r.candles, source: p, quote: r.quote, hasVolume: r.hasVolume, fetchedAt: Date.now(), note }
      } catch (err) {
        reasons.push(`${sourceLabel(p)}: ${err instanceof NotListedError ? err.message : describeError(err)}`)
      }
    }
    return { ...base, error: `Candles unavailable — ${reasons.join('; ')}` }
  })
  handle('market:validate', async (_e, raw) => {
    const symbol = normalizeSymbol(String(raw))
    if (!symbol) return { ok: false, symbol: String(raw), error: 'Symbols are 1–15 letters/digits, e.g. BTC' }
    if (!isEnabled()) return { ok: false, symbol, error: 'Market tools are disabled in Settings' }
    const t = await fetchQuotes([symbol], 30_000)
    const q = t.quotes[0]
    return q ? { ok: true, symbol, source: q.source } : { ok: false, symbol, error: t.errors[0]?.error ?? 'Not found' }
  })
  handle('market:checkProviders', async () => {
    requireEnabled()
    await Promise.all(([...PROVIDERS, 'binance-futures'] as ProviderHealth['id'][]).map((p) => probe(p)))
    broadcast('market:status', status())
    return providerHealth()
  })

  // ---------------------------------------------------------------- watchlists
  const wlChanged = () => broadcast('market:watchlistsChanged', undefined)
  handle('market:watchlists', () => store.listWatchlists())
  handle('market:watchlistCreate', (_e, name, symbols) => {
    const w = store.createWatchlist(String(name ?? ''), cleanList(symbols ?? []))
    wlChanged()
    return w
  })
  handle('market:watchlistRename', (_e, id, name) => {
    store.renameWatchlist(String(id), String(name ?? ''))
    wlChanged()
  })
  handle('market:watchlistDelete', (_e, id) => {
    store.deleteWatchlist(String(id))
    wlChanged()
  })
  handle('market:watchlistSetSymbols', (_e, id, symbols) => {
    store.setWatchlistSymbols(String(id), cleanList(symbols))
    wlChanged()
  })

  // ---------------------------------------------------------------- alerts
  const alertsChanged = () => {
    reloadAlerts()
    broadcast('alerts:changed', undefined)
  }
  handle('alerts:list', () => store.listAlerts())
  handle('alerts:create', (_e, input) => {
    const a = store.createAlert({ ...input, threshold: Number(input?.threshold) })
    alertsChanged()
    return a
  })
  handle('alerts:update', (_e, id, patch) => {
    store.updateAlert(String(id), patch ?? {})
    alertsChanged()
  })
  handle('alerts:delete', (_e, id) => {
    store.deleteAlert(String(id))
    alertsChanged()
  })
  handle('alerts:log', (_e, limit) => store.alertLog(Number(limit) || 50))
  handle('alerts:clearLog', () => {
    store.clearAlertLog()
    broadcast('alerts:changed', undefined)
  })

  // ---------------------------------------------------------------- portfolio (manual, local)
  handle('portfolio:list', () => store.listTx())
  handle('portfolio:add', (_e, tx) => {
    const t = store.addTx(tx)
    broadcast('portfolio:changed', undefined)
    return t
  })
  handle('portfolio:update', (_e, id, tx) => {
    store.updateTx(String(id), tx)
    broadcast('portfolio:changed', undefined)
  })
  handle('portfolio:delete', (_e, id) => {
    store.deleteTx(String(id))
    broadcast('portfolio:changed', undefined)
  })

  // ---------------------------------------------------------------- paper trading (simulated)
  handle('paper:state', () => paperState())
  handle('paper:order', (_e, order) => placePaperOrder(order))
  handle('paper:reset', (_e, opts) => resetPaperAccount(Number(opts?.startingBalance), Number(opts?.feeRate)))

  // ---------------------------------------------------------------- research & FX (user-triggered)
  handle('crypto:research', (_e, q) => {
    requireEnabled()
    return research(String(q ?? '').slice(0, 120))
  })
  handle('finance:fx', (_e, base) => {
    requireEnabled()
    return fxRates(String(base ?? 'USD'))
  })

  // ---------------------------------------------------------------- diagnostics
  for (const id of [...PROVIDERS, 'binance-futures'] as ProviderHealth['id'][]) {
    registerDiagnostic(async () => {
      const label = `Market data · ${sourceLabel(id)}`
      if (!isEnabled()) return { id: 'market-' + id, label, status: 'unknown', detail: 'Market tools disabled — no requests made' }
      const r = await probe(id)
      const pref = getSetting('markets.provider') === id ? ' · preferred' : ''
      return r.ok
        ? { id: 'market-' + id, label, status: 'ok', detail: `Reachable · ${r.latencyMs} ms${pref}` }
        : { id: 'market-' + id, label, status: /451|403/.test(r.error ?? '') ? 'warn' : 'error', detail: `${r.error}${pref}${id !== 'binance-futures' ? ' · automatic fallback to other providers' : ' · funding / open interest show “—”'}` }
    })
  }
  registerDiagnostic(() => {
    const label = 'Market data · Binance stream'
    if (!isEnabled()) return { id: 'market-stream', label, status: 'unknown', detail: 'Market tools disabled' }
    const s = streamInfo()
    const st = status()
    if (s.connected) return { id: 'market-stream', label, status: 'ok', detail: `Connected · last message ${Math.round((Date.now() - s.lastMessageAt) / 1000)}s ago` }
    return { id: 'market-stream', label, status: 'unknown', detail: st.mode === 'stream' ? `Reconnecting${s.lastError ? ` (${s.lastError})` : ''}` : `Idle (mode: ${st.mode}) — streams only while a markets view is visible` }
  })

  // ---------------------------------------------------------------- settings
  onSettingChanged((key) => {
    try {
      if (key === 'markets.enabled') {
        if (isEnabled()) {
          resetHub()
          reloadAlerts()
        } else stopAll()
        broadcast('market:status', status())
      } else if (key === 'markets.provider' || key === 'markets.quote') {
        resetHub()
      } else if (key === 'performance.mode') reschedule()
    } catch (err) {
      log.error('settings change handling failed', err)
    }
  })

  // Alert rules drive a slow background check only while enabled rules exist.
  setTimeout(() => {
    try {
      reloadAlerts()
    } catch (err) {
      log.error('alerts init failed', err)
    }
  }, 3000)
}
