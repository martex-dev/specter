// Pure domain helpers (no Electron) shared by privacy code and tests.

const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'com.br', 'com.cn', 'com.tw', 'com.hk',
  'co.in', 'co.nz', 'co.za', 'com.mx', 'com.ar', 'com.tr', 'com.sg', 'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'herokuapp.com',
  'blogspot.com', 'appspot.com', 'azurewebsites.net', 'cloudfront.net', 'web.app', 'firebaseapp.com'
])

/** Approximate registrable domain ("eTLD+1") without shipping the full Public Suffix List. */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.')
  if (parts.length <= 2) return parts.join('.')
  const last2 = parts.slice(-2).join('.')
  if (MULTI_PART_SUFFIXES.has(last2)) return parts.slice(-3).join('.')
  return last2
}

/** True when two hosts belong to different sites (third-party relationship). */
export function isThirdParty(requestHost: string, topHost: string): boolean {
  if (!topHost) return false
  return registrableDomain(requestHost) !== registrableDomain(topHost)
}

/** Builds a matcher that checks a host and all of its parent domains against a list. */
export function makeTrackerMatcher(domains: string[]): (host: string) => boolean {
  const set = new Set(domains.map((d) => d.toLowerCase()))
  return (host: string) => {
    const h = host.toLowerCase()
    if (set.has(h)) return true
    const parts = h.split('.')
    for (let i = 1; i < parts.length - 1; i++) if (set.has(parts.slice(i).join('.'))) return true
    return false
  }
}
