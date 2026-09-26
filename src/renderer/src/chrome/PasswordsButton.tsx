// Key button in the address bar: shown when logins are saved for the current
// site; lists them and fills the chosen one into the page's sign-in form.
import { useEffect, useState } from 'react'
import { KeyRound, Settings2 } from 'lucide-react'
import type { LoginSuggestion } from '@shared/passwords'
import { hostname } from '@shared/url'
import { invoke, on } from '../lib/ipc'
import { wcIdFor } from '../lib/webviews'
import { newTab } from '../stores/browser'
import { openMenu, toast } from '../stores/ui'

export function PasswordsButton({ tabId, url }: { tabId: string; url: string }) {
  const [logins, setLogins] = useState<LoginSuggestion[]>([])
  useEffect(() => {
    let live = true
    const load = () => {
      if (!/^https?:/.test(url)) return setLogins([])
      invoke('passwords:forUrl', url)
        .then((l) => live && setLogins(l))
        .catch(() => live && setLogins([]))
    }
    load()
    const off = on('passwords:changed', load)
    return () => {
      live = false
      off()
    }
  }, [url])
  if (!logins.length) return null

  const fill = async (id: string) => {
    const wcId = wcIdFor(tabId)
    const ok = wcId !== null && (await invoke('passwords:fillInTab', wcId, id).catch(() => false))
    if (!ok) toast({ kind: 'warn', title: 'No sign-in form found', body: 'Open the page’s sign-in form, then try again.' })
  }

  return (
    <button
      className="icon-btn omni-action"
      onClick={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        openMenu({
          x: r.left - 220,
          y: r.bottom + 6,
          width: 260,
          items: [
            { header: `Saved logins · ${hostname(url)}` },
            ...logins.slice(0, 12).map((l) => ({
              label: (l.username || '(no username)') + (l.exact ? '' : ` — ${hostname(l.origin)}`),
              icon: <KeyRound size={14} />,
              run: () => void fill(l.id)
            })),
            { separator: true },
            { label: 'Manage passwords', icon: <Settings2 size={14} />, run: () => newTab('specter://passwords') }
          ]
        })
      }}
      data-tip={`${logins.length} saved login${logins.length === 1 ? '' : 's'} — click to fill`}
      aria-label="Saved logins for this site"
    >
      <KeyRound size={14} />
    </button>
  )
}
