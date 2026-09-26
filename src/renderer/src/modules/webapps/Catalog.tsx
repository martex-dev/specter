// Catalog grid + custom-app form, shared by the "Add apps" picker and the
// specter://webapps manager page.
import { useState } from 'react'
import { Check, Plus, ShieldAlert, Smartphone } from 'lucide-react'
import { cleanAppName, normalizeAppUrl, WEBAPP_CATALOG, WEBAPP_CATEGORIES, type CatalogApp } from '@shared/modules/webapps'
import { Switch } from '../../components/ui'
import { toast } from '../../stores/ui'
import { CatalogIcon } from './AppIcon'
import { openApp, removeApp, saveApp, useWebApps } from './store'

export async function addCatalogApp(cat: CatalogApp): Promise<string | null> {
  const app = await saveApp({ catalogId: cat.id })
  if (!app) return null
  useWebApps.setState((s) => (s.apps.some((a) => a.id === app.id) ? s : { apps: [...s.apps, app] }))
  return app.id
}

export function CatalogGrid({ onOpen }: { onOpen?: () => void }) {
  const apps = useWebApps((s) => s.apps)
  const [busy, setBusy] = useState<string | null>(null)
  const installed = (c: CatalogApp) => apps.find((a) => a.catalogId === c.id)
  return (
    <div className="wa-catalog">
      {WEBAPP_CATEGORIES.map((cat) => {
        const items = WEBAPP_CATALOG.filter((c) => c.category === cat.id)
        if (!items.length) return null
        return (
          <div key={cat.id} className="wa-cat">
            <div className="label">{cat.label}</div>
            <div className="wa-cat-grid">
              {items.map((c) => {
                const inst = installed(c)
                return (
                  <div key={c.id} className={'wa-cat-item' + (inst ? ' on' : '')}>
                    <CatalogIcon name={c.name} url={c.url} color={c.color} size={28} />
                    <div className="wa-cat-text">
                      <div className="wa-cat-name">
                        {c.name}
                        {c.drm && (
                          <span className="wa-drm" data-tip="Playback uses Widevine DRM, which SPECTER's Chromium build doesn't include. Browsing works; protected tracks may not play.">
                            <ShieldAlert size={11} /> DRM
                          </span>
                        )}
                        {c.mobile && (
                          <span className="wa-drm muted" data-tip="Opens with a mobile layout by default">
                            <Smartphone size={11} />
                          </span>
                        )}
                      </div>
                      <div className="wa-cat-blurb">{c.blurb}</div>
                    </div>
                    {inst && onOpen && (
                      <button
                        className="btn sm ghost"
                        onClick={() => {
                          openApp(inst.id)
                          onOpen()
                        }}
                      >
                        Open
                      </button>
                    )}
                    <Switch
                      on={!!inst}
                      disabled={busy === c.id}
                      label={(inst ? 'Remove ' : 'Add ') + c.name}
                      onChange={async (v) => {
                        setBusy(c.id)
                        try {
                          if (v && !inst) {
                            if (await addCatalogApp(c)) toast({ kind: 'ok', title: `${c.name} added to the sidebar`, ttl: 2500 })
                          } else if (!v && inst) await removeApp(inst.id)
                        } finally {
                          setBusy(null)
                        }
                      }}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function CustomAppForm({ onAdded }: { onAdded?: (id: string) => void }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [mobile, setMobile] = useState(false)
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const normalized = normalizeAppUrl(url)
  const invalid = touched && url.trim() !== '' && !normalized
  const submit = async (open: boolean) => {
    setTouched(true)
    if (!normalized) return
    setSaving(true)
    const app = await saveApp({ name: cleanAppName(name, normalized), url: normalized, mobile })
    setSaving(false)
    if (!app) return
    useWebApps.setState((s) => (s.apps.some((a) => a.id === app.id) ? s : { apps: [...s.apps, app] }))
    toast({ kind: 'ok', title: `${app.name} added to the sidebar`, ttl: 2500 })
    setName('')
    setUrl('')
    setMobile(false)
    setTouched(false)
    if (open) openApp(app.id)
    onAdded?.(app.id)
  }
  return (
    <form
      className="wa-form"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(true)
      }}
    >
      <label className="wa-field">
        <span className="label">Web address</span>
        <input className={'input' + (invalid ? ' invalid' : '')} placeholder="e.g. outlook.live.com/mail" value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => setTouched(true)} spellCheck={false} autoComplete="off" />
      </label>
      <label className="wa-field">
        <span className="label">Name</span>
        <input className="input" placeholder={normalized ? cleanAppName('', normalized) : 'Optional'} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
      </label>
      <div className="wa-form-row">
        <span className="row" style={{ gap: 8 }}>
          <Switch on={mobile} onChange={setMobile} label="Mobile layout" />
          <span className="muted">Mobile layout</span>
        </span>
        <span className="grow" />
        {invalid && <span className="wa-form-err">Enter an http(s) web address</span>}
        <button type="button" className="btn sm" disabled={!normalized || saving} onClick={() => void submit(false)}>
          <Plus size={13} /> Add
        </button>
        <button type="submit" className="btn sm primary" disabled={!normalized || saving}>
          <Check size={13} /> Add & open
        </button>
      </div>
    </form>
  )
}
