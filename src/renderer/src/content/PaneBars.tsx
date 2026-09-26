import { useEffect, useRef, useState } from 'react'
import { AlertOctagon, Camera, Clock, Globe, Mic, MonitorUp, Bell, MapPin, ClipboardPaste, ExternalLink, ShieldAlert, WifiOff, Zap, Moon, KeyRound, X } from 'lucide-react'
import type { PermissionRequest } from '@shared/types'
import type { PasswordOffer } from '@shared/passwords'
import { hostname } from '@shared/url'
import { invoke } from '../lib/ipc'
import { formatBytes } from '../lib/format'
import { tabIdForWcId } from '../lib/webviews'
import { reload, resolvePermissionRequest, respondPasswordOffer, updateTab, wakeTab, type RuntimeTab } from '../stores/browser'

const PERM_LABEL: Record<string, { text: string; icon: JSX.Element }> = {
  camera: { text: 'use your camera', icon: <Camera size={15} /> },
  microphone: { text: 'use your microphone', icon: <Mic size={15} /> },
  notifications: { text: 'show notifications', icon: <Bell size={15} /> },
  geolocation: { text: 'know your location', icon: <MapPin size={15} /> },
  'clipboard-read': { text: 'read your clipboard', icon: <ClipboardPaste size={15} /> },
  'display-capture': { text: 'capture your screen', icon: <MonitorUp size={15} /> },
  openExternal: { text: 'open an external application', icon: <ExternalLink size={15} /> },
  midi: { text: 'use MIDI devices', icon: <Zap size={15} /> },
  'idle-detection': { text: 'know when you are idle', icon: <Clock size={15} /> },
  'window-management': { text: 'manage windows on your displays', icon: <MonitorUp size={15} /> }
}

function PermissionBar({ tabId, req }: { tabId: string; req: PermissionRequest }) {
  const parts = req.permission.split('+')
  const labels = parts.map((p) => PERM_LABEL[p]?.text ?? p)
  const rememberRef = useRef<HTMLInputElement>(null)
  return (
    <div className="infobar" role="alertdialog" aria-label="Permission request">
      {PERM_LABEL[parts[0]]?.icon ?? <ShieldAlert size={15} />}
      <span className="grow">
        <b>{hostname(req.origin) || req.origin}</b> wants to {labels.join(' and ')}
        {req.details && <span className="muted"> — {req.details.slice(0, 120)}</span>}
      </span>
      <label className="row" style={{ gap: 6, fontSize: 12, color: 'var(--fg-2)' }}>
        <input ref={rememberRef} type="checkbox" defaultChecked /> Remember
      </label>
      <button className="btn sm" onClick={() => resolvePermissionRequest(tabId, req.requestId, 'deny', !!rememberRef.current?.checked)}>
        Block
      </button>
      <button className="btn sm primary" onClick={() => resolvePermissionRequest(tabId, req.requestId, 'allow', !!rememberRef.current?.checked)}>
        Allow
      </button>
    </div>
  )
}

function SavePasswordBar({ tabId, offer }: { tabId: string; offer: PasswordOffer }) {
  const [username, setUsername] = useState(offer.username)
  useEffect(() => setUsername(offer.username), [offer.offerId, offer.username])
  const site = hostname(offer.origin) || offer.origin
  const save = () => respondPasswordOffer(tabId, 'save', username)
  return (
    <div className="infobar" role="alertdialog" aria-label={offer.update ? 'Update password' : 'Save password'}>
      <KeyRound size={15} className="accent" />
      <span>
        {offer.update ? (
          <>
            Update the saved password for <b>{offer.username || '(no username)'}</b> on <b>{site}</b>?
          </>
        ) : (
          <>
            Save password for <b>{site}</b>?
          </>
        )}
      </span>
      {!offer.update && (
        <input
          className="input"
          style={{ height: 26, width: 220, fontSize: 12 }}
          value={username}
          placeholder="Username (optional)"
          aria-label="Username"
          spellCheck={false}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && save()}
        />
      )}
      <span className="grow" />
      {!offer.update && (
        <button className="btn sm ghost" onClick={() => respondPasswordOffer(tabId, 'never')}>
          Never for this site
        </button>
      )}
      <button className="btn sm primary" onClick={save}>
        {offer.update ? 'Update' : 'Save'}
      </button>
      <button className="icon-btn sm" onClick={() => respondPasswordOffer(tabId, 'dismiss')} aria-label="Not now" data-tip="Not now">
        <X size={14} />
      </button>
    </div>
  )
}

export function PaneBars({ tab }: { tab: RuntimeTab }) {
  const popups = tab.blockedPopups ?? []
  return (
    <>
      {tab.passwordOffer && <SavePasswordBar key={tab.passwordOffer.offerId} tabId={tab.id} offer={tab.passwordOffer} />}
      {(tab.permissionRequests ?? []).slice(0, 1).map((r) => (
        <PermissionBar key={r.requestId} tabId={tab.id} req={r} />
      ))}
      {popups.length > 0 && (
        <div className="infobar warn">
          <ShieldAlert size={15} className="warn" />
          <span className="grow ellipsis">
            Blocked {popups.length} pop-up{popups.length > 1 ? 's' : ''} from <b>{hostname(popups[0].origin)}</b>
            <span className="muted"> · {popups[popups.length - 1].url.slice(0, 90)}</span>
          </span>
          <button
            className="btn sm"
            onClick={() => {
              const last = popups[popups.length - 1]
              import('../stores/browser').then((m) => m.newTab(last.url, { openerId: tab.id }))
              updateTab(tab.id, { blockedPopups: undefined })
            }}
          >
            Open it
          </button>
          <button
            className="btn sm"
            onClick={() => {
              invoke('permissions:set', popups[0].origin, 'popups', 'allow')
              updateTab(tab.id, { blockedPopups: undefined })
            }}
          >
            Always allow
          </button>
          <button className="btn sm ghost" onClick={() => updateTab(tab.id, { blockedPopups: undefined })}>
            Dismiss
          </button>
        </div>
      )}
      {tab.unresponsive && (
        <div className="infobar bad">
          <AlertOctagon size={15} className="bad" />
          <span className="grow">This page isn't responding.</span>
          <button className="btn sm" onClick={() => updateTab(tab.id, { unresponsive: false })}>
            Wait
          </button>
          <button className="btn sm danger" onClick={() => reload(tab.id, true)}>
            Reload
          </button>
        </div>
      )}
    </>
  )
}

export function CrashPage({ tab }: { tab: RuntimeTab }) {
  return (
    <div className="crash-page">
      <AlertOctagon size={34} className="bad" />
      <h2>This tab stopped working</h2>
      <div className="muted">
        The page's process ended unexpectedly <code className="mono">({tab.crashed})</code>. Your other tabs are fine.
      </div>
      <button className="btn primary" onClick={() => reload(tab.id)}>
        Reload tab
      </button>
    </div>
  )
}

const OFFLINE_CODES = new Set([-106, -105, -21, -130, -137])

export function ErrorPage({ tab }: { tab: RuntimeTab }) {
  const e = tab.error!
  const offline = OFFLINE_CODES.has(e.code) || !navigator.onLine
  const certErr = e.code <= -200 && e.code > -300
  return (
    <div className="error-page">
      {offline ? <WifiOff size={34} className="muted" /> : certErr ? <ShieldAlert size={34} className="warn" /> : <Globe size={34} className="muted" />}
      <h2>{offline ? "You're offline" : certErr ? 'Connection is not private' : "This site can't be reached"}</h2>
      <div className="muted" style={{ maxWidth: 520 }}>
        {certErr ? (
          <>SPECTER blocked <b>{hostname(e.url)}</b> because its security certificate could not be verified. Attackers might be trying to intercept your connection.</>
        ) : offline ? (
          'Check your network connection. Offline features (notes, history, bookmarks, local AI) keep working.'
        ) : (
          <>
            <b>{hostname(e.url) || e.url}</b> — {e.description.replace(/^ERR_/, '').replace(/_/g, ' ').toLowerCase()}
          </>
        )}
      </div>
      <code>
        {e.description} ({e.code})
      </code>
      <div className="row">
        <button className="btn primary" onClick={() => reload(tab.id)}>
          Try again
        </button>
      </div>
    </div>
  )
}

export function SuspendedPage({ tab }: { tab: RuntimeTab }) {
  useEffect(() => {
    // A suspended tab that becomes visible wakes automatically.
    const t = setTimeout(() => wakeTab(tab.id), 0)
    return () => clearTimeout(t)
  }, [tab.id])
  return (
    <div className="suspended-page">
      <Moon size={26} />
      <div>Waking tab…</div>
      {tab.memoryReleasedKB ? <div className="label">{formatBytes(tab.memoryReleasedKB * 1024)} were released while sleeping</div> : null}
    </div>
  )
}

/** Routes guest crash / unresponsive events to the owning tab. */
export function handleGuestCrash(wcId: number, reason: string): void {
  const tabId = tabIdForWcId(wcId)
  if (tabId) updateTab(tabId, { crashed: reason, loading: false })
}

export function handleGuestUnresponsive(wcId: number, responsive: boolean): void {
  const tabId = tabIdForWcId(wcId)
  if (tabId) updateTab(tabId, { unresponsive: !responsive })
}
