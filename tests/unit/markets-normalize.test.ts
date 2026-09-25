import { describe, expect, it } from 'vitest'
import {
  aggregateCandles,
  normalizeBinanceKlines,
  normalizeBinanceMiniTicker,
  normalizeBinanceTicker,
  normalizeCoinbaseCandles,
  normalizeCoinbaseStats,
  normalizeCoinGeckoCoin,
  normalizeCoinGeckoMarket,
  normalizeCoinGeckoOhlc,
  normalizeDexPairs,
  normalizeGoPlus,
  normalizePremiumIndex,
  pickCoinGeckoSearch
} from '../../src/main/modules/markets/normalize'

describe('Binance normalizers', () => {
  it('maps a 24h ticker', () => {
    const q = normalizeBinanceTicker(
      { symbol: 'BTCUSDT', lastPrice: '83956.78', openPrice: '84513.90', priceChange: '-557.12', priceChangePercent: '-0.659', highPrice: '85255', lowPrice: '83183', volume: '18787.83', quoteVolume: '1582670930.11', closeTime: 1000 },
      'BTC',
      'USDT',
      2000
    )!
    expect(q.symbol).toBe('BTC')
    expect(q.pair).toBe('BTCUSDT')
    expect(q.price).toBeCloseTo(83956.78)
    expect(q.changePct24h).toBeCloseTo(-0.659)
    expect(q.quoteVolume24h).toBeCloseTo(1582670930.11)
    expect(q.source).toBe('binance')
    expect(q.ts).toBe(1000)
  })
  it('rejects missing or zero prices instead of inventing one', () => {
    expect(normalizeBinanceTicker({ symbol: 'X', lastPrice: '', openPrice: '1', priceChange: '0', priceChangePercent: '0', highPrice: '1', lowPrice: '1', volume: '0', quoteVolume: '0', closeTime: 0 }, 'X', 'USDT', 1)).toBeNull()
    expect(normalizeBinanceTicker({ symbol: 'X', lastPrice: '0', openPrice: '1', priceChange: '0', priceChangePercent: '0', highPrice: '1', lowPrice: '1', volume: '0', quoteVolume: '0', closeTime: 0 }, 'X', 'USDT', 1)).toBeNull()
  })
  it('maps a mini ticker and computes change from open', () => {
    const q = normalizeBinanceMiniTicker({ e: '24hrMiniTicker', E: 555, s: 'ETHUSDT', c: '110', o: '100', h: '120', l: '90', v: '5', q: '550' }, 'ETH', 'USDT', 600)!
    expect(q.change24h).toBeCloseTo(10)
    expect(q.changePct24h).toBeCloseTo(10)
    expect(q.live).toBe(true)
    expect(q.ts).toBe(555)
  })
  it('parses klines into ascending second-based candles', () => {
    const c = normalizeBinanceKlines([
      [1790359200000, '2', '3', '1', '2.5', '10', 0],
      [1790355600000, '1', '2', '0.5', '2', '5', 0],
      [1790362800000, 'bad', '3', '1', '2', '1', 0]
    ])
    expect(c).toHaveLength(2)
    expect(c[0].time).toBe(1790355600)
    expect(c[1]).toEqual({ time: 1790359200, open: 2, high: 3, low: 1, close: 2.5, volume: 10 })
  })
  it('indexes premiumIndex by symbol', () => {
    const m = normalizePremiumIndex([{ symbol: 'BTCUSDT', lastFundingRate: '0.00005012', nextFundingTime: 1, markPrice: '83919.3', time: 2 }])
    expect(m.get('BTCUSDT')?.fundingRate).toBeCloseTo(0.00005012)
  })
})

describe('Coinbase normalizers', () => {
  it('maps /stats and leaves quote volume unknown', () => {
    const q = normalizeCoinbaseStats({ open: '100', high: '120', low: '90', last: '105', volume: '42' }, 'BTC', 'USD', 'BTC-USD', 99)!
    expect(q.changePct24h).toBeCloseTo(5)
    expect(q.volume24h).toBe(42)
    expect(q.quoteVolume24h).toBeNull()
    expect(q.pair).toBe('BTC-USD')
    expect(q.ts).toBe(99)
  })
  it('reorders candle columns [time, low, high, open, close, volume]', () => {
    const c = normalizeCoinbaseCandles([
      [7200, 1, 4, 2, 3, 10],
      [3600, 0.5, 2, 1, 2, 5]
    ])
    expect(c[0]).toEqual({ time: 3600, open: 1, high: 2, low: 0.5, close: 2, volume: 5 })
    expect(c[1].open).toBe(2)
  })
})

describe('aggregateCandles', () => {
  const hourly = Array.from({ length: 10 }, (_, i) => ({ time: 4 * 3600 * 100 + 3600 * (i + 2), open: i, high: i + 1, low: i - 1, close: i + 0.5, volume: 1 }))
  it('builds 4h buckets and drops the partial first bucket', () => {
    const out = aggregateCandles(hourly, 4 * 3600)
    // hours 2,3 (partial) dropped; 4-7, 8-11 remain
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ time: 4 * 3600 * 101, open: 2, high: 6, low: 1, close: 5.5, volume: 4 })
    expect(out[1].volume).toBe(4)
  })
  it('aligns weekly buckets to Monday 00:00 UTC', () => {
    const monday = Date.UTC(2026, 8, 21) / 1000 // Mon 21 Sep 2026
    const daily = Array.from({ length: 9 }, (_, i) => ({ time: monday - 86400 + i * 86400, open: i, high: i, low: i, close: i, volume: 1 }))
    const out = aggregateCandles(daily, 604800, true)
    expect(out[0].time).toBe(monday)
    expect(new Date(out[0].time * 1000).getUTCDay()).toBe(1)
    expect(out[0].volume).toBe(7)
  })
})

describe('CoinGecko normalizers', () => {
  it('maps /coins/markets with market cap and derived open', () => {
    const q = normalizeCoinGeckoMarket(
      { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 100, market_cap: 2000, total_volume: 50, high_24h: 110, low_24h: 90, price_change_24h: -10, price_change_percentage_24h: -9.09, last_updated: '2026-09-25T18:57:00.000Z' },
      'BTC',
      'USD',
      1
    )!
    expect(q.open24h).toBe(110)
    expect(q.marketCap).toBe(2000)
    expect(q.volume24h).toBeNull()
    expect(q.quoteVolume24h).toBe(50)
    expect(q.ts).toBe(Date.parse('2026-09-25T18:57:00.000Z'))
  })
  it('parses OHLC without volume and de-duplicates timestamps', () => {
    const c = normalizeCoinGeckoOhlc([
      [2000, 1, 2, 0.5, 1.5],
      [1000, 1, 2, 0.5, 1.5],
      [2000, 9, 9, 9, 9]
    ])
    expect(c.map((x) => x.time)).toEqual([1, 2])
    expect(c[0].volume).toBeNull()
  })
  it('picks the highest-ranked exact symbol match', () => {
    expect(
      pickCoinGeckoSearch(
        [
          { id: 'pepe-2', symbol: 'PEPE', market_cap_rank: 900 },
          { id: 'pepe', symbol: 'PEPE', market_cap_rank: 54 },
          { id: 'pepecoin', symbol: 'PEPECOIN', market_cap_rank: 5 }
        ],
        'pepe'
      )
    ).toBe('pepe')
    expect(pickCoinGeckoSearch([{ id: 'x', symbol: 'XYZ', market_cap_rank: 1 }], 'ABC')).toBeNull()
  })
  it('maps a coin document', () => {
    const c = normalizeCoinGeckoCoin({
      id: 'pepe',
      symbol: 'pepe',
      name: 'Pepe',
      platforms: { ethereum: '0xabc', '': '' },
      links: { homepage: ['https://www.pepe.vip/', ''], blockchain_site: ['https://etherscan.io/token/0xabc', 'https://x/<api_symbol>'] },
      market_data: { current_price: { usd: 0.0000044 }, market_cap: { usd: 1850000000 }, total_volume: { usd: 3e8 } },
      market_cap_rank: 54
    })
    expect(c.symbol).toBe('PEPE')
    expect(c.platforms).toEqual([{ chain: 'ethereum', address: '0xabc' }])
    expect(c.explorers).toEqual(['https://etherscan.io/token/0xabc'])
    expect(c.marketCap).toBe(1850000000)
    expect(c.fdv).toBeNull()
  })
})

describe('DexScreener & GoPlus normalizers', () => {
  it('sorts pairs by liquidity and keeps unknowns as null', () => {
    const pairs = normalizeDexPairs({
      pairs: [
        { chainId: 'ethereum', dexId: 'uniswap', pairAddress: '0x1', baseToken: { symbol: 'PEPE', address: '0xa' }, quoteToken: { symbol: 'WETH' }, liquidity: { usd: 10 }, url: 'https://dexscreener.com/x' },
        { chainId: 'ethereum', dexId: 'uniswap', pairAddress: '0x2', baseToken: { symbol: 'PEPE', address: '0xa' }, quoteToken: { symbol: 'USDC' }, liquidity: { usd: 1000 }, txns: { h24: { buys: 5, sells: 3 } }, pairCreatedAt: 1681492871000 },
        { nope: true }
      ]
    })
    expect(pairs.map((p) => p.pairAddress)).toEqual(['0x2', '0x1'])
    expect(pairs[0].buys24h).toBe(5)
    expect(pairs[1].volume24h).toBeNull()
    expect(pairs[1].pairCreatedAt).toBeNull()
  })
  it('computes top-10 concentration excluding burn and locked holders', () => {
    const s = normalizeGoPlus(
      {
        code: 1,
        result: {
          '0xabc': {
            is_open_source: '1',
            is_honeypot: '0',
            buy_tax: '0',
            sell_tax: '0.05',
            holder_count: '1234',
            holders: [
              { address: '0x000000000000000000000000000000000000dead', percent: '0.5', is_locked: 0 },
              { address: '0x1', percent: '0.1', is_locked: 0 },
              { address: '0x2', percent: '0.2', is_locked: 1 },
              { address: '0x3', percent: '0.05', is_locked: 0 }
            ]
          }
        }
      },
      'ethereum',
      '0xABC',
      1
    )!
    expect(s.isOpenSource).toBe(true)
    expect(s.top10Pct).toBeCloseTo(15)
    expect(s.sellTaxPct).toBeCloseTo(5)
    expect(s.holderCount).toBe(1234)
    expect(s.isProxy).toBeNull()
  })
})
