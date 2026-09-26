// Markdown note editor with autosave, split preview, [[wiki-link]]
// autocomplete and backlinks. Used by specter://notes and the Notes panel.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Columns2, Download, Eye, Link2, Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import { noteToMarkdown, normalizeTitle, parseTags, type NoteFull } from '@shared/modules/knowledge'
import { invoke } from '../../lib/ipc'
import { timeAgo } from '../../lib/format'
import { toast } from '../../stores/ui'
import { useBrowser } from '../../stores/browser'
import { confirmAction } from '../../components/prompt'
import { currentWorkspaceId, fmtDate, hostOf, openUrl, slugFile, useIpcRefresh } from './lib'
import { onMarkdownClick, renderMarkdown } from './markdown'

export type EditorMode = 'edit' | 'split' | 'preview'

interface Props {
  id: string
  compact?: boolean
  onOpenNote: (id: string) => void
  onDeleted?: () => void
}

type Draft = { title: string; body: string; tags: string }

const MIRROR_PROPS = ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize', 'wordSpacing'] as const

/** Pixel position (relative to the textarea's box) just below character `pos`. */
function caretCoords(el: HTMLTextAreaElement, pos: number): { x: number; y: number } {
  const cs = getComputedStyle(el)
  const div = document.createElement('div')
  for (const p of MIRROR_PROPS) (div.style as any)[p] = cs[p]
  div.style.position = 'absolute'
  div.style.visibility = 'hidden'
  div.style.whiteSpace = 'pre-wrap'
  div.style.overflowWrap = 'break-word'
  div.style.top = '0'
  div.style.left = '-9999px'
  div.textContent = el.value.slice(0, Math.max(0, pos))
  const span = document.createElement('span')
  span.textContent = '​'
  div.appendChild(span)
  document.body.appendChild(div)
  const lh = parseFloat(cs.lineHeight) || 20
  const x = Math.min(span.offsetLeft, Math.max(0, el.clientWidth - 290))
  const y = span.offsetTop - el.scrollTop + lh + 2
  div.remove()
  return { x, y: Math.max(0, Math.min(y, el.clientHeight - 40)) }
}

export function NoteEditor({ id, compact, onOpenNote, onDeleted }: Props) {
  const [note, setNote] = useState<NoteFull | null | undefined>(undefined)
  const [draft, setDraft] = useState<Draft>({ title: '', body: '', tags: '' })
  const [mode, setMode] = useState<EditorMode>(() => {
    try {
      return (localStorage.getItem('kn.editorMode' + (compact ? '.c' : '')) as EditorMode) || (compact ? 'edit' : 'split')
    } catch {
      return 'edit'
    }
  })
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved')
  const [titles, setTitles] = useState<{ id: string; title: string }[]>([])
  const [ac, setAc] = useState<{ query: string; start: number; index: number; x: number; y: number } | null>(null)
  const dirty = useRef(false)
  // Last content known to be stored, so refreshes caused by our own saves
  // don't overwrite what is being typed (e.g. a trailing space in the title).
  const lastSaved = useRef<string | null>(null)
  const sig = (n: { title: string; body: string; tags: string[] }) => JSON.stringify([n.title, n.body, n.tags])
  const draftRef = useRef(draft)
  draftRef.current = draft
  const timer = useRef<number | undefined>(undefined)
  const ta = useRef<HTMLTextAreaElement>(null)
  const workspaces = useBrowser((s) => s.workspaces)

  const load = useCallback(async () => {
    const n = await invoke('notes:get', id).catch(() => null)
    setNote(n)
    if (n && !dirty.current) {
      if (lastSaved.current !== sig(n)) setDraft({ title: n.title, body: n.body, tags: n.tags.join(', ') })
      lastSaved.current = sig(n)
    }
  }, [id])

  const loadTitles = useCallback(() => {
    invoke('notes:titles')
      .then(setTitles)
      .catch(() => undefined)
  }, [])

  // Save pending edits of the previous note before switching.
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current)
    if (!dirty.current) return
    dirty.current = false
    const d = draftRef.current
    setSaveState('saving')
    try {
      const n = await invoke('notes:update', id, { title: d.title, body: d.body, tags: parseTags(d.tags) })
      if (n) {
        lastSaved.current = sig(n)
        setNote((cur) => (cur && cur.id === n.id ? { ...n } : cur))
      }
      setSaveState(dirty.current ? 'dirty' : 'saved')
    } catch {
      dirty.current = true
      setSaveState('error')
    }
  }, [id])

  useEffect(() => {
    dirty.current = false
    lastSaved.current = null
    setSaveState('saved')
    setNote(undefined)
    load()
    loadTitles()
    return () => {
      flush()
    }
  }, [id, load, loadTitles, flush])

  // Closing the window unloads the page without unmounting React: save the last keystrokes too.
  useEffect(() => {
    const onHide = () => void flush()
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [flush])

  useIpcRefresh(
    ['notes:changed'],
    () => {
      loadTitles()
      if (!dirty.current) load()
    },
    [id]
  )

  const change = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    dirty.current = true
    setSaveState('dirty')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 650)
  }

  const setModePersist = (m: EditorMode) => {
    setMode(m)
    try {
      localStorage.setItem('kn.editorMode' + (compact ? '.c' : ''), m)
    } catch {
      /* ignore */
    }
  }

  const titleKeys = useMemo(() => new Set(titles.map((t) => normalizeTitle(t.title))), [titles])
  const html = useMemo(() => (mode === 'edit' ? '' : renderMarkdown(draft.body, (t) => titleKeys.has(normalizeTitle(t)))), [draft.body, mode, titleKeys])

  const openWiki = async (title: string) => {
    await flush()
    const existing = await invoke('notes:findByTitle', title)
    if (existing) return onOpenNote(existing)
    const n = await invoke('notes:create', { title, body: '', workspaceId: currentWorkspaceId() })
    toast({ kind: 'info', title: `Created “${title}”` })
    onOpenNote(n.id)
  }

  // ---------------------------------------------------------------- editing helpers

  // Programmatic edits restore the caret synchronously after React commits the
  // new value, so fast typing right after an edit lands in the right place.
  const pendingSel = useRef<[number, number] | null>(null)
  useLayoutEffect(() => {
    const el = ta.current
    const sel = pendingSel.current
    if (!el || !sel) return
    pendingSel.current = null
    el.focus()
    el.setSelectionRange(sel[0], sel[1])
  }, [draft.body])

  const applyEdit = (value: string, selStart: number, selEnd = selStart) => {
    pendingSel.current = [selStart, selEnd]
    change({ body: value })
  }

  const wrap = (mark: string) => {
    const el = ta.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e, value } = el
    const sel = value.slice(s, e)
    applyEdit(value.slice(0, s) + mark + sel + mark + value.slice(e), s + mark.length, e + mark.length)
  }

  const updateAutocomplete = (el: HTMLTextAreaElement) => {
    const pos = el.selectionStart
    const before = el.value.slice(Math.max(0, pos - 80), pos)
    const m = /\[\[([^\[\]\n|]*)$/.exec(before)
    if (m) {
      const start = pos - m[1].length
      const at = caretCoords(el, start - 2)
      setAc((cur) => ({ query: m[1], start, index: cur && cur.start === start ? cur.index : 0, x: at.x, y: at.y }))
    } else if (ac) setAc(null)
  }

  const acItems = useMemo(() => {
    if (!ac) return []
    const q = ac.query.trim().toLowerCase()
    const list = titles.filter((t) => t.id !== id && (!q || t.title.toLowerCase().includes(q)))
    const out = list.slice(0, 7).map((t) => t.title)
    if (q && !titles.some((t) => t.title.toLowerCase() === q)) out.push(ac.query.trim())
    return out
  }, [ac, titles, id])

  const acceptAc = (title: string) => {
    const el = ta.current
    if (!el || !ac) return
    const { value, selectionStart: pos } = el
    const after = value.slice(pos)
    const closing = after.startsWith(']]') ? 2 : 0
    const insert = title + ']]'
    const next = value.slice(0, ac.start) + insert + after.slice(closing)
    setAc(null)
    applyEdit(next, ac.start + insert.length)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    // Keys that confirm an IME composition (Enter, Tab…) belong to the IME.
    if (e.nativeEvent.isComposing) return
    if (ac && acItems.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const d = e.key === 'ArrowDown' ? 1 : -1
        setAc({ ...ac, index: (ac.index + d + acItems.length) % acItems.length })
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        acceptAc(acItems[Math.min(ac.index, acItems.length - 1)])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setAc(null)
        return
      }
    }
    const mod = e.ctrlKey || e.metaKey
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') return e.preventDefault(), wrap('**')
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'i') return e.preventDefault(), wrap('_')
    if (e.key === 'Tab' && !mod) {
      e.preventDefault()
      const { selectionStart: s, selectionEnd: en, value } = el
      const lineStart = value.lastIndexOf('\n', s - 1) + 1
      if (e.shiftKey) {
        const n = value.startsWith('  ', lineStart) ? 2 : value.startsWith(' ', lineStart) ? 1 : 0
        if (n) applyEdit(value.slice(0, lineStart) + value.slice(lineStart + n), Math.max(lineStart, s - n), Math.max(lineStart, en - n))
      } else if (s !== en) {
        applyEdit(value.slice(0, lineStart) + '  ' + value.slice(lineStart), s + 2, en + 2)
      } else {
        applyEdit(value.slice(0, s) + '  ' + value.slice(en), s + 2)
      }
      return
    }
    if (e.key === 'Enter' && !mod && !e.shiftKey) {
      // Continue Markdown lists.
      const { selectionStart: s, selectionEnd: en, value } = el
      if (s !== en) return
      const lineStart = value.lastIndexOf('\n', s - 1) + 1
      const line = value.slice(lineStart, s)
      const m = /^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)\. |> )/.exec(line)
      if (!m) return
      e.preventDefault()
      if (line.trim() === m[2].trim()) {
        // Empty item: end the list.
        applyEdit(value.slice(0, lineStart) + value.slice(s), lineStart)
        return
      }
      let marker = m[2]
      if (m[3]) marker = `${Number(m[3]) + 1}. `
      else if (/\[[ xX]\]/.test(marker)) marker = marker.replace(/\[[xX]\]/, '[ ]')
      const ins = '\n' + m[1] + marker
      applyEdit(value.slice(0, s) + ins + value.slice(s), s + ins.length)
    }
  }

  const onEditorKeys = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault()
      flush()
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'e') {
      e.preventDefault()
      const order: EditorMode[] = compact ? ['edit', 'preview'] : ['edit', 'split', 'preview']
      setModePersist(order[(order.indexOf(mode) + 1) % order.length] ?? 'edit')
    }
  }

  // ---------------------------------------------------------------- actions

  const togglePin = async () => {
    if (!note) return
    const n = await invoke('notes:update', id, { pinned: !note.pinned })
    if (n) setNote(n)
  }

  const exportMd = async () => {
    await flush()
    const n = await invoke('notes:get', id)
    if (!n) return
    const path = await invoke('app:saveFile', slugFile(n.title, '.md'), noteToMarkdown(n))
    if (path) toast({ kind: 'ok', title: 'Note exported', body: path })
  }

  const remove = async () => {
    if (!(await confirmAction('Delete note?', `“${draft.title || 'Untitled'}” will be permanently deleted from this device.`, 'Delete', true))) return
    window.clearTimeout(timer.current)
    dirty.current = false
    await invoke('notes:delete', id)
    toast({ kind: 'ok', title: 'Note deleted' })
    onDeleted?.()
  }

  if (note === undefined) return <div className="empty">Loading…</div>
  if (note === null) return <div className="empty">This note no longer exists.</div>

  const words = (draft.body.match(/\S+/g) ?? []).length
  const wsName = note.workspaceId ? workspaces.find((w) => w.id === note.workspaceId)?.name : undefined
  const saveLabel = saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Edited' : saveState === 'error' ? 'Save failed' : 'Saved'

  const preview = (
    <div className="kn-preview md selectable" onClick={(e) => onMarkdownClick(e, openWiki)}>
      {draft.body.trim() ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <div className="dim">Nothing to preview yet.</div>}
    </div>
  )

  const editor = (
    <div className="kn-editor-wrap">
      <textarea
        ref={ta}
        className="kn-textarea"
        value={draft.body}
        placeholder={'Write in Markdown…  Link notes with [[Note title]]'}
        spellCheck
        onChange={(e) => {
          change({ body: e.target.value })
          updateAutocomplete(e.target)
        }}
        onKeyDown={onKeyDown}
        // Any caret move (click, arrows, Home/End) re-evaluates the [[ popup so
        // accepting a suggestion always replaces the text right before the caret.
        onSelect={(e) => updateAutocomplete(e.currentTarget)}
        onBlur={() => {
          setTimeout(() => setAc(null), 150)
          flush()
        }}
        aria-label="Note body"
      />
      {ac && acItems.length > 0 && (
        <div className="kn-ac pop" role="listbox" style={{ left: ac.x, top: ac.y }}>
          <div className="label" style={{ padding: '4px 8px' }}>
            Link to note
          </div>
          {acItems.map((t, i) => (
            <button
              key={t + i}
              role="option"
              aria-selected={i === ac.index}
              className={'kn-ac-item' + (i === ac.index ? ' on' : '')}
              onMouseDown={(e) => {
                e.preventDefault()
                acceptAc(t)
              }}
            >
              <Link2 size={12} />
              <span className="ellipsis">{t}</span>
              {!titleKeys.has(normalizeTitle(t)) && <span className="badge">new</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  const linksPanel = (
    <>
      <div className="kn-side-sec">
        <div className="label">Linked from · {note.backlinks.length}</div>
        {note.backlinks.length === 0 && <div className="dim kn-side-empty">No notes link here yet. Reference this note with [[{draft.title || 'title'}]].</div>}
        {note.backlinks.map((b) => (
          <button key={b.id} className="kn-link-row" onClick={() => onOpenNote(b.id)}>
            <div className="kn-link-title">{b.title}</div>
            {b.context && <div className="kn-link-ctx">{b.context}</div>}
          </button>
        ))}
      </div>
      <div className="kn-side-sec">
        <div className="label">Links · {note.links.length}</div>
        {note.links.length === 0 && <div className="dim kn-side-empty">No outgoing links.</div>}
        {note.links.map((l) => (
          <button key={l.title} className={'kn-link-row' + (l.id ? '' : ' missing')} onClick={() => openWiki(l.title)} data-tip={l.id ? 'Open note' : 'Create this note'}>
            <div className="kn-link-title">
              {l.title} {!l.id && <span className="badge">create</span>}
            </div>
          </button>
        ))}
      </div>
    </>
  )

  return (
    <div className={'kn-note' + (compact ? ' compact' : '')} onKeyDown={onEditorKeys}>
      <div className="kn-note-main">
        <div className="kn-note-head">
          <input className="kn-title-input" value={draft.title} placeholder="Untitled" onChange={(e) => change({ title: e.target.value })} onBlur={flush} aria-label="Note title" />
          <div className="kn-toolbar">
            <div className="seg" role="radiogroup" aria-label="Editor mode">
              <button className={mode === 'edit' ? 'on' : ''} onClick={() => setModePersist('edit')} data-tip="Edit" data-kbd="Ctrl+E">
                <Pencil size={12} />
              </button>
              {!compact && (
                <button className={mode === 'split' ? 'on' : ''} onClick={() => setModePersist('split')} data-tip="Split">
                  <Columns2 size={12} />
                </button>
              )}
              <button className={mode === 'preview' ? 'on' : ''} onClick={() => setModePersist('preview')} data-tip="Preview">
                <Eye size={12} />
              </button>
            </div>
            <span className="spacer" />
            <span className={'kn-save mono ' + saveState}>{saveLabel}</span>
            <button className={'icon-btn sm' + (note.pinned ? ' on' : '')} onClick={togglePin} data-tip={note.pinned ? 'Unpin' : 'Pin'} aria-label="Pin note">
              {note.pinned ? <PinOff size={13} /> : <Pin size={13} />}
            </button>
            <button className="icon-btn sm" onClick={exportMd} data-tip="Export as Markdown" aria-label="Export note">
              <Download size={13} />
            </button>
            <button className="icon-btn sm" onClick={remove} data-tip="Delete note" aria-label="Delete note">
              <Trash2 size={13} />
            </button>
          </div>
          <div className="kn-meta">
            <span className="label">Created</span>
            <span className="mono">{fmtDate(note.createdAt)}</span>
            <span className="label">Updated</span>
            <span className="mono" data-tip={fmtDate(note.updatedAt)}>
              {timeAgo(note.updatedAt)}
            </span>
            <span className="label">Words</span>
            <span className="mono">{words}</span>
            {wsName && (
              <>
                <span className="label">Workspace</span>
                <span className="mono">{wsName}</span>
              </>
            )}
          </div>
          <div className="kn-tags-row">
            <span className="label">Tags</span>
            <input className="kn-tags-input" value={draft.tags} placeholder="comma, separated" onChange={(e) => change({ tags: e.target.value })} onBlur={flush} aria-label="Tags" />
          </div>
          {note.sourceUrl && (
            <div className="kn-source-row">
              <span className="label">Source</span>
              <button className="kn-source-link" onClick={() => openUrl(note.sourceUrl!)} data-tip={note.sourceUrl}>
                {hostOf(note.sourceUrl)} <ArrowUpRight size={11} />
              </button>
            </div>
          )}
        </div>
        <div className={'kn-body mode-' + mode}>
          {mode !== 'preview' && editor}
          {mode !== 'edit' && preview}
        </div>
        {compact && <div className="kn-compact-links">{linksPanel}</div>}
      </div>
      {!compact && <aside className="kn-note-side">{linksPanel}</aside>}
    </div>
  )
}
