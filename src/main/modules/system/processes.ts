// On-demand process list (tasklist) and "open file location". Read-only:
// SPECTER never terminates or modifies other processes.
import { app, shell } from 'electron'
import { existsSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import type { ProcessList, RevealResult } from '@shared/modules/system'
import { parseTasklistCsv } from './parsers'
import { run } from './sources'

let inflight: Promise<ProcessList> | null = null

export function listProcesses(): Promise<ProcessList> {
  if (inflight) return inflight
  inflight = (async (): Promise<ProcessList> => {
    const t0 = performance.now()
    if (process.platform !== 'win32') return { ts: Date.now(), items: [], tookMs: 0, error: 'The process viewer is only implemented for Windows' }
    const own = new Set(app.getAppMetrics().map((m) => m.pid))
    const r = await run('tasklist', ['/FO', 'CSV', '/NH'], 10_000, 16 * 1024 * 1024)
    const items = r.ok ? parseTasklistCsv(r.stdout, own) : []
    return {
      ts: Date.now(),
      items,
      tookMs: Math.round(performance.now() - t0),
      error: r.ok ? (items.length ? undefined : 'tasklist returned no processes') : `tasklist failed: ${r.error ?? 'unknown error'}`
    }
  })().finally(() => (inflight = null))
  return inflight
}

export async function revealProcess(pid: number): Promise<RevealResult> {
  if (!Number.isInteger(pid) || pid <= 4 || pid > 0x7fffffff) return { ok: false, error: 'Not a user-mode process' }
  let path = ''
  if (app.getAppMetrics().some((m) => m.pid === pid)) path = process.execPath
  else {
    // pid is a validated integer, so it is safe to interpolate.
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).Path`], 10_000, 64 * 1024)
    if (!r.ok) {
      const msg = (r.stderr || r.error || '').toString()
      return { ok: false, error: /Cannot find a process/i.test(msg) ? 'The process has exited' : `Could not query the process: ${msg.split('\n')[0].slice(0, 160)}` }
    }
    path = r.stdout.trim().split(/\r?\n/)[0]?.trim() ?? ''
  }
  if (!path) return { ok: false, error: 'Path not available — the process is protected, elevated, or owned by another user' }
  if (!existsSync(path)) return { ok: false, path, error: 'The executable no longer exists on disk' }
  shell.showItemInFolder(path)
  return { ok: true, path }
}
