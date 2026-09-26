// Chart wrappers over TradingView Lightweight Charts™ (Apache-2.0,
// https://www.tradingview.com/lightweight-charts/). The library's attribution
// logo is kept enabled as its license notice requests.
import { useEffect, useRef, useState } from 'react'
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type UTCTimestamp
} from 'lightweight-charts'
import type { Candle } from '@shared/modules/markets'
import { newTab } from '../../stores/browser'
import { px, qty } from './ui'

export type ChartKind = 'candles' | 'line' | 'area'

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (!m) return color
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

function baseOptions() {
  const fg = cssVar('--fg-2', '#7d8391')
  const line = 'rgba(255,255,255,0.05)'
  return {
    autoSize: true,
    layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: fg, fontFamily: cssVar('--font-mono', 'Consolas, monospace'), fontSize: 11, attributionLogo: true },
    grid: { vertLines: { color: line }, horzLines: { color: line } },
    rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
    timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false },
    crosshair: { mode: CrosshairMode.Normal, vertLine: { color: 'rgba(255,255,255,0.25)', labelBackgroundColor: cssVar('--bg-4', '#2a2f39') }, horzLine: { color: 'rgba(255,255,255,0.25)', labelBackgroundColor: cssVar('--bg-4', '#2a2f39') } },
    localization: { priceFormatter: (p: number) => px(p) }
  }
}

/**
 * Intraday bars are labelled in local time; daily / weekly bars open at 00:00
 * UTC and stand for a UTC calendar day, so they keep their UTC date (in a
 * negative-offset timezone local time would show the previous day).
 */
function timeLabel(sec: number, utcDates: boolean): string {
  const d = new Date(sec * 1000)
  return utcDates ? d.toLocaleDateString([], { timeZone: 'UTC', year: 'numeric', month: 'short', day: '2-digit' }) : d.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function localTickMark(time: Time, type: TickMarkType): string | null {
  if (typeof time !== 'number') return null
  const d = new Date(time * 1000)
  switch (type) {
    case TickMarkType.Year:
      return String(d.getFullYear())
    case TickMarkType.Month:
      return d.toLocaleDateString([], { month: 'short' })
    case TickMarkType.DayOfMonth:
      return String(d.getDate())
    case TickMarkType.Time:
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    default:
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }
}

interface Legend {
  time: number
  o: number
  h: number
  l: number
  c: number
  v: number | null
}

/** Price chart: candlesticks / line / area + optional volume histogram, zoom, pan and crosshair. */
export function PriceChart({ candles, kind, showVolume, height = 420, resetKey, utcDates = false }: { candles: Candle[]; kind: ChartKind; showVolume: boolean; height?: number; resetKey: string; utcDates?: boolean }) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const main = useRef<ISeriesApi<SeriesType> | null>(null)
  const vol = useRef<ISeriesApi<'Histogram'> | null>(null)
  const byTime = useRef(new Map<number, Candle>())
  const lastKey = useRef('')
  const [legend, setLegend] = useState<Legend | null>(null)

  // Create chart once.
  useEffect(() => {
    if (!el.current) return
    const c = createChart(el.current, baseOptions())
    chart.current = c
    const onMove = (p: MouseEventParams<Time>) => {
      const t = typeof p.time === 'number' ? p.time : null
      const k = t !== null ? byTime.current.get(t) : undefined
      setLegend(k ? { time: k.time, o: k.open, h: k.high, l: k.low, c: k.close, v: k.volume } : null)
    }
    c.subscribeCrosshairMove(onMove)
    return () => {
      c.unsubscribeCrosshairMove(onMove)
      c.remove()
      chart.current = null
      main.current = null
      vol.current = null
    }
  }, [])

  // Axis and crosshair labels use the same clock as the OHLC legend (the library defaults to UTC).
  useEffect(() => {
    chart.current?.applyOptions({
      localization: { timeFormatter: (t: Time) => (typeof t === 'number' ? timeLabel(t, utcDates) : String(t)) },
      timeScale: { tickMarkFormatter: (t: Time, type: TickMarkType) => (utcDates ? null : localTickMark(t, type)) }
    })
  }, [utcDates])

  // (Re)build series when the kind or volume toggle changes.
  useEffect(() => {
    const c = chart.current
    if (!c) return
    if (main.current) c.removeSeries(main.current)
    if (vol.current) c.removeSeries(vol.current)
    main.current = null
    vol.current = null
    const up = cssVar('--up', '#3fcf8e')
    const down = cssVar('--down', '#f0616d')
    const accent = cssVar('--accent', '#a3b1ff')
    const priceFormat = { type: 'custom' as const, formatter: (p: number) => px(p), minMove: 1e-8 }
    if (kind === 'candles') main.current = c.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceFormat })
    else if (kind === 'line') main.current = c.addSeries(LineSeries, { color: accent, lineWidth: 2, priceFormat })
    else main.current = c.addSeries(AreaSeries, { lineColor: accent, topColor: withAlpha(accent, 0.28), bottomColor: withAlpha(accent, 0.02), lineWidth: 2, priceFormat })
    main.current.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: showVolume ? 0.26 : 0.08 } })
    if (showVolume) {
      vol.current = c.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false })
      vol.current.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
    }
    lastKey.current = ''
  }, [kind, showVolume])

  // Push data.
  useEffect(() => {
    const s = main.current
    if (!s) return
    const up = withAlpha(cssVar('--up', '#3fcf8e'), 0.45)
    const down = withAlpha(cssVar('--down', '#f0616d'), 0.45)
    byTime.current = new Map(candles.map((k) => [k.time, k]))
    const t = (k: Candle) => k.time as UTCTimestamp
    if (kind === 'candles') (s as ISeriesApi<'Candlestick'>).setData(candles.map((k) => ({ time: t(k), open: k.open, high: k.high, low: k.low, close: k.close })))
    else (s as ISeriesApi<'Line'>).setData(candles.map((k) => ({ time: t(k), value: k.close })))
    vol.current?.setData(candles.filter((k) => k.volume !== null).map((k) => ({ time: t(k), value: k.volume as number, color: k.close >= k.open ? up : down })))
    const key = resetKey + '|' + kind + '|' + showVolume
    if (key !== lastKey.current && candles.length) {
      lastKey.current = key
      const n = candles.length
      chart.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 150), to: n + 4 })
    }
  }, [candles, kind, showVolume, resetKey])

  const last = candles[candles.length - 1]
  const lg = legend ?? (last ? { time: last.time, o: last.open, h: last.high, l: last.low, c: last.close, v: last.volume } : null)
  return (
    <div className="mk-chart" style={{ height }}>
      <div ref={el} className="mk-chart-canvas" />
      {lg && (
        <div className="mk-legend mono num">
          <span className="dim">{timeLabel(lg.time, utcDates)}</span>
          <span>
            O <b>{px(lg.o)}</b>
          </span>
          <span>
            H <b>{px(lg.h)}</b>
          </span>
          <span>
            L <b>{px(lg.l)}</b>
          </span>
          <span>
            C <b className={lg.c >= lg.o ? 'up' : 'down'}>{px(lg.c)}</b>
          </span>
          {lg.v !== null && (
            <span>
              V <b>{qty(lg.v)}</b>
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/** Simple line chart for a value series (e.g. paper-trading equity). */
export function LineChart({ points, height = 180, color }: { points: { time: number; value: number }[]; height?: number; color?: string }) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const series = useRef<ISeriesApi<'Area'> | null>(null)
  useEffect(() => {
    if (!el.current) return
    const c = createChart(el.current, { ...baseOptions(), handleScroll: false, handleScale: false })
    const accent = color ?? cssVar('--accent', '#a3b1ff')
    series.current = c.addSeries(AreaSeries, { lineColor: accent, topColor: withAlpha(accent, 0.22), bottomColor: withAlpha(accent, 0.01), lineWidth: 2, priceFormat: { type: 'custom', formatter: (p: number) => px(p), minMove: 0.01 } })
    chart.current = c
    return () => {
      c.remove()
      chart.current = null
      series.current = null
    }
  }, [color])
  useEffect(() => {
    // Times must be unique and ascending.
    const seen = new Map<number, number>()
    for (const p of points) seen.set(Math.floor(p.time), p.value)
    const data = [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time: time as UTCTimestamp, value }))
    series.current?.setData(data)
    chart.current?.timeScale().fitContent()
  }, [points])
  return (
    <div className="mk-chart" style={{ height }}>
      <div ref={el} className="mk-chart-canvas" />
    </div>
  )
}

export function ChartAttribution() {
  return (
    <button className="mk-attrib mono" onClick={() => newTab('https://www.tradingview.com/lightweight-charts/')} data-tip="Charts rendered with TradingView Lightweight Charts™ — open source, Apache License 2.0. Opens tradingview.com in a new tab.">
      Charts: TradingView Lightweight Charts™ · Apache-2.0
    </button>
  )
}
