// "Bring over your browser profiles": each Chrome (or Edge, Brave, Firefox…)
// profile goes into the open SPECTER profile, a new one named after it, or an
// existing one — bookmarks and history directly, passwords through the
// browser's own export file (one per browser profile).
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, ExternalLink, FileUp, Trash2 } from 'lucide-react'
import type { ImportSource, ImportSourceProfile, ImportTarget, ProfileImportResult } from '@shared/ipc'
import type { PasswordImportResult } from '@shared/passwords'
import type { Profile } from '@shared/types'
import { invoke, ipcErrorText } from '../lib/ipc'
import { useBrowser } from '../stores/browser'
import { toast } from '../stores/ui'
import { Switch } from './ui'

interface Row {
  source: ImportSource
  profile: ImportSourceProfile
  key: string
}

/** Select value: "current" | "new" | "skip" | "p:<profileId>". */
type Choice = string

function defaultChoice(row: Row, rows: Row[], currentId: string | undefined): Choice {
  if (row.profile.importedInto) return row.profile.importedInto === currentId ? 'current' : 'p:' + row.profile.importedInto
  const firstBrowser = rows[0]?.source.id
  if (row.source.id !== firstBrowser) return 'skip'
  const siblings = rows.filter((r) => r.source.id === row.source.id)
  // One browser profile → this profile; several → the first here, the others as their own profiles.
  return siblings[0] === row ? 'current' : 'new'
}

const toTarget = (c: Choice): ImportTarget => (c === 'current' ? 'current' : c === 'new' ? 'new' : { profileId: c.slice(2) })

export function ProfileImport({ onDone }: { onDone?: () => void }) {
  const current = useBrowser((s) => s.profile)
  const [sources, setSources] = useState<ImportSource[] | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [what, setWhat] = useState({ bookmarks: true, history: true })
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Record<string, ProfileImportResult>>({})
  const [chromeInstalled, setChromeInstalled] = useState(false)

  const load = () =>
    Promise.all([invoke('import:sources'), invoke('profiles:list')])
      .then(([s, p]) => {
        setSources(s)
        setProfiles(p)
      })
      .catch(() => setSources([]))
  useEffect(() => {
    void load()
    invoke('passwords:status')
      .then((s) => setChromeInstalled(s.chromeInstalled))
      .catch(() => undefined)
  }, [])

  const rows = useMemo<Row[]>(() => (sources ?? []).flatMap((source) => source.profiles.map((profile) => ({ source, profile, key: source.id + '|' + profile.path }))), [sources])
  useEffect(() => {
    setChoices((c) => {
      const next = { ...c }
      for (const r of rows) if (!(r.key in next)) next[r.key] = defaultChoice(r, rows, current?.id)
      return next
    })
  }, [rows, current?.id])

  if (sources === null) return <div className="muted">Looking for browsers…</div>
  if (!rows.length) return <div className="muted">No other browsers were found on this PC.</div>

  const picked = rows.filter((r) => (choices[r.key] ?? 'skip') !== 'skip')
  const run = async () => {
    setBusy(true)
    try {
      for (const r of picked) {
        try {
          const res = await invoke('import:toProfile', r.source.id, r.profile.path, what, toTarget(choices[r.key]))
          setResults((x) => ({ ...x, [r.key]: res }))
          // A new profile now exists: point the row at it so importing again fills it.
          setChoices((c) => ({ ...c, [r.key]: res.profileId === current?.id ? 'current' : 'p:' + res.profileId }))
        } catch (err) {
          toast({ kind: 'error', title: `Couldn’t import ${r.profile.name}`, body: ipcErrorText(err) })
        }
      }
      await load()
      onDone?.()
    } finally {
      setBusy(false)
    }
  }

  const profileName = (id: string) => profiles.find((p) => p.id === id)?.name ?? 'profile'
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="pi-list">
        {rows.map((r) => {
          const res = results[r.key]
          const choice = choices[r.key] ?? 'skip'
          const newLabel = r.profile.importedInto ? null : `New profile “${r.profile.label || r.profile.name}”`
          return (
            <div key={r.key} className="pi-row">
              <span className="pi-dot" style={{ background: r.profile.color ?? 'var(--fg-3)' }} />
              <div className="pi-name">
                <div className="ellipsis">
                  <b>{r.profile.label || r.profile.name}</b> <span className="muted">· {r.source.name}</span>
                </div>
                {r.profile.account && <div className="muted ellipsis" style={{ fontSize: 11.5 }}>{r.profile.account}</div>}
              </div>
              <ArrowRight size={14} className="muted" />
              <select className="select" value={choice} disabled={busy} aria-label={`Import ${r.profile.name} into`} onChange={(e) => setChoices((c) => ({ ...c, [r.key]: e.target.value }))}>
                <option value="current">This profile ({current?.name ?? 'current'})</option>
                {newLabel && <option value="new">{newLabel}</option>}
                {profiles
                  .filter((p) => p.id !== current?.id)
                  .map((p) => (
                    <option key={p.id} value={'p:' + p.id}>
                      {p.name}
                      {p.id === r.profile.importedInto ? ' (imported before)' : ''}
                    </option>
                  ))}
                <option value="skip">Don’t import</option>
              </select>
              {res && (
                <div className="pi-result">
                  <div className="row" style={{ gap: 6 }}>
                    <Check size={13} className="ok" />
                    <span>
                      {res.bookmarks.toLocaleString()} bookmarks and {res.history.toLocaleString()} history entries → <b>{res.profileName}</b>
                      {res.created ? ' (new profile)' : ''}
                    </span>
                  </div>
                  {res.errors.map((e) => (
                    <div key={e} className="bad">
                      {e}
                    </div>
                  ))}
                  <RowPasswords row={r} profileId={res.profileId} chromeInstalled={chromeInstalled} />
                  {res.profileId !== current?.id && (
                    <button className="btn sm ghost" onClick={() => invoke('profiles:openWindow', res.profileId)}>
                      Switch to {profileName(res.profileId)}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
        <label className="row">
          <Switch on={what.bookmarks} onChange={(v) => setWhat({ ...what, bookmarks: v })} /> Bookmarks
        </label>
        <label className="row">
          <Switch on={what.history} onChange={(v) => setWhat({ ...what, history: v })} /> History
        </label>
        <span className="spacer" />
        <button className="btn primary" disabled={busy || !picked.length || (!what.bookmarks && !what.history)} onClick={run}>
          {busy ? 'Importing…' : `Import ${picked.length} profile${picked.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}

/** Passwords for one imported browser profile: export from that profile, import into the SPECTER one. */
function RowPasswords({ row, profileId, chromeInstalled }: { row: Row; profileId: string; chromeInstalled: boolean }) {
  const [res, setRes] = useState<PasswordImportResult | null>(null)
  const [trashed, setTrashed] = useState(false)
  const isChrome = row.source.id === 'chrome'
  return (
    <div className="pi-pw">
      <span className="muted">Passwords:</span>
      {isChrome && chromeInstalled && (
        <button
          className="btn sm"
          onClick={() => invoke('passwords:openChromeExport', row.profile.dir)}
          data-tip="Opens this Chrome profile's password settings — click Export passwords there"
        >
          <ExternalLink size={12} /> 1. Export from Chrome
        </button>
      )}
      <button
        className="btn sm"
        onClick={async () => {
          try {
            const r = await invoke('passwords:importCsv', profileId)
            if (r) {
              setRes(r)
              setTrashed(false)
            }
          } catch (err) {
            toast({ kind: 'error', title: 'Import failed', body: ipcErrorText(err) })
          }
        }}
      >
        <FileUp size={12} /> {isChrome && chromeInstalled ? '2. Import the file' : 'Import exported file…'}
      </button>
      {res && (
        <span className="row" style={{ gap: 6 }}>
          <Check size={13} className="ok" /> {res.added} added{res.updated ? `, ${res.updated} updated` : ''}
          {!trashed ? (
            <button className="btn sm ghost" onClick={async () => setTrashed(await invoke('passwords:trashImported', res.file).catch(() => false))} data-tip="The export holds your passwords in plain text">
              <Trash2 size={12} /> Recycle the export
            </button>
          ) : (
            <span className="muted">export recycled</span>
          )}
        </span>
      )}
    </div>
  )
}
