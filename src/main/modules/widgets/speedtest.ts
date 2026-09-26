// Speed test against Cloudflare's public endpoints (speed.cloudflare.com).
// Runs only when the user presses "Start"; uses an isolated in-memory session
// (no cookies, no cache). Traffic and the user's IP address go to Cloudflare —
// the UI states this before the test.
import { session } from 'electron'
import { aggregateBandwidth, jitter, median, toMbps, type SpeedProgress, type SpeedResult, type SpeedSample } from '@shared/modules/widgets'
import { all, json, run, uid } from '../../db'
import { broadcast } from '../../ipc'
import { createLogger } from '../../logger'

const log = createLogger('widgets.speed')
const BASE = 'https://speed.cloudflare.com'
const LATENCY_PINGS = 12
const DOWN_SIZES = [100_000, 100_000, 1_000_000, 1_000_000, 10_000_000, 10_000_000, 25_000_000]
const UP_SIZES = [100_000, 1_000_000, 1_000_000, 5_000_000, 10_000_000]
/** A request slower than this stops escalating to larger payloads. */
const SLOW_MS = 5000
const PHASE_BUDGET_MS = 20_000
const HISTORY_MAX = 50

let sess: Electron.Session | null = null
const cleanSession = () => (sess ??= session.fromPartition('specter-widgets-speedtest', { cache: false }))

let current: AbortController | null = null

function progress(p: SpeedProgress): void {
  broadcast('widgets:speedProgress', p)
}

function serverMs(res: Response): number {
  // "cfRequestDuration;dur=12.3" — time Cloudflare spent handling the request.
  const m = /dur=([\d.]+)/.exec(res.headers.get('server-timing') ?? '')
  return m ? Number(m[1]) : 0
}

function coloOf(res: Response): string | null {
  const c = res.headers.get('colo') ?? res.headers.get('cf-meta-colo')
  if (c) return c.slice(0, 8)
  const ray = res.headers.get('cf-ray')
  return ray?.includes('-') ? ray.split('-').pop()!.slice(0, 8) : null
}

async function fetchCf(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  signal.addEventListener('abort', onAbort)
  const t = setTimeout(() => ctrl.abort(), 30_000)
  try {
    return await cleanSession().fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store', credentials: 'omit' } as RequestInit)
  } finally {
    clearTimeout(t)
    signal.removeEventListener('abort', onAbort)
  }
}

async function measureLatency(signal: AbortSignal): Promise<{ samples: number[]; colo: string | null }> {
  const samples: number[] = []
  let colo: string | null = null
  for (let i = 0; i <= LATENCY_PINGS; i++) {
    if (signal.aborted) throw new Error('Cancelled')
    const t0 = performance.now()
    const res = await fetchCf(`${BASE}/__down?bytes=0&r=${Math.random().toString(36).slice(2)}`, {}, signal)
    const t1 = performance.now()
    await res.arrayBuffer().catch(() => undefined)
    colo ??= coloOf(res)
    // The first request pays for DNS + TLS setup; skip it.
    if (i > 0) samples.push(Math.max(0.1, t1 - t0 - serverMs(res)))
    progress({ phase: 'latency', progress: (i / LATENCY_PINGS) * 0.1, latencyMs: samples.length ? median(samples) : undefined })
  }
  return { samples, colo }
}

async function measureDownload(signal: AbortSignal, onBytes: (n: number) => void): Promise<SpeedSample[]> {
  const out: SpeedSample[] = []
  const started = performance.now()
  for (let i = 0; i < DOWN_SIZES.length; i++) {
    const size = DOWN_SIZES[i]
    if (signal.aborted) throw new Error('Cancelled')
    const res = await fetchCf(`${BASE}/__down?bytes=${size}&r=${Math.random().toString(36).slice(2)}`, {}, signal)
    if (!res.ok || !res.body) throw new Error(`Download test failed (HTTP ${res.status})`)
    const reader = res.body.getReader()
    const t0 = performance.now()
    let got = 0
    let lastTick = t0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      got += value.byteLength
      onBytes(value.byteLength)
      const now = performance.now()
      if (now - lastTick > 200 && now - t0 > 50) {
        lastTick = now
        progress({ phase: 'download', progress: 0.1 + 0.5 * ((i + Math.min(1, got / size)) / DOWN_SIZES.length), mbps: toMbps(got, now - t0) })
      }
    }
    const ms = performance.now() - t0
    out.push({ bytes: got, ms })
    progress({ phase: 'download', progress: 0.1 + 0.5 * ((i + 1) / DOWN_SIZES.length), mbps: aggregateBandwidth(out) ?? toMbps(got, ms) })
    if (ms > SLOW_MS || performance.now() - started > PHASE_BUDGET_MS) break
  }
  return out
}

async function measureUpload(signal: AbortSignal, latency: number, onBytes: (n: number) => void): Promise<SpeedSample[]> {
  const out: SpeedSample[] = []
  const started = performance.now()
  for (let i = 0; i < UP_SIZES.length; i++) {
    const size = UP_SIZES[i]
    if (signal.aborted) throw new Error('Cancelled')
    // Request bodies are sent uncompressed, so the filler content does not matter.
    const body = Buffer.alloc(size, 'specter-speedtest-')
    const t0 = performance.now()
    const res = await fetchCf(`${BASE}/__up?r=${Math.random().toString(36).slice(2)}`, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } }, signal)
    await res.arrayBuffer().catch(() => undefined)
    const total = performance.now() - t0
    if (!res.ok) throw new Error(`Upload test failed (HTTP ${res.status})`)
    onBytes(size)
    // Subtract one round trip and the server's own processing time.
    const ms = Math.max(1, total - latency - serverMs(res))
    out.push({ bytes: size, ms })
    progress({ phase: 'upload', progress: 0.6 + 0.4 * ((i + 1) / UP_SIZES.length), mbps: aggregateBandwidth(out) ?? toMbps(size, ms) })
    if (total > SLOW_MS || performance.now() - started > PHASE_BUDGET_MS) break
  }
  return out
}

export async function runSpeedTest(opts: { upload: boolean }): Promise<SpeedResult> {
  if (current) throw new Error('A speed test is already running')
  const ctrl = new AbortController()
  current = ctrl
  const result: SpeedResult = { id: uid('st_'), at: Date.now(), colo: null, latencyMs: null, jitterMs: null, downMbps: null, upMbps: null, bytes: 0 }
  const count = (n: number) => (result.bytes += n)
  try {
    const lat = await measureLatency(ctrl.signal)
    result.colo = lat.colo
    result.latencyMs = lat.samples.length ? median(lat.samples) : null
    result.jitterMs = lat.samples.length > 1 ? jitter(lat.samples) : null
    progress({ phase: 'download', progress: 0.1, latencyMs: result.latencyMs ?? undefined, jitterMs: result.jitterMs ?? undefined })
    result.downMbps = aggregateBandwidth(await measureDownload(ctrl.signal, count))
    if (opts?.upload) {
      progress({ phase: 'upload', progress: 0.6, downMbps: result.downMbps ?? undefined })
      result.upMbps = aggregateBandwidth(await measureUpload(ctrl.signal, result.latencyMs ?? 0, count))
    }
    progress({ phase: 'done', progress: 1, latencyMs: result.latencyMs ?? undefined, jitterMs: result.jitterMs ?? undefined, downMbps: result.downMbps ?? undefined, upMbps: result.upMbps ?? undefined })
  } catch (err) {
    const msg = ctrl.signal.aborted ? 'Cancelled' : err instanceof Error ? err.message : String(err)
    result.error = msg
    progress({ phase: 'error', progress: 1, message: msg })
    log.warn(`speed test failed: ${msg}`)
  } finally {
    current = null
  }
  if (result.downMbps !== null || result.latencyMs !== null) {
    run('INSERT INTO wg_speed(id, at, data) VALUES(?,?,?)', result.id, result.at, JSON.stringify(result))
    run('DELETE FROM wg_speed WHERE id NOT IN (SELECT id FROM wg_speed ORDER BY at DESC LIMIT ?)', HISTORY_MAX)
  }
  return result
}

export function cancelSpeedTest(): void {
  current?.abort()
}

export function speedHistory(): SpeedResult[] {
  return all<{ data: string }>('SELECT data FROM wg_speed ORDER BY at DESC LIMIT ?', HISTORY_MAX)
    .map((r) => json<SpeedResult | null>(r.data, null))
    .filter((r): r is SpeedResult => !!r)
}

export function clearSpeedHistory(): void {
  run('DELETE FROM wg_speed')
}
