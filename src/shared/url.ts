// URL / omnibox input interpretation. Pure functions — unit tested.

export const INTERNAL_SCHEME = 'specter:'

const KNOWN_TLDS = new Set(
  (
    'com net org io dev app ai co me info biz edu gov mil int eu us uk de fr es it nl be ch at se no dk fi pl cz sk hu ro bg gr pt ie ru ua by kz tr il in cn jp kr tw hk sg my th vn id ph au nz ca mx br ar cl pe co za ng ke eg ma sa ae ir pk bd lk ' +
    'xyz tech site online store shop blog news tv fm gg ly to sh cc ws so is im gl lol wiki page link live pro cloud zone space fun top vip one art design dev run ninja rocks tools codes software systems network digital media studio games game crypto finance money exchange trade market capital fund bank insure inc llc ltd'
  ).split(/\s+/)
)

export type OmniboxIntent =
  | { kind: 'url'; url: string }
  | { kind: 'search'; query: string }
  | { kind: 'scoped'; scope: OmniboxScope; query: string }

export type OmniboxScope = 'tabs' | 'history' | 'bookmarks' | 'workspace' | 'command' | 'ai' | 'notes' | 'market'

export const SCOPE_ALIASES: Record<string, OmniboxScope> = {
  '@tabs': 'tabs',
  '@tab': 'tabs',
  '@history': 'history',
  '@h': 'history',
  '@bookmarks': 'bookmarks',
  '@b': 'bookmarks',
  '@workspace': 'workspace',
  '@ws': 'workspace',
  '@command': 'command',
  '@cmd': 'command',
  '>': 'command',
  '@ai': 'ai',
  '?': 'ai',
  '@notes': 'notes',
  '@note': 'notes',
  '@market': 'market',
  '$': 'market'
}

export function parseScope(input: string): { scope: OmniboxScope; query: string } | null {
  const trimmed = input.trimStart()
  for (const [alias, scope] of Object.entries(SCOPE_ALIASES)) {
    if (alias.length === 1) {
      if (trimmed.startsWith(alias) && (alias !== '$' || /^\$[A-Za-z]/.test(trimmed))) {
        return { scope, query: trimmed.slice(1).trim() }
      }
      continue
    }
    const lower = trimmed.toLowerCase()
    if (lower === alias || lower.startsWith(alias + ' ')) {
      return { scope, query: trimmed.slice(alias.length).trim() }
    }
  }
  return null
}

function isIPv4(host: string): boolean {
  const parts = host.split('.')
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

/** Returns a navigable URL if the input looks like one, otherwise null. */
export function toUrl(input: string): string | null {
  const text = input.trim()
  if (!text || /\s/.test(text)) {
    // A URL cannot contain whitespace (unless it's a file path with spaces).
    if (/^[a-zA-Z]:\\/.test(text)) return 'file:///' + text.replace(/\\/g, '/')
    return null
  }
  if (/^specter:\/\//i.test(text)) return text.toLowerCase().startsWith('specter://') ? text : 'specter://' + text.slice(10)
  if (/^(https?|file|ftp|chrome|devtools|view-source|data|blob|about):/i.test(text)) {
    if (/^about:blank$/i.test(text)) return 'about:blank'
    return text
  }
  if (/^[a-zA-Z]:[\\/]/.test(text)) return 'file:///' + text.replace(/\\/g, '/')
  if (/^mailto:/i.test(text)) return text

  // host[:port][/path]
  const m = /^([^/?#:]+)(:\d{1,5})?([/?#].*)?$/.exec(text)
  if (!m) return null
  const host = m[1].toLowerCase()
  if (host === 'localhost' || isIPv4(host)) return 'http://' + text
  if (/^\[[0-9a-f:]+\]$/i.test(host)) return 'http://' + text
  if (!host.includes('.')) return null
  const labels = host.split('.')
  if (labels.some((l) => !/^[a-z0-9-]+$/i.test(l) || l.startsWith('-') || l.endsWith('-'))) {
    // allow punycode / unicode hostnames
    if (!labels.every((l) => l.length > 0 && !/[\s!"#$%&'()*+,;<=>@[\\\]^`{|}~]/.test(l))) return null
  }
  const tld = labels[labels.length - 1]
  if (/^\d+$/.test(tld)) return null
  const hasPathOrPort = Boolean(m[2] || m[3])
  if (!KNOWN_TLDS.has(tld) && !/^xn--/.test(tld) && !hasPathOrPort) {
    // Unknown TLD and no path ("node.js", "file.txt") → search, unless it has
    // several labels ("intranet.corp.lan") which is very likely a host.
    if (!(labels.length >= 3 && /^[a-z]{2,12}$/.test(tld))) return null
  }
  return 'https://' + text
}

export function interpretInput(input: string): OmniboxIntent {
  const scoped = parseScope(input)
  if (scoped) return { kind: 'scoped', scope: scoped.scope, query: scoped.query }
  const url = toUrl(input)
  if (url) return { kind: 'url', url }
  return { kind: 'search', query: input.trim() }
}

export function isInternal(url: string): boolean {
  return url.startsWith('specter://')
}

export function internalRoute(url: string): { page: string; sub: string; query: URLSearchParams } {
  const rest = url.slice('specter://'.length)
  const [pathPart, queryPart = ''] = rest.split('?')
  const [page, ...sub] = pathPart.split('/').filter(Boolean)
  return { page: (page || 'newtab').toLowerCase(), sub: sub.join('/'), query: new URLSearchParams(queryPart) }
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function origin(url: string): string {
  try {
    const u = new URL(url)
    return u.origin === 'null' ? u.protocol + '//' + u.host : u.origin
  } catch {
    return ''
  }
}

/** Human display form of a URL for the omnibox when not focused. */
export function displayUrl(url: string): string {
  if (!url || url === 'about:blank' || url === 'specter://newtab') return ''
  if (isInternal(url)) return url
  try {
    const u = new URL(url)
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      const path = u.pathname === '/' ? '' : u.pathname
      return u.host.replace(/^www\./, '') + path + u.search + u.hash
    }
    return url
  } catch {
    return url
  }
}

export function sameDocument(a: string, b: string): boolean {
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    ua.hash = ''
    ub.hash = ''
    return ua.href === ub.href
  } catch {
    return a === b
  }
}

export type PageKind = 'github-repo' | 'github' | 'paper' | 'video' | 'finance' | 'docs' | 'pdf' | 'generic'

/** Lightweight page-type detection used for contextual actions. */
export function detectPageKind(url: string, title = ''): PageKind {
  const host = hostname(url)
  let path = ''
  try {
    path = new URL(url).pathname
  } catch {
    /* ignore */
  }
  if (host === 'github.com') {
    const parts = path.split('/').filter(Boolean)
    if (parts.length >= 2 && !['settings', 'notifications', 'marketplace', 'explore', 'topics', 'orgs', 'sponsors'].includes(parts[0])) return 'github-repo'
    return 'github'
  }
  if (/\.pdf($|\?)/i.test(path)) return 'pdf'
  if (/(^|\.)(arxiv\.org|biorxiv\.org|medrxiv\.org|semanticscholar\.org|scholar\.google\.com|pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|nature\.com|sciencedirect\.com|springer\.com|acm\.org|ieee\.org|openreview\.net|researchgate\.net|ssrn\.com)$/.test(host)) return 'paper'
  if (/(^|\.)(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|dailymotion\.com)$/.test(host) && (path.startsWith('/watch') || host === 'youtu.be' || host.endsWith('vimeo.com') || host.endsWith('twitch.tv') || path.startsWith('/shorts') || path.startsWith('/live'))) return 'video'
  if (/(^|\.)(finance\.yahoo\.com|tradingview\.com|coingecko\.com|coinmarketcap\.com|binance\.com|bloomberg\.com|marketwatch\.com|investing\.com|macrotrends\.net|sec\.gov|morningstar\.com|stockanalysis\.com|dexscreener\.com|etherscan\.io|solscan\.io)$/.test(host)) return 'finance'
  if (/^(docs|developer|developers|learn)\./.test(host) || /(^|\.)(developer\.mozilla\.org|readthedocs\.io|stackoverflow\.com|npmjs\.com|pypi\.org|docs\.rs|pkg\.go\.dev)$/.test(host) || /\bdocumentation\b/i.test(title)) return 'docs'
  return 'generic'
}
