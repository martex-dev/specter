// "Bring your passwords from Chrome": Chrome encrypts its passwords so only
// Chrome can read them, so the move goes through Chrome's own export file.
import { useEffect, useState } from 'react'
import { Check, ExternalLink, FileUp, Trash2 } from 'lucide-react'
import type { PasswordImportResult, PasswordStatus } from '@shared/passwords'
import { invoke, ipcErrorText } from '../lib/ipc'
import { newTab } from '../stores/browser'
import { toast } from '../stores/ui'

export function PasswordImport({ compact }: { compact?: boolean }) {
  const [status, setStatus] = useState<PasswordStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PasswordImportResult | null>(null)
  const [trashed, setTrashed] = useState(false)
  useEffect(() => {
    invoke('passwords:status').then(setStatus).catch(() => undefined)
  }, [])

  if (status && !status.available)
    return <div className="muted">Windows data protection isn’t available, so SPECTER can’t store passwords securely on this system.</div>

  const doImport = async () => {
    setBusy(true)
    try {
      const r = await invoke('passwords:importCsv')
      if (r) {
        setResult(r)
        setTrashed(false)
      }
    } catch (err) {
      toast({ kind: 'error', title: 'Import failed', body: ipcErrorText(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="col" style={{ gap: 10 }}>
      <ol className="pw-steps">
        <li>
          <div>
            <b>Export from Chrome.</b> In Chrome’s password settings click <b>Export passwords</b> and confirm with your Windows PIN or password. Chrome saves <span className="mono">Chrome Passwords.csv</span> to your Downloads folder.
          </div>
          <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {status?.chromeInstalled && (
              <button
                className="btn sm"
                onClick={async () => {
                  if (!(await invoke('passwords:openChromeExport').catch(() => false))) toast({ kind: 'warn', title: 'Couldn’t open Chrome', body: 'Open chrome://password-manager/settings in Chrome yourself.' })
                }}
              >
                <ExternalLink size={12} /> Open Chrome’s password settings
              </button>
            )}
            <button className="btn sm ghost" onClick={() => newTab('https://passwords.google.com/')} data-tip="Passwords synced to your Google account: Settings → Export passwords">
              <ExternalLink size={12} /> Google Password Manager
            </button>
          </div>
        </li>
        <li>
          <div>
            <b>Import the file here.</b> Exports from Edge, Brave, Opera, Firefox, Bitwarden, 1Password and LastPass work too.
          </div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <button className="btn sm primary" disabled={busy} onClick={doImport}>
              <FileUp size={12} /> {busy ? 'Importing…' : 'Choose exported file…'}
            </button>
          </div>
        </li>
      </ol>
      {result && (
        <div className="card" style={{ padding: 12, fontSize: 12.5 }}>
          <div className="row" style={{ gap: 6 }}>
            <Check size={14} className="ok" />
            <span>
              Imported {result.added.toLocaleString()} new login{result.added === 1 ? '' : 's'}
              {result.updated ? `, updated ${result.updated}` : ''}
              {result.unchanged ? `, ${result.unchanged} already saved` : ''}
              {result.skipped ? ` · skipped ${result.skipped} (app logins or empty passwords)` : ''}.
            </span>
          </div>
          {!trashed ? (
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <span className="warn grow" style={{ fontSize: 12 }}>
                The exported file still holds every password in plain text.
              </span>
              <button
                className="btn sm"
                onClick={async () => {
                  const ok = await invoke('passwords:trashImported', result.file).catch(() => false)
                  setTrashed(ok)
                  if (!ok) toast({ kind: 'warn', title: 'Couldn’t remove the file', body: result.file })
                }}
              >
                <Trash2 size={12} /> Move it to the Recycle Bin
              </button>
            </div>
          ) : (
            <div className="muted" style={{ marginTop: 6 }}>
              The exported file was moved to the Recycle Bin — empty it to delete it for good.
            </div>
          )}
          {!compact && result.added + result.updated > 0 && (
            <div className="muted" style={{ marginTop: 6 }}>
              Sign-in fields now show your saved logins — click one to fill it in.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
