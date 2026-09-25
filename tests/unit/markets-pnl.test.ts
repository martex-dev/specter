import { describe, expect, it } from 'vitest'
import { computeHoldings, executePaperOrder, maxDrawdown, paperStats, unrealizedPnl, type PaperTrade, type PortfolioTx } from '@shared/modules/markets'

const tx = (id: string, type: PortfolioTx['type'], quantity: number, price: number, fee = 0, date = Number(id)): PortfolioTx => ({ id, asset: 'btc', type, quantity, price, fee, date })

describe('portfolio (average-cost)', () => {
  it('averages buys including fees', () => {
    const r = computeHoldings([tx('1', 'buy', 1, 100, 1), tx('2', 'buy', 1, 200, 1)])
    const h = r.holdings[0]
    expect(h.asset).toBe('BTC')
    expect(h.quantity).toBe(2)
    expect(h.costBasis).toBe(302)
    expect(h.avgCost).toBe(151)
  })
  it('realizes P/L on sells at average cost', () => {
    const r = computeHoldings([tx('1', 'buy', 2, 100), tx('2', 'buy', 2, 200), tx('3', 'sell', 1, 300, 2)])
    const h = r.holdings[0]
    // avg 150 → realized = 300 - 2 - 150 = 148
    expect(h.realizedPnl).toBeCloseTo(148)
    expect(h.quantity).toBe(3)
    expect(h.avgCost).toBeCloseTo(150)
    expect(r.realizedTotal).toBeCloseTo(148)
    expect(r.feesTotal).toBe(2)
  })
  it('handles transfers and clamps oversells with a warning', () => {
    const r = computeHoldings([tx('1', 'transfer_in', 1, 50), tx('2', 'transfer_out', 0.5, 0, 1), tx('3', 'sell', 5, 100)])
    const h = r.holdings[0]
    expect(h.realizedPnl).toBeCloseTo(-1 + (0.5 * 100 - 0.5 * 50))
    expect(h.quantity).toBe(0)
    expect(h.costBasis).toBe(0)
    expect(r.warnings).toHaveLength(1)
  })
  it('processes transactions in date order regardless of input order', () => {
    const r = computeHoldings([tx('3', 'sell', 1, 300), tx('1', 'buy', 1, 100)])
    expect(r.warnings).toHaveLength(0)
    expect(r.holdings[0].realizedPnl).toBe(200)
  })
  it('computes unrealized P/L only with a real price', () => {
    const h = computeHoldings([tx('1', 'buy', 2, 100)]).holdings[0]
    expect(unrealizedPnl(h, 150)).toEqual({ value: 300, pnl: 100, pct: 50 })
    expect(unrealizedPnl(h, undefined)).toEqual({ value: null, pnl: null, pct: null })
  })
})

describe('paper trading engine', () => {
  it('buys by notional, charging the fee on top and into avg price', () => {
    const r = executePaperOrder(10_000, [], { symbol: 'btc', side: 'buy', notional: 1000 }, 50_000, 0.001)
    if (!r.ok) throw new Error(r.error)
    expect(r.trade.qty).toBeCloseTo(0.02)
    expect(r.trade.fee).toBeCloseTo(1)
    expect(r.cash).toBeCloseTo(8999)
    expect(r.positions[0]).toMatchObject({ symbol: 'BTC', qty: 0.02 })
    expect(r.positions[0].avgPrice).toBeCloseTo(50_050)
  })
  it('rejects buys beyond cash and sells without a position (long-only)', () => {
    expect(executePaperOrder(100, [], { symbol: 'BTC', side: 'buy', qty: 1 }, 50_000, 0).ok).toBe(false)
    expect(executePaperOrder(100, [], { symbol: 'BTC', side: 'sell', qty: 1 }, 50_000, 0).ok).toBe(false)
    expect(executePaperOrder(100, [], { symbol: 'BTC', side: 'buy', qty: 1 }, 0, 0).ok).toBe(false)
    expect(executePaperOrder(100, [], { symbol: 'BTC', side: 'buy', qty: -1 }, 10, 0).ok).toBe(false)
  })
  it('sells realize P/L and remove closed positions', () => {
    const buy = executePaperOrder(1000, [], { symbol: 'ETH', side: 'buy', qty: 1 }, 100, 0.01)
    if (!buy.ok) throw new Error()
    const sell = executePaperOrder(buy.cash, buy.positions, { symbol: 'ETH', side: 'sell', qty: 1 }, 120, 0.01)
    if (!sell.ok) throw new Error(sell.error)
    // cost 101 incl fee; proceeds 120 - 1.2 = 118.8 → +17.8
    expect(sell.trade.realizedPnl).toBeCloseTo(17.8)
    expect(sell.positions).toHaveLength(0)
    expect(sell.cash).toBeCloseTo(1000 - 101 + 118.8)
  })
  it('partial sells keep the average price', () => {
    const buy = executePaperOrder(1000, [], { symbol: 'ETH', side: 'buy', qty: 2 }, 100, 0)
    if (!buy.ok) throw new Error()
    const sell = executePaperOrder(buy.cash, buy.positions, { symbol: 'ETH', side: 'sell', qty: 0.5 }, 90, 0)
    if (!sell.ok) throw new Error()
    expect(sell.positions[0]).toEqual({ symbol: 'ETH', qty: 1.5, avgPrice: 100 })
    expect(sell.trade.realizedPnl).toBeCloseTo(-5)
    expect(executePaperOrder(sell.cash, sell.positions, { symbol: 'ETH', side: 'sell', qty: 2 }, 90, 0).ok).toBe(false)
  })
  it('computes win rate, return and drawdown', () => {
    const t = (pnl: number | null, side: 'buy' | 'sell' = 'sell'): PaperTrade => ({ id: String(Math.random()), symbol: 'X', side, qty: 1, price: 1, fee: 0.5, notional: 1, realizedPnl: pnl, source: 'binance', quote: 'USDT', ts: 0 })
    const s = paperStats([t(null, 'buy'), t(10), t(-5), t(3)], [1100, 900, 1000], 1000, 1200)
    expect(s.closedTrades).toBe(3)
    expect(s.wins).toBe(2)
    expect(s.winRate).toBeCloseTo(2 / 3)
    expect(s.realizedPnl).toBe(8)
    expect(s.fees).toBe(2)
    expect(s.totalReturnPct).toBeCloseTo(20)
    expect(s.maxDrawdownPct).toBeCloseTo((200 / 1100) * 100)
    expect(paperStats([], [], 1000, null).winRate).toBeNull()
  })
  it('maxDrawdown handles flat and rising series', () => {
    expect(maxDrawdown([1, 2, 3])).toBe(0)
    expect(maxDrawdown([100, 50, 200, 100])).toBe(0.5)
    expect(maxDrawdown([])).toBe(0)
  })
})
