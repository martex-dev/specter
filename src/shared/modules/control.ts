// GX-style Control — shared types, pure helpers and IPC contract augmentation.
//
// Everything here controls SPECTER's own resource usage (its processes, its
// tabs, its network session). Nothing touches other applications or the OS.

export type NetPresetId = 'off' | '1' | '5' | '10' | '25' | '50' | 'custom'
export type SoundThemeId = 'auto' | 'neon' | 'terminal' | 'glass' | 'paper'
export type SoundEvent = 'tabOpen' | 'tabClose' | 'notify' | 'click' | 'toggle'
export type WallpaperId = 'aurora' | 'grid' | 'stars' | 'topo' | 'waves'

export interface ControlConfig {
  ram: {
    enabled: boolean
    /** Limit for SPECTER's total private memory, MB. */
    limitMB: number
    /** Hard limit: act on the first sample above the limit and also sleep pinned / audible / recently used tabs. */
    hard: boolean
    excludePinned: boolean
    excludeAudible: boolean
  }
  net: {
    preset: NetPresetId
    /** Custom caps in megabits per second. */
    customDownMbps: number
    customUpMbps: number
    /** Added round-trip latency, ms (0 = none). */
    latencyMs: number
  }
  cpu: {
    enabled: boolean
    /** Chromium CPU throttling rate (2 = half speed, 4 = quarter speed…). */
    rate: number
  }
  sounds: {
    enabled: boolean
    theme: SoundThemeId
    /** 0..1 */
    volume: number
    autoMute: boolean
    tabs: boolean
    notifications: boolean
    clicks: boolean
  }
  wallpaper: {
    /** Darkening / lightening scrim over the wallpaper, 0..0.85. */
    dim: number
    animate: boolean
  }
}

export const DEFAULT_CONTROL_CONFIG: ControlConfig = {
  ram: { enabled: false, limitMB: 4096, hard: false, excludePinned: true, excludeAudible: true },
  net: { preset: 'off', customDownMbps: 15, customUpMbps: 5, latencyMs: 0 },
  cpu: { enabled: false, rate: 4 },
  sounds: { enabled: false, theme: 'auto', volume: 0.5, autoMute: true, tabs: true, notifications: true, clicks: false },
  wallpaper: { dim: 0.35, animate: true }
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

/** Merges a stored / patched config onto defaults, dropping unknown keys and wrong types. */
export function mergeControlConfig(base: ControlConfig, patch: unknown): ControlConfig {
  const out = structuredCloneSafe(base)
  if (!patch || typeof patch !== 'object') return out
  for (const section of Object.keys(out) as (keyof ControlConfig)[]) {
    const p = (patch as Record<string, unknown>)[section]
    if (!p || typeof p !== 'object') continue
    const target = out[section] as Record<string, unknown>
    for (const k of Object.keys(target)) {
      const v = (p as Record<string, unknown>)[k]
      if (v !== undefined && typeof v === typeof target[k]) target[k] = v
    }
  }
  return sanitizeControlConfig(out)
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo)

export const CPU_RATES = [2, 4, 6, 10, 20] as const
export const RAM_MIN_MB = 1024
export const RAM_STEP_MB = 256

export function sanitizeControlConfig(c: ControlConfig): ControlConfig {
  c.ram.limitMB = Math.round(clamp(c.ram.limitMB, RAM_MIN_MB, 1024 * 1024))
  if (!NET_PRESETS.some((p) => p.id === c.net.preset)) c.net.preset = 'off'
  c.net.customDownMbps = clamp(c.net.customDownMbps, 0.1, 10_000)
  c.net.customUpMbps = clamp(c.net.customUpMbps, 0.1, 10_000)
  c.net.latencyMs = Math.round(clamp(c.net.latencyMs, 0, 5000))
  c.cpu.rate = clamp(Math.round(c.cpu.rate), 2, 20)
  c.sounds.volume = clamp(c.sounds.volume, 0, 1)
  if (!['auto', 'neon', 'terminal', 'glass', 'paper'].includes(c.sounds.theme)) c.sounds.theme = 'auto'
  c.wallpaper.dim = clamp(c.wallpaper.dim, 0, 0.85)
  return c
}

/** Slider range for the RAM limit: 1 GB .. total physical memory, in RAM_STEP_MB steps. */
export function ramLimitRange(systemBytes: number, stepMB = RAM_STEP_MB): { min: number; max: number; step: number } {
  const totalMB = Math.floor(systemBytes / (1024 * 1024))
  const max = Math.max(RAM_MIN_MB, Math.floor(totalMB / stepMB) * stepMB)
  return { min: RAM_MIN_MB, max, step: stepMB }
}

export interface HeavyThresholds {
  memKB: number
  /** % of one core */
  cpu: number
}

export const HEAVY: HeavyThresholds = { memKB: 300 * 1024, cpu: 20 }

/** Background tabs worth putting to sleep ("hot tabs"): heavy on memory or CPU, heaviest first. */
export function heavyTabs<T extends { visible: boolean; memKB: number | null; cpu: number | null }>(tabs: T[], t: HeavyThresholds = HEAVY): T[] {
  return tabs.filter((x) => !x.visible && ((x.memKB ?? 0) >= t.memKB || (x.cpu ?? 0) >= t.cpu)).sort((a, b) => (b.memKB ?? 0) - (a.memKB ?? 0))
}

// ---------------------------------------------------------------- network presets

export const NET_PRESETS: { id: NetPresetId; label: string; mbps: number | null }[] = [
  { id: 'off', label: 'Off', mbps: null },
  { id: '1', label: '1 Mbps', mbps: 1 },
  { id: '5', label: '5 Mbps', mbps: 5 },
  { id: '10', label: '10 Mbps', mbps: 10 },
  { id: '25', label: '25 Mbps', mbps: 25 },
  { id: '50', label: '50 Mbps', mbps: 50 },
  { id: 'custom', label: 'Custom', mbps: null }
]

/** Megabits per second (decimal, as ISPs quote it) → bytes per second. */
export function mbpsToBytesPerSec(mbps: number): number {
  return Math.round((mbps * 1_000_000) / 8)
}

export interface NetEmulation {
  downloadThroughput: number
  uploadThroughput: number
  latency: number
}

/** Resolves the network config into Chromium emulation options, or null for "no cap". */
export function netEmulationFor(net: ControlConfig['net']): NetEmulation | null {
  if (net.preset === 'off') return null
  let down: number
  let up: number
  if (net.preset === 'custom') {
    down = net.customDownMbps
    up = net.customUpMbps
  } else {
    down = up = NET_PRESETS.find((p) => p.id === net.preset)?.mbps ?? 0
  }
  if (!(down > 0) || !(up > 0)) return null
  return { downloadThroughput: mbpsToBytesPerSec(down), uploadThroughput: mbpsToBytesPerSec(up), latency: Math.max(0, Math.round(net.latencyMs)) }
}

// ---------------------------------------------------------------- tabs / stats

/** What a window's renderer reports about each of its tabs. */
export interface TabReport {
  tabId: string
  wcId: number | null
  title: string
  url: string
  visible: boolean
  pinned: boolean
  audible: boolean
  suspended: boolean
  internal: boolean
  lastActive: number
}

export interface TabUsage {
  tabId: string
  title: string
  url: string
  visible: boolean
  pinned: boolean
  audible: boolean
  lastActive: number
  /** Private memory of processes used only by this tab, KB (null = not measurable). */
  memKB: number | null
  /** Private memory of renderer processes this tab shares with other tabs, KB. */
  sharedKB: number
  /** CPU of this tab's own processes, % of one core. */
  cpu: number | null
  pids: number[]
  /** Number of other tabs sharing at least one process with this tab. */
  sharedWith: number
  throttled: boolean
  /** Why the CPU limiter left this background tab alone. */
  throttleSkip?: string
}

export interface RamState {
  enabled: boolean
  limitKB: number
  overKB: number
  /** Human-readable status of the limiter. */
  status: string
}

export interface NetState {
  active: boolean
  downBps: number
  upBps: number
  latencyMs: number
  /** Pages currently capped. */
  guests?: number
  error?: string
}

export interface ControlStats {
  at: number
  /** SPECTER's total private memory (sum over all its processes), KB. */
  totalKB: number
  /** Physical memory of the machine, KB. */
  systemKB: number
  /** SPECTER's total CPU, % of the whole machine (all cores = 100). */
  cpuPct: number
  cores: number
  processes: number
  tabs: TabUsage[]
  ram: RamState
  net: NetState
  cpuLimiter: { enabled: boolean; rate: number; throttled: number }
}

export interface SleepLogEntry {
  id: string
  at: number
  reason: 'limit' | 'manual' | 'heavy'
  tabs: { tabId: string; title: string; url: string; memKB: number | null }[]
  /** SPECTER total private memory right before sleeping, KB (measured). */
  beforeKB: number
  /** SPECTER total private memory after the tabs' processes exited, KB (measured). */
  afterKB: number
  /** beforeKB − afterKB (can be ≤ 0 if something else grew in the same window). */
  releasedKB: number
  /** Time between the two measurements, ms. */
  ms: number
  note?: string
}

export interface SleepRequest {
  requestId: string
  tabIds: string[]
}

declare module '../ipc' {
  interface IpcContract {
    'control:getConfig': () => ControlConfig
    'control:setConfig': (patch: DeepPartial<ControlConfig>) => ControlConfig
    'control:syncTabs': (tabs: TabReport[]) => void
    'control:subscribe': (on: boolean) => void
    /** Number of renderers (panels, incl. popped-out ones) currently subscribed to stats. */
    'control:watchers': () => number
    'control:stats': () => ControlStats
    'control:log': () => SleepLogEntry[]
    'control:clearLog': () => void
    'control:sleepTabs': (tabIds: string[], reason: 'manual' | 'heavy') => SleepLogEntry | null
    'control:sleepDone': (requestId: string, slept: string[]) => void
    'control:pickWallpaper': () => string | null
    'control:wallpaperData': (path: string) => string | null
  }
  interface IpcEvents {
    'control:config': ControlConfig
    'control:stats': ControlStats
    'control:log': SleepLogEntry
    'control:sleepRequest': SleepRequest
    'control:watchers': number
  }
}
