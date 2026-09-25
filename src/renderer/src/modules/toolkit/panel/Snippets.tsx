// Manual snippets — an opt-in alternative to clipboard history. Nothing is
// captured automatically; the user adds text explicitly.
import { useState } from 'react'
import { ClipboardPaste, Plus, X } from 'lucide-react'
import { invoke } from '../../../lib/ipc'
import { CopyBtn } from '../ui'

interface Snippet {
  id: string
  text: string
  label?: string
}

const KEY = 'specter.toolkit.snippets'
const ENABLED = 'specter.toolkit.snippetsEnabled'

function load(): Snippet[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export default function Snippets() {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(ENABLED) === '1'
    } catch {
      return false
    }
  })
  const [items, setItems] = useState<Snippet[]>(load)
  const [text, setText] = useState('')
  const [label, setLabel] = useState('')

  const update = (next: Snippet[]) => {
    setItems(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }

  if (!enabled)
    return (
      <div className="empty" style={{ gap: 12 }}>
        <ClipboardPaste size={22} />
        <div style={{ maxWidth: 280 }}>
          SPECTER doesn’t record your clipboard. Snippets is an opt-in list of text you save yourself (stored locally), with one-click copy.
        </div>
        <button
          className="btn primary sm"
          onClick={() => {
            setEnabled(true)
            try {
              localStorage.setItem(ENABLED, '1')
            } catch {
              /* ignore */
            }
          }}
        >
          Enable snippets
        </button>
      </div>
    )

  const add = (t = text) => {
    if (!t.trim()) return
    update([{ id: Date.now().toString(36), text: t, label: label.trim() || undefined }, ...items])
    setText('')
    setLabel('')
  }

  return (
    <>
      <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" aria-label="Snippet label" />
      <textarea className="textarea mono" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Snippet text…" aria-label="Snippet text" onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && add()} />
      <div className="tkp-row">
        <button className="btn primary sm" onClick={() => add()} disabled={!text.trim()}>
          <Plus size={12} /> Save snippet
        </button>
        <button className="btn sm" onClick={async () => add(await invoke('app:clipboardRead').catch(() => ''))} data-tip="Save what's on the clipboard right now (only when you click)">
          <ClipboardPaste size={12} /> From clipboard
        </button>
      </div>
      {items.length ? (
        <div className="tkp-list">
          {items.map((s) => (
            <div key={s.id} className="tkp-item" style={{ alignItems: 'flex-start', paddingTop: 7, paddingBottom: 7 }}>
              <div className="grow" style={{ minWidth: 0 }}>
                {s.label && <div style={{ fontWeight: 600, fontSize: 12 }}>{s.label}</div>}
                <div className="mono selectable" style={{ fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 80, overflow: 'hidden', color: 'var(--fg-1)' }}>
                  {s.text}
                </div>
              </div>
              <CopyBtn text={s.text} />
              <button className="icon-btn sm x" onClick={() => update(items.filter((x) => x.id !== s.id))} aria-label="Delete snippet">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty" style={{ padding: 20 }}>
          No snippets yet.
        </div>
      )}
      <button
        className="btn sm ghost"
        onClick={() => {
          update([])
          setEnabled(false)
          try {
            localStorage.removeItem(ENABLED)
          } catch {
            /* ignore */
          }
        }}
      >
        Disable and delete all snippets
      </button>
    </>
  )
}
