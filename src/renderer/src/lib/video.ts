// Video tools helpers for the UI: speed commands and the per-site switch.
import { formatSpeed, siteKey, type VideoAction } from '@shared/video'
import { invoke } from './ipc'
import { getSetting, setSetting } from '../stores/settings'
import { activeTab } from '../stores/browser'
import { toast } from '../stores/ui'

/** Runs a speed action in a tab's page and says what happened. */
export async function videoSpeed(wcId: number, action: VideoAction): Promise<void> {
  const r = await invoke('video:command', wcId, action).catch(() => null)
  if (!r || r.rate === null) toast({ kind: 'info', title: 'No video or audio on this page' })
  else toast({ kind: 'ok', title: `Playback speed ${formatSpeed(r.rate)}`, ttl: 1500 })
}

/** Palette command: switch video tools' keys, badge and speed keeping for the active tab's site. */
export async function toggleVideoToolsForActiveSite(): Promise<void> {
  const tab = activeTab()
  const site = tab ? siteKey(tab.url) : null
  if (!site) return void toast({ kind: 'info', title: 'Open a website first', body: 'Video tools are switched per site.' })
  if (!getSetting('video.enabled')) return void toast({ kind: 'info', title: 'Video tools are off', body: 'Turn them on in Settings → Video.' })
  const list = getSetting('video.disabledSites')
  const on = list.includes(site)
  await setSetting('video.disabledSites', on ? list.filter((s) => s !== site) : [...list, site].sort())
  toast({ kind: 'ok', title: on ? `Video tools on for ${site}` : `Video tools off for ${site}`, body: on ? undefined : 'Speed keys and the badge are off; the media controls still work.', ttl: 2500 })
}
