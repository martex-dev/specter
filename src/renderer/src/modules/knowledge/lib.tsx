// Shared renderer helpers for notes / research / knowledge.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { IpcEvent } from '@shared/ipc'
import type { MissionStep } from '@shared/modules/knowledge'
import { invoke, on } from '../../lib/ipc'
import { activateTab, activeTab, loadUrl, newTab, useBrowser } from '../../stores/browser'
import { toast } from '../../stores/ui'

export function currentWorkspaceId(): string | null {
  return useBrowser.getState().activeWsId || null
}

function hasBrowser(): boolean {
  const s = useBrowser.getState()
  return !!s.open[s.activeWsId]
}

/** Opens a web URL in a new tab (or the main window when called from a popout). */
export function openUrl(url: string, background = false): void {
  if (hasBrowser()) newTab(url, { background })
  else invoke('window:new', { url, focus: true }).catch(() => undefined)
}

/**
 * Opens an internal page, reusing an existing tab of the same page in the
 * active workspace. A bare page URL only focuses the existing tab.
 */
export function openInternal(url: string): void {
  if (!hasBrowser()) {
    invoke('window:new', { url, focus: true }).catch(() => toast({ kind: 'error', title: 'Could not open ' + url }))
    return
  }
  const s = useBrowser.getState()
  const ws = s.open[s.activeWsId]
  const page = url.slice('specter://'.length).split(/[/?#]/)[0]
  const bare = url.replace(/\/+$/, '') === 'specter://' + page
  const cur = activeTab()
  const existing = cur?.url.startsWith('specter://' + page) ? cur : ws?.tabs.find((t) => t.url === 'specter://' + page || t.url.startsWith('specter://' + page + '/') || t.url.startsWith('specter://' + page + '?'))
  if (existing) {
    activateTab(existing.id)
    if (!bare && existing.url !== url) loadUrl(existing.id, url)
    return
  }
  newTab(url)
}

/** Re-runs `fn` whenever one of the given IPC events fires (debounced). */
export function useIpcRefresh(events: IpcEvent[], fn: () => void, deps: unknown[] = []): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    let t: number | undefined
    const offs = events.map((ev) =>
      on(ev, () => {
        window.clearTimeout(t)
        t = window.setTimeout(() => ref.current(), 120)
      })
    )
    return () => {
      window.clearTimeout(t)
      offs.forEach((o) => o())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/** Async loader with refresh on IPC events. */
export function useLoad<T>(load: () => Promise<T>, events: IpcEvent[], deps: unknown[]): [T | undefined, () => void] {
  const [data, setData] = useState<T | undefined>(undefined)
  const seq = useRef(0)
  const run = () => {
    const n = ++seq.current
    load()
      .then((d) => n === seq.current && setData(d))
      .catch(() => n === seq.current && setData(undefined))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, deps)
  useIpcRefresh(events, run, deps)
  return [data, run]
}

/** Renders an FTS snippet with \u0001…\u0002 match markers as <mark>. */
export function Snippet({ text }: { text: string }): ReactNode {
  const parts = text.split(/(\u0001[^\u0002]*\u0002)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('\u0001') ? (
          <mark key={i} className="kn-mark">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <Fragment key={i}>{p.replace(/[\u0001\u0002]/g, '')}</Fragment>
        )
      )}
    </>
  )
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function fmtDay(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function slugFile(name: string, ext: string): string {
  return ((name || 'Untitled').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Untitled') + ext
}

/**
 * Mission checklist with optimistic updates: rapid clicks apply to the latest
 * local state instead of a stale server copy.
 */
export function useSteps(missionId: string | undefined, server: MissionStep[] | undefined): [MissionStep[], (fn: (s: MissionStep[]) => MissionStep[]) => void] {
  const [steps, setSteps] = useState<MissionStep[]>(server ?? [])
  const latest = useRef(steps)
  const pending = useRef(0)
  useEffect(() => {
    if (server && pending.current === 0) {
      latest.current = server
      setSteps(server)
    }
  }, [server])
  const update = (fn: (s: MissionStep[]) => MissionStep[]) => {
    if (!missionId) return
    const next = fn(latest.current)
    latest.current = next
    setSteps(next)
    pending.current++
    invoke('research:update', missionId, { steps: next })
      .catch(() => toast({ kind: 'error', title: 'Could not update checklist' }))
      .finally(() => pending.current--)
  }
  return [steps, update]
}
