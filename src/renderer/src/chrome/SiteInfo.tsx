import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Cookie, Lock, LockOpen, Settings2, ShieldCheck, Trash2, X } from 'lucide-react'
import type { PermissionDecision, SecurityInfo } from '@shared/types'
import { hostname, isInternal } from '@shared/url'
import { invoke } from '../lib/ipc'
import { wcIdFor } from '../lib/webviews'
import { findTab, newTab, reload } from '../stores/browser'
import { toast } from '../stores/ui'
import { ClickShield } from '../components/ui'

const SITE_PERMS: { id: string; label: string }[] = [
  { id: 'javascript', label: 'JavaScript' },
  { id: 'popups', label: 'Pop-ups' },
  { id: 'cookies', label: 'Cookies' },
  { id: 'camera', label: 'Camera' },
  { id: 'microphone', label: 'Microphone' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'geolocation', label: 'Location' },
  { id: 'clipboard-read', label: 'Clipboard' },
  { id: 'display-capture', label: 'Screen capture' }
]

export function SiteInfoPopover({ tabId, onClose }: { tabId: string; onClose: () => void }) {
  const [info, setInfo] = useState<SecurityInfo | null>(null)
  const [perms, setPerms] = useState<Record<string, PermissionDecision>>({})
  const ref = useRef<HTMLDivElement>(null)
  const tab = findTab(tabId)?.tab

  const load = async () => {
    const wcId = wcIdFor(tabId)
    if (wcId === null) return
    const i = await invoke('guest:security', wcId).catch(() => null)
    setInfo(i)
    if (i) {
      const map: Record<string, PermissionDecision> = {}
      for (const p of i.permissions) map[p.permission] = p.decision
      setPerms(map)
    }
  }

  useEffect(() => {
    load()
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('.site-chip')) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId])

  if (!tab || isInternal(tab.url)) return null
  const set = async (perm: string, decision: PermissionDecision) => {
    if (!info) return
    await invoke('permissions:set', info.origin, perm, decision)
    setPerms((p) => ({ ...p, [perm]: decision }))
  }

  return (
    <>
    {/* Clicks on the web page never reach the window listener above. The shield is
        portalled to <body> (some themes give the toolbar a backdrop-filter, which
        would trap a fixed layer inside it) and sits above the page (z 1) but below
        the toolbar (z 3) that holds this popover. */}
    {createPortal(<ClickShield onDismiss={onClose} zIndex={2} />, document.body)}
    <div ref={ref} className="pop" style={{ position: 'absolute', top: 38, left: 0, width: 360, zIndex: 60, animation: 'pop-in 140ms var(--ease)' }}>
      <div className="row" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
        {info?.secure ? <Lock size={16} className="ok" /> : <LockOpen size={16} className="warn" />}
        <div className="grow">
          <div style={{ fontWeight: 600 }} className="ellipsis">
            {hostname(tab.url) || tab.url}
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            {info ? (info.secure ? 'Connection is secure (HTTPS)' : info.protocol === 'http:' ? 'Connection is not secure — data can be read in transit' : info.protocol.replace(':', '').toUpperCase() + ' page') : 'Loading…'}
          </div>
        </div>
        <button className="icon-btn sm" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>
      {info?.certificate && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', fontSize: 12 }}>
          <div className="label" style={{ marginBottom: 6 }}>
            Certificate
          </div>
          <div className="row" style={{ gap: 6 }}>
            <ShieldCheck size={13} className="ok" /> <span className="ellipsis">Issued to {info.certificate.subject}</span>
          </div>
          <div className="muted" style={{ marginTop: 3 }}>
            By {info.certificate.issuer}
          </div>
          <div className="muted">
            Valid {new Date(info.certificate.validFrom).toLocaleDateString()} – {new Date(info.certificate.validTo).toLocaleDateString()}
          </div>
        </div>
      )}
      <div style={{ padding: '8px 14px 4px' }}>
        <div className="label" style={{ margin: '4px 0 6px' }}>
          Permissions for this site
        </div>
        {SITE_PERMS.map((p) => (
          <div key={p.id} className="row" style={{ height: 30 }}>
            <span className="grow" style={{ fontSize: 12.5 }}>
              {p.label}
            </span>
            <select className="select" style={{ height: 24, fontSize: 11.5, width: 110 }} value={perms[p.id] ?? 'ask'} onChange={(e) => set(p.id, e.target.value as PermissionDecision)} aria-label={p.label}>
              <option value="ask">{['javascript', 'cookies'].includes(p.id) ? 'Default (allow)' : p.id === 'popups' ? 'Default (block)' : 'Ask'}</option>
              <option value="allow">Allow</option>
              <option value="deny">Block</option>
            </select>
          </div>
        ))}
      </div>
      <div className="row" style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', fontSize: 12 }}>
        <Cookie size={14} className="muted" />
        <span className="grow">{info ? `${info.cookies} cookie${info.cookies === 1 ? '' : 's'} for this site` : '—'}</span>
        <button
          className="btn sm"
          onClick={async () => {
            if (!info) return
            await invoke('privacy:clearOrigin', info.origin)
            toast({ kind: 'ok', title: 'Site data cleared', body: hostname(info.origin) })
            load()
          }}
        >
          <Trash2 size={12} /> Clear site data
        </button>
      </div>
      <div className="row" style={{ padding: '8px 10px 10px', gap: 6 }}>
        <button
          className="btn sm ghost"
          onClick={() => {
            onClose()
            newTab('specter://privacy')
          }}
        >
          <Settings2 size={12} /> Privacy Center
        </button>
        <span className="spacer" />
        <button className="btn sm" onClick={() => (reload(tabId), onClose())}>
          Reload to apply
        </button>
      </div>
    </div>
    </>
  )
}
