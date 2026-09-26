// Toolkit — main-process module entry.
//
// Provides `tools:http` for the HTTP request tester (specter://toolkit/http),
// implemented with Electron's net stack (`session.fetch`, same as `net.fetch`
// but bound to an isolated in-memory session).
// Requests are only ever sent when the user presses "Send" in that tool, go to
// exactly the URL they entered, use a clean (cookie-less) session and are
// never logged with their headers or body.
import { session } from 'electron'
import type { HttpToolRequest, HttpToolResponse } from '@shared/modules/toolkit'
import { handle } from '../../ipc'
import { createLogger } from '../../logger'

const log = createLogger('toolkit')

const MAX_BODY_BYTES = 5 * 1024 * 1024
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
// Headers Chromium's network stack manages itself / refuses from fetch().
const FORBIDDEN = new Set(['host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'expect', 'te', 'trailer'])

let toolSession: Electron.Session | null = null
function clean(): Electron.Session {
  // In-memory partition: no cookies or cache shared with browsing profiles.
  if (!toolSession) toolSession = session.fromPartition('specter-toolkit-http', { cache: false })
  return toolSession
}

function looksBinary(bytes: Uint8Array, contentType: string): boolean {
  if (/^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|.*\+json|.*\+xml))/i.test(contentType)) return false
  if (/^(image|audio|video|font)\/|octet-stream|zip|pdf|protobuf/i.test(contentType)) return true
  const n = Math.min(bytes.length, 2048)
  let ctrl = 0
  for (let i = 0; i < n; i++) {
    const b = bytes[i]
    if (b === 0) return true
    if (b < 9 || (b > 13 && b < 32)) ctrl++
  }
  return n > 0 && ctrl / n > 0.1
}

/** Decodes a text body using the Content-Type charset (UTF-8 when absent or unknown). */
function decodeText(bytes: Uint8Array, contentType: string): string {
  const charset = /;\s*charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1]
  if (charset) {
    try {
      return new TextDecoder(charset, { fatal: false }).decode(bytes)
    } catch {
      /* unknown label — fall back to UTF-8 */
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

async function perform(req: HttpToolRequest): Promise<HttpToolResponse> {
  const started = performance.now()
  const empty: HttpToolResponse = {
    ok: false,
    status: 0,
    statusText: '',
    url: req.url,
    redirected: false,
    headers: [],
    body: '',
    binary: false,
    truncated: false,
    bytes: 0,
    ttfbMs: 0,
    totalMs: 0
  }
  let url: URL
  try {
    url = new URL(req.url)
  } catch {
    return { ...empty, error: 'Invalid URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ...empty, error: 'Only http:// and https:// URLs are supported' }
  const method = String(req.method || 'GET').toUpperCase()
  if (!METHODS.has(method)) return { ...empty, error: `Unsupported method ${method}` }

  const headers = new Headers()
  for (const [k, v] of req.headers ?? []) {
    const key = String(k).trim()
    if (!key || FORBIDDEN.has(key.toLowerCase())) continue
    try {
      headers.append(key, String(v))
    } catch {
      return { ...empty, error: `Invalid header "${key}"` }
    }
  }
  const timeoutMs = Math.max(1000, Math.min(120_000, req.timeoutMs ?? 30_000))
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await clean().fetch(url.toString(), {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : (req.body ?? undefined),
      redirect: req.followRedirects === false ? 'manual' : 'follow',
      signal: ctrl.signal,
      cache: 'no-store',
      credentials: 'omit'
    } as RequestInit)
    const ttfbMs = performance.now() - started
    const outHeaders: [string, string][] = []
    res.headers.forEach((v, k) => outHeaders.push([k, v]))
    const contentType = res.headers.get('content-type') ?? ''

    // Stream the body so huge responses are cut off instead of buffered whole.
    const chunks: Uint8Array[] = []
    let total = 0
    let truncated = false
    const reader = res.body?.getReader()
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_BODY_BYTES) {
          truncated = true
          const keep = value.byteLength - (total - MAX_BODY_BYTES)
          if (keep > 0) chunks.push(value.subarray(0, keep))
          await reader.cancel().catch(() => undefined)
          break
        }
        chunks.push(value)
      }
    }
    const bytes = new Uint8Array(Math.min(total, MAX_BODY_BYTES))
    let off = 0
    for (const c of chunks) {
      bytes.set(c, off)
      off += c.byteLength
    }
    const binary = looksBinary(bytes, contentType)
    const body = binary ? '' : decodeText(bytes, contentType)
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      url: res.url || url.toString(),
      redirected: res.redirected,
      headers: outHeaders,
      body,
      binary,
      truncated,
      bytes: total,
      ttfbMs,
      totalMs: performance.now() - started
    }
  } catch (err) {
    const aborted = ctrl.signal.aborted
    const message = aborted ? `Timed out after ${Math.round(timeoutMs / 1000)} s` : err instanceof Error ? err.message : String(err)
    return { ...empty, error: message, totalMs: performance.now() - started }
  } finally {
    clearTimeout(timer)
  }
}

export function register(): void {
  handle('tools:http', async (_e, req) => {
    const r = await perform(req)
    // Log only method/host/status — never headers or bodies (may hold secrets).
    let host = ''
    try {
      host = new URL(req.url).host
    } catch {
      /* invalid */
    }
    log.info(`http tester ${String(req.method).toUpperCase()} ${host} → ${r.error ? 'error' : r.status}`)
    return r
  })
}
