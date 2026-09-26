// Wallpaper renderer: built-in procedural art drawn with the current theme's
// CSS variables (so every palette recolours it live), or the user's own image.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { WallpaperId } from '@shared/modules/control'
import { invoke } from '../../../lib/ipc'
import { parseWallpaper, rng, topoPaths, wavePath } from './art'

const dataCache = new Map<string, string | null>()

function useImageData(path: string | null): { url: string | null; error: boolean } {
  const [state, setState] = useState<{ url: string | null; error: boolean }>(() => ({ url: path ? (dataCache.get(path) ?? null) : null, error: false }))
  useEffect(() => {
    if (!path) return setState({ url: null, error: false })
    const cached = dataCache.get(path)
    if (cached !== undefined) return setState({ url: cached, error: cached === null })
    let alive = true
    invoke('control:wallpaperData', path)
      .then((url) => {
        // Only one custom wallpaper exists at a time (main deletes the others);
        // drop earlier multi-MB data URLs instead of keeping them for the session.
        for (const k of dataCache.keys()) if (k !== path) dataCache.delete(k)
        dataCache.set(path, url)
        if (alive) setState({ url, error: !url })
      })
      .catch(() => alive && setState({ url: null, error: true }))
    return () => {
      alive = false
    }
  }, [path])
  return state
}

/** Watches a data-* attribute on <html> (theme / motion changes). */
export function useRootData(attr: string): string | undefined {
  const [v, setV] = useState(() => document.documentElement.getAttribute(attr) ?? undefined)
  useEffect(() => {
    const mo = new MutationObserver(() => setV(document.documentElement.getAttribute(attr) ?? undefined))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: [attr] })
    return () => mo.disconnect()
  }, [attr])
  return v
}

function usePrefersReducedMotion(): boolean {
  const [v, setV] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const fn = () => setV(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return v
}

/** Animations run only when allowed by the wallpaper option, SPECTER's motion setting and the OS. */
export function useWallpaperMotion(animate: boolean): boolean {
  const motion = useRootData('data-motion')
  const reduced = usePrefersReducedMotion()
  return animate && (motion ?? 'full') === 'full' && !reduced
}

export function Wallpaper({ value, dim, animate, preview }: { value: string; dim: number; animate: boolean; preview?: boolean }) {
  const wp = parseWallpaper(value)
  const moving = useWallpaperMotion(animate) && !preview
  const img = useImageData(wp.kind === 'file' ? wp.path : null)
  if (wp.kind === 'none') return null
  return (
    <div className={'ctl-wp' + (preview ? ' preview' : '')} data-anim={moving ? 'on' : 'off'} aria-hidden="true">
      {wp.kind === 'builtin' ? <Builtin id={wp.id} moving={moving} preview={!!preview} /> : img.url ? <div className="wp-image" style={{ backgroundImage: `url("${img.url}")` }} /> : null}
      {wp.kind === 'file' && img.error && !preview && <div className="wp-missing">Wallpaper image not found — choose it again in GX Control.</div>}
      <div className="ctl-wp-scrim" style={{ opacity: dim }} />
    </div>
  )
}

function Builtin({ id, moving, preview }: { id: WallpaperId; moving: boolean; preview: boolean }) {
  switch (id) {
    case 'aurora':
      return (
        <div className="wp-aurora">
          <span className="b b1" />
          <span className="b b2" />
          <span className="b b3" />
          <span className="b b4" />
          <span className="veil" />
        </div>
      )
    case 'grid':
      return (
        <div className="wp-grid">
          <span className="sky" />
          <span className="sun" />
          <span className="horizon" />
          <span className="floor">
            <span className="lines" />
          </span>
        </div>
      )
    case 'stars':
      return <Starfield moving={moving} preview={preview} />
    case 'topo':
      return <Topo />
    case 'waves':
      return <Waves />
  }
}

function Topo() {
  const paths = useMemo(() => topoPaths(), [])
  return (
    <div className="wp-topo">
      <svg viewBox="0 0 960 600" preserveAspectRatio="xMidYMid slice">
        {paths.map((p, i) => (
          <path key={i} d={p.d} className={p.major ? 'major' : undefined} />
        ))}
      </svg>
    </div>
  )
}

const WAVES = [
  { base: 380, amp: 26, periods: 2, phase: 0.3, cls: 'w1' },
  { base: 420, amp: 22, periods: 3, phase: 1.9, cls: 'w2' },
  { base: 462, amp: 18, periods: 2, phase: 3.1, cls: 'w3' },
  { base: 505, amp: 14, periods: 4, phase: 0.9, cls: 'w4' }
]

function Waves() {
  const paths = useMemo(() => WAVES.map((w) => ({ ...w, d: wavePath(960, 600, w.base, w.amp, w.periods, w.phase) })), [])
  return (
    <div className="wp-waves">
      <span className="glow" />
      {paths.map((w) => (
        <svg key={w.cls} className={'wave ' + w.cls} viewBox="0 0 1920 600" preserveAspectRatio="none">
          <path d={w.d} />
        </svg>
      ))}
    </div>
  )
}

function readColor(el: Element, v: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(v).trim() || fallback
}

function Starfield({ moving, preview }: { moving: boolean; preview: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const palette = useRootData('data-palette')
  const theme = useRootData('data-theme')
  const accentStyle = useRootData('style')
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const g = canvas.getContext('2d')
    if (!g) return
    const colors = [readColor(canvas, '--fg-0', '#ffffff'), readColor(canvas, '--accent', '#8ab4ff'), readColor(canvas, '--accent-2', '#c084fc')]
    const r = rng(42)
    let stars: { x: number; y: number; z: number; c: number; ph: number }[] = []
    let w = 0
    let h = 0
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const resize = () => {
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      const n = Math.min(1400, Math.round((w * h) / (preview ? 700 : 1500)))
      stars = Array.from({ length: n }, () => ({ x: r() * w, y: r() * h, z: 0.2 + r() * 0.8, c: r() < 0.72 ? 0 : r() < 0.6 ? 1 : 2, ph: r() * Math.PI * 2 }))
    }
    const draw = (t: number) => {
      g.clearRect(0, 0, w, h)
      for (const s of stars) {
        const tw = moving ? 0.65 + 0.35 * Math.sin(t / 900 + s.ph) : 0.85
        g.globalAlpha = Math.min(1, (0.35 + s.z * 0.75) * tw)
        g.fillStyle = colors[s.c]
        const size = 0.6 + s.z * (s.c ? 2.4 : 1.8)
        g.beginPath()
        g.arc(s.x, s.y, size / 2, 0, Math.PI * 2)
        g.fill()
      }
      g.globalAlpha = 1
    }
    resize()
    draw(0)
    const ro = new ResizeObserver(() => {
      resize()
      draw(performance.now())
    })
    ro.observe(canvas)
    let raf = 0
    let last = 0
    let prev = performance.now()
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      if (document.hidden || t - last < 33) return // ~30 fps is plenty for a slow drift
      const dt = Math.min(100, t - prev)
      prev = t
      last = t
      for (const s of stars) {
        s.x -= s.z * s.z * dt * 0.012
        if (s.x < -2) {
          s.x = w + 2
          s.y = r() * h
        }
      }
      draw(t)
    }
    if (moving) raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [moving, preview, palette, theme, accentStyle])
  return (
    <div className="wp-stars">
      <span className="nebula" />
      <canvas ref={ref} />
    </div>
  )
}
