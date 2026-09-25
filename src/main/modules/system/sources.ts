// Native data sources for the system monitor. Everything is async, windowless,
// time-limited, and long-lived helpers are killed as soon as nobody watches.
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { statfs } from 'node:fs/promises'
import type { DiskMetrics, GpuMetrics, NetInterfaceRate, NetMetrics } from '@shared/modules/system'
import { createLogger } from '../../logger'
import { NVIDIA_QUERY_FIELDS, parseNetstatE, parseNvidiaSmiCsv, parseTypeperfHeader, parseTypeperfRow, rateFromCounters, sumInterfaces, TYPEPERF_COUNTERS, type TypeperfColumn } from './parsers'

const log = createLogger('system')
const IS_WIN = process.platform === 'win32'

export interface ExecResult {
  ok: boolean
  stdout: string
  stderr: string
  error?: string
  code?: string | number | null
}

/** execFile with a hard timeout, no window, bounded output. Never rejects. */
export function run(cmd: string, args: string[], timeoutMs: number, maxBuffer = 4 * 1024 * 1024): Promise<ExecResult> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { windowsHide: true, timeout: timeoutMs, maxBuffer, encoding: 'utf8' }, (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean }
          resolve({ ok: false, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: e.code ?? null, error: e.killed ? `timed out after ${timeoutMs} ms` : e.code === 'ENOENT' ? 'not found' : e.message.split('\n')[0] })
        } else resolve({ ok: true, stdout: String(stdout), stderr: String(stderr) })
      })
    } catch (err) {
      resolve({ ok: false, stdout: '', stderr: '', error: String((err as Error)?.message ?? err) })
    }
  })
}

// ---------------------------------------------------------------- GPU: nvidia-smi

const NV_QUERY = `--query-gpu=${NVIDIA_QUERY_FIELDS.join(',')}`
const NV_FORMAT = '--format=csv,noheader,nounits'

export class NvidiaSmi {
  /** undefined = not probed yet, null = unavailable. */
  path: string | null | undefined = undefined
  error: string | null = null
  private proc: ChildProcess | null = null
  private intervalMs = 0
  private latest: { ts: number; gpus: GpuMetrics[] } | null = null
  private pending = new Map<number, GpuMetrics>()
  private count = 1
  private buf = ''
  private wanted = false
  private restarts = 0
  private probing: Promise<boolean> | null = null

  probe(): Promise<boolean> {
    if (this.path !== undefined) return Promise.resolve(this.path !== null)
    if (this.probing) return this.probing
    this.probing = (async () => {
      const candidates = IS_WIN
        ? ['nvidia-smi', 'C:\\Windows\\System32\\nvidia-smi.exe', 'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe']
        : ['nvidia-smi']
      let lastErr = 'nvidia-smi not found — no NVIDIA driver installed or it is not on PATH'
      for (const c of candidates) {
        const r = await run(c, [NV_QUERY, NV_FORMAT], 6000)
        if (r.ok) {
          const gpus = parseNvidiaSmiCsv(r.stdout)
          if (gpus.length) {
            this.path = c
            this.count = gpus.length
            this.latest = { ts: Date.now(), gpus }
            this.error = null
            log.info(`nvidia-smi available (${c}): ${gpus.map((g) => g.name).join(', ')}`)
            return true
          }
          lastErr = 'nvidia-smi returned no GPUs' + (r.stdout.trim() ? `: ${r.stdout.trim().slice(0, 160)}` : '')
        } else if (r.code !== 'ENOENT') {
          lastErr = `nvidia-smi failed: ${(r.stdout || r.stderr || r.error || '').trim().slice(0, 200)}`
        }
      }
      this.path = null
      this.error = lastErr
      log.info('GPU telemetry unavailable: ' + lastErr)
      return false
    })().finally(() => (this.probing = null))
    return this.probing
  }

  /** Start (or re-time) the long-lived `nvidia-smi -lms` loop. */
  async start(intervalMs: number): Promise<void> {
    this.wanted = true
    if (!(await this.probe()) || !this.wanted) return
    if (this.proc && this.intervalMs === intervalMs) return
    this.kill()
    this.intervalMs = intervalMs
    this.buf = ''
    this.pending.clear()
    try {
      const p = spawn(this.path!, [NV_QUERY, NV_FORMAT, '-lms', String(intervalMs)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      this.proc = p
      p.stdout!.setEncoding('utf8')
      p.stdout!.on('data', (d: string) => this.onData(d))
      p.stderr!.on('data', () => undefined)
      p.on('error', (err) => {
        this.error = 'nvidia-smi: ' + err.message
      })
      p.on('exit', (code) => {
        if (this.proc !== p) return
        this.proc = null
        if (!this.wanted) return
        this.restarts++
        if (this.restarts > 5) {
          this.error = `nvidia-smi exited repeatedly (code ${code}); GPU telemetry stopped`
          log.warn(this.error)
          return
        }
        log.warn(`nvidia-smi exited (code ${code}); restarting`)
        setTimeout(() => this.wanted && this.start(this.intervalMs), 2000 * this.restarts)
      })
    } catch (err) {
      this.error = 'nvidia-smi: ' + String((err as Error)?.message ?? err)
    }
  }

  private onData(d: string): void {
    this.buf += d
    const lines = this.buf.split(/\r?\n/)
    this.buf = lines.pop() ?? ''
    for (const line of lines) {
      const g = parseNvidiaSmiCsv(line)[0]
      if (!g) continue
      if (this.pending.has(g.index)) this.flush()
      this.pending.set(g.index, g)
      if (this.pending.size >= this.count) this.flush()
    }
  }

  private flush(): void {
    if (!this.pending.size) return
    this.latest = { ts: Date.now(), gpus: [...this.pending.values()].sort((a, b) => a.index - b.index) }
    this.pending.clear()
    this.restarts = 0
    this.error = null
  }

  private kill(): void {
    const p = this.proc
    this.proc = null
    if (p && p.exitCode === null) {
      try {
        p.kill()
      } catch {
        /* already gone */
      }
    }
  }

  stop(): void {
    this.wanted = false
    this.kill()
  }

  /** Latest sample, or null if unavailable / stale (never returns old data as current). */
  sample(now: number): GpuMetrics[] | null {
    if (!this.latest) return null
    const maxAge = Math.max(this.intervalMs * 3, 8000)
    return now - this.latest.ts <= maxAge ? this.latest.gpus : null
  }

  /** One-shot query for diagnostics (does not affect the loop). */
  async oneShot(): Promise<{ ok: boolean; detail: string }> {
    if (!(await this.probe())) return { ok: false, detail: this.error ?? 'Unavailable' }
    const t0 = Date.now()
    const r = await run(this.path!, [NV_QUERY, NV_FORMAT], 5000)
    const gpus = r.ok ? parseNvidiaSmiCsv(r.stdout) : []
    if (!gpus.length) return { ok: false, detail: r.error ?? 'No GPUs reported' }
    return { ok: true, detail: `${gpus.map((g) => g.name).join(', ')} · query ${Date.now() - t0} ms · ${this.path}` }
  }
}

// ---------------------------------------------------------------- Network: typeperf → netstat -e

export class PerfCounters {
  source: 'typeperf' | 'netstat' | null = null
  error: string | null = null
  private tp: ChildProcess | null = null
  private tpFailed = !IS_WIN
  private cols: TypeperfColumn[] | null = null
  private buf = ''
  private lastRowTs = ''
  private seconds = 0
  private watchdog: NodeJS.Timeout | null = null
  private latest: { t: number; rxBps: number; txBps: number; interfaces?: NetInterfaceRate[]; source: 'typeperf' | 'netstat' } | null = null
  private util: { t: number; total: number | null; perCore: number[] } | null = null
  private prevCounters: { rx: number; tx: number; t: number } | null = null
  private netstatBusy = false
  private wanted = false
  private intervalMs = 2000

  start(intervalMs: number): void {
    this.wanted = true
    this.intervalMs = intervalMs
    if (this.tpFailed) {
      this.source = IS_WIN ? 'netstat' : null
      if (!IS_WIN) this.error = 'Network throughput is only implemented for Windows'
      return
    }
    const seconds = Math.max(1, Math.round(intervalMs / 1000))
    if (this.tp && this.seconds === seconds) return
    this.killTp()
    this.seconds = seconds
    this.cols = null
    this.buf = ''
    this.lastRowTs = ''
    try {
      const p = spawn('typeperf', [...TYPEPERF_COUNTERS, '-si', String(seconds)], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      this.tp = p
      this.source = 'typeperf'
      p.stdout!.setEncoding('utf8')
      p.stdout!.on('data', (d: string) => this.onTpData(d))
      p.stderr!.on('data', () => undefined)
      p.on('error', (err) => this.fallback('typeperf unavailable: ' + err.message))
      p.on('exit', (code) => {
        if (this.tp !== p) return
        this.tp = null
        if (this.wanted) this.fallback(`typeperf exited (code ${code})`)
      })
      // No header + first row within a few intervals → counters unavailable (e.g. localised names).
      if (this.watchdog) clearTimeout(this.watchdog)
      this.watchdog = setTimeout(() => {
        this.watchdog = null
        if (this.tp === p && !this.lastRowTs) this.fallback('typeperf produced no samples')
      }, Math.max(8000, seconds * 3000 + 2000))
    } catch (err) {
      this.fallback('typeperf: ' + String((err as Error)?.message ?? err))
    }
  }

  private fallback(reason: string): void {
    log.info(`network throughput: ${reason}; falling back to netstat -e`)
    this.tpFailed = true
    this.killTp()
    this.source = 'netstat'
    this.error = null
    this.util = null
  }

  private onTpData(d: string): void {
    this.buf += d
    const lines = this.buf.split(/\r?\n/)
    this.buf = lines.pop() ?? ''
    for (const l of lines) this.tpLine(l, true)
    // typeperf terminates a record with the *next* newline; accept the tail as soon as it is complete.
    if (this.buf && this.cols) this.tpLine(this.buf, false)
    if (/No valid counters|Error:/i.test(this.buf)) this.fallback('typeperf: ' + this.buf.trim().slice(0, 120))
  }

  private tpLine(line: string, complete: boolean): void {
    const t = line.trim()
    if (!t) return
    if (!this.cols) {
      if (!complete) return
      const cols = parseTypeperfHeader(t)
      if (cols) this.cols = cols
      else if (/error|no valid/i.test(t)) this.fallback('typeperf: ' + t.slice(0, 120))
      return
    }
    const row = parseTypeperfRow(t, this.cols)
    if (!row || row.ts === this.lastRowTs) return
    this.lastRowTs = row.ts
    const sum = sumInterfaces(row.interfaces)
    const now = Date.now()
    this.latest = { t: now, ...sum, interfaces: row.interfaces, source: 'typeperf' }
    if (row.util) this.util = { t: now, ...row.util }
  }

  private killTp(): void {
    if (this.watchdog) clearTimeout(this.watchdog)
    this.watchdog = null
    const p = this.tp
    this.tp = null
    if (p && p.exitCode === null) {
      try {
        p.kill()
      } catch {
        /* gone */
      }
    }
  }

  /** Called every poll tick: netstat mode reads the counters asynchronously. */
  tick(): void {
    if (this.source !== 'netstat' || this.netstatBusy) return
    this.netstatBusy = true
    run('netstat', ['-e'], 4000, 256 * 1024)
      .then((r) => {
        const c = r.ok ? parseNetstatE(r.stdout) : null
        if (!c) {
          this.error = 'netstat -e: ' + (r.error ?? 'unrecognised output')
          return
        }
        this.error = null
        const cur = { ...c, t: Date.now() }
        const rate = this.prevCounters ? rateFromCounters(this.prevCounters, cur) : null
        this.prevCounters = cur
        if (rate) this.latest = { t: cur.t, ...rate, source: 'netstat' }
      })
      .finally(() => (this.netstatBusy = false))
  }

  stop(): void {
    this.wanted = false
    this.killTp()
    this.prevCounters = null
  }

  private maxAge(): number {
    return Math.max(this.intervalMs * 3, (this.seconds || 1) * 3000, 8000)
  }

  /** Windows "% Processor Utility" (Task Manager's CPU figure), or null. */
  cpuUtility(now: number): { total: number | null; perCore: number[] } | null {
    const u = this.util
    if (!u || now - u.t > this.maxAge()) return null
    return { total: u.total, perCore: u.perCore }
  }

  sample(now: number): NetMetrics | null {
    const l = this.latest
    if (!l) return null
    if (now - l.t > this.maxAge()) return null
    return { rxBps: l.rxBps, txBps: l.txBps, source: l.source, interfaces: l.interfaces }
  }
}

// ---------------------------------------------------------------- Disks: fs.statfs

export class Disks {
  private roots: string[] | null = null
  private enumeratedAt = 0
  private refreshedAt = 0
  private busy = false
  private latest: DiskMetrics[] = []

  private async enumerate(): Promise<string[]> {
    if (!IS_WIN) return ['/']
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
    const found: string[] = []
    await Promise.all(
      letters.map(async (L) => {
        const root = `${L}:\\`
        const st = await withTimeout(statfs(root).catch(() => null), 2500)
        if (st && st.blocks > 0) found.push(root)
      })
    )
    return found.sort()
  }

  /** Kicks an async refresh if stale; returns the cached list immediately. */
  sample(now: number): DiskMetrics[] {
    if (!this.busy && now - this.refreshedAt > 30_000) {
      this.busy = true
      this.refresh(now).finally(() => (this.busy = false))
    }
    return this.latest
  }

  private async refresh(now: number): Promise<void> {
    try {
      if (!this.roots || now - this.enumeratedAt > 5 * 60_000) {
        this.roots = await this.enumerate()
        this.enumeratedAt = now
      }
      const out: DiskMetrics[] = []
      for (const root of this.roots) {
        const st = await withTimeout(statfs(root).catch(() => null), 2500)
        if (st && st.blocks > 0) out.push({ mount: root, total: st.blocks * st.bsize, free: st.bavail * st.bsize })
      }
      this.latest = out
      this.refreshedAt = Date.now()
    } catch (err) {
      log.warn('disk refresh failed', err)
      this.refreshedAt = Date.now()
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))])
}
