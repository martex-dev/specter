// Local persistence for the markets module (watchlists, alerts, portfolio,
// paper trading, symbol map, research snapshots). Everything stays on this machine.
import { all, get, json, metaGet, metaSet, registerMigrations, run, tx, uid } from '../../db'
import type { AlertEvent, AlertInput, AlertKind, AlertRule, PaperAccount, PaperPosition, PaperTrade, PortfolioTx, PortfolioTxInput, TxType, Watchlist } from '@shared/modules/markets'
import { DEFAULT_WATCHLIST, normalizeSymbol } from '@shared/modules/markets'

export function registerMarketMigrations(): void {
  registerMigrations('markets', [
    `CREATE TABLE market_watchlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, symbols TEXT NOT NULL DEFAULT '[]', sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
     CREATE TABLE market_alerts (id TEXT PRIMARY KEY, symbol TEXT NOT NULL, kind TEXT NOT NULL, threshold REAL NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, repeat INTEGER NOT NULL DEFAULT 0, cooldown_min INTEGER NOT NULL DEFAULT 60, note TEXT, created_at INTEGER NOT NULL, last_triggered_at INTEGER, trigger_count INTEGER NOT NULL DEFAULT 0);
     CREATE TABLE market_alert_log (id TEXT PRIMARY KEY, alert_id TEXT NOT NULL, symbol TEXT NOT NULL, message TEXT NOT NULL, value REAL, price REAL, source TEXT, ts INTEGER NOT NULL);
     CREATE INDEX market_alert_log_ts ON market_alert_log(ts);
     CREATE TABLE portfolio_tx (id TEXT PRIMARY KEY, asset TEXT NOT NULL, type TEXT NOT NULL, quantity REAL NOT NULL, price REAL NOT NULL, fee REAL NOT NULL DEFAULT 0, date INTEGER NOT NULL, note TEXT, created_at INTEGER NOT NULL);
     CREATE TABLE paper_account (id INTEGER PRIMARY KEY CHECK (id = 1), starting_balance REAL NOT NULL, cash REAL NOT NULL, fee_rate REAL NOT NULL, quote TEXT NOT NULL, created_at INTEGER NOT NULL, reset_at INTEGER NOT NULL);
     CREATE TABLE paper_positions (symbol TEXT PRIMARY KEY, qty REAL NOT NULL, avg_price REAL NOT NULL);
     CREATE TABLE paper_trades (id TEXT PRIMARY KEY, symbol TEXT NOT NULL, side TEXT NOT NULL, qty REAL NOT NULL, price REAL NOT NULL, fee REAL NOT NULL, notional REAL NOT NULL, realized_pnl REAL, source TEXT NOT NULL, quote TEXT NOT NULL, ts INTEGER NOT NULL);
     CREATE TABLE paper_equity (ts INTEGER NOT NULL, equity REAL NOT NULL);
     CREATE TABLE market_symbol_map (symbol TEXT PRIMARY KEY, coingecko_id TEXT, updated_at INTEGER NOT NULL);
     CREATE TABLE crypto_liq_snapshots (key TEXT NOT NULL, liquidity REAL NOT NULL, ts INTEGER NOT NULL);
     CREATE INDEX crypto_liq_snapshots_key ON crypto_liq_snapshots(key, ts);`
  ])
}

// ---------------------------------------------------------------- watchlists

type WlRow = { id: string; name: string; symbols: string; sort: number; created_at: number }

const cleanSymbols = (symbols: string[]) => [...new Set(symbols.map((s) => normalizeSymbol(s)).filter((s): s is string => !!s))].slice(0, 100)

export function listWatchlists(): Watchlist[] {
  if (!metaGet('markets:seeded')) {
    metaSet('markets:seeded', '1')
    if (!get('SELECT id FROM market_watchlists LIMIT 1')) createWatchlist('Main', DEFAULT_WATCHLIST)
  }
  return all<WlRow>('SELECT * FROM market_watchlists ORDER BY sort, created_at').map((r) => ({ id: r.id, name: r.name, symbols: json<string[]>(r.symbols, []), sort: r.sort, createdAt: r.created_at }))
}

export function createWatchlist(name: string, symbols: string[] = []): Watchlist {
  const id = uid('wl_')
  const sort = (get<{ m: number | null }>('SELECT MAX(sort) AS m FROM market_watchlists')?.m ?? -1) + 1
  const w: Watchlist = { id, name: name.trim().slice(0, 60) || 'Watchlist', symbols: cleanSymbols(symbols), sort, createdAt: Date.now() }
  run('INSERT INTO market_watchlists(id, name, symbols, sort, created_at) VALUES(?,?,?,?,?)', w.id, w.name, JSON.stringify(w.symbols), w.sort, w.createdAt)
  return w
}

export function renameWatchlist(id: string, name: string): void {
  run('UPDATE market_watchlists SET name = ? WHERE id = ?', name.trim().slice(0, 60) || 'Watchlist', id)
}

export function deleteWatchlist(id: string): void {
  const n = get<{ n: number }>('SELECT COUNT(*) AS n FROM market_watchlists')?.n ?? 0
  if (n <= 1) throw new Error('At least one watchlist is required')
  run('DELETE FROM market_watchlists WHERE id = ?', id)
}

export function setWatchlistSymbols(id: string, symbols: string[]): void {
  run('UPDATE market_watchlists SET symbols = ? WHERE id = ?', JSON.stringify(cleanSymbols(symbols)), id)
}

export function allWatchedSymbols(): string[] {
  return [...new Set(listWatchlists().flatMap((w) => w.symbols))]
}

// ---------------------------------------------------------------- alerts

type AlertRow = { id: string; symbol: string; kind: string; threshold: number; enabled: number; repeat: number; cooldown_min: number; note: string | null; created_at: number; last_triggered_at: number | null; trigger_count: number }

const toAlert = (r: AlertRow): AlertRule => ({
  id: r.id,
  symbol: r.symbol,
  kind: r.kind as AlertKind,
  threshold: r.threshold,
  enabled: !!r.enabled,
  repeat: !!r.repeat,
  cooldownMin: r.cooldown_min,
  note: r.note ?? undefined,
  createdAt: r.created_at,
  lastTriggeredAt: r.last_triggered_at,
  triggerCount: r.trigger_count
})

const ALERT_KINDS: AlertKind[] = ['price_above', 'price_below', 'change_above', 'change_below', 'volume_above']

export function listAlerts(): AlertRule[] {
  return all<AlertRow>('SELECT * FROM market_alerts ORDER BY created_at DESC').map(toAlert)
}

export function createAlert(input: AlertInput): AlertRule {
  const symbol = normalizeSymbol(input.symbol)
  if (!symbol) throw new Error('Invalid symbol')
  if (!ALERT_KINDS.includes(input.kind)) throw new Error('Invalid alert type')
  if (!isFinite(input.threshold)) throw new Error('Threshold must be a number')
  const a: AlertRule = {
    id: uid('al_'),
    symbol,
    kind: input.kind,
    threshold: input.threshold,
    enabled: true,
    repeat: !!input.repeat,
    cooldownMin: Math.max(1, Math.round(input.cooldownMin ?? 60)),
    note: input.note?.slice(0, 200) || undefined,
    createdAt: Date.now(),
    lastTriggeredAt: null,
    triggerCount: 0
  }
  run(
    'INSERT INTO market_alerts(id, symbol, kind, threshold, enabled, repeat, cooldown_min, note, created_at, trigger_count) VALUES(?,?,?,?,?,?,?,?,?,0)',
    a.id,
    a.symbol,
    a.kind,
    a.threshold,
    1,
    a.repeat ? 1 : 0,
    a.cooldownMin,
    a.note ?? null,
    a.createdAt
  )
  return a
}

export function updateAlert(id: string, patch: Partial<Pick<AlertRule, 'enabled' | 'repeat' | 'cooldownMin' | 'threshold' | 'note'>>): void {
  const cur = get<AlertRow>('SELECT * FROM market_alerts WHERE id = ?', id)
  if (!cur) throw new Error('Alert not found')
  const a = { ...toAlert(cur), ...patch }
  // Re-arming a one-shot alert that already fired clears its trigger time.
  const rearm = patch.enabled === true && !cur.enabled && !a.repeat
  run(
    'UPDATE market_alerts SET enabled = ?, repeat = ?, cooldown_min = ?, threshold = ?, note = ?, last_triggered_at = ? WHERE id = ?',
    a.enabled ? 1 : 0,
    a.repeat ? 1 : 0,
    Math.max(1, Math.round(a.cooldownMin)),
    isFinite(a.threshold) ? a.threshold : cur.threshold,
    a.note ?? null,
    rearm ? null : a.lastTriggeredAt,
    id
  )
}

export function deleteAlert(id: string): void {
  run('DELETE FROM market_alerts WHERE id = ?', id)
}

export function recordAlertTrigger(rule: AlertRule, ev: Omit<AlertEvent, 'id'>): AlertEvent {
  const event: AlertEvent = { ...ev, id: uid('ae_') }
  tx(() => {
    run('UPDATE market_alerts SET last_triggered_at = ?, trigger_count = trigger_count + 1, enabled = ? WHERE id = ?', ev.ts, rule.repeat ? 1 : 0, rule.id)
    run('INSERT INTO market_alert_log(id, alert_id, symbol, message, value, price, source, ts) VALUES(?,?,?,?,?,?,?,?)', event.id, event.alertId, event.symbol, event.message, event.value, event.price, event.source, event.ts)
    run('DELETE FROM market_alert_log WHERE id NOT IN (SELECT id FROM market_alert_log ORDER BY ts DESC LIMIT 500)')
  })
  return event
}

export function alertLog(limit = 50): AlertEvent[] {
  return all<{ id: string; alert_id: string; symbol: string; message: string; value: number; price: number; source: string; ts: number }>('SELECT * FROM market_alert_log ORDER BY ts DESC LIMIT ?', Math.min(500, Math.max(1, limit))).map((r) => ({
    id: r.id,
    alertId: r.alert_id,
    symbol: r.symbol,
    message: r.message,
    value: r.value,
    price: r.price,
    source: r.source,
    ts: r.ts
  }))
}

export function clearAlertLog(): void {
  run('DELETE FROM market_alert_log')
}

// ---------------------------------------------------------------- portfolio

type TxRow = { id: string; asset: string; type: string; quantity: number; price: number; fee: number; date: number; note: string | null }
const TX_TYPES: TxType[] = ['buy', 'sell', 'transfer_in', 'transfer_out']

function validateTx(t: PortfolioTxInput): PortfolioTxInput {
  const asset = normalizeSymbol(t.asset)
  if (!asset) throw new Error('Invalid asset symbol')
  if (!TX_TYPES.includes(t.type)) throw new Error('Invalid transaction type')
  if (!(t.quantity > 0)) throw new Error('Quantity must be positive')
  if (!(t.price >= 0) || !isFinite(t.price)) throw new Error('Price must be zero or positive')
  if (!(t.fee >= 0) || !isFinite(t.fee)) throw new Error('Fee must be zero or positive')
  if (!isFinite(t.date)) throw new Error('Invalid date')
  return { ...t, asset, note: t.note?.slice(0, 300) || undefined }
}

export function listTx(): PortfolioTx[] {
  return all<TxRow>('SELECT * FROM portfolio_tx ORDER BY date DESC, created_at DESC').map((r) => ({ id: r.id, asset: r.asset, type: r.type as TxType, quantity: r.quantity, price: r.price, fee: r.fee, date: r.date, note: r.note ?? undefined }))
}

export function addTx(input: PortfolioTxInput): PortfolioTx {
  const t = validateTx(input)
  const id = uid('tx_')
  run('INSERT INTO portfolio_tx(id, asset, type, quantity, price, fee, date, note, created_at) VALUES(?,?,?,?,?,?,?,?,?)', id, t.asset, t.type, t.quantity, t.price, t.fee, t.date, t.note ?? null, Date.now())
  return { ...t, id }
}

export function updateTx(id: string, input: PortfolioTxInput): void {
  const t = validateTx(input)
  const r = run('UPDATE portfolio_tx SET asset = ?, type = ?, quantity = ?, price = ?, fee = ?, date = ?, note = ? WHERE id = ?', t.asset, t.type, t.quantity, t.price, t.fee, t.date, t.note ?? null, id)
  if (!r.changes) throw new Error('This transaction no longer exists (it was deleted)')
}

export function deleteTx(id: string): void {
  run('DELETE FROM portfolio_tx WHERE id = ?', id)
}

// ---------------------------------------------------------------- paper trading

type AccRow = { starting_balance: number; cash: number; fee_rate: number; quote: string; created_at: number; reset_at: number }

export function paperAccount(defaultQuote: string): PaperAccount {
  let r = get<AccRow>('SELECT * FROM paper_account WHERE id = 1')
  if (!r) {
    const now = Date.now()
    run('INSERT INTO paper_account(id, starting_balance, cash, fee_rate, quote, created_at, reset_at) VALUES(1, ?, ?, ?, ?, ?, ?)', 10_000, 10_000, 0.001, defaultQuote, now, now)
    r = get<AccRow>('SELECT * FROM paper_account WHERE id = 1')!
  }
  return { startingBalance: r.starting_balance, cash: r.cash, feeRate: r.fee_rate, quote: r.quote, createdAt: r.created_at, resetAt: r.reset_at }
}

export function paperPositions(): PaperPosition[] {
  return all<{ symbol: string; qty: number; avg_price: number }>('SELECT * FROM paper_positions ORDER BY symbol').map((r) => ({ symbol: r.symbol, qty: r.qty, avgPrice: r.avg_price }))
}

export function paperTrades(limit = 500): PaperTrade[] {
  return all<{ id: string; symbol: string; side: string; qty: number; price: number; fee: number; notional: number; realized_pnl: number | null; source: string; quote: string; ts: number }>(
    'SELECT * FROM paper_trades ORDER BY ts DESC LIMIT ?',
    limit
  ).map((r) => ({ id: r.id, symbol: r.symbol, side: r.side as 'buy' | 'sell', qty: r.qty, price: r.price, fee: r.fee, notional: r.notional, realizedPnl: r.realized_pnl, source: r.source, quote: r.quote, ts: r.ts }))
}

export function paperEquity(): { ts: number; equity: number }[] {
  return all<{ ts: number; equity: number }>('SELECT ts, equity FROM paper_equity ORDER BY ts')
}

export function savePaperFill(cash: number, positions: PaperPosition[], trade: PaperTrade): void {
  tx(() => {
    run('UPDATE paper_account SET cash = ? WHERE id = 1', cash)
    run('DELETE FROM paper_positions')
    for (const p of positions) run('INSERT INTO paper_positions(symbol, qty, avg_price) VALUES(?,?,?)', p.symbol, p.qty, p.avgPrice)
    run(
      'INSERT INTO paper_trades(id, symbol, side, qty, price, fee, notional, realized_pnl, source, quote, ts) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      trade.id,
      trade.symbol,
      trade.side,
      trade.qty,
      trade.price,
      trade.fee,
      trade.notional,
      trade.realizedPnl,
      trade.source,
      trade.quote,
      trade.ts
    )
  })
}

export function addPaperEquity(ts: number, equity: number): void {
  run('INSERT INTO paper_equity(ts, equity) VALUES(?, ?)', ts, equity)
  run('DELETE FROM paper_equity WHERE ts < (SELECT ts FROM paper_equity ORDER BY ts DESC LIMIT 1 OFFSET 2000)')
}

export function resetPaper(startingBalance: number, feeRate: number, quote: string): void {
  const now = Date.now()
  tx(() => {
    run('DELETE FROM paper_positions')
    run('DELETE FROM paper_trades')
    run('DELETE FROM paper_equity')
    run('DELETE FROM paper_account')
    run('INSERT INTO paper_account(id, starting_balance, cash, fee_rate, quote, created_at, reset_at) VALUES(1, ?, ?, ?, ?, ?, ?)', startingBalance, startingBalance, feeRate, quote, now, now)
  })
}

// ---------------------------------------------------------------- symbol map / research snapshots

export function cachedCoinGeckoId(symbol: string): string | null | undefined {
  const r = get<{ coingecko_id: string | null; updated_at: number }>('SELECT coingecko_id, updated_at FROM market_symbol_map WHERE symbol = ?', symbol)
  if (!r) return undefined
  // Negative results expire after a day; positive ones after 30 days.
  const maxAge = r.coingecko_id ? 30 * 86_400_000 : 86_400_000
  return Date.now() - r.updated_at > maxAge ? undefined : r.coingecko_id
}

export function storeCoinGeckoId(symbol: string, id: string | null): void {
  run('INSERT INTO market_symbol_map(symbol, coingecko_id, updated_at) VALUES(?,?,?) ON CONFLICT(symbol) DO UPDATE SET coingecko_id = excluded.coingecko_id, updated_at = excluded.updated_at', symbol, id, Date.now())
}

/** Most recent snapshot at least `minAgeMs` old, else the most recent one. */
export function liquiditySnapshot(key: string, minAgeMs: number): { liquidityUsd: number; ts: number } | null {
  const older = get<{ liquidity: number; ts: number }>('SELECT liquidity, ts FROM crypto_liq_snapshots WHERE key = ? AND ts <= ? ORDER BY ts DESC LIMIT 1', key, Date.now() - minAgeMs)
  const r = older ?? get<{ liquidity: number; ts: number }>('SELECT liquidity, ts FROM crypto_liq_snapshots WHERE key = ? ORDER BY ts DESC LIMIT 1', key)
  return r ? { liquidityUsd: r.liquidity, ts: r.ts } : null
}

export function storeLiquiditySnapshot(key: string, liquidity: number): void {
  const last = get<{ ts: number }>('SELECT ts FROM crypto_liq_snapshots WHERE key = ? ORDER BY ts DESC LIMIT 1', key)
  if (last && Date.now() - last.ts < 10 * 60_000) return
  run('INSERT INTO crypto_liq_snapshots(key, liquidity, ts) VALUES(?,?,?)', key, liquidity, Date.now())
  run('DELETE FROM crypto_liq_snapshots WHERE key = ? AND ts < (SELECT ts FROM crypto_liq_snapshots WHERE key = ? ORDER BY ts DESC LIMIT 1 OFFSET 50)', key, key)
}
