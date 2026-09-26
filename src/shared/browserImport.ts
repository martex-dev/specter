// Pure helpers for importing from other browsers (no Electron, unit-tested).

/** Chromium stores profile colours as signed 32-bit ARGB integers. */
export function chromeColor(v: unknown): string | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return '#' + ((v >>> 0) & 0xffffff).toString(16).padStart(6, '0')
}

/** Colours for new profiles when the browser has none (readable on SPECTER's dark and light themes). */
export const PROFILE_COLORS = ['#8b9cff', '#5ad1a6', '#f2a65a', '#e46e8a', '#63b8ff', '#c792ea', '#e5c07b', '#7fd4d4']

export interface ChromiumProfileInfo {
  dir: string
  label?: string
  account?: string
  color?: string
}

/** Reads the profile list of a Chromium "Local State" file (profile.info_cache). */
export function chromiumProfileInfo(localState: unknown): Map<string, ChromiumProfileInfo> {
  const out = new Map<string, ChromiumProfileInfo>()
  const cache = (localState as { profile?: { info_cache?: Record<string, Record<string, unknown>> } })?.profile?.info_cache
  if (!cache || typeof cache !== 'object') return out
  for (const [dir, info] of Object.entries(cache)) {
    if (!info || typeof info !== 'object') continue
    const str = (k: string) => (typeof info[k] === 'string' && (info[k] as string).trim() ? (info[k] as string).trim() : undefined)
    out.set(dir, {
      dir,
      label: str('name') ?? str('gaia_given_name'),
      account: str('user_name'),
      color: chromeColor(info.profile_highlight_color) ?? chromeColor(info.default_avatar_fill_color)
    })
  }
  return out
}

/** "Work (Profile 1)"; the plain folder name when the browser has no name for it. */
export function profileDisplayName(dir: string, label?: string): string {
  return label ? `${label} (${dir})` : dir
}
