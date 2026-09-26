// Ad blocker helpers for the UI: per-site on/off.
import { isAllowlisted, normalizeSiteHost } from '@shared/adblock'
import { hostname, isInternal } from '@shared/url'
import { getSetting, setSetting } from '../stores/settings'
import { activeTab, reload } from '../stores/browser'
import { toast } from '../stores/ui'

/** True if the ad blocker is active on pages of `host` (switched on and the site isn't excluded). */
export function adblockOnFor(host: string): boolean {
  return getSetting('privacy.adblock') && !isAllowlisted(host, getSetting('privacy.adblockAllowlist'))
}

/** Turns the ad blocker on or off for one site. Turning it on also removes parent-domain exclusions that cover the site. */
export async function setAdblockForSite(input: string, on: boolean): Promise<void> {
  const host = normalizeSiteHost(input)
  if (!host) return
  const list = getSetting('privacy.adblockAllowlist')
  const next = on ? list.filter((a) => !isAllowlisted(host, [a])) : list.includes(host) ? list : [...list, host].sort()
  await setSetting('privacy.adblockAllowlist', next)
}

/** Palette command: flip the ad blocker for the active tab's site and reload it. */
export async function toggleAdblockForActiveSite(): Promise<void> {
  const tab = activeTab()
  const host = tab && !isInternal(tab.url) ? hostname(tab.url) : ''
  if (!host) {
    toast({ kind: 'info', title: 'Open a website first', body: 'The ad blocker is switched per site.' })
    return
  }
  if (!getSetting('privacy.adblock')) {
    toast({ kind: 'info', title: 'The ad blocker is off', body: 'Turn it on in the Privacy Center.' })
    return
  }
  const on = !adblockOnFor(host)
  await setAdblockForSite(host, on)
  toast({ kind: 'ok', title: on ? `Ad blocker on for ${normalizeSiteHost(host)}` : `Ad blocker off for ${normalizeSiteHost(host)}`, ttl: 2500 })
  reload(tab!.id)
}
