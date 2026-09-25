// Chromium EyeDropper API (samples any pixel on screen, not just this window).

interface EyeDropperCtor {
  new (): { open(opts?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }> }
}

export function eyeDropperSupported(): boolean {
  return typeof (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper === 'function'
}

/** Resolves to "#rrggbb", or null when cancelled (Esc). Throws if unsupported. */
export async function pickScreenColor(): Promise<string | null> {
  const Ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper
  if (!Ctor) throw new Error('The EyeDropper API is not available in this build')
  try {
    const r = await new Ctor().open()
    return r.sRGBHex.startsWith('#') ? r.sRGBHex.toLowerCase() : rgbToHex(r.sRGBHex)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null
    throw err
  }
}

function rgbToHex(s: string): string {
  const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(s)
  if (!m) return s
  return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')
}
