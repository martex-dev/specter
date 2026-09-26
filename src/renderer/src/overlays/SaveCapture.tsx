// "Save to SPECTER" and "Quick capture" dialogs. Destinations provided by
// optional modules (notes / research / knowledge) appear only when present.
import { useEffect, useState } from 'react'
import { Bookmark, Brain, ClipboardCopy, FlaskConical, Library, NotebookPen, Pin } from 'lucide-react'
import { isInternal } from '@shared/url'
import { prettyAccelerator } from '@shared/keys'
import { invoke } from '../lib/ipc'
import { runCommand, shortcutFor } from '../lib/commands'
import { commandAvailable } from '../chrome/contextual'
import { wcIdFor } from '../lib/webviews'
import { activeTab, activeWs } from '../stores/browser'
import { closeOverlay, toast } from '../stores/ui'
import { Modal } from '../components/ui'

interface Dest {
  id: string
  label: string
  desc: string
  icon: JSX.Element
  run: () => Promise<unknown> | unknown
}

export function SaveToDialog() {
  const tab = activeTab()
  const [selection, setSelection] = useState('')
  useEffect(() => {
    const id = tab ? wcIdFor(tab.id) : null
    if (id !== null) invoke('guest:selection', id).then(setSelection).catch(() => undefined)
  }, [tab])
  if (!tab || isInternal(tab.url)) {
    return (
      <Modal title="Save to SPECTER" onClose={closeOverlay} width={440}>
        <div className="muted">Open a web page to save it.</div>
      </Modal>
    )
  }
  const ws = activeWs()
  const dests: Dest[] = [
    {
      id: 'bookmark',
      label: 'Bookmark',
      desc: 'Add to the bookmarks bar',
      icon: <Bookmark size={16} />,
      run: async () => {
        await invoke('bookmarks:add', { kind: 'bookmark', title: tab.title, url: tab.url, favicon: tab.favicon })
        toast({ kind: 'ok', title: 'Bookmarked' })
      }
    },
    {
      id: 'workspace',
      label: `Session bookmark in “${ws?.name}”`,
      desc: 'Bookmark tagged to this workspace',
      icon: <Pin size={16} />,
      run: async () => {
        await invoke('bookmarks:add', { kind: 'bookmark', title: tab.title, url: tab.url, favicon: tab.favicon, workspaceId: ws?.id, tags: ['workspace:' + (ws?.name ?? '')] })
        toast({ kind: 'ok', title: `Saved to ${ws?.name}` })
      }
    }
  ]
  if (commandAvailable('notes.savePage')) dests.push({ id: 'notes', label: 'Notes', desc: selection ? 'New note with the selected text' : 'New note linking this page', icon: <NotebookPen size={16} />, run: () => runCommand('notes.savePage', { url: tab.url, title: tab.title, text: selection }) })
  if (commandAvailable('research.saveSource')) dests.push({ id: 'research', label: 'Research', desc: 'Add as a source to a research project', icon: <FlaskConical size={16} />, run: () => runCommand('research.saveSource', { url: tab.url, title: tab.title, quote: selection }) })
  if (commandAvailable('knowledge.savePage')) dests.push({ id: 'knowledge', label: 'Knowledge base', desc: 'Store the readable page text locally for search', icon: <Library size={16} />, run: () => runCommand('knowledge.savePage', { tabId: tab.id }) })

  return (
    <Modal title="Save to SPECTER" onClose={closeOverlay} width={480}>
      <div className="muted ellipsis" style={{ fontSize: 12, marginBottom: 10 }}>
        {tab.title}
      </div>
      <div className="col" style={{ gap: 6 }}>
        {dests.map((d, i) => (
          <button
            key={d.id}
            className="palette-item"
            style={{ border: '1px solid var(--line)', background: 'var(--bg-2)', textAlign: 'left' }}
            autoFocus={i === 0}
            onClick={async () => {
              closeOverlay()
              await d.run()
            }}
          >
            <span className="pi-icon">{d.icon}</span>
            <div className="grow">
              <div>{d.label}</div>
              <div className="pi-sub">{d.desc}</div>
            </div>
            <span className="kbd">
              <span>{i + 1}</span>
            </span>
          </button>
        ))}
      </div>
      {dests.length <= 2 && <div className="dim" style={{ fontSize: 11.5, marginTop: 10 }}>Notes, Research and Knowledge destinations appear when those modules are enabled.</div>}
      <KeyPick count={dests.length} onPick={(i) => (closeOverlay(), dests[i].run())} />
    </Modal>
  )
}

function KeyPick({ count, onPick }: { count: number; onPick: (i: number) => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const n = Number(e.key)
      if (n >= 1 && n <= count && !e.ctrlKey && !e.altKey) onPick(n - 1)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [count, onPick])
  return null
}

export function QuickCaptureDialog() {
  const tab = activeTab()
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    const id = tab && !isInternal(tab.url) ? wcIdFor(tab.id) : null
    if (id === null) return setText('')
    invoke('guest:selection', id)
      .then((s) => setText(s))
      .catch(() => setText(''))
  }, [tab])
  if (text === null) return null
  const acts: Dest[] = [
    {
      id: 'copy',
      label: 'Copy',
      desc: 'Copy to clipboard',
      icon: <ClipboardCopy size={16} />,
      run: async () => {
        await invoke('app:clipboardWrite', text)
        toast({ kind: 'ok', title: 'Copied' })
      }
    }
  ]
  if (commandAvailable('notes.saveSelection')) acts.unshift({ id: 'snippet', label: 'Save snippet', desc: 'Save as a note with source link', icon: <NotebookPen size={16} />, run: () => runCommand('notes.saveSelection', { text, url: tab?.url, title: tab?.title }) })
  if (commandAvailable('ai.ask')) acts.push({ id: 'ai', label: 'Ask AI', desc: 'Send the selection to local AI', icon: <Brain size={16} />, run: () => runCommand('ai.ask', { action: 'ask', text }) })
  if (commandAvailable('research.saveSource')) acts.push({ id: 'research', label: 'Research', desc: 'Save as evidence in a research project', icon: <FlaskConical size={16} />, run: () => runCommand('research.saveSource', { url: tab?.url, title: tab?.title, quote: text }) })
  return (
    <Modal title="Quick capture" onClose={closeOverlay} width={520}>
      {text ? (
        <div className="card selectable" style={{ padding: 10, maxHeight: 160, overflow: 'auto', fontSize: 12.5, whiteSpace: 'pre-wrap', marginBottom: 12 }}>
          {text.slice(0, 3000)}
        </div>
      ) : (
        <div className="muted" style={{ marginBottom: 12 }}>
          Select text on a page first{shortcutFor('capture.quick') ? `, then press ${prettyAccelerator(shortcutFor('capture.quick')!)}` : ''}.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {acts.map((a, i) => (
          <button
            key={a.id}
            className="palette-item"
            disabled={!text}
            style={{ border: '1px solid var(--line)', background: 'var(--bg-2)', textAlign: 'left', opacity: text ? 1 : 0.5 }}
            onClick={async () => {
              closeOverlay()
              await a.run()
            }}
          >
            <span className="pi-icon">{a.icon}</span>
            <div className="grow">
              <div>{a.label}</div>
              <div className="pi-sub">{a.desc}</div>
            </div>
            <span className="kbd">
              <span>{i + 1}</span>
            </span>
          </button>
        ))}
      </div>
      {text && <KeyPick count={acts.length} onPick={(i) => (closeOverlay(), acts[i].run())} />}
    </Modal>
  )
}
