// Todo list persisted in localStorage ('specter.toolkit.todos'); kept in sync
// between the main window and a popped-out panel via the storage event.
import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Seg } from '../../../components/ui'

export interface Todo {
  id: string
  text: string
  done: boolean
  created: number
  doneAt?: number
}

const KEY = 'specter.toolkit.todos'

function load(): Todo[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((t) => t && typeof t.text === 'string') : []
  } catch {
    return []
  }
}

function save(list: Todo[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* storage full / unavailable */
  }
}

export default function TodoView() {
  const [todos, setTodos] = useState<Todo[]>(load)
  const [text, setText] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === KEY && setTodos(load())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const update = (next: Todo[]) => {
    setTodos(next)
    save(next)
  }
  const add = () => {
    const t = text.trim()
    if (!t) return
    update([{ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: t, done: false, created: Date.now() }, ...todos])
    setText('')
  }
  const toggle = (id: string) => update(todos.map((t) => (t.id === id ? { ...t, done: !t.done, doneAt: !t.done ? Date.now() : undefined } : t)))
  const remove = (id: string) => update(todos.filter((t) => t.id !== id))
  const commitEdit = () => {
    if (!editing) return
    const v = draft.trim()
    update(v ? todos.map((t) => (t.id === editing ? { ...t, text: v } : t)) : todos.filter((t) => t.id !== editing))
    setEditing(null)
  }
  const move = (id: string, dir: -1 | 1) => {
    const i = todos.findIndex((t) => t.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= todos.length) return
    const next = [...todos]
    ;[next[i], next[j]] = [next[j], next[i]]
    update(next)
  }

  const shown = todos.filter((t) => (filter === 'all' ? true : filter === 'active' ? !t.done : t.done))
  const remaining = todos.filter((t) => !t.done).length

  return (
    <>
      <div className="row">
        <input ref={input} className="input grow" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add a task and press Enter" aria-label="New task" autoFocus />
        <button className="btn primary sm" onClick={add} disabled={!text.trim()} aria-label="Add task">
          <Plus size={13} />
        </button>
      </div>
      <div className="row">
        <Seg value={filter} onChange={setFilter} options={[{ value: 'all', label: `All ${todos.length}` }, { value: 'active', label: `Open ${remaining}` }, { value: 'done', label: `Done ${todos.length - remaining}` }]} />
        <span className="spacer" />
        {todos.some((t) => t.done) && (
          <button className="btn sm ghost" onClick={() => update(todos.filter((t) => !t.done))}>
            Clear done
          </button>
        )}
      </div>
      {shown.length ? (
        <div className="tkp-list">
          {shown.map((t) => (
            <div
              key={t.id}
              className={'tkp-item' + (t.done ? ' done' : '')}
              onKeyDown={(e) => {
                if (editing) return
                if (e.altKey && e.key === 'ArrowUp') move(t.id, -1)
                else if (e.altKey && e.key === 'ArrowDown') move(t.id, 1)
              }}
            >
              <input type="checkbox" className="tkp-check" checked={t.done} onChange={() => toggle(t.id)} aria-label={`Mark "${t.text}" ${t.done ? 'not done' : 'done'}`} />
              {editing === t.id ? (
                <input
                  className="input grow"
                  style={{ height: 24 }}
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit()
                    else if (e.key === 'Escape') setEditing(null)
                  }}
                  aria-label="Edit task"
                />
              ) : (
                <span
                  className="t grow selectable"
                  style={{ wordBreak: 'break-word', cursor: 'text' }}
                  onDoubleClick={() => {
                    setEditing(t.id)
                    setDraft(t.text)
                  }}
                  title="Double-click to edit"
                >
                  {t.text}
                </span>
              )}
              <button className="icon-btn sm x" onClick={() => remove(t.id)} aria-label="Delete task">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty" style={{ padding: 24 }}>
          {todos.length ? 'Nothing here.' : 'No tasks yet.'}
        </div>
      )}
      <div className="tk-note">Saved on this device only. Double-click to edit · Alt+↑/↓ to reorder.</div>
    </>
  )
}
