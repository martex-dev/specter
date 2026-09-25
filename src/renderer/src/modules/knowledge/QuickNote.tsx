// Quick Note overlay (Ctrl+Shift+N): capture a thought into the current workspace.
import { useEffect, useRef, useState } from 'react'
import { Link2, NotebookPen } from 'lucide-react'
import { parseTags } from '@shared/modules/knowledge'
import { isInternal } from '@shared/url'
import { invoke } from '../../lib/ipc'
import { activeTab, useBrowser } from '../../stores/browser'
import { closeOverlay, toast } from '../../stores/ui'
import { Kbd, Modal } from '../../components/ui'
import { openNote } from './actions'
import { currentWorkspaceId, hostOf } from './lib'

function deriveTitle(body: string): string {
  const first = body.split('\n').find((l) => l.trim()) ?? ''
  const t = first.replace(/^[#>*\-\s]+/, '').replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1').trim()
  return t.length > 80 ? t.slice(0, 79) + '…' : t
}

export function QuickNote() {
  const tab = activeTab()
  const pageUrl = tab && !isInternal(tab.url) ? tab.url : ''
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [attach, setAttach] = useState(false)
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const wsName = useBrowser((s) => s.workspaces.find((w) => w.id === s.activeWsId)?.name)

  useEffect(() => {
    const t = setTimeout(() => bodyRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [])

  const save = async () => {
    if (busy) return
    if (!body.trim() && !title.trim()) {
      closeOverlay()
      return
    }
    setBusy(true)
    try {
      const n = await invoke('notes:create', {
        title: title.trim() || deriveTitle(body) || 'Quick note',
        body: body + (attach && pageUrl && !body.includes(pageUrl) ? `\n\n— [${tab?.title || hostOf(pageUrl)}](${pageUrl})\n` : ''),
        tags: parseTags(tags),
        workspaceId: currentWorkspaceId(),
        sourceUrl: attach && pageUrl ? pageUrl : null
      })
      closeOverlay()
      toast({ kind: 'ok', title: 'Note saved', body: n.title, action: { label: 'Open', run: () => openNote(n.id) } })
    } catch (err) {
      setBusy(false)
      toast({ kind: 'error', title: 'Could not save note', body: err instanceof Error ? err.message : String(err) })
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      save()
    }
  }

  return (
    <Modal
      title="Quick note"
      icon={<NotebookPen size={15} style={{ color: 'var(--accent)' }} />}
      onClose={closeOverlay}
      width={560}
      footer={
        <>
          <span className="label" style={{ marginRight: 'auto' }}>
            {wsName ? `Workspace · ${wsName}` : 'Saved locally'}
          </span>
          <button className="btn ghost" onClick={closeOverlay}>
            Cancel <Kbd keys="Esc" />
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            Save <Kbd keys="Ctrl+Enter" />
          </button>
        </>
      }
    >
      <div className="col kn-quick" style={{ gap: 8 }} onKeyDown={onKey}>
        <input className="input kn-quick-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional — first line is used)" aria-label="Title" />
        <textarea
          ref={bodyRef}
          className="textarea kn-quick-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={'Capture a thought… Markdown and [[links]] work.'}
          rows={8}
          aria-label="Note"
        />
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, comma separated" aria-label="Tags" />
          {pageUrl && (
            <button className={'btn sm' + (attach ? ' kn-on' : '')} onClick={() => setAttach(!attach)} aria-pressed={attach} data-tip={pageUrl}>
              <Link2 size={12} /> {attach ? 'Linked: ' : 'Link '}
              {hostOf(pageUrl)}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
