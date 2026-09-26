// Procedural geometry for the built-in wallpapers (pure, deterministic).
import type { WallpaperId } from '@shared/modules/control'

export const BUILTIN_WALLPAPERS: { id: WallpaperId; name: string; animated: boolean }[] = [
  { id: 'aurora', name: 'Aurora mesh', animated: true },
  { id: 'grid', name: 'Neon horizon', animated: true },
  { id: 'stars', name: 'Starfield', animated: true },
  { id: 'topo', name: 'Topographic', animated: false },
  { id: 'waves', name: 'Gradient waves', animated: true }
]

export type WallpaperValue = { kind: 'none' } | { kind: 'builtin'; id: WallpaperId } | { kind: 'file'; path: string }

export function parseWallpaper(v: string | undefined | null): WallpaperValue {
  if (!v) return { kind: 'none' }
  if (v.startsWith('builtin:')) {
    const id = v.slice(8) as WallpaperId
    return BUILTIN_WALLPAPERS.some((w) => w.id === id) ? { kind: 'builtin', id } : { kind: 'none' }
  }
  if (v.startsWith('file:') && v.length > 5) return { kind: 'file', path: v.slice(5) }
  return { kind: 'none' }
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Topographic contour lines: a smooth height field (a few gaussian hills and
 * gentle ripples) traced with marching squares. Returns one SVG path per level.
 */
export function topoPaths(w = 960, h = 600, levels = 14, seed = 7): { d: string; major: boolean }[] {
  const r = rng(seed)
  const hills = Array.from({ length: 7 }, () => ({ x: r() * w, y: r() * h, s: 90 + r() * 220, a: (r() < 0.25 ? -0.6 : 1) * (0.5 + r()) }))
  const cell = 10
  const cols = Math.ceil(w / cell) + 1
  const rows = Math.ceil(h / cell) + 1
  const f = new Float32Array(cols * rows)
  let min = Infinity
  let max = -Infinity
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const x = i * cell
      const y = j * cell
      let v = 0.18 * Math.sin(x / 140 + Math.cos(y / 170)) + 0.12 * Math.cos(y / 95 - x / 260)
      for (const hl of hills) v += hl.a * Math.exp(-((x - hl.x) ** 2 + (y - hl.y) ** 2) / (2 * hl.s * hl.s))
      f[j * cols + i] = v
      if (v < min) min = v
      if (v > max) max = v
    }
  const out: { d: string; major: boolean }[] = []
  for (let l = 1; l <= levels; l++) {
    const iso = min + ((max - min) * l) / (levels + 1)
    const parts: string[] = []
    for (let j = 0; j < rows - 1; j++)
      for (let i = 0; i < cols - 1; i++) {
        const a = f[j * cols + i]
        const b = f[j * cols + i + 1]
        const c = f[(j + 1) * cols + i + 1]
        const d = f[(j + 1) * cols + i]
        const idx = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (d > iso ? 1 : 0)
        if (idx === 0 || idx === 15) continue
        const x = i * cell
        const y = j * cell
        const lerp = (p: number, q: number) => (iso - p) / (q - p || 1e-9)
        const top = () => [x + cell * lerp(a, b), y]
        const right = () => [x + cell, y + cell * lerp(b, c)]
        const bottom = () => [x + cell * lerp(d, c), y + cell]
        const left = () => [x, y + cell * lerp(a, d)]
        const seg = (p: number[], q: number[]) => parts.push(`M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${q[0].toFixed(1)} ${q[1].toFixed(1)}`)
        switch (idx) {
          case 1:
          case 14:
            seg(left(), bottom())
            break
          case 2:
          case 13:
            seg(bottom(), right())
            break
          case 3:
          case 12:
            seg(left(), right())
            break
          case 4:
          case 11:
            seg(top(), right())
            break
          case 5:
            seg(left(), top())
            seg(bottom(), right())
            break
          case 6:
          case 9:
            seg(top(), bottom())
            break
          case 7:
          case 8:
            seg(left(), top())
            break
          case 10:
            seg(top(), right())
            seg(left(), bottom())
            break
        }
      }
    out.push({ d: parts.join(''), major: l % 4 === 0 })
  }
  return out
}

/** A seamless sine wave band twice as wide as the view (for a -50% translate loop). */
export function wavePath(w: number, h: number, base: number, amp: number, periods: number, phase: number): string {
  const total = w * 2
  const pts: string[] = []
  const step = 12
  for (let x = 0; x <= total; x += step) {
    const y = base + amp * Math.sin((x / w) * periods * 2 * Math.PI + phase) + amp * 0.35 * Math.sin((x / w) * periods * 4 * Math.PI + phase * 1.7)
    pts.push(`${x.toFixed(0)} ${y.toFixed(1)}`)
  }
  return `M0 ${h}L${pts.join('L')}L${total} ${h}Z`
}
