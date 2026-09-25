// specter://plugins — declarative plugins: permissions, commands, events, settings.
import { useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink, FolderOpen, Link2, Play, Puzzle, RefreshCw, ShieldCheck, Zap } from 'lucide-react'
import { PERMISSION_LABELS, type PluginInfo, type PluginSettingDef } from '@shared/modules/automation'
import type { PageProps } from '../../pages/registry'
import { invoke, on } from '../../lib/ipc'
import { Favicon, Modal, Switch } from '../../components/ui'
import { newTab } from '../../stores/browser'
import { toast } from '../../stores/ui'
import { describeAction, describeTrigger, errorText } from './util'
import './automation.css'

const SAMPLE = `{
  "id": "my-links",
  "name": "My links",
  "version": "1.0.0",
  "permissions": ["tabs", "notifications"],
  "commands": [
    { "id": "docs", "title": "Open team docs",
      "actions": [{ "type": "openUrl", "url": "https://example.com/docs" }] }
  ],
  "events": [],
  "settings": []
}`

function SettingInput({ p, def }: { p: PluginInfo; def: PluginSettingDef }) {
  const value = p.settings[def.key] ?? def.default
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const save = async (v: string | boolean | number) => {
    try {
      await invoke('plugins:setSetting', p.id, def.key, v)
    } catch (err) {
      toast({ kind: 'error', title: 'Could not save setting', body: errorText(err) })
    }
  }
  return (
    <div className="setting">
      <div className="st-text">
        <div className="st-title">{def.title}</div>
        {def.description && <div className="st-desc">{def.description}</div>}
      </div>
      {def.type === 'boolean' ? (
        <Switch on={!!value} onChange={(v) => save(v)} label={def.title} />
      ) : (
        <input
          className="input"
          style={{ width: 220 }}
          type={def.type === 'number' ? 'number' : 'text'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== String(value) && save(def.type === 'number' ? Number(draft) || 0 : draft)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label={def.title}
        />
      )}
    </div>
  )
}

function PluginCard({ p, onList }: { p: PluginInfo; onList: (l: PluginInfo[]) => void }) {
  const m = p.manifest
  const [confirming, setConfirming] = useState(false)
  const toggle = async (v: boolean, confirmed = false) => {
    if (v && m && !confirmed) return setConfirming(true)
    setConfirming(false)
    try {
      onList(await invoke('plugins:setEnabled', p.id, v))
    } catch (err) {
      toast({ kind: 'error', title: 'Could not change plugin', body: errorText(err) })
    }
  }
  const run = async (cmdId: string, title: string) => {
    try {
      const r = await invoke('plugins:runCommand', p.id, cmdId)
      toast({ kind: r.status === 'ok' ? 'ok' : 'error', title, body: r.detail })
    } catch (err) {
      toast({ kind: 'error', title, body: errorText(err) })
    }
  }
  return (
    <div className={'card pl-card' + (p.enabled ? ' on' : '')}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div className="pl-icon">
          <Puzzle size={18} />
        </div>
        <div className="grow">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="ar-name">{m?.name ?? p.folder}</span>
            {m && <span className="badge">v{m.version}</span>}
            <span className="badge mono">{p.id}</span>
            {p.example && <span className="badge accent">Example</span>}
            {p.errors.length > 0 && <span className="badge bad">Invalid manifest</span>}
            {p.enabled && <span className="badge ok">Enabled</span>}
          </div>
          {m?.description && (
            <div className="dim" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
              {m.description}
            </div>
          )}
          <div className="dim mono selectable" style={{ fontSize: 10.5, marginTop: 4 }}>
            {p.path}
          </div>
        </div>
        <Switch on={p.enabled} onChange={(v) => toggle(v)} disabled={!m} label={p.enabled ? 'Disable plugin' : 'Enable plugin'} />
      </div>

      {p.errors.length > 0 && (
        <div className="pl-errors">
          <div className="row" style={{ gap: 6, marginBottom: 4 }}>
            <AlertTriangle size={13} className="bad" /> <b>Manifest errors — fix manifest.json and reload</b>
          </div>
          {p.errors.map((e, i) => (
            <div key={i} className="mono" style={{ fontSize: 11 }}>
              {e}
            </div>
          ))}
        </div>
      )}

      {m && (
        <div className="pl-grid">
          <div>
            <div className="label" style={{ marginBottom: 6 }}>
              Permissions
            </div>
            {m.permissions.length === 0 && <div className="dim" style={{ fontSize: 12 }}>None</div>}
            {m.permissions.map((x) => (
              <div key={x} className="row pl-perm">
                <ShieldCheck size={12} className="muted" />
                <span className="mono" style={{ fontSize: 11 }}>
                  {x}
                </span>
                <span className="dim" style={{ fontSize: 11.5 }}>
                  {PERMISSION_LABELS[x]}
                </span>
              </div>
            ))}
          </div>
          <div>
            <div className="label" style={{ marginBottom: 6 }}>
              Commands {p.enabled && <span className="dim">· in the palette as plugin.{p.id}.*</span>}
            </div>
            {m.commands.length === 0 && <div className="dim" style={{ fontSize: 12 }}>None</div>}
            {m.commands.map((c) => (
              <div key={c.id} className="row pl-cmd">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontSize: 12.5 }}>
                    {c.title}
                  </div>
                  <div className="dim ellipsis" style={{ fontSize: 11 }}>
                    {c.actions.map(describeAction).join(' → ')}
                  </div>
                </div>
                <button className="btn sm" disabled={!p.enabled} onClick={() => run(c.id, c.title)} data-tip={p.enabled ? 'Run' : 'Enable the plugin to run commands'}>
                  <Play size={11} /> Run
                </button>
              </div>
            ))}
          </div>
          {m.events.length > 0 && (
            <div>
              <div className="label" style={{ marginBottom: 6 }}>
                Event handlers {p.enabled ? '· active' : '· inactive until enabled'}
              </div>
              {m.events.map((ev, i) => (
                <div key={i} className="ar-flow" style={{ marginBottom: 6 }}>
                  <span className="ar-chip trigger">
                    <Zap size={10} /> {describeTrigger(ev.trigger)}
                  </span>
                  {ev.actions.map((a, j) => (
                    <span key={j} className="ar-chip action">
                      {describeAction(a)}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
          {(m.ui?.quickLinks?.length || m.ui?.sidePanelUrl) && (
            <div>
              <div className="label" style={{ marginBottom: 6 }}>
                Links
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {m.ui?.quickLinks?.map((l) => (
                  <button key={l.url} className="btn sm ghost" disabled={!p.enabled} onClick={() => newTab(l.url)} title={l.url}>
                    <Favicon url={l.url} size={12} /> {l.title}
                  </button>
                ))}
                {m.ui?.sidePanelUrl && (
                  <button className="btn sm ghost" disabled={!p.enabled} onClick={() => newTab(m.ui!.sidePanelUrl!)} title={m.ui.sidePanelUrl} data-tip="Plugin panels open as a normal web page tab">
                    <ExternalLink size={12} /> Panel page
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {confirming && m && (
        <Modal
          title={`Enable ${m.name}?`}
          icon={<Puzzle size={15} className="accent" />}
          onClose={() => setConfirming(false)}
          width={480}
          footer={
            <>
              <button className="btn ghost" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => toggle(true, true)}>
                Enable
              </button>
            </>
          }
        >
          <div className="dim" style={{ fontSize: 12.5, marginBottom: 10 }}>
            This plugin requests the following permissions. Plugins are declarative and cannot run code; destructive actions are never available.
          </div>
          {m.permissions.length === 0 && <div className="dim">No permissions.</div>}
          {m.permissions.map((x) => (
            <div key={x} className="row pl-perm">
              <ShieldCheck size={13} className="accent" />
              <span className="mono" style={{ fontSize: 11, width: 92 }}>
                {x}
              </span>
              <span style={{ fontSize: 12.5 }}>{PERMISSION_LABELS[x]}</span>
            </div>
          ))}
          <div className="dim" style={{ fontSize: 11.5, marginTop: 10 }}>
            {m.commands.length} command(s) · {m.events.length} event handler(s){m.events.length ? ' that run automatically' : ''}
          </div>
        </Modal>
      )}

      {m && m.settings.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="label">Settings</div>
          <div className="setting-group" style={{ padding: 0 }}>
            {m.settings.map((s) => (
              <SettingInput key={s.key} p={p} def={s} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function PluginsPage(_: PageProps) {
  const [list, setList] = useState<PluginInfo[] | null>(null)
  const [dir, setDir] = useState('')
  const [showFormat, setShowFormat] = useState(false)
  useEffect(() => {
    const load = () => invoke('plugins:list').then(setList).catch(() => setList([]))
    load()
    invoke('app:info')
      .then((i) => setDir(i.userData + '\\plugins'))
      .catch(() => undefined)
    return on('plugins:changed', load)
  }, [])

  return (
    <div className="page">
      <div className="page-h">
        <div className="grow">
          <div className="page-kicker">SPECTER Plugins</div>
          <h1 className="page-title">Plugins</h1>
          <div className="page-sub">
            Declarative plugins — a folder with a <span className="mono">manifest.json</span>. They can't run code; they can only use safe SPECTER actions covered by the permissions you approve. No marketplace, nothing is downloaded.
          </div>
        </div>
        <button className="btn" onClick={() => invoke('plugins:openFolder').catch((err) => toast({ kind: 'error', title: 'Could not open folder', body: errorText(err) }))}>
          <FolderOpen size={13} /> Open plugins folder
        </button>
        <button
          className="btn primary"
          onClick={async () => {
            try {
              const l = await invoke('plugins:reload')
              setList(l)
              toast({ kind: 'ok', title: 'Plugins reloaded', body: `${l.length} found · ${l.filter((p) => p.errors.length).length} with errors` })
            } catch (err) {
              toast({ kind: 'error', title: 'Reload failed', body: errorText(err) })
            }
          }}
        >
          <RefreshCw size={13} /> Reload
        </button>
      </div>

      {list && list.length === 0 && (
        <div className="card empty">
          <Puzzle size={26} />
          <div>No plugins installed.</div>
          <div className="dim mono" style={{ fontSize: 11 }}>
            {dir}
          </div>
        </div>
      )}
      <div className="col" style={{ gap: 12 }}>
        {list?.map((p) => (
          <PluginCard key={p.id} p={p} onList={setList} />
        ))}
      </div>

      <div className="section">
        <button className="btn sm ghost" onClick={() => setShowFormat(!showFormat)}>
          <Link2 size={12} /> {showFormat ? 'Hide' : 'Show'} manifest format
        </button>
        {showFormat && (
          <div className="card card-b" style={{ marginTop: 8 }}>
            <div className="dim" style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}>
              Create <span className="mono">{dir || '<userData>\\plugins'}\&lt;id&gt;\manifest.json</span> (the folder name must equal the id), then press Reload. Action types: <span className="mono">openUrl, notify, workspace, sidePanel, command, performanceMode, setting, wait</span>. Permissions:{' '}
              <span className="mono">{Object.keys(PERMISSION_LABELS).join(', ')}</span>. Events use the same triggers as automations. Text fields accept <span className="mono">{'{{settings.key}}'}</span> and event placeholders.
            </div>
            <pre className="mono selectable pl-sample">{SAMPLE}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
