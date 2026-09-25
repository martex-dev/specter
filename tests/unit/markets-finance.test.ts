import { describe, expect, it } from 'vitest'
import { computeRiskIndicators, fin, looksLikeAddress, normalizeSymbol, type DexPair } from '@shared/modules/markets'

describe('finance formulas', () => {
  it('compound interest with and without contributions', () => {
    const a = fin.compound(1000, 10, 2, 1)
    expect(a.future).toBeCloseTo(1210)
    expect(a.interest).toBeCloseTo(210)
    const b = fin.compound(0, 12, 1, 12, 100)
    expect(b.future).toBeCloseTo(100 * ((Math.pow(1.01, 12) - 1) / 0.01))
    expect(fin.compound(0, 0, 1, 12, 100).future).toBeCloseTo(1200)
  })
  it('position size', () => {
    const r = fin.positionSize(10_000, 1, 100, 95)!
    expect(r.riskAmount).toBe(100)
    expect(r.units).toBe(20)
    expect(r.positionValue).toBe(2000)
    expect(fin.positionSize(10_000, 1, 100, 100)).toBeNull()
  })
  it('percent change and CAGR', () => {
    expect(fin.percentChange(80, 100)).toBeCloseTo(25)
    expect(fin.percentChange(100, 80)).toBeCloseTo(-20)
    expect(fin.percentChange(0, 1)).toBeNull()
    expect(fin.cagr(100, 121, 2)).toBeCloseTo(10)
    expect(fin.cagr(0, 1, 1)).toBeNull()
  })
  it('drawdown and recovery', () => {
    const d = fin.drawdown(100, 50)!
    expect(d.drawdownPct).toBe(50)
    expect(d.recoveryPct).toBe(100)
  })
  it('risk/reward requires a stop on the losing side', () => {
    const r = fin.riskReward(100, 95, 115)!
    expect(r.ratio).toBe(3)
    expect(r.breakevenWinRate).toBeCloseTo(25)
    expect(r.side).toBe('long')
    expect(fin.riskReward(100, 105, 115)).toBeNull()
    expect(fin.riskReward(100, 105, 85)!.side).toBe('short')
  })
  it('liquidation estimate', () => {
    expect(fin.liquidation(100, 10, 'long', 0)!.price).toBeCloseTo(90)
    expect(fin.liquidation(100, 10, 'short', 0)!.price).toBeCloseTo(110)
    expect(fin.liquidation(100, 10, 'long', 0.5)!.price).toBeCloseTo(90.5)
    expect(fin.liquidation(100, 0.5, 'long')).toBeNull()
  })
  it('profit/loss', () => {
    expect(fin.profitLoss(100, 110, 10, 'long', 5)).toEqual({ pnl: 95, pct: 9.5 })
    expect(fin.profitLoss(100, 110, 10, 'short').pnl).toBe(-100)
  })
  it('allocation deltas', () => {
    const a = fin.allocation([
      { name: 'A', value: 600, targetPct: 50 },
      { name: 'B', value: 400, targetPct: 50 }
    ])
    expect(a.total).toBe(1000)
    expect(a.rows[0].currentPct).toBe(60)
    expect(a.rows[0].delta).toBe(-100)
    expect(a.rows[1].delta).toBe(100)
  })
  it('currency conversion via a common base', () => {
    const rates = { EUR: 0.9, GBP: 0.8 }
    expect(fin.convert(100, 'USD', 'EUR', 'USD', rates)).toBeCloseTo(90)
    expect(fin.convert(90, 'EUR', 'GBP', 'USD', rates)).toBeCloseTo(80)
    expect(fin.convert(1, 'USD', 'XXX', 'USD', rates)).toBeNull()
  })
})

describe('symbol helpers', () => {
  it('normalizes tickers', () => {
    expect(normalizeSymbol(' $btc ')).toBe('BTC')
    expect(normalizeSymbol('b-t')).toBeNull()
  })
  it('detects addresses', () => {
    expect(looksLikeAddress('0x6982508145454Ce325dDbE47a25d4ec3d2311933')).toBe(true)
    expect(looksLikeAddress('BTC')).toBe(false)
  })
})

describe('risk research indicators', () => {
  const now = Date.UTC(2026, 8, 25)
  const pair = (p: Partial<DexPair> = {}): DexPair => ({
    chainId: 'ethereum',
    dexId: 'uniswap',
    url: '',
    pairAddress: '0x1',
    baseSymbol: 'T',
    baseName: 'T',
    baseAddress: '0xa',
    quoteSymbol: 'WETH',
    priceUsd: 1,
    liquidityUsd: 1_000_000,
    volume24h: 100_000,
    priceChange24h: 1,
    buys24h: 100,
    sells24h: 90,
    fdv: null,
    marketCap: null,
    pairCreatedAt: now - 400 * 86_400_000,
    labels: [],
    ...p
  })
  const byId = (xs: ReturnType<typeof computeRiskIndicators>) => Object.fromEntries(xs.map((x) => [x.id, x.status]))

  it('marks missing sources as DATA UNAVAILABLE, never CHECKED', () => {
    const r = byId(computeRiskIndicators({ pairs: [], security: null, previousLiquidity: null, now }))
    expect(Object.values(r).every((s) => s === 'DATA UNAVAILABLE')).toBe(true)
  })
  it('flags thin liquidity, young pairs, wash-like volume and sell-less activity', () => {
    const r = byId(computeRiskIndicators({ pairs: [pair({ liquidityUsd: 10_000, volume24h: 200_000, pairCreatedAt: now - 2 * 86_400_000, sells24h: 0, buys24h: 50 })], security: null, previousLiquidity: null, now }))
    expect(r.liquidity).toBe('WARNING')
    expect(r.pair_age).toBe('WARNING')
    expect(r.volume_liquidity).toBe('WARNING')
    expect(r.sell_activity).toBe('WARNING')
    expect(r.liquidity_change).toBe('UNKNOWN')
  })
  it('uses an older local snapshot for liquidity change', () => {
    const r = byId(computeRiskIndicators({ pairs: [pair({ liquidityUsd: 500_000 })], security: null, previousLiquidity: { liquidityUsd: 1_000_000, ts: now - 86_400_000 }, now }))
    expect(r.liquidity_change).toBe('WARNING')
    const ok = byId(computeRiskIndicators({ pairs: [pair()], security: null, previousLiquidity: { liquidityUsd: 1_000_000, ts: now - 86_400_000 }, now }))
    expect(ok.liquidity_change).toBe('CHECKED')
  })
  it('maps contract checks from GoPlus data', () => {
    const r = byId(
      computeRiskIndicators({
        pairs: [pair()],
        security: { chainId: 'ethereum', address: '0xa', isOpenSource: false, isProxy: false, isMintable: false, isHoneypot: false, buyTaxPct: 0, sellTaxPct: 25, holderCount: 10, top10Pct: 80, ownerAddress: null, fetchedAt: now },
        previousLiquidity: null,
        now
      })
    )
    expect(r.contract_verified).toBe('WARNING')
    expect(r.holder_concentration).toBe('WARNING')
    expect(r.transfer_flags).toBe('WARNING')
  })
})
