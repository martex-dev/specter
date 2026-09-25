// Renderer-side metrics store. One IPC subscription per window, reference
// counted by the components that are actually mounted (HUD, panel, page,
// new-tab widget). When the last one unmounts the main-process poller stops.
import { useSyncExternalStore } from 'react'
import type { SystemMetrics, SystemStatus } from '@shared/modules/system'
import { invoke, on } from '../../lib/ipc'

export interface MetricsSnapshot {
  latest: SystemMetrics | null
  history: SystemMetrics[]
  status: SystemStatus | null
}

const HISTORY_MAX = 300
const CLIENT_ID = 'ui-' + Math.random().toString(36).slice(2, 10)

let snap: MetricsSnapshot = { latest: null, history: [], status: null }
const listeners = new Set<() => void>()
let refs = 0
let off: (() => void) | null = null
let releaseTimer: ReturnType<typeof setTimeout> | null = null
let statusTimer: ReturnType<typeof setInterval> | null = null

function emit(next: Partial<MetricsSnapshot>): void {
  snap = { ...snap, ...next }
  listeners.forEach((l) => l())
}

function push(m: SystemMetrics): void {
  const h = snap.history.length >= HISTORY_MAX ? snap.history.slice(1 - HISTORY_MAX) : snap.history.slice()
  h.push(m)
  emit({ latest: m, history: h })
}

function acquire(): void {
  refs++
  if (releaseTimer) {
    clearTimeout(releaseTimer)
    releaseTimer = null
  }
  if (off) return
  off = on('system:metrics', push)
  invoke('system:subscribe', CLIENT_ID)
    .then((status) => emit({ status }))
    .catch(() => undefined)
  // Seed charts with samples the main process already has (real, earlier samples).
  invoke('system:history')
    .then((h) => {
      if (!h.length) return
      const known = new Set(snap.history.map((x) => x.ts))
      const merged = [...h.filter((x) => !known.has(x.ts)), ...snap.history].sort((a, b) => a.ts - b.ts).slice(-HISTORY_MAX)
      emit({ history: merged, latest: snap.latest ?? merged[merged.length - 1] ?? null })
    })
    .catch(() => undefined)
  statusTimer = setInterval(() => {
    invoke('system:status')
      .then((status) => emit({ status }))
      .catch(() => undefined)
  }, 10_000)
}

function release(): void {
  refs = Math.max(0, refs - 1)
  if (refs > 0 || releaseTimer) return
  // Debounced so tab switches / StrictMode remounts don't restart the poller.
  releaseTimer = setTimeout(() => {
    releaseTimer = null
    if (refs > 0) return
    off?.()
    off = null
    if (statusTimer) clearInterval(statusTimer)
    statusTimer = null
    invoke('system:unsubscribe', CLIENT_ID).catch(() => undefined)
  }, 1500)
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  acquire()
  return () => {
    listeners.delete(l)
    release()
  }
}

const getSnap = () => snap

/** Subscribes this component to live metrics (starts the poller if needed). */
export function useMetrics(): MetricsSnapshot {
  return useSyncExternalStore(subscribe, getSnap)
}

export function refreshStatus(): void {
  invoke('system:status')
    .then((status) => emit({ status }))
    .catch(() => undefined)
}

// ---------------------------------------------------------------- helpers

/**
 * Headline CPU figure: Windows "% Processor Utility" when available (what
 * Task Manager shows — frequency-scaled, so higher than raw busy time on
 * turbo-boosting CPUs), otherwise processor time from os.cpus().
 */
export function cpuPct(m: SystemMetrics | null): number | null {
  if (!m) return null
  return m.cpu.utility?.total ?? m.cpu.total
}

export function perCorePct(m: SystemMetrics | null): { values: number[]; kind: 'utility' | 'time' } {
  if (!m) return { values: [], kind: 'time' }
  const u = m.cpu.utility?.perCore
  return u && u.length === m.cpu.perCore.length ? { values: u, kind: 'utility' } : { values: m.cpu.perCore, kind: 'time' }
}

export function memPct(m: SystemMetrics | null): number | null {
  return m && m.mem.total ? (m.mem.used / m.mem.total) * 100 : null
}

export function primaryGpu(m: SystemMetrics | null) {
  return m?.gpu?.[0] ?? null
}

export function fmtPct(v: number | null | undefined, digits = 0): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}%`
}

export function fmtRate(bps: number | null | undefined): string {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return '—'
  if (bps < 1024) return `${Math.round(bps)} B/s`
  const units = ['KB/s', 'MB/s', 'GB/s']
  let v = bps / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`
}

export function fmtGB(bytes: number | null | undefined, digits = 1): string {
  return bytes === null || bytes === undefined || !Number.isFinite(bytes) ? '—' : `${(bytes / 1073741824).toFixed(digits)} GB`
}

export const REASON_LABEL: Record<string, string> = {
  normal: 'configured interval',
  mode: 'slowed by performance mode',
  unfocused: 'slowed: SPECTER not focused',
  hidden: 'slowed: all windows minimised'
}

/** Level class for a utilisation percentage. */
export function level(p: number | null | undefined): '' | 'warn' | 'bad' {
  if (p === null || p === undefined) return ''
  return p >= 92 ? 'bad' : p >= 80 ? 'warn' : ''
}
