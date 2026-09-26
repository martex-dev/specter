// Interface micro-interactions ("fx"): click ripples, cursor spotlights and
// tilt on cards, and the circular reveal used when switching themes. All of it
// is decoration — every effect checks the root data attributes each time, so
// turning effects or motion off takes effect immediately.

const root = document.documentElement
const fxOn = () => root.dataset.effects === 'on'
const motionOn = () => root.dataset.motion !== 'off' && root.dataset.motion !== 'reduced'

const RIPPLE_TARGETS = '.btn, .icon-btn, .dock-btn, .palette-chip, .theme-card, .quick-link, .seg > button'
const SPOT_TARGETS = '.card, .ntp-card, .theme-card, .quick-link, .setting-group'
const TILT_TARGETS = '.theme-card'

function ripple(e: PointerEvent): void {
  if (e.button !== 0 || !motionOn()) return
  const el = (e.target as Element | null)?.closest?.(RIPPLE_TARGETS) as HTMLElement | null
  if (!el || (el as HTMLButtonElement).disabled) return
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
  const r = el.getBoundingClientRect()
  const size = Math.max(r.width, r.height) * 2.2
  const host = document.createElement('span')
  host.className = 'fx-ripple-host'
  const dot = document.createElement('span')
  dot.className = 'fx-ripple'
  dot.style.width = dot.style.height = size + 'px'
  dot.style.left = e.clientX - r.left - size / 2 + 'px'
  dot.style.top = e.clientY - r.top - size / 2 + 'px'
  host.appendChild(dot)
  el.appendChild(host)
  setTimeout(() => host.remove(), 650)
}

let spotEl: HTMLElement | null = null
let spotLayer: HTMLElement | null = null

function clearSpot(): void {
  spotLayer?.remove()
  if (spotEl) {
    spotEl.style.removeProperty('--tilt-x')
    spotEl.style.removeProperty('--tilt-y')
    spotEl.classList.remove('fx-tilting')
  }
  spotEl = spotLayer = null
}

function spotlight(e: PointerEvent): void {
  if (!fxOn()) {
    if (spotEl) clearSpot()
    return
  }
  const el = (e.target as Element | null)?.closest?.(SPOT_TARGETS) as HTMLElement | null
  if (el !== spotEl) {
    clearSpot()
    if (!el) return
    spotEl = el
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
    spotLayer = document.createElement('span')
    spotLayer.className = 'fx-spot'
    el.appendChild(spotLayer)
    if (el.matches(TILT_TARGETS)) el.classList.add('fx-tilting')
  }
  if (!el) return
  const r = el.getBoundingClientRect()
  const x = e.clientX - r.left
  const y = e.clientY - r.top
  spotLayer!.style.setProperty('--mx', x + 'px')
  spotLayer!.style.setProperty('--my', y + 'px')
  if (el.classList.contains('fx-tilting')) {
    el.style.setProperty('--tilt-x', ((y / r.height - 0.5) * -7).toFixed(2) + 'deg')
    el.style.setProperty('--tilt-y', ((x / r.width - 0.5) * 9).toFixed(2) + 'deg')
  }
}

let installed = false
export function installFx(): void {
  if (installed) return
  installed = true
  window.addEventListener('pointerdown', ripple, { capture: true, passive: true })
  window.addEventListener('pointermove', spotlight, { passive: true })
  window.addEventListener('blur', clearSpot)
  document.addEventListener('pointerleave', clearSpot)
}

/**
 * Runs a theme change inside a circular view-transition reveal centred on the
 * pointer. Falls back to a plain change when unsupported or motion is off.
 * `applied` resolves once the new theme is on <html> (App applies it after the
 * setting round-trips).
 */
export function withThemeReveal(change: () => void, applied: () => boolean, origin?: { x: number; y: number }): void {
  const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => { ready: Promise<void>; finished: Promise<void>; skipTransition: () => void } }
  if (!doc.startViewTransition || !motionOn() || document.visibilityState !== 'visible') {
    change()
    return
  }
  const x = origin?.x ?? innerWidth / 2
  const y = origin?.y ?? 60
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  try {
    const t = doc.startViewTransition(async () => {
      change()
      // Timers, not animation frames: frames pause while the window is occluded.
      const t0 = performance.now()
      while (!applied() && performance.now() - t0 < 400) await new Promise((r) => setTimeout(r, 16))
    })
    // Never let a stalled transition hold the old snapshot on screen.
    const guard = setTimeout(() => t.skipTransition(), 1200)
    t.finished.finally(() => clearTimeout(guard)).catch(() => undefined)
    t.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 560, easing: 'cubic-bezier(.22,.8,.2,1)', pseudoElement: '::view-transition-new(root)' }
        )
      })
      .catch(() => undefined)
  } catch {
    change()
  }
}

/** Theme/palette change with the reveal; `fromPointer` starts it at the last click. */
export function switchTheme(change: () => void, expect: { theme?: string; palette?: string }, fromPointer = true): void {
  withThemeReveal(
    change,
    () => (!expect.theme || root.dataset.theme === expect.theme) && (!expect.palette || root.dataset.palette === expect.palette),
    fromPointer ? { ...lastPointer } : undefined
  )
}

/** Last pointer position, so menu-driven theme changes can reveal from the click. */
export const lastPointer = { x: 0, y: 0 }
window.addEventListener('pointerdown', (e) => ((lastPointer.x = e.clientX), (lastPointer.y = e.clientY)), { capture: true, passive: true })
