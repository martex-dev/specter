import { describe, expect, it } from 'vitest'
import { evaluateAlert, type AlertRule, type Quote } from '@shared/modules/markets'

const quote = (patch: Partial<Quote> = {}): Quote => ({
  symbol: 'BTC',
  quote: 'USDT',
  pair: 'BTCUSDT',
  price: 100,
  open24h: 95,
  change24h: 5,
  changePct24h: 5.26,
  high24h: 101,
  low24h: 90,
  volume24h: 10,
  quoteVolume24h: 1000,
  source: 'binance',
  ts: 0,
  fetchedAt: 0,
  ...patch
})

const rule = (patch: Partial<AlertRule> = {}): AlertRule => ({ id: 'a', symbol: 'BTC', kind: 'price_above', threshold: 99, enabled: true, repeat: false, cooldownMin: 60, createdAt: 0, lastTriggeredAt: null, triggerCount: 0, ...patch })

describe('evaluateAlert', () => {
  it('fires price above / below at the threshold', () => {
    expect(evaluateAlert(rule(), quote(), 0).fire).toBe(true)
    expect(evaluateAlert(rule({ threshold: 100 }), quote(), 0).fire).toBe(true)
    expect(evaluateAlert(rule({ threshold: 101 }), quote(), 0).fire).toBe(false)
    expect(evaluateAlert(rule({ kind: 'price_below', threshold: 100 }), quote(), 0).fire).toBe(true)
    expect(evaluateAlert(rule({ kind: 'price_below', threshold: 99 }), quote(), 0).fire).toBe(false)
  })
  it('fires on 24h % change and volume', () => {
    expect(evaluateAlert(rule({ kind: 'change_above', threshold: 5 }), quote(), 0).fire).toBe(true)
    expect(evaluateAlert(rule({ kind: 'change_below', threshold: -3 }), quote({ changePct24h: -4 }), 0).fire).toBe(true)
    expect(evaluateAlert(rule({ kind: 'volume_above', threshold: 999 }), quote(), 0).fire).toBe(true)
  })
  it('never fires on unknown values', () => {
    expect(evaluateAlert(rule({ kind: 'volume_above', threshold: 1 }), quote({ quoteVolume24h: null }), 0).fire).toBe(false)
    expect(evaluateAlert(rule({ kind: 'change_above', threshold: 1 }), quote({ changePct24h: null }), 0).fire).toBe(false)
  })
  it('ignores disabled rules and other symbols', () => {
    expect(evaluateAlert(rule({ enabled: false }), quote(), 0).fire).toBe(false)
    expect(evaluateAlert(rule({ symbol: 'ETH' }), quote(), 0).fire).toBe(false)
  })
  it('one-shot rules fire once', () => {
    expect(evaluateAlert(rule({ lastTriggeredAt: 1 }), quote(), 10_000_000).fire).toBe(false)
  })
  it('repeating rules respect the cooldown', () => {
    const r = rule({ repeat: true, cooldownMin: 10, lastTriggeredAt: 0 })
    expect(evaluateAlert(r, quote(), 9 * 60_000).fire).toBe(false)
    expect(evaluateAlert(r, quote(), 10 * 60_000).fire).toBe(true)
  })
  it('builds a message with source and quote currency', () => {
    const m = evaluateAlert(rule(), quote(), 0).message!
    expect(m).toContain('BTC')
    expect(m).toContain('USDT')
    expect(m).toContain('Binance')
  })
})
