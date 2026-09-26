import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, Maximize2, X } from 'lucide-react'
import type { SplitLayout } from '@shared/types'
import { internalRoute, isInternal } from '@shared/url'
import { invoke } from '../lib/ipc'
import { wcIdFor } from '../lib/webviews'
import { activateTab, closeTab, setLayout, setPaneSizes, swapPanes, updateTab, useBrowser, visibleTabIds, type RuntimeTab } from '../stores/browser'
import { useUi } from '../stores/ui'
import { Favicon } from '../components/ui'
import { getPage } from '../pages/registry'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { WebviewTab } from './WebviewTab'
import { FindBar } from './FindBar'
const ReaderView = lazy(() => import('./ReaderView').then((m) => ({ default: m.ReaderView })))
import { CrashPage, ErrorPage, PaneBars, SuspendedPage } from './PaneBars'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const PAD = 6
const GAP = 6

const PRESET_TRACKS: Record<string, { dir: 'cols' | 'rows' | 'grid'; fr: number[] }> = {
  '50/50': { dir: 'cols', fr: [1, 1] },
  '33/67': { dir: 'cols', fr: [1, 2] },
  '67/33': { dir: 'cols', fr: [2, 1] },
  '25/75': { dir: 'cols', fr: [1, 3] },
  'rows-50/50': { dir: 'rows', fr: [1, 1] },
  'three-column': { dir: 'cols', fr: [1, 1, 1] },
  'four-panel': { dir: 'cols', fr: [1, 1, 1, 1] },
  quadrant: { dir: 'grid', fr: [0.5, 0.5] }
}

function normalize(fr: number[]): number[] {
  const sum = fr.reduce((a, b) => a + b, 0) || 1
  return fr.map((f) => f / sum)
}

export function computeRects(layout: SplitLayout, W: number, H: number): { rects: Rect[]; splitters: { dir: 'v' | 'h'; pos: number; index: number; x: number; y: number; len: number }[] } {
  const track = PRESET_TRACKS[layout.preset]
  if (!track || layout.panes.length < 2) return { rects: [{ x: 0, y: 0, w: W, h: H }], splitters: [] }
  if (track.dir === 'grid') {
    const c = layout.sizes?.[0] ?? 0.5
    const r = layout.sizes?.[1] ?? 0.5
    const iw = W - PAD * 2 - GAP
    const ih = H - PAD * 2 - GAP
    const w0 = iw * c
    const h0 = ih * r
    const rects = [
      { x: PAD, y: PAD, w: w0, h: h0 },
      { x: PAD + w0 + GAP, y: PAD, w: iw - w0, h: h0 },
      { x: PAD, y: PAD + h0 + GAP, w: w0, h: ih - h0 },
      { x: PAD + w0 + GAP, y: PAD + h0 + GAP, w: iw - w0, h: ih - h0 }
    ]
    return {
      rects,
      splitters: [
        { dir: 'v', pos: PAD + w0 + GAP / 2, index: 0, x: PAD + w0 + GAP / 2, y: PAD, len: H - PAD * 2 },
        { dir: 'h', pos: PAD + h0 + GAP / 2, index: 1, x: PAD, y: PAD + h0 + GAP / 2, len: W - PAD * 2 }
      ]
    }
  }
  const fr = normalize(layout.sizes && layout.sizes.length === track.fr.length ? layout.sizes : track.fr)
  const n = fr.length
  const along = track.dir === 'cols' ? W : H
  const across = track.dir === 'cols' ? H : W
  const inner = along - PAD * 2 - GAP * (n - 1)
  const rects: Rect[] = []
  const splitters: ReturnType<typeof computeRects>['splitters'] = []
  let cursor = PAD
  fr.forEach((f, i) => {
    const size = inner * f
    rects.push(track.dir === 'cols' ? { x: cursor, y: PAD, w: size, h: across - PAD * 2 } : { x: PAD, y: cursor, w: across - PAD * 2, h: size })
    cursor += size
    if (i < n - 1) {
      const pos = cursor + GAP / 2
      splitters.push(track.dir === 'cols' ? { dir: 'v', pos, index: i, x: pos, y: PAD, len: H - PAD * 2 } : { dir: 'h', pos, index: i, x: PAD, y: pos, len: W - PAD * 2 })
      cursor += GAP
    }
  })
  return { rects, splitters }
}

export function ContentArea() {
  const state = useBrowser()
  const viewportRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [dragging, setDragging] = useState<number | null>(null)
  const findOpen = useUi((s) => s.findOpen)

  useLayoutEffect(() => {
    const el = viewportRef.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const ws = state.open[state.activeWsId]
  const visible = visibleTabIds(ws)
  const split = !!ws && ws.layout.preset !== 'single' && ws.layout.panes.length > 1
  const { rects, splitters } = useMemo(() => (ws ? computeRects(ws.layout, size.w, size.h) : { rects: [], splitters: [] }), [ws, size.w, size.h])
  const rectFor = (tabId: string): Rect | null => {
    const i = visible.indexOf(tabId)
    return i >= 0 ? (rects[i] ?? null) : null
  }

  // Every live web tab across this window's workspaces, in a STABLE order so
  // React never moves (and thereby reloads) a webview element.
  const liveTabs = useMemo(() => {
    const out: RuntimeTab[] = []
    for (const w of Object.values(state.open)) for (const t of w.tabs) if (!t.suspended && !isInternal(t.url) && !t.crashed) out.push(t)
    return out.sort((a, b) => (a.id < b.id ? -1 : 1))
  }, [state.open])

  const partition = state.profile?.partition ?? 'persist:specter-default'

  const startDrag = useCallback(
    (index: number, dir: 'v' | 'h', e: React.MouseEvent) => {
      if (!ws) return
      e.preventDefault()
      setDragging(index)
      const el = viewportRef.current!
      const box = el.getBoundingClientRect()
      const track = PRESET_TRACKS[ws.layout.preset]
      const move = (ev: MouseEvent) => {
        if (track.dir === 'grid') {
          const sizes = [...(ws.layout.sizes ?? [0.5, 0.5])]
          if (dir === 'v') sizes[0] = Math.min(0.85, Math.max(0.15, (ev.clientX - box.left - PAD) / (box.width - PAD * 2)))
          else sizes[1] = Math.min(0.85, Math.max(0.15, (ev.clientY - box.top - PAD) / (box.height - PAD * 2)))
          setPaneSizes(sizes)
          return
        }
        const fr = normalize(ws.layout.sizes && ws.layout.sizes.length === track.fr.length ? ws.layout.sizes : track.fr)
        const total = (dir === 'v' ? box.width : box.height) - PAD * 2
        const p = ((dir === 'v' ? ev.clientX - box.left : ev.clientY - box.top) - PAD) / total
        const before = fr.slice(0, index).reduce((a, b) => a + b, 0)
        const pair = fr[index] + fr[index + 1]
        const a = Math.min(pair - 0.08, Math.max(0.08, p - before))
        fr[index] = a
        fr[index + 1] = pair - a
        setPaneSizes(fr)
      }
      const up = () => {
        setDragging(null)
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [ws]
  )

  if (!ws) return <div className="viewport" ref={viewportRef} />

  const visibleOther = visible.map((id) => ws.tabs.find((t) => t.id === id)).filter((t): t is RuntimeTab => !!t && (isInternal(t.url) || t.suspended || !!t.crashed))

  return (
    <div className="viewport" ref={viewportRef}>
      {liveTabs.map((t) => {
        const rect = rectFor(t.id)
        return (
          <Pane
            key={t.id}
            tab={t}
            rect={rect}
            split={split}
            focused={t.id === ws.activeTabId}
            partition={partition}
            findOpen={!!findOpen[t.id]}
            paneIndex={visible.indexOf(t.id)}
            paneCount={visible.length}
          />
        )
      })}
      {visibleOther.map((t) => (
        <Pane key={'x' + t.id} tab={t} rect={rectFor(t.id)} split={split} focused={t.id === ws.activeTabId} partition={partition} findOpen={false} paneIndex={visible.indexOf(t.id)} paneCount={visible.length} />
      ))}
      {split &&
        splitters.map((s, i) => (
          <div
            key={i}
            className={`splitter ${s.dir}${dragging === i ? ' active' : ''}`}
            style={s.dir === 'v' ? { left: s.x, top: s.y, height: s.len } : { top: s.y, left: s.x, width: s.len }}
            onMouseDown={(e) => startDrag(s.index, s.dir, e)}
            onDoubleClick={() => setPaneSizes([])}
          />
        ))}
      {dragging !== null && <div className="drag-shield" style={{ cursor: splitters[dragging]?.dir === 'v' ? 'col-resize' : 'row-resize' }} />}
    </div>
  )
}

interface PaneProps {
  tab: RuntimeTab
  rect: Rect | null
  split: boolean
  focused: boolean
  partition: string
  findOpen: boolean
  paneIndex: number
  paneCount: number
}

const Pane = memo(function Pane({ tab, rect, split, focused, partition, findOpen, paneIndex, paneCount }: PaneProps) {
  const internal = isInternal(tab.url)
  const visible = !!rect
  const style: React.CSSProperties = rect ? { left: rect.x, top: rect.y, width: rect.w, height: rect.h } : { display: 'none' }
  return (
    <div className={'pane' + (split ? ' split' : '') + (focused ? ' focused' : '')} style={style} onMouseDown={() => !focused && split && activateTab(tab.id)}>
      {split && visible && (
        <div className="pane-header">
          <Favicon src={tab.favicon} url={tab.url} size={13} />
          <span className="ellipsis grow">{tab.title}</span>
          {paneIndex > 0 && (
            <button className="icon-btn sm" onClick={() => swapPanes(paneIndex, paneIndex - 1)} data-tip="Swap with previous pane" aria-label="Swap pane">
              <ArrowLeftRight size={12} />
            </button>
          )}
          <button
            className="icon-btn sm"
            onClick={() => {
              activateTab(tab.id)
              setLayout('single')
            }}
            data-tip="Maximize pane (exit split)"
            aria-label="Maximize pane"
          >
            <Maximize2 size={12} />
          </button>
          <button
            className="icon-btn sm"
            onClick={() => {
              const cur = useBrowser.getState().open[useBrowser.getState().activeWsId]
              const panes = cur?.layout.panes.filter((p) => p !== tab.id) ?? []
              // setLayout keeps the focused tab on screen, so move focus off the removed pane first.
              if (cur?.activeTabId === tab.id && panes.length) activateTab(panes[0])
              if (panes.length < 2) setLayout('single')
              else setLayout(paneCount - 1 === 3 ? 'three-column' : '50/50', panes)
            }}
            data-tip="Remove from split"
            aria-label="Remove from split"
          >
            <X size={12} />
          </button>
        </div>
      )}
      {visible && !internal && <PaneBars tab={tab} />}
      <div className={'pane-body' + (internal ? ' internal' : '')}>
        {internal ? (
          visible && <InternalPane tab={tab} />
        ) : tab.crashed ? (
          <CrashPage tab={tab} />
        ) : tab.suspended ? (
          visible && <SuspendedPage tab={tab} />
        ) : (
          <>
            <WebviewTab tabId={tab.id} initialUrl={tab.url} partition={partition} visible={visible} />
            {tab.error && !tab.loading && <ErrorPage tab={tab} />}
            {tab.reader && visible && (
              <Suspense fallback={null}>
                <ReaderView tabId={tab.id} />
              </Suspense>
            )}
            {findOpen && visible && <FindBar tabId={tab.id} />}
          </>
        )}
      </div>
      {tab.devtoolsDocked && !internal && !tab.suspended && <DevtoolsDock tabId={tab.id} visible={visible} />}
    </div>
  )
})

function InternalPane({ tab }: { tab: RuntimeTab }) {
  // Stable per URL: pages key effects on `query`, which must not change on every tab update
  // (title, loading, lastActive…).
  const route = useMemo(() => internalRoute(tab.url), [tab.url])
  const page = getPage(route.page)
  if (!page) {
    return (
      <div className="error-page">
        <h2>Unknown SPECTER page</h2>
        <code>{tab.url}</code>
        <button className="btn" onClick={() => closeTab(tab.id)}>
          Close tab
        </button>
      </div>
    )
  }
  const C = page.component
  return (
    <Suspense fallback={<div className="empty">Loading…</div>}>
      <div style={{ position: 'absolute', inset: 0, overflow: 'auto' }} className="internal-page">
        <ErrorBoundary name={page.title} key={tab.url}>
          <C tabId={tab.id} url={tab.url} sub={route.sub} query={route.query} />
        </ErrorBoundary>
      </div>
    </Suspense>
  )
}

function DevtoolsDock({ tabId, visible }: { tabId: string; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const height = useUi((s) => s.devtoolsDockHeight)
  const opened = useRef(false)

  useEffect(() => {
    let raf = 0
    const report = () => {
      const wcId = wcIdFor(tabId)
      const el = ref.current
      if (wcId === null || !el) return
      const r = el.getBoundingClientRect()
      const b = { x: r.left, y: r.top, width: r.width, height: r.height }
      if (!opened.current) {
        opened.current = true
        invoke('guest:dockDevtools', wcId, b).catch(() => updateTab(tabId, { devtoolsDocked: false }))
      } else invoke('guest:devtoolsBounds', wcId, visible && r.width > 0 ? b : null).catch(() => undefined)
    }
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(report)
    })
    if (ref.current) ro.observe(ref.current)
    const onReady = (e: Event) => (e as CustomEvent<{ tabId: string }>).detail?.tabId === tabId && report()
    window.addEventListener('resize', report)
    window.addEventListener('specter:webview-ready', onReady)
    report()
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', report)
      window.removeEventListener('specter:webview-ready', onReady)
      cancelAnimationFrame(raf)
    }
  }, [tabId, visible, height])

  useEffect(
    () => () => {
      const wcId = wcIdFor(tabId)
      if (wcId !== null) invoke('guest:closeDevtools', wcId).catch(() => undefined)
    },
    [tabId]
  )

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const start = height
    const move = (ev: MouseEvent) => useUi.setState({ devtoolsDockHeight: Math.max(120, Math.min(window.innerHeight - 200, start - (ev.clientY - startY))) })
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div style={{ height, flex: 'none', position: 'relative', borderTop: '1px solid var(--line-strong)', background: 'var(--bg-1)' }}>
      <div onMouseDown={startResize} style={{ position: 'absolute', top: -4, left: 0, right: 0, height: 8, cursor: 'row-resize', zIndex: 2 }} />
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
    </div>
  )
}
