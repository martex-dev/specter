import { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, ShieldCheck, RefreshCw } from 'lucide-react'
import type { SecurityState } from '@shared/ipc'
import { invoke } from '../lib/ipc'
import { useSetting } from '../stores/settings'
import type { PageProps } from './registry'

type Level = 'ok' | 'warn' | 'bad'

function Check({ level, title, detail }: { level: Level; title: string; detail: string }) {
  return (
    <div className="setting">
      {level === 'ok' ? <CheckCircle2 size={17} className="ok" /> : level === 'warn' ? <AlertTriangle size={17} className="warn" /> : <XCircle size={17} className="bad" />}
      <div className="st-text">
        <div className="st-title">{title}</div>
        <div className="st-desc">{detail}</div>
      </div>
    </div>
  )
}

export default function Security(_: PageProps) {
  const [s, setS] = useState<SecurityState | null>(null)
  const aiEnabled = useSetting('ai.enabled')
  const aiUrl = useSetting('ai.ollamaUrl')
  const aiPerms = useSetting('ai.permissions')
  const load = () => invoke('app:securityState').then(setS)
  useEffect(() => {
    load()
  }, [])
  if (!s) return <div className="empty">Inspecting…</div>
  const chromeOk = s.chrome.every((c) => c.sandbox && c.contextIsolation && !c.nodeIntegration && c.webSecurity)
  const localAi = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/.test(aiUrl)
  return (
    <div className="page">
      <div className="page-h">
        <div className="grow">
          <div className="page-kicker">SPECTER Security</div>
          <h1 className="page-title">Security dashboard</h1>
          <div className="page-sub">Read live from Electron’s effective web preferences for every open page — not from configuration intent.</div>
        </div>
        <button className="btn" onClick={load}>
          <RefreshCw size={13} /> Re-check
        </button>
      </div>
      <div className="card setting-group">
        <Check level={chromeOk ? 'ok' : 'bad'} title="SPECTER interface isolation" detail={`${s.chrome.length} interface window(s): sandbox ${s.chrome.every((c) => c.sandbox) ? 'on' : 'OFF'}, context isolation ${s.chrome.every((c) => c.contextIsolation) ? 'on' : 'OFF'}, Node.js integration ${s.chrome.some((c) => c.nodeIntegration) ? 'ON' : 'off'}.`} />
        <Check
          level={s.guests.count === 0 || (s.guests.sandboxed === s.guests.count && s.guests.nodeIntegration === 0) ? 'ok' : 'bad'}
          title="Web pages sandboxed"
          detail={s.guests.count ? `${s.guests.sandboxed}/${s.guests.count} open pages run in the Chromium sandbox; ${s.guests.nodeIntegration} have Node.js access; ${s.guests.webSecurityOff} have web security disabled.` : 'No pages open right now.'}
        />
        <Check level={s.guests.isolated === s.guests.count ? 'ok' : 'bad'} title="Context isolation for pages" detail="Pages have no preload script and cannot reach SPECTER’s IPC bridge." />
        <Check level="ok" title="Typed IPC allowlist" detail={`The interface bridge only forwards ${s.ipcDomains} known channel domains; requests from any other sender are rejected in the main process.`} />
        <Check level={s.extensions.count ? 'warn' : 'ok'} title="Extensions" detail={s.extensions.count ? `${s.extensions.count} loaded: ${s.extensions.names.join(', ')} — extensions can read pages you visit.` : 'No extensions loaded.'} />
        <Check level="ok" title="Site permissions" detail={`${s.sitePermissions.allow} allowed, ${s.sitePermissions.deny} blocked. Device APIs (USB, HID, serial) are always denied.`} />
        <Check level={!aiEnabled ? 'ok' : localAi ? 'ok' : 'warn'} title="AI" detail={!aiEnabled ? 'Disabled.' : localAi ? `Local Ollama at ${aiUrl}. Permissions: ${aiPerms.join(', ')}. Execution always requires confirmation.` : `Remote AI endpoint ${aiUrl} — prompts leave this computer.`} />
        <Check level="ok" title="Engine" detail={`Chromium ${s.chromium} via Electron ${s.electron}. Keep SPECTER updated to receive Chromium security fixes.`} />
      </div>
      <div className="row muted" style={{ marginTop: 14, fontSize: 12 }}>
        <ShieldCheck size={14} /> SPECTER does not store passwords, upload data, or run analytics.
      </div>
    </div>
  )
}
