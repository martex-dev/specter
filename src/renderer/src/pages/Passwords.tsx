import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Ban, Copy, Download, ExternalLink, Eye, EyeOff, KeyRound, Pencil, Plus, Search, ShieldCheck, Trash2, Upload, X } from 'lucide-react'
import type { PasswordHealth, SavedLogin, WeakReason } from '@shared/passwords'
import { invoke, ipcErrorText, on } from '../lib/ipc'
import { Favicon, Modal, Switch } from '../components/ui'
import { confirmAction } from '../components/prompt'
import { PasswordImport } from '../components/PasswordImport'
import { setSetting, useSetting } from '../stores/settings'
import { newTab } from '../stores/browser'
import { toast } from '../stores/ui'
import type { PageProps } from './registry'

/** "example.com", or "localhost:3000" when a port matters. */
function siteLabel(origin: string): string {
  try {
    return new URL(origin).host.replace(/^www\./, '')
  } catch {
    return origin
  }
}

/** Revealed passwords hide again after this long. */
const REVEAL_MS = 30_000

export default function Passwords(_: PageProps) {
  const [list, setList] = useState<SavedLogin[] | null>(null)
  const [never, setNever] = useState<{ origin: string; createdAt: number }[]>([])
  const [available, setAvailable] = useState(true)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<SavedLogin | 'new' | null>(null)
  const [showImport, setShowImport] = useState(false)

  const load = () => {
    invoke('passwords:list').then(setList).catch(() => setList([]))
    invoke('passwords:neverList').then(setNever).catch(() => undefined)
    invoke('passwords:status').then((s) => setAvailable(s.available)).catch(() => undefined)
  }
  useEffect(() => {
    load()
    return on('passwords:changed', load)
  }, [])

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const m = new Map<string, SavedLogin[]>()
    for (const l of list ?? []) {
      const host = siteLabel(l.origin)
      if (needle && !host.toLowerCase().includes(needle) && !l.username.toLowerCase().includes(needle) && !l.note.toLowerCase().includes(needle)) continue
      m.set(host, [...(m.get(host) ?? []), l])
    }
    return [...m].sort((a, b) => a[0].localeCompare(b[0]))
  }, [list, q])

  const count = list?.length ?? 0
  return (
    <div className="page">
      <div className="page-h">
        <div className="grow">
          <div className="page-kicker">Browser</div>
          <h1 className="page-title">Passwords</h1>
          <div className="page-sub">
            <ShieldCheck size={12} className="ok" style={{ verticalAlign: -2 }} /> {count.toLocaleString()} saved login{count === 1 ? '' : 's'} · encrypted with Windows data protection, stored only on this PC
          </div>
        </div>
        <button className="btn" disabled={!available} onClick={() => setEditing('new')}>
          <Plus size={14} /> Add
        </button>
        <button className="btn" disabled={!available} onClick={() => setShowImport((v) => !v)}>
          <Upload size={14} /> Import
        </button>
        <button
          className="btn"
          disabled={!count}
          onClick={() =>
            invoke('passwords:exportCsv')
              .then((p) => p && toast({ kind: 'ok', title: 'Passwords exported', body: `${p} — delete it once you’re done with it.` }))
              .catch((err) => toast({ kind: 'error', title: 'Export failed', body: ipcErrorText(err) }))
          }
        >
          <Download size={14} /> Export
        </button>
      </div>

      {(showImport || (list !== null && count === 0)) && (
        <div className="section">
          <div className="section-title">
            <KeyRound size={14} /> {count === 0 ? 'Bring your passwords from Chrome' : 'Import passwords'}
            {count > 0 && (
              <button className="icon-btn sm" style={{ marginLeft: 'auto' }} onClick={() => setShowImport(false)} aria-label="Close">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="card" style={{ padding: 16 }}>
            <p className="muted" style={{ margin: '0 0 10px', lineHeight: 1.5 }}>
              Chrome locks its passwords so that only Chrome can read them, so they move over through Chrome’s own export file. It takes about a minute.
            </p>
            <PasswordImport />
          </div>
        </div>
      )}

      <div className="section">
        <div className="card setting-group">
          <div className="setting">
            <div className="st-text">
              <div className="st-title">Offer to save passwords</div>
              <div className="st-desc">After you sign in, SPECTER asks whether to save the login.</div>
            </div>
            <PasswordSetting k="passwords.offerToSave" />
          </div>
          <div className="setting">
            <div className="st-text">
              <div className="st-title">Suggest saved logins</div>
              <div className="st-desc">Sign-in fields list your saved logins; pick one to fill it in. Nothing is filled until you pick.</div>
            </div>
            <PasswordSetting k="passwords.autofill" />
          </div>
        </div>
      </div>

      {count > 0 && <PasswordCheck logins={list ?? []} onEdit={setEditing} />}

      {count > 0 && (
        <div className="section">
          <div className="row" style={{ position: 'relative', marginBottom: 10 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--fg-3)' }} />
            <input className="input grow" style={{ paddingLeft: 30, height: 34 }} placeholder="Search sites and usernames…" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
          </div>
          {groups.length === 0 && <div className="empty">No logins match “{q}”.</div>}
          <div className="card pw-list">
            {groups.map(([host, logins]) => (
              <div key={host} className="pw-site">
                <div className="pw-host">
                  <Favicon url={logins[0].origin} size={16} />
                  <span className="ellipsis">{host}</span>
                  {logins.length > 1 && <span className="badge">{logins.length}</span>}
                </div>
                {logins.map((l) => (
                  <LoginRow key={l.id} login={l} onEdit={() => setEditing(l)} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {never.length > 0 && (
        <div className="section">
          <div className="section-title">
            <Ban size={14} /> Never saved <span className="badge">{never.length}</span>
          </div>
          <div className="card setting-group">
            {never.map((n) => (
              <div key={n.origin} className="setting">
                <div className="st-text">
                  <div className="st-title">{siteLabel(n.origin)}</div>
                </div>
                <button className="btn sm" onClick={() => invoke('passwords:neverRemove', n.origin)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {editing && <EditLogin login={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

const WEAK_LABEL: Record<WeakReason, string> = {
  common: 'one of the most common passwords',
  short: 'shorter than 8 characters',
  simple: 'easy to guess (one kind of character or a simple pattern)',
  username: 'contains your username'
}

/** Weak and reused passwords, checked on this PC (nothing is sent anywhere). */
function PasswordCheck({ logins, onEdit }: { logins: SavedLogin[]; onEdit: (l: SavedLogin) => void }) {
  const [health, setHealth] = useState<PasswordHealth | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    invoke('passwords:check').then(setHealth).catch(() => setHealth(null))
  }, [logins])
  if (!health) return null
  const byId = new Map(logins.map((l) => [l.id, l]))
  const reusedIds = new Set(health.reused.flat())
  const issues = health.weak.length + reusedIds.size
  const Item = ({ id, why }: { id: string; why: string }) => {
    const l = byId.get(id)
    if (!l) return null
    return (
      <div className="pw-row">
        <span className="pw-user ellipsis">
          <b>{siteLabel(l.origin)}</b> · {l.username || <span className="muted">(no username)</span>}
        </span>
        <span className="muted ellipsis" style={{ gridColumn: 'span 2', fontSize: 12 }}>
          {why}
        </span>
        <div className="row pw-actions" style={{ opacity: 1 }}>
          <button className="btn sm ghost" onClick={() => newTab(l.url || l.origin)} data-tip="Open the site to change the password there">
            <ExternalLink size={12} /> Change on site
          </button>
          <button className="icon-btn sm" onClick={() => onEdit(l)} data-tip="Edit the saved password" aria-label="Edit">
            <Pencil size={13} />
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="section">
      <div className="card pw-check">
        <div className="row" style={{ gap: 10, padding: '12px 14px' }}>
          {issues ? <AlertTriangle size={16} className="warn" /> : <ShieldCheck size={16} className="ok" />}
          <div className="grow">
            <div style={{ fontWeight: 600 }}>Password check</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {issues
                ? `${health.weak.length} weak · ${reusedIds.size} reused on more than one site — checked on this PC, nothing is sent anywhere`
                : `All ${health.checked} passwords look strong and unique — checked on this PC`}
            </div>
          </div>
          {issues > 0 && (
            <button className="btn sm" onClick={() => setOpen((v) => !v)}>
              {open ? 'Hide' : 'Review'}
            </button>
          )}
        </div>
        {open && (
          <div style={{ borderTop: '1px solid var(--line)', padding: '4px 0 8px' }}>
            {health.weak.map((w) => (
              <Item key={'w' + w.id} id={w.id} why={`Weak: ${WEAK_LABEL[w.reason]}`} />
            ))}
            {health.reused.map((group) =>
              group.map((id) => <Item key={'r' + id} id={id} why={`Reused on ${group.length - 1} other site${group.length > 2 ? 's' : ''}`} />)
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function PasswordSetting({ k }: { k: 'passwords.offerToSave' | 'passwords.autofill' }) {
  const v = useSetting(k)
  return <Switch on={!!v} onChange={(x) => setSetting(k, x)} />
}

async function copy(text: string, what: string): Promise<void> {
  await navigator.clipboard.writeText(text)
  toast({ kind: 'ok', title: `${what} copied`, ttl: 2000 })
}

function LoginRow({ login, onEdit }: { login: SavedLogin; onEdit: () => void }) {
  const [shown, setShown] = useState<string | null>(null)
  const timer = useRef<number>(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const reveal = async () => {
    if (shown !== null) return setShown(null)
    try {
      setShown(await invoke('passwords:reveal', login.id))
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setShown(null), REVEAL_MS)
    } catch (err) {
      toast({ kind: 'error', title: 'Can’t show this password', body: ipcErrorText(err) })
    }
  }
  return (
    <div className="pw-row">
      <span className="pw-user ellipsis" title={login.username}>
        {login.username || <span className="muted">(no username)</span>}
      </span>
      <span className={'pw-pass mono ellipsis' + (shown === null ? ' masked' : '')}>{shown ?? '••••••••••'}</span>
      <span className="pw-meta muted ellipsis">{login.lastUsedAt ? `Used ${new Date(login.lastUsedAt).toLocaleDateString()}` : `Saved ${new Date(login.createdAt).toLocaleDateString()}`}</span>
      <div className="row pw-actions">
        <button className="icon-btn sm" onClick={reveal} data-tip={shown === null ? 'Show password' : 'Hide password'} aria-label={shown === null ? 'Show password' : 'Hide password'}>
          {shown === null ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button className="icon-btn sm" disabled={!login.username} onClick={() => copy(login.username, 'Username')} data-tip="Copy username" aria-label="Copy username">
          <Copy size={13} />
        </button>
        <button
          className="icon-btn sm"
          onClick={() =>
            invoke('passwords:copy', login.id)
              .then(() => toast({ kind: 'ok', title: 'Password copied', body: 'The clipboard clears itself in a minute.', ttl: 3000 }))
              .catch((err) => toast({ kind: 'error', title: 'Can’t copy this password', body: ipcErrorText(err) }))
          }
          data-tip="Copy password"
          aria-label="Copy password"
        >
          <KeyRound size={13} />
        </button>
        <button className="icon-btn sm" onClick={onEdit} data-tip="Edit" aria-label="Edit">
          <Pencil size={13} />
        </button>
        <button
          className="icon-btn sm"
          onClick={async () => {
            if (await confirmAction(`Delete the login for ${login.username || '(no username)'} on ${siteLabel(login.origin)}?`, 'The password is removed from SPECTER. Your account on the site is not affected.', 'Delete', true))
              invoke('passwords:remove', login.id)
          }}
          data-tip="Delete"
          aria-label="Delete"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

function EditLogin({ login, onClose }: { login: SavedLogin | null; onClose: () => void }) {
  const [url, setUrl] = useState(login?.url ?? '')
  const [username, setUsername] = useState(login?.username ?? '')
  const [password, setPassword] = useState('')
  const [note, setNote] = useState(login?.note ?? '')
  const [show, setShow] = useState(false)
  const [loaded, setLoaded] = useState(!login)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!login) return
    invoke('passwords:reveal', login.id)
      .then((p) => {
        setPassword(p)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [login])

  const save = async () => {
    setBusy(true)
    try {
      await invoke('passwords:save', { id: login?.id, url: url.trim(), username, password: password || undefined, note })
      onClose()
    } catch (err) {
      toast({ kind: 'error', title: 'Couldn’t save', body: ipcErrorText(err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={login ? 'Edit login' : 'Add login'}
      icon={<KeyRound size={16} />}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !loaded || !url.trim() || (!login && !password)} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <form
        className="col"
        style={{ gap: 10 }}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <label className="col" style={{ gap: 4 }}>
          <span className="label">Website</span>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" spellCheck={false} autoFocus={!login} />
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="label">Username</span>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} spellCheck={false} autoComplete="off" />
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="label">Password</span>
          <div className="row" style={{ gap: 6 }}>
            <input className="input grow mono" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={loaded ? '' : 'Loading…'} autoComplete="new-password" />
            <button type="button" className="icon-btn" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="label">Note</span>
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} style={{ resize: 'vertical', height: 'auto', padding: 8 }} />
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
