// System monitor — shared types and IPC contract augmentation.
//
// Every number here is a real measurement taken on this machine. Anything that
// cannot be measured is `null` (rendered as "Unavailable"), never estimated.
import type { AppMetricsEntry } from '../types'

export interface CpuMetrics {
  /** Whole-machine CPU utilisation 0–100 over the last interval (os.cpus() time deltas). */
  total: number
  /** Per logical processor 0–100. */
  perCore: number[]
  /**
   * Windows "% Processor Utility" (frequency-scaled; this is what Task Manager
   * shows), clamped to 0–100. Null when the performance counter is unavailable.
   */
  utility: { total: number | null; perCore: number[] } | null
}

export interface MemMetrics {
  /** Bytes in use (total − available). */
  used: number
  /** Physical memory in bytes. */
  total: number
}

export interface GpuMetrics {
  index: number
  name: string
  /** Utilisation 0–100, null when the driver does not report it. */
  util: number | null
  /** VRAM bytes. */
  memUsed: number | null
  memTotal: number | null
  /** °C */
  temp: number | null
  /** Watts */
  power: number | null
  powerLimit: number | null
  /** Fan speed 0–100 (null for fanless/passive or unsupported). */
  fan: number | null
  /** Graphics clock MHz. */
  clockMHz: number | null
}

export interface DiskMetrics {
  /** Drive root, e.g. "C:\\" */
  mount: string
  total: number
  free: number
}

export interface NetInterfaceRate {
  name: string
  rxBps: number
  txBps: number
  /** Virtual adapter (Hyper-V vSwitch, WAN miniport…) — excluded from the totals to avoid double counting. */
  virtual?: boolean
}

export interface NetMetrics {
  /** Bytes per second received / sent, summed over all interfaces. */
  rxBps: number
  txBps: number
  source: 'typeperf' | 'netstat'
  /** Per-interface rates (typeperf only). */
  interfaces?: NetInterfaceRate[]
}

export interface SpecterUsage {
  /** CPU used by all SPECTER processes as a share of total machine CPU (0–100). */
  cpu: number
  /** Private memory of all SPECTER processes, KB. */
  memKB: number
  processes: number
}

export interface SystemMetrics {
  ts: number
  /** Interval the sample was taken with (ms). */
  intervalMs: number
  cpu: CpuMetrics
  mem: MemMetrics
  /** null = no GPU telemetry source (see status.gpuError). Empty array never used. */
  gpu: GpuMetrics[] | null
  disks: DiskMetrics[]
  /** null until two samples exist or when no source works. */
  net: NetMetrics | null
  specter: SpecterUsage
}

export type PollReason = 'normal' | 'mode' | 'unfocused' | 'hidden'

export interface SystemStatus {
  running: boolean
  subscribers: number
  /** Configured performance.hudPollMs. */
  baseIntervalMs: number
  /** Interval currently in effect after mode / focus adjustments. */
  intervalMs: number
  reason: PollReason
  mode: string
  ticks: number
  /** Average / max synchronous main-thread time per tick (ms), last 60 ticks. */
  avgTickMs: number
  maxTickMs: number
  lastSampleTs: number | null
  gpuSource: 'nvidia-smi' | null
  gpuError: string | null
  netSource: 'typeperf' | 'netstat' | null
  netError: string | null
}

export interface SystemInfo {
  cpuModel: string
  logicalCores: number
  cpuSpeedMHz: number
  totalMem: number
  os: string
  arch: string
  uptimeSec: number
  /** Adapter names reported by Chromium (vendor-neutral; no live metrics). */
  gpuAdapters: string[]
  nvidiaSmiPath: string | null
}

export interface ProcessRow {
  name: string
  pid: number
  /** Working set, KB (tasklist "Mem Usage"). */
  memKB: number
  session: string
  /** Belongs to SPECTER (from app.getAppMetrics). */
  specter: boolean
}

export interface ProcessList {
  ts: number
  items: ProcessRow[]
  tookMs: number
  error?: string
}

export interface RevealResult {
  ok: boolean
  path?: string
  error?: string
}

export interface SpecterDashboard {
  ts: number
  processes: AppMetricsEntry[]
  logicalCores: number
  totalMem: number
  uptimeSec: number
}

export type NetDiagRequest =
  | { kind: 'connectivity' }
  | { kind: 'dns'; host: string }
  | { kind: 'https'; url: string }
  | { kind: 'tls'; host: string }

export interface ConnectivityResult {
  kind: 'connectivity'
  online: boolean
  checks: { target: string; ok: boolean; status?: number; ms?: number; error?: string }[]
}

export interface DnsResult {
  kind: 'dns'
  host: string
  /** OS resolver (includes the Windows DNS cache). */
  lookup: { ms: number; addresses: { address: string; family: number }[] } | { error: string }
  /** Direct query to the configured DNS servers (bypasses the OS cache). */
  query: { ms: number; a: string[]; aaaa: string[] } | { error: string }
  servers: string[]
}

export interface HttpsResult {
  kind: 'https'
  url: string
  status?: number
  httpVersion?: string
  remoteAddress?: string
  /** Phase timings in ms (fresh connection, no keep-alive). */
  dnsMs?: number
  connectMs?: number
  tlsMs?: number
  ttfbMs?: number
  totalMs?: number
  error?: string
}

export interface TlsResult {
  kind: 'tls'
  host: string
  ms?: number
  protocol?: string | null
  cipher?: string
  alpn?: string | false | null
  authorized?: boolean
  authorizationError?: string | null
  remoteAddress?: string
  cert?: {
    subject: string
    issuer: string
    validFrom: string
    validTo: string
    daysRemaining: number
    altNames: string[]
    fingerprint256: string
    serialNumber: string
    keyBits?: number
  }
  chain?: { subject: string; issuer: string }[]
  error?: string
}

export type NetDiagResult = ConnectivityResult | DnsResult | HttpsResult | TlsResult

declare module '../ipc' {
  interface IpcContract {
    'system:subscribe': (clientId: string) => SystemStatus
    'system:unsubscribe': (clientId: string) => void
    'system:history': () => SystemMetrics[]
    'system:status': () => SystemStatus
    'system:info': () => SystemInfo
    'system:processes': () => ProcessList
    'system:revealProcess': (pid: number) => RevealResult
    'system:specter': () => SpecterDashboard
    'system:netDiag': (req: NetDiagRequest) => NetDiagResult
  }
  interface IpcEvents {
    'system:metrics': SystemMetrics
  }
}
