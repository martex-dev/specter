// Free update checker using the GitHub Releases API. Opt-in: nothing is
// requested until the user enters a repository in Settings → About and
// enables checking. SPECTER never downloads or installs anything by itself —
// it tells the user a newer release exists and opens the release page.
import { app } from 'electron'
import { handle } from '../ipc'
import { fetchJson } from './net'
import { getSetting, onSettingChanged } from './settings'
import { notify } from './notifications'
import { metaGet, metaSet } from '../db'
import { createLogger } from '../logger'

const log = createLogger('updates')

export interface UpdateInfo {
  checked: boolean
  current: string
  latest?: string
  url?: string
  name?: string
  publishedAt?: string
  newer: boolean
  error?: string
}

/** Compares dotted versions (ignores leading "v" and pre-release suffixes). */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  const repo = getSetting('advanced.updateRepo').trim()
  const current = app.getVersion()
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { checked: false, current, newer: false, error: 'No release repository configured' }
  try {
    const r = await fetchJson<{ tag_name: string; html_url: string; name: string; published_at: string; draft: boolean; prerelease: boolean }>(`https://api.github.com/repos/${repo}/releases/latest`, {
      timeoutMs: 8000,
      retries: 1,
      ttl: 10 * 60_000,
      headers: { Accept: 'application/vnd.github+json' }
    })
    const newer = compareVersions(r.tag_name, current) > 0
    metaSet('updates:lastCheck', String(Date.now()))
    return { checked: true, current, latest: r.tag_name.replace(/^v/, ''), url: r.html_url, name: r.name, publishedAt: r.published_at, newer }
  } catch (err: any) {
    log.warn('update check failed', err?.message)
    return { checked: true, current, newer: false, error: String(err?.message ?? err) }
  }
}

async function scheduledCheck(): Promise<void> {
  if (!getSetting('advanced.checkUpdates')) return
  const last = Number(metaGet('updates:lastCheck') ?? 0)
  if (Date.now() - last < 24 * 3600_000) return
  const info = await checkForUpdates()
  if (info.newer && metaGet('updates:notified') !== info.latest) {
    metaSet('updates:notified', info.latest!)
    notify({ category: 'browser', title: `SPECTER ${info.latest} is available`, body: 'Open Settings → About to view the release.' })
  }
}

export function registerUpdatesIpc(): void {
  handle('app:checkUpdates', () => checkForUpdates())
  setTimeout(() => scheduledCheck().catch(() => undefined), 30_000)
  setInterval(() => scheduledCheck().catch(() => undefined), 6 * 3600_000).unref?.()
  onSettingChanged((key) => {
    if (key === 'advanced.checkUpdates' || key === 'advanced.updateRepo') metaSet('updates:lastCheck', '0')
  })
}
