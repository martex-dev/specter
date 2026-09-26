// Ad blocker: filter-list catalog and pure helpers shared by main and UI.
//
// Lists come straight from their maintainers (uBlock Origin's CDN, which also
// mirrors EasyList), so fixes such as YouTube's reach SPECTER within hours.
// Each list's own "! Expires:" header decides how often it is refreshed.

const UBO = 'https://ublockorigin.github.io/uAssets'

export interface FilterList {
  id: string
  name: string
  desc: string
  /** On for new installs. */
  default: boolean
  urls: string[]
}

export const FILTER_LISTS: FilterList[] = [
  {
    id: 'easylist',
    name: 'EasyList',
    desc: 'The main ad-blocking list: ad servers, banners and ad frames.',
    default: true,
    urls: [`${UBO}/thirdparties/easylist.txt`]
  },
  {
    id: 'ublock',
    name: 'uBlock Origin filters',
    desc: "uBlock Origin's own rules, including quick fixes for YouTube and video ads, and site repairs.",
    default: true,
    urls: [`${UBO}/filters/filters.min.txt`, `${UBO}/filters/quick-fixes.min.txt`, `${UBO}/filters/unbreak.min.txt`, `${UBO}/filters/resource-abuse.txt`]
  },
  {
    id: 'easyprivacy',
    name: 'EasyPrivacy',
    desc: 'Tracking scripts, analytics beacons and fingerprinting (EasyPrivacy + uBlock privacy).',
    default: true,
    urls: [`${UBO}/thirdparties/easyprivacy.txt`, `${UBO}/filters/privacy.min.txt`]
  },
  {
    id: 'badware',
    name: 'Malware & scam protection',
    desc: 'uBlock Origin badware list: scam, fake-download and malware sites.',
    default: true,
    urls: [`${UBO}/filters/badware.min.txt`]
  },
  {
    id: 'peterlowe',
    name: "Peter Lowe's list",
    desc: 'Ad and tracking servers, blocked by host name.',
    default: true,
    urls: ['https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext']
  },
  {
    id: 'cookies',
    name: 'Cookie banners',
    desc: 'Hides cookie-consent pop-ups and notices (EasyList Cookie + uBlock cookie annoyances).',
    default: true,
    urls: [`${UBO}/thirdparties/easylist-cookies.txt`, `${UBO}/filters/annoyances-cookies.txt`]
  },
  {
    id: 'annoyances',
    name: 'Other annoyances',
    desc: 'Newsletter pop-ups, "open in app" banners, social widgets. May hide things you want.',
    default: false,
    urls: [`${UBO}/filters/annoyances-others.txt`]
  }
]

/** Fallback hosts for a list URL, tried in order when the primary fails. */
export function listMirrors(url: string): string[] {
  const out = [url]
  if (url.startsWith(UBO + '/')) out.push('https://ublockorigin.pages.dev/' + url.slice(UBO.length + 1))
  const m = /\/thirdparties\/(easylist|easyprivacy)\.txt$/.exec(url)
  if (m) out.push(`https://easylist.to/easylist/${m[1]}.txt`)
  return out
}

/**
 * Scriptlet and redirect implementations (uBlock Origin's, converted to the
 * engine's format by the Ghostery adblocker project). Always loaded.
 */
export const RESOURCES_URL = 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json'

export const DEFAULT_FILTER_LISTS = FILTER_LISTS.filter((l) => l.default).map((l) => l.id)

/** Refresh interval for lists that don't say ("! Expires: …"), and the bounds for those that do. */
export const LIST_MAX_AGE_MS = 24 * 3600_000
const MIN_AGE_MS = 4 * 3600_000
const MAX_AGE_MS = 7 * 24 * 3600_000

/** Refresh interval a list asks for in its header ("! Expires: 12 hours"), clamped to 4 h – 7 days. */
export function listMaxAge(text: string): number {
  const m = /^!\s*Expires:\s*(\d+)\s*(hours?|days?|h|d)\b/im.exec(text.slice(0, 4000))
  if (!m) return LIST_MAX_AGE_MS
  const ms = Number(m[1]) * (m[2].startsWith('h') ? 3600_000 : 24 * 3600_000)
  return Math.min(MAX_AGE_MS, Math.max(MIN_AGE_MS, ms))
}

export interface AdblockListState {
  id: string
  name: string
  desc: string
  enabled: boolean
  /** Number of filter rules in the downloaded list (0 = not downloaded yet). */
  rules: number
  updatedAt: number
}

export interface AdblockStatus {
  enabled: boolean
  /** The engine is loaded and blocking. */
  ready: boolean
  updating: boolean
  error: string | null
  rules: number
  customRules: number
  lastUpdated: number
  lists: AdblockListState[]
  allowlist: string[]
  blockedSession: number
}

/** Normalises user input ("https://www.Example.com/path") to a host ("example.com"). */
export function normalizeSiteHost(input: string): string {
  let s = input.trim().toLowerCase()
  if (!s) return ''
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = new URL(s).hostname
  } catch {
    return ''
  }
  s = s.replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/^\.+|\.+$/g, '')
  if (s.startsWith('www.')) s = s.slice(4)
  return /^[a-z0-9.-]+$/.test(s) || /^\[[0-9a-f:]+\]$/.test(s) ? s : ''
}

/** True if the ad blocker is switched off for the page at `host` (a listed site or any of its parents). */
export function isAllowlisted(host: string, allowlist: readonly string[]): boolean {
  if (!host || !allowlist.length) return false
  let h = host.toLowerCase()
  if (h.startsWith('www.')) h = h.slice(4)
  for (const a of allowlist) if (h === a || h.endsWith('.' + a)) return true
  return false
}

/** Counts rules in a filter list: non-empty lines that are not comments or headers. */
export function countRules(text: string): number {
  let n = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line && !line.startsWith('!') && !line.startsWith('[') && !line.startsWith('#')) n++
    else if (line.startsWith('##') || line.startsWith('#@#') || line.startsWith('#?#') || line.startsWith('#$#')) n++
  }
  return n
}
