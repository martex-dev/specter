// Pure parsers and math for the system monitor. No Electron / Node side
// effects here so everything is unit-testable (tests/unit/system-*.test.ts).
import { isIP } from 'node:net'
import type { GpuMetrics, NetInterfaceRate, ProcessRow } from '@shared/modules/system'

// ---------------------------------------------------------------- CPU

export interface CpuTimes {
  user: number
  nice: number
  sys: number
  idle: number
  irq: number
}

/**
 * CPU utilisation from two os.cpus() snapshots. Each core is busy/total of its
 * own time delta; the machine total is the sum over all cores (so it weights
 * cores equally, like Task Manager's "Processor time"). Returns null when the
 * snapshots are incompatible (core count changed) or no time elapsed.
 */
export function cpuUsage(prev: CpuTimes[], cur: CpuTimes[]): { total: number; perCore: number[] } | null {
  if (!prev.length || prev.length !== cur.length) return null
  let busySum = 0
  let totalSum = 0
  const perCore: number[] = []
  for (let i = 0; i < cur.length; i++) {
    const a = prev[i]
    const b = cur[i]
    const idle = b.idle - a.idle
    const total = b.user - a.user + (b.nice - a.nice) + (b.sys - a.sys) + (b.irq - a.irq) + idle
    if (total <= 0 || idle < 0) {
      perCore.push(0)
      continue
    }
    const busy = Math.max(0, total - idle)
    perCore.push(clampPct((busy / total) * 100))
    busySum += busy
    totalSum += total
  }
  if (totalSum <= 0) return null
  return { total: clampPct((busySum / totalSum) * 100), perCore }
}

function clampPct(v: number): number {
  return Math.round(Math.min(100, Math.max(0, v)) * 10) / 10
}

// ---------------------------------------------------------------- CSV

/** Parses one CSV line with double-quote escaping ("" inside quotes). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else q = false
      } else cur += c
    } else if (c === '"') q = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

// ---------------------------------------------------------------- nvidia-smi

/** Fields requested from nvidia-smi, in this order. */
export const NVIDIA_QUERY_FIELDS = [
  'index',
  'name',
  'utilization.gpu',
  'memory.used',
  'memory.total',
  'temperature.gpu',
  'power.draw',
  'power.limit',
  'fan.speed',
  'clocks.gr'
] as const

function nvNum(s: string | undefined): number | null {
  if (s === undefined) return null
  const t = s.trim()
  // "[N/A]", "[Not Supported]", "N/A", "[Unknown Error]" …
  if (!t || /n\/a|not supported|unknown|error|insufficient/i.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * Parses `nvidia-smi --query-gpu=<NVIDIA_QUERY_FIELDS> --format=csv,noheader,nounits`.
 * Memory is reported in MiB and converted to bytes. Lines that do not parse are skipped.
 */
export function parseNvidiaSmiCsv(text: string): GpuMetrics[] {
  const out: GpuMetrics[] = []
  const n = NVIDIA_QUERY_FIELDS.length
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    let parts = line.split(',').map((p) => p.trim())
    if (parts.length < n) continue
    if (parts.length > n) {
      // A comma inside the product name: glue the extra fields back into it.
      const extra = parts.length - n
      parts = [parts[0], parts.slice(1, 2 + extra).join(', '), ...parts.slice(2 + extra)]
    }
    const index = nvNum(parts[0])
    if (index === null) continue
    const mib = (v: number | null) => (v === null ? null : Math.round(v * 1048576))
    out.push({
      index,
      name: parts[1],
      util: nvNum(parts[2]),
      memUsed: mib(nvNum(parts[3])),
      memTotal: mib(nvNum(parts[4])),
      temp: nvNum(parts[5]),
      power: nvNum(parts[6]),
      powerLimit: nvNum(parts[7]),
      fan: nvNum(parts[8]),
      clockMHz: nvNum(parts[9])
    })
  }
  return out
}

// ---------------------------------------------------------------- netstat -e

/**
 * Parses the byte counters from `netstat -e` (Windows). The labels are
 * localised, so the first row that ends in two integers is taken as "Bytes"
 * (it is always the first counter row).
 */
export function parseNetstatE(text: string): { rx: number; tx: number } | null {
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*\S.*?\s+(\d+)\s+(\d+)\s*$/.exec(raw)
    if (m) return { rx: Number(m[1]), tx: Number(m[2]) }
  }
  return null
}

const U32 = 2 ** 32

/**
 * Delta of a counter that may be 32-bit and wrap around (netstat -e uses
 * 32-bit interface counters). Returns null if the counter apparently reset.
 */
export function counterDelta(prev: number, cur: number): number | null {
  if (cur >= prev) return cur - prev
  if (prev < U32 && cur < U32) return cur + U32 - prev
  return null
}

export function rateFromCounters(prev: { rx: number; tx: number; t: number }, cur: { rx: number; tx: number; t: number }): { rxBps: number; txBps: number } | null {
  const dt = (cur.t - prev.t) / 1000
  if (dt <= 0) return null
  const rx = counterDelta(prev.rx, cur.rx)
  const tx = counterDelta(prev.tx, cur.tx)
  if (rx === null || tx === null) return null
  return { rxBps: Math.round(rx / dt), txBps: Math.round(tx / dt) }
}

// ---------------------------------------------------------------- typeperf

/** Counters read by the long-lived typeperf helper, in this order. */
export const TYPEPERF_COUNTERS = [
  '\\Network Interface(*)\\Bytes Received/sec',
  '\\Network Interface(*)\\Bytes Sent/sec',
  '\\Processor Information(*)\\% Processor Utility'
] as const

export type TypeperfRole = 'rx' | 'tx' | 'util'
const ROLE_ORDER: TypeperfRole[] = ['rx', 'tx', 'util']

export interface TypeperfColumn {
  role: TypeperfRole
  /** Interface name (rx/tx) or processor instance ("_Total", "0,5", …). */
  instance: string
}

/** Adapters that mirror traffic already counted on a physical NIC. */
export const VIRTUAL_IFACE = /vEthernet|Hyper-V|WAN Miniport|Teredo|isatap|6to4|Pseudo-Interface|Loopback|VirtualBox Host-Only|VMware Virtual/i

function roleByName(counter: string): TypeperfRole | null {
  if (/Bytes Received/i.test(counter)) return 'rx'
  if (/Bytes Sent/i.test(counter)) return 'tx'
  if (/Processor Utility/i.test(counter)) return 'util'
  return null
}

/**
 * Header of `typeperf <TYPEPERF_COUNTERS…>`. Returns one entry per data column
 * (column 0, the timestamp, is dropped). Counter names are matched in English;
 * on localised Windows the columns are assigned by the order of the counters.
 */
export function parseTypeperfHeader(line: string): TypeperfColumn[] | null {
  const cells = parseCsvLine(line.trim())
  if (cells.length < 2 || !/PDH-CSV/i.test(cells[0])) return null
  const parsed: { instance: string; counter: string }[] = []
  for (const c of cells.slice(1)) {
    const m = /\\[^\\]*\((.*)\)\\([^\\]+)$/.exec(c)
    if (!m) return null
    parsed.push({ instance: m[1], counter: m[2] })
  }
  const distinct = [...new Set(parsed.map((p) => p.counter))]
  const named = distinct.map(roleByName)
  const allNamed = named.every((r) => r !== null)
  if (!allNamed && distinct.length > ROLE_ORDER.length) return null
  const roleOf = new Map(distinct.map((c, i) => [c, allNamed ? named[i]! : ROLE_ORDER[i]]))
  return parsed.map((p) => ({ role: roleOf.get(p.counter)!, instance: p.instance }))
}

export function sumInterfaces(ifaces: NetInterfaceRate[]): { rxBps: number; txBps: number } {
  let rxBps = 0
  let txBps = 0
  for (const i of ifaces) {
    if (i.virtual) continue
    rxBps += i.rxBps
    txBps += i.txBps
  }
  return { rxBps, txBps }
}

export interface TypeperfRow {
  ts: string
  interfaces: (NetInterfaceRate & { virtual: boolean })[]
  /** "% Processor Utility" (what Task Manager shows), clamped to 0–100. Null when not in the header. */
  util: { total: number | null; perCore: number[] } | null
}

/** One data row. Null if the row is incomplete or any value is invalid. */
export function parseTypeperfRow(line: string, cols: TypeperfColumn[]): TypeperfRow | null {
  const cells = parseCsvLine(line.trim())
  if (cells.length !== cols.length + 1) return null
  const by = new Map<string, NetInterfaceRate & { virtual: boolean }>()
  const cores: { g: number; i: number; v: number }[] = []
  let utilTotal: number | null = null
  let hasUtil = false
  for (let i = 0; i < cols.length; i++) {
    const raw = cells[i + 1].trim()
    const v = Number(raw)
    if (raw === '' || !Number.isFinite(v) || v < 0) return null
    const col = cols[i]
    if (col.role === 'util') {
      hasUtil = true
      const pct = Math.round(Math.min(100, v) * 10) / 10
      if (col.instance === '_Total') utilTotal = pct
      else {
        const m = /^(\d+),(\d+)$/.exec(col.instance)
        if (m) cores.push({ g: Number(m[1]), i: Number(m[2]), v: pct })
      }
      continue
    }
    const r = by.get(col.instance) ?? { name: col.instance, rxBps: 0, txBps: 0, virtual: VIRTUAL_IFACE.test(col.instance) }
    if (col.role === 'rx') r.rxBps = Math.round(v)
    else r.txBps = Math.round(v)
    by.set(col.instance, r)
  }
  cores.sort((a, b) => a.g - b.g || a.i - b.i)
  return { ts: cells[0], interfaces: [...by.values()], util: hasUtil ? { total: utilTotal, perCore: cores.map((c) => c.v) } : null }
}

// ---------------------------------------------------------------- tasklist

/** Digits only — tasklist formats memory with locale separators ("16,724 K", "16.724 K", "16 724 K"). */
function digits(s: string): number {
  const d = s.replace(/[^\d]/g, '')
  return d ? Number(d) : 0
}

/** Parses `tasklist /FO CSV /NH`: "Image Name","PID","Session Name","Session#","Mem Usage". */
export function parseTasklistCsv(text: string, specterPids: Set<number> = new Set()): ProcessRow[] {
  const out: ProcessRow[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('"')) continue
    const c = parseCsvLine(line)
    if (c.length < 5) continue
    const pid = Number(c[1])
    if (!Number.isInteger(pid)) continue
    out.push({ name: c[0], pid, session: c[2], memKB: digits(c[4]), specter: specterPids.has(pid) })
  }
  return out
}

// ---------------------------------------------------------------- polling policy

export type PollMode = 'normal' | 'coding' | 'ml' | 'research' | 'trading' | 'gaming' | 'battery' | string

/**
 * Effective poll interval. Gaming / battery slow down to ≥5 s (×2.5); all
 * windows unfocused ≥4 s (×2); all windows hidden/minimised ≥10 s (×5).
 */
export function effectiveInterval(
  baseMs: number,
  mode: PollMode,
  windows: { visible: number; focused: number }
): { ms: number; reason: 'normal' | 'mode' | 'unfocused' | 'hidden' } {
  const base = Math.min(60_000, Math.max(500, Number.isFinite(baseMs) ? baseMs : 2000))
  let ms = base
  let reason: 'normal' | 'mode' | 'unfocused' | 'hidden' = 'normal'
  if (mode === 'gaming' || mode === 'battery') {
    ms = Math.max(base * 2.5, 5000)
    reason = 'mode'
  }
  if (windows.visible === 0) {
    const hidden = Math.max(base * 5, 10_000)
    if (hidden > ms) {
      ms = hidden
      reason = 'hidden'
    }
  } else if (windows.focused === 0) {
    const unf = Math.max(base * 2, 4000)
    if (unf > ms) {
      ms = unf
      reason = 'unfocused'
    }
  }
  return { ms: Math.round(ms), reason }
}

// ---------------------------------------------------------------- network diagnostics input

/** Accepts "example.com", "https://example.com/path" → "example.com". Throws on anything else. */
export function normalizeHost(input: string): string {
  let s = String(input ?? '').trim()
  if (!s) throw new Error('Enter a host name')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = new URL(s).hostname
  s = s.replace(/^\[|\]$/g, '').replace(/\/.*$/, '')
  if (isIP(s)) return s
  if (s.length > 253 || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)*\.?$/i.test(s)) throw new Error('Not a valid host name')
  return s.toLowerCase()
}
