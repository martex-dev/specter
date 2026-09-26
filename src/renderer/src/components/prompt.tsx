import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { Modal } from './ui'

interface PromptReq {
  title: string
  label?: string
  placeholder?: string
  initial?: string
  multiline?: boolean
  confirmLabel?: string
  danger?: boolean
  /** When true, renders a confirmation (no input). */
  confirmOnly?: boolean
  body?: string
  resolve: (v: string | null) => void
}

const usePrompt = create<{ req: PromptReq | null }>(() => ({ req: null }))

export function promptText(o: Omit<PromptReq, 'resolve'>): Promise<string | null> {
  // A prompt replaced by another counts as cancelled, so its caller doesn't hang.
  usePrompt.getState().req?.resolve(null)
  return new Promise((resolve) => usePrompt.setState({ req: { ...o, resolve } }))
}

export async function confirmAction(title: string, body?: string, confirmLabel = 'Confirm', danger = false): Promise<boolean> {
  const r = await promptText({ title, body, confirmLabel, danger, confirmOnly: true })
  return r !== null
}

export function PromptLayer() {
  const req = usePrompt((s) => s.req)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (req) {
      setValue(req.initial ?? '')
      setTimeout(() => {
        // A confirmation has no field; focus a button so Enter/Escape reach the
        // dialog instead of the web page that may still hold keyboard focus
        // (Cancel for destructive ones, so a stray Enter doesn't confirm).
        if (!inputRef.current) return (usePrompt.getState().req?.danger ? cancelRef : confirmRef).current?.focus()
        inputRef.current.focus()
        inputRef.current.select()
      }, 20)
    }
  }, [req])
  if (!req) return null
  const done = (v: string | null) => {
    usePrompt.setState({ req: null })
    req.resolve(v)
  }
  const submit = () => done(req.confirmOnly ? 'ok' : value)
  return (
    <Modal
      title={req.title}
      onClose={() => done(null)}
      width={460}
      footer={
        <>
          <button ref={cancelRef} className="btn ghost" onClick={() => done(null)}>
            Cancel
          </button>
          <button ref={confirmRef} className={'btn ' + (req.danger ? 'danger solid' : 'primary')} onClick={submit}>
            {req.confirmLabel ?? 'Save'}
          </button>
        </>
      }
    >
      {req.body && <p style={{ margin: '0 0 12px', color: 'var(--fg-1)', lineHeight: 1.5 }}>{req.body}</p>}
      {!req.confirmOnly && (
        <div className="col" style={{ gap: 6 }}>
          {req.label && <span className="label">{req.label}</span>}
          {req.multiline ? (
            <textarea
              ref={inputRef}
              className="textarea"
              rows={4}
              value={value}
              placeholder={req.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey && !e.nativeEvent.isComposing) submit()
              }}
            />
          ) : (
            <input
              ref={inputRef}
              className="input"
              value={value}
              placeholder={req.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
              }}
            />
          )}
        </div>
      )}
    </Modal>
  )
}
