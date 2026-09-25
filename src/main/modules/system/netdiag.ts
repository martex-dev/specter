// On-demand, non-intrusive network diagnostics. Each check is triggered by the
// user, sends a single request to a host the user chose (or the documented
// default), and never probes other ports (443 only).
import { net } from 'electron'
import { promises as dnsp, getServers } from 'node:dns'
import https from 'node:https'
import { isIP } from 'node:net'
import { performance } from 'node:perf_hooks'
import tls, { type DetailedPeerCertificate } from 'node:tls'
import { normalizeHost } from './parsers'
import type { ConnectivityResult, DnsResult, HttpsResult, NetDiagRequest, NetDiagResult, TlsResult } from '@shared/modules/system'

const TIMEOUT = 10_000

export const CONNECTIVITY_TARGETS = ['https://www.gstatic.com/generate_204', 'https://1.1.1.1/cdn-cgi/trace']

function ms(t0: number): number {
  return Math.round((performance.now() - t0) * 10) / 10
}

function errMsg(err: unknown): string {
  const e = err as NodeJS.ErrnoException
  return e?.code ? `${e.code}${e.message && !e.message.includes(e.code) ? ': ' + e.message : ''}` : String(e?.message ?? err)
}

async function connectivity(): Promise<ConnectivityResult> {
  const online = net.isOnline()
  // Redirects are not followed: any HTTP answer below 500 proves the path works.
  const checks = await Promise.all(
    CONNECTIVITY_TARGETS.map(async (target) => {
      const r = await httpsCheck(target)
      if (r.error) return { target, ok: false, error: r.error }
      return { target, ok: (r.status ?? 0) > 0 && (r.status ?? 0) < 500, status: r.status, ms: r.totalMs }
    })
  )
  return { kind: 'connectivity', online, checks }
}

async function dnsCheck(hostInput: string): Promise<DnsResult> {
  const servers = getServers()
  let host: string
  try {
    host = normalizeHost(hostInput)
  } catch (err) {
    return { kind: 'dns', host: String(hostInput), lookup: { error: errMsg(err) }, query: { error: errMsg(err) }, servers }
  }
  let lookup: DnsResult['lookup']
  let t0 = performance.now()
  try {
    const addresses = await Promise.race([
      dnsp.lookup(host, { all: true }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out')), TIMEOUT))
    ])
    lookup = { ms: ms(t0), addresses: addresses.map((a) => ({ address: a.address, family: a.family })) }
  } catch (err) {
    lookup = { error: errMsg(err) }
  }
  let query: DnsResult['query']
  if (isIP(host)) query = { error: 'Host is an IP address — nothing to resolve' }
  else {
    const resolver = new dnsp.Resolver({ timeout: 4000, tries: 1 })
    t0 = performance.now()
    const [a, aaaa] = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)])
    const took = ms(t0)
    if (a.status === 'rejected' && aaaa.status === 'rejected') query = { error: errMsg(a.reason) }
    else query = { ms: took, a: a.status === 'fulfilled' ? a.value : [], aaaa: aaaa.status === 'fulfilled' ? aaaa.value : [] }
  }
  return { kind: 'dns', host, lookup, query, servers }
}

function httpsCheck(urlInput: string): Promise<HttpsResult> {
  let url: URL
  try {
    const raw = String(urlInput ?? '').trim()
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw)
    if (url.protocol !== 'https:') throw new Error('Only https:// URLs are supported')
    if (url.port && url.port !== '443') throw new Error('Only port 443 is allowed')
    normalizeHost(url.hostname)
  } catch (err) {
    return Promise.resolve({ kind: 'https', url: String(urlInput), error: errMsg(err) })
  }
  return new Promise((resolve) => {
    const out: HttpsResult = { kind: 'https', url: url.toString() }
    const t0 = performance.now()
    let tLookup: number | undefined
    let tConnect: number | undefined
    let tTls: number | undefined
    let done = false
    const finish = (patch: Partial<HttpsResult>) => {
      if (done) return
      done = true
      resolve({ ...out, ...patch })
    }
    try {
      const req = https.request(url, { method: 'HEAD', agent: false, timeout: TIMEOUT, headers: { 'user-agent': 'SPECTER-netdiag', 'cache-control': 'no-cache' } })
      req.on('socket', (s) => {
        s.once('lookup', () => (tLookup = performance.now()))
        s.once('connect', () => (tConnect = performance.now()))
        s.once('secureConnect', () => (tTls = performance.now()))
      })
      req.on('response', (res) => {
        const tFirst = performance.now()
        const r = (v: number | undefined, from: number) => (v === undefined ? undefined : Math.round((v - from) * 10) / 10)
        const connectFrom = tLookup ?? t0
        out.status = res.statusCode
        out.httpVersion = res.httpVersion
        out.remoteAddress = res.socket?.remoteAddress
        out.dnsMs = r(tLookup, t0)
        out.connectMs = r(tConnect, connectFrom)
        out.tlsMs = tConnect !== undefined ? r(tTls, tConnect) : undefined
        out.ttfbMs = r(tFirst, tTls ?? tConnect ?? t0)
        res.resume()
        res.on('end', () => finish({ totalMs: ms(t0) }))
        res.on('error', () => finish({ totalMs: ms(t0) }))
      })
      req.on('timeout', () => {
        req.destroy(new Error('timed out'))
      })
      req.on('error', (err) => finish({ error: errMsg(err), totalMs: ms(t0) }))
      req.end()
    } catch (err) {
      finish({ error: errMsg(err) })
    }
  })
}

function name(o: Record<string, unknown> | undefined): string {
  if (!o) return ''
  const pick = (k: string) => (Array.isArray(o[k]) ? (o[k] as string[]).join(', ') : (o[k] as string | undefined))
  return [pick('CN'), pick('O')].filter(Boolean).join(' · ') || Object.values(o).flat().join(', ')
}

function tlsCheck(hostInput: string): Promise<TlsResult> {
  let host: string
  try {
    host = normalizeHost(hostInput)
  } catch (err) {
    return Promise.resolve({ kind: 'tls', host: String(hostInput), error: errMsg(err) })
  }
  return new Promise((resolve) => {
    const t0 = performance.now()
    let done = false
    const finish = (r: TlsResult) => {
      if (done) return
      done = true
      clearTimeout(to)
      try {
        sock.destroy()
      } catch {
        /* ignore */
      }
      resolve(r)
    }
    const sock = tls.connect({
      host,
      port: 443,
      servername: isIP(host) ? undefined : host,
      ALPNProtocols: ['h2', 'http/1.1'],
      // We inspect the certificate ourselves and report whether it validates.
      rejectUnauthorized: false
    })
    const to = setTimeout(() => finish({ kind: 'tls', host, error: 'timed out' }), TIMEOUT)
    sock.once('secureConnect', () => {
      try {
        const cert = sock.getPeerCertificate(true) as DetailedPeerCertificate
        const chain: { subject: string; issuer: string }[] = []
        let c: DetailedPeerCertificate | undefined = cert
        const seen = new Set<string>()
        while (c && c.fingerprint256 && !seen.has(c.fingerprint256) && chain.length < 6) {
          seen.add(c.fingerprint256)
          chain.push({ subject: name(c.subject as never), issuer: name(c.issuer as never) })
          c = c.issuerCertificate
        }
        const validTo = cert?.valid_to ? new Date(cert.valid_to) : null
        finish({
          kind: 'tls',
          host,
          ms: ms(t0),
          protocol: sock.getProtocol(),
          cipher: sock.getCipher()?.name,
          alpn: sock.alpnProtocol,
          authorized: sock.authorized,
          authorizationError: sock.authorizationError ? String(sock.authorizationError) : null,
          remoteAddress: sock.remoteAddress,
          cert: cert?.subject
            ? {
                subject: name(cert.subject as never),
                issuer: name(cert.issuer as never),
                validFrom: cert.valid_from,
                validTo: cert.valid_to,
                daysRemaining: validTo ? Math.floor((validTo.getTime() - Date.now()) / 86_400_000) : 0,
                altNames: (cert.subjectaltname ?? '')
                  .split(/,\s*/)
                  .filter(Boolean)
                  .slice(0, 24)
                  .map((s) => s.replace(/^DNS:/, '')),
                fingerprint256: cert.fingerprint256,
                serialNumber: cert.serialNumber,
                keyBits: typeof cert.bits === 'number' ? cert.bits : undefined
              }
            : undefined,
          chain
        })
      } catch (err) {
        finish({ kind: 'tls', host, error: errMsg(err) })
      }
    })
    sock.once('error', (err) => finish({ kind: 'tls', host, error: errMsg(err), ms: ms(t0) }))
  })
}

let busy = 0

export async function netDiag(req: NetDiagRequest): Promise<NetDiagResult> {
  if (busy >= 4) throw new Error('Too many diagnostics running — wait for the current ones to finish')
  busy++
  try {
    switch (req?.kind) {
      case 'connectivity':
        return await connectivity()
      case 'dns':
        return await dnsCheck(req.host)
      case 'https':
        return await httpsCheck(req.url)
      case 'tls':
        return await tlsCheck(req.host)
      default:
        throw new Error('Unknown diagnostic')
    }
  } finally {
    busy--
  }
}
