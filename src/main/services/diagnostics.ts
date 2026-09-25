// SPECTER Diagnostics. Modules can register additional checks.
import { app, BrowserWindow, dialog, net } from 'electron'
import { statfsSync, writeFileSync } from 'node:fs'
import type { DiagnosticCheck } from '@shared/types'
import { getDb } from '../db'
import { handle } from '../ipc'
import { logEntries } from '../logger'

type CheckFn = () => Promise<DiagnosticCheck> | DiagnosticCheck
const extra: CheckFn[] = []

export function registerDiagnostic(fn: CheckFn): void {
  extra.push(fn)
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))])
}

export async function runDiagnostics(): Promise<DiagnosticCheck[]> {
  const out: DiagnosticCheck[] = []
  out.push({ id: 'chromium', label: 'Chromium', status: 'ok', detail: `Chromium ${process.versions.chrome} · Electron ${process.versions.electron} · Node ${process.versions.node}` })

  const gpu = app.getGPUFeatureStatus()
  const accel = app.isHardwareAccelerationEnabled()
  const gpuBad = Object.entries(gpu).filter(([, v]) => String(v).startsWith('disabled') || String(v).startsWith('unavailable')).map(([k]) => k)
  out.push({
    id: 'gpu',
    label: 'GPU acceleration',
    status: !accel ? 'warn' : gpuBad.includes('gpu_compositing') ? 'warn' : 'ok',
    detail: !accel ? 'Hardware acceleration disabled in settings' : `Compositing: ${gpu.gpu_compositing}; WebGL: ${gpu.webgl}; Video decode: ${gpu.video_decode}${gpuBad.length ? ` · disabled: ${gpuBad.join(', ')}` : ''}`
  })

  try {
    const r = getDb().prepare('PRAGMA quick_check').get() as { quick_check: string }
    const size = getDb().prepare('SELECT page_count * page_size AS s FROM pragma_page_count(), pragma_page_size()').get() as { s: number }
    out.push({ id: 'database', label: 'Database', status: r.quick_check === 'ok' ? 'ok' : 'error', detail: `SQLite integrity: ${r.quick_check} · ${(size.s / 1048576).toFixed(1)} MB` })
  } catch (err: any) {
    out.push({ id: 'database', label: 'Database', status: 'error', detail: String(err?.message ?? err) })
  }

  try {
    const st = statfsSync(app.getPath('userData'))
    const freeGB = (st.bavail * st.bsize) / 1073741824
    out.push({ id: 'storage', label: 'Storage', status: freeGB < 2 ? 'warn' : 'ok', detail: `${freeGB.toFixed(1)} GB free on profile drive` })
  } catch {
    out.push({ id: 'storage', label: 'Storage', status: 'unknown', detail: 'Free space unavailable' })
  }

  const online = net.isOnline()
  let latency: number | null = null
  if (online) {
    const t0 = performance.now()
    latency = await withTimeout(
      net
        .fetch('https://www.gstatic.com/generate_204', { method: 'HEAD', cache: 'no-store' })
        .then(() => Math.round(performance.now() - t0))
        .catch(() => null),
      5000,
      null
    )
  }
  out.push({
    id: 'network',
    label: 'Network',
    status: !online ? 'error' : latency === null ? 'warn' : 'ok',
    detail: !online ? 'Offline' : latency === null ? 'Online, but connectivity check failed' : `Online · HTTPS round-trip ${latency} ms`
  })

  for (const fn of extra) {
    try {
      out.push(await withTimeout(Promise.resolve(fn()), 6000, { id: 'timeout', label: 'Check', status: 'unknown', detail: 'Timed out' } as DiagnosticCheck))
    } catch (err: any) {
      out.push({ id: 'error', label: 'Check', status: 'error', detail: String(err?.message ?? err) })
    }
  }
  return out
}

export function registerDiagnosticsIpc(): void {
  handle('diagnostics:run', () => runDiagnostics())
  handle('diagnostics:export', async (e) => {
    const checks = await runDiagnostics()
    const report = {
      generated: new Date().toISOString(),
      app: { version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, arch: process.arch },
      checks,
      // Log messages only (no URLs/data payloads) to avoid leaking browsing data.
      recentErrors: logEntries(300)
        .filter((l) => l.level === 'error' || l.level === 'warn')
        .map((l) => ({ ts: new Date(l.ts).toISOString(), level: l.level, scope: l.scope, message: l.message }))
    }
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { defaultPath: 'specter-diagnostics.json' }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, JSON.stringify(report, null, 2))
    return r.filePath
  })
}
