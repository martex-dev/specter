// PAPER TRADING simulator. Virtual balance only — this module has no code
// path to any real exchange account or order endpoint.
import type { PaperOrderInput, PaperPosition, PaperState, PaperTrade } from '@shared/modules/markets'
import { executePaperOrder, normalizeSymbol } from '@shared/modules/markets'
import { uid } from '../../db'
import { broadcast } from '../../ipc'
import { fetchQuotes, isEnabled, settingQuote } from './hub'
import { addPaperEquity, paperAccount, paperEquity, paperPositions, paperTrades, resetPaper, savePaperFill } from './store'

export function paperState(): PaperState {
  return { account: paperAccount(settingQuote()), positions: paperPositions(), trades: paperTrades(), equity: paperEquity() }
}

async function equityNow(cash: number, positions: PaperPosition[]): Promise<number | null> {
  if (!positions.length) return cash
  const tick = await fetchQuotes(
    positions.map((p) => p.symbol),
    30_000
  )
  let eq = cash
  for (const p of positions) {
    const q = tick.quotes.find((x) => x.symbol === p.symbol)
    if (!q) return null
    eq += p.qty * q.price
  }
  return eq
}

let queue: Promise<unknown> = Promise.resolve()

export function placePaperOrder(order: PaperOrderInput): Promise<{ ok: boolean; error?: string; trade?: PaperTrade }> {
  const run = async () => {
    if (!isEnabled()) return { ok: false, error: 'Market tools are disabled in Settings' }
    const symbol = normalizeSymbol(order.symbol ?? '')
    if (!symbol) return { ok: false, error: 'Enter a valid symbol' }
    if (order.side !== 'buy' && order.side !== 'sell') return { ok: false, error: 'Invalid side' }
    // Fill at the current real last-traded price (≤5 s old); no spread or slippage is modelled.
    const tick = await fetchQuotes([symbol], 5_000)
    const q = tick.quotes.find((x) => x.symbol === symbol)
    if (!q) return { ok: false, error: tick.errors[0]?.error ?? `No price available for ${symbol}` }
    const acc = paperAccount(settingQuote())
    const r = executePaperOrder(acc.cash, paperPositions(), { ...order, symbol }, q.price, acc.feeRate)
    if (!r.ok) return { ok: false, error: r.error }
    const trade: PaperTrade = { ...r.trade, id: uid('pt_'), source: q.source, quote: q.quote, ts: Date.now() }
    savePaperFill(r.cash, r.positions, trade)
    const eq = await equityNow(r.cash, r.positions).catch(() => null)
    if (eq !== null) addPaperEquity(Date.now(), eq)
    broadcast('paper:changed', undefined)
    return { ok: true, trade }
  }
  const p = queue.then(run, run)
  queue = p.catch(() => undefined)
  return p
}

export function resetPaperAccount(startingBalance: number, feeRate: number): PaperState {
  if (!(startingBalance > 0) || startingBalance > 1e12) throw new Error('Starting balance must be between 0 and 1,000,000,000,000')
  if (!(feeRate >= 0) || feeRate > 0.05) throw new Error('Fee rate must be between 0% and 5%')
  resetPaper(startingBalance, feeRate, settingQuote())
  broadcast('paper:changed', undefined)
  return paperState()
}
