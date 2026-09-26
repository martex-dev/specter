// Video tools (built-in speed controller): pure logic shared by the page
// preload, the main process and the settings UI. No DOM, no Electron.
import { eventToAccelerator, normalizeAccelerator, type KeyInput } from './keys'

export const SPEED_MIN = 0.07
export const SPEED_MAX = 16
export const SPEED_STEP = 0.1
export const SEEK_SECONDS = 10

export type VideoAction = 'slower' | 'faster' | 'reset' | 'rewind' | 'advance' | 'preferred'

export const VIDEO_ACTIONS: { id: VideoAction; label: string }[] = [
  { id: 'slower', label: 'Slower' },
  { id: 'faster', label: 'Faster' },
  { id: 'reset', label: 'Reset to 1×' },
  { id: 'rewind', label: 'Back 10 s' },
  { id: 'advance', label: 'Forward 10 s' },
  { id: 'preferred', label: 'Toggle 1× / preferred speed' }
]

export const DEFAULT_VIDEO_KEYS: Record<VideoAction, string> = { slower: 'S', faster: 'D', reset: 'R', rewind: 'Z', advance: 'X', preferred: 'G' }

const round2 = (n: number) => Math.round(n * 100) / 100

/** A valid playback rate: finite, within 0.07×–16×, two decimals (so 0.1 + 0.2 stays 0.3). */
export function clampSpeed(rate: number): number {
  if (!Number.isFinite(rate)) return 1
  return round2(Math.min(SPEED_MAX, Math.max(SPEED_MIN, rate)))
}

export function sameSpeed(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005
}

/** One step faster (dir 1) or slower (dir -1). From below one step, faster lands on the step itself (0.07 → 0.1). */
export function stepSpeed(current: number, dir: 1 | -1, step = SPEED_STEP): number {
  const s = step > 0 && Number.isFinite(step) ? step : SPEED_STEP
  const cur = Number.isFinite(current) && current > 0 ? current : 1
  if (dir > 0 && cur < s) return clampSpeed(s)
  return clampSpeed(cur + dir * s)
}

/** R: back to 1×; pressed again at 1×, returns to the last speed (like Video Speed Controller). */
export function resetSpeed(current: number, last: number | null): number {
  if (sameSpeed(current, 1) && last !== null && !sameSpeed(last, 1)) return clampSpeed(last)
  return 1
}

/** G: switch between 1× and the preferred speed (any other speed goes to the preferred one). */
export function togglePreferred(current: number, preferred: number): number {
  const p = clampSpeed(preferred)
  return sameSpeed(current, p) ? 1 : p
}

/** New playback rate for a speed action, or null for actions that seek. */
export function speedFor(action: VideoAction, current: number, opts: { step?: number; preferred: number; last: number | null }): number | null {
  switch (action) {
    case 'faster':
      return stepSpeed(current, 1, opts.step)
    case 'slower':
      return stepSpeed(current, -1, opts.step)
    case 'reset':
      return resetSpeed(current, opts.last)
    case 'preferred':
      return togglePreferred(current, opts.preferred)
    default:
      return null
  }
}

/** "1.5×", "0.07×", "2×". */
export function formatSpeed(rate: number): string {
  return `${round2(rate)}×`
}

// ------------------------------------------------------------------ keys

const MODIFIER_ONLY = /^(Ctrl|Alt|Shift|Meta|Control|AltGraph|Os)?$/

/** Canonical form of a user-entered key ("s" → "S", "shift+d" → "Shift+D"), or null when it names no key. */
export function parseVideoKey(binding: string | undefined | null): string | null {
  if (!binding || !binding.trim()) return null
  const acc = normalizeAccelerator(binding.trim())
  const key = acc.split('+').pop() ?? ''
  if (MODIFIER_ONLY.test(key)) return null
  return acc
}

/** Accelerator → action. Overrides replace defaults; an empty string turns an action off. Later duplicates lose. */
export function videoKeyMap(overrides: Partial<Record<VideoAction, string>> = {}): Map<string, VideoAction> {
  const map = new Map<string, VideoAction>()
  for (const { id } of VIDEO_ACTIONS) {
    const acc = parseVideoKey(id in overrides ? overrides[id] : DEFAULT_VIDEO_KEYS[id])
    if (acc && !map.has(acc)) map.set(acc, id)
  }
  return map
}

/** The effective key of each action (null = off). */
export function resolveVideoKeys(overrides: Partial<Record<VideoAction, string>> = {}): Record<VideoAction, string | null> {
  const out = {} as Record<VideoAction, string | null>
  for (const { id } of VIDEO_ACTIONS) out[id] = parseVideoKey(id in overrides ? overrides[id] : DEFAULT_VIDEO_KEYS[id])
  return out
}

/** Action bound to a key event (non-Latin layouts match by physical key, as SPECTER's shortcuts do). */
export function videoActionFor(e: KeyInput, map: Map<string, VideoAction>): VideoAction | null {
  const acc = eventToAccelerator(e)
  return acc ? (map.get(acc) ?? null) : null
}

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week'])

/** Whether keys typed into this element are text (so speed keys must leave them alone). */
export function isTypingTarget(el: { tagName?: string; type?: string; isContentEditable?: boolean; role?: string | null } | null | undefined): boolean {
  if (!el) return false
  if (el.isContentEditable) return true
  const tag = (el.tagName ?? '').toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return TEXT_INPUT_TYPES.has((el.type ?? '').toLowerCase())
  const role = (el.role ?? '').toLowerCase()
  return role === 'textbox' || role === 'searchbox' || role === 'combobox'
}

// ------------------------------------------------------------ keeping speed

/**
 * What to do when a page changes a media element's playback rate on its own:
 * adopt it (the user just used the site's own speed control), restore the
 * speed the user chose (the site reset it on navigation or for an ad), or ignore.
 */
export function rateChangeDecision(o: { desired: number | null; actual: number; ours: boolean; msSinceUserInput: number }): 'adopt' | 'restore' | 'ignore' {
  if (o.ours || !Number.isFinite(o.actual) || o.actual <= 0) return 'ignore'
  const userDriven = o.msSinceUserInput < 1500
  if (o.desired === null) return userDriven ? 'adopt' : 'ignore'
  if (sameSpeed(o.actual, o.desired)) return 'ignore'
  return userDriven ? 'adopt' : 'restore'
}

// ---------------------------------------------------------- per-site memory

/** The key a speed is remembered under: the host without "www.", or null for pages that aren't sites. */
export function siteKey(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.hostname.toLowerCase().replace(/^www\./, '') || null
  } catch {
    return null
  }
}

export interface SiteSpeed {
  site: string
  rate: number
  updatedAt: number
}

/** Remembered speeds, capped (least recently changed sites are dropped first). 1× is not stored. */
export class SpeedMemory {
  private map = new Map<string, SiteSpeed>()
  constructor(
    entries: SiteSpeed[] = [],
    private cap = 500
  ) {
    for (const e of [...entries].sort((a, b) => a.updatedAt - b.updatedAt)) if (e.site && Number.isFinite(e.rate)) this.map.set(e.site, { ...e, rate: clampSpeed(e.rate) })
    this.trim()
  }

  get(site: string | null): number | null {
    return site ? (this.map.get(site)?.rate ?? null) : null
  }

  /** Stores a speed; returns the entries that were dropped to stay under the cap. */
  set(site: string | null, rate: number, now = Date.now()): { changed: boolean; dropped: string[] } {
    if (!site) return { changed: false, dropped: [] }
    const r = clampSpeed(rate)
    if (sameSpeed(r, 1)) return { changed: this.map.delete(site), dropped: [] }
    const prev = this.map.get(site)
    this.map.delete(site)
    this.map.set(site, { site, rate: r, updatedAt: now })
    return { changed: !prev || !sameSpeed(prev.rate, r), dropped: this.trim() }
  }

  forget(site: string): boolean {
    return this.map.delete(site)
  }

  clear(): void {
    this.map.clear()
  }

  /** Most recently changed first. */
  list(): SiteSpeed[] {
    return [...this.map.values()].reverse()
  }

  private trim(): string[] {
    const dropped: string[] = []
    for (const site of this.map.keys()) {
      if (this.map.size <= this.cap) break
      this.map.delete(site)
      dropped.push(site)
    }
    return dropped
  }
}

// ------------------------------------------------------ preload ⇄ main process

/** What the page preload needs to know (sent at document start and whenever the settings change). */
export interface VideoPageConfig {
  /** Keys, badge and speed keeping; off when the feature or this site is switched off. */
  enabled: boolean
  keys: [string, VideoAction][]
  step: number
  preferred: number
  badge: boolean
  /** Remembered speed for the page's site (only at document start). */
  siteSpeed?: number | null
}

/** Commands SPECTER's UI sends to a page: a speed action, or 'set' with a rate. */
export type VideoCommand = VideoAction | 'set'
