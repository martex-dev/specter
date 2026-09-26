import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { LogEntry } from '@shared/types'

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const
const ring: LogEntry[] = []
const RING_MAX = 2000
let minLevel: LogEntry['level'] = 'info'
let logFile: string | null = null

export function initLogFile(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true })
    logFile = join(dir, 'specter.log')
    try {
      if (statSync(logFile).size > 5 * 1024 * 1024) renameSync(logFile, join(dir, 'specter.old.log'))
    } catch {
      /* no file yet */
    }
  } catch {
    logFile = null
  }
}

export function setLogLevel(level: LogEntry['level']): void {
  minLevel = level
}

function write(level: LogEntry['level'], scope: string, message: string, data?: unknown): void {
  const entry: LogEntry = { ts: Date.now(), level, scope, message, data: data instanceof Error ? { message: data.message, stack: data.stack } : data }
  ring.push(entry)
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX)
  if (LEVELS[level] < LEVELS[minLevel]) return
  const line = `${new Date(entry.ts).toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${data !== undefined ? ' ' + safeJson(entry.data) : ''}`
  try {
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  } catch {
    /* a closed stdout/stderr pipe (EPIPE) must not throw into callers, e.g. the updater's quit handler */
  }
  if (logFile) {
    try {
      appendFileSync(logFile, line + '\n')
    } catch {
      /* disk issues must never crash the browser */
    }
  }
}

function safeJson(v: unknown): string {
  try {
    const s = JSON.stringify(v)
    return s && s.length > 2000 ? s.slice(0, 2000) + '…' : (s ?? '')
  } catch {
    return String(v)
  }
}

export function createLogger(scope: string) {
  return {
    debug: (m: string, d?: unknown) => write('debug', scope, m, d),
    info: (m: string, d?: unknown) => write('info', scope, m, d),
    warn: (m: string, d?: unknown) => write('warn', scope, m, d),
    error: (m: string, d?: unknown) => write('error', scope, m, d)
  }
}

export function logEntries(limit = 500): LogEntry[] {
  return ring.slice(-limit)
}

export function clearLogs(): void {
  ring.length = 0
}

export function rawLog(level: LogEntry['level'], scope: string, message: string): void {
  write(level, scope, message)
}
