// Sticky notes — quick coloured notes stored locally (also a new-tab widget).
import { useEffect, useRef, useState } from 'react'
import { Pin, PinOff, Plus, StickyNote as StickyIcon, Trash2 } from 'lucide-react'
import { WIDGET_COLORS, type StickyNote, type WidgetColor } from '@shared/modules/widgets'
import { timeAgo } from '../../lib/format'
import { toast } from '../../stores/ui'
import { kvPeek, kvWrite, useKv } from './store'
import { ColorDots, colorVar } from './ui'
import './widgets.css'

const EMPTY: StickyNote[] = []

export function useStickies(): [StickyNote[], (n: StickyNote[]) => void, boolean] {
  return useKv<StickyNote[]>('stickies', EMPTY)
}

export function sortNotes(notes: StickyNote[]): StickyNote[] {
  return [...notes].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt)
}

export function newNote(notes: StickyNote[], text = ''): StickyNote {
  const used = new Set(notes.slice(-3).map((n) => n.color))
  const color = (WIDGET_COLORS.find((c) => !used.has(c)) ?? 'accent') as WidgetColor
  return { id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text, color, createdAt: Date.now(), updatedAt: Date.now() }
}

/** Applies a patch to the latest stored list (avoids clobbering concurrent edits). */
function patchNote(id: string, patch: Partial<StickyNote>): void {
  const cur = kvPeek<StickyNote[]>('stickies') ?? []
  kvWrite(
    'stickies',
    cur.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: patch.text !== undefined ? Date.now() : n.updatedAt } : n))
  )
}

export function deleteNote(id: string): void {
  const cur = kvPeek<StickyNote[]>('stickies') ?? []
  const note = cur.find((n) => n.id === id)
  kvWrite(
    'stickies',
    cur.filter((n) => n.id !== id)
  )
  if (note?.text.trim())
    toast({
      kind: 'info',
      title: 'Note deleted',
      action: { label: 'Undo', run: () => kvWrite('stickies', [...(kvPeek<StickyNote[]>('stickies') ?? []), note]) },
      ttl: 6000
    })
}

export function NoteCard({ note, compact, autoFocus }: { note: StickyNote; compact?: boolean; autoFocus?: boolean }) {
  const [text, setText] = useState(note.text)
  const [editingColor, setEditingColor] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = useRef(false)
  // Pick up edits made in another window unless we're mid-edit here.
  useEffect(() => {
    if (!dirty.current) setText(note.text)
  }, [note.text])
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current)
        patchNote(note.id, { text: textRef.current })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const textRef = useRef(text)
  textRef.current = text
  const onChange = (v: string) => {
    setText(v)
    dirty.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      dirty.current = false
      patchNote(note.id, { text: v.slice(0, 20_000) })
    }, 400)
  }
  return (
    <div className={'wg-note' + (compact ? ' compact' : '')} style={{ ['--c' as string]: colorVar(note.color) }}>
      <textarea value={text} onChange={(e) => onChange(e.target.value)} placeholder="Write something…" aria-label="Note" autoFocus={autoFocus} spellCheck />
      <div className="wg-note-f">
        {editingColor ? (
          <ColorDots
            value={note.color}
            size={11}
            onChange={(c) => {
              patchNote(note.id, { color: c })
              setEditingColor(false)
            }}
          />
        ) : (
          <>
            <button className="wg-note-color" onClick={() => setEditingColor(true)} aria-label="Change colour" data-tip="Colour" />
            <span className="wg-note-time">{timeAgo(note.updatedAt)}</span>
          </>
        )}
        <span className="spacer" />
        <button className="icon-btn sm" onClick={() => patchNote(note.id, { pinned: !note.pinned })} aria-label={note.pinned ? 'Unpin' : 'Pin'} data-tip={note.pinned ? 'Unpin' : 'Pin to top'}>
          {note.pinned ? <PinOff size={11} /> : <Pin size={11} />}
        </button>
        <button className="icon-btn sm" onClick={() => deleteNote(note.id)} aria-label="Delete note" data-tip="Delete">
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

export default function StickiesPanel() {
  const [notes, setNotes, loaded] = useStickies()
  const [fresh, setFresh] = useState<string | null>(null)
  const add = () => {
    const n = newNote(notes)
    setFresh(n.id)
    setNotes([...notes, n])
  }
  const sorted = sortNotes(notes)
  return (
    <div className="wg wg-stickies">
      <div className="wg-toolbar">
        <span className="dim" style={{ fontSize: 12 }}>
          {notes.length} note{notes.length === 1 ? '' : 's'}
        </span>
        <span className="spacer" />
        <button className="btn sm primary" onClick={add}>
          <Plus size={12} /> New note
        </button>
      </div>
      <div className="wg-pad">
        {loaded && !notes.length ? (
          <div className="empty">
            <StickyIcon size={22} />
            <div>Quick notes live here and on the new tab page.</div>
            <button className="btn sm" onClick={add}>
              <Plus size={12} /> New note
            </button>
          </div>
        ) : (
          <div className="wg-notes">
            {sorted.map((n) => (
              <NoteCard key={n.id} note={n} autoFocus={n.id === fresh} />
            ))}
          </div>
        )}
        <p className="wg-fine">Notes are saved on this device as you type.</p>
      </div>
    </div>
  )
}
