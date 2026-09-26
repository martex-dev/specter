import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { invoke } from '../lib/ipc'
import { webviewFor, wcIdFor } from '../lib/webviews'
import { setFindOpen } from '../stores/ui'
import { onFound } from './findEvents'

type FindResult = { active: number; matches: number; error?: string }
type FindState = { q: string; matchCase: boolean; wholeWord: boolean; regex: boolean; result: FindResult | null }

// The bar unmounts while its tab is in the background; keep its query (and the page's
// highlights) so switching back doesn't show an empty box over stale highlights.
const saved = new Map<string, FindState>()

export function FindBar({ tabId }: { tabId: string }) {
  const init = saved.get(tabId)
  const [q, setQ] = useState(init?.q ?? '')
  const [matchCase, setMatchCase] = useState(init?.matchCase ?? false)
  const [wholeWord, setWholeWord] = useState(init?.wholeWord ?? false)
  const [regex, setRegex] = useState(init?.regex ?? false)
  const [result, setResult] = useState<FindResult | null>(init?.result ?? null)
  // Restored bar: the page still has its highlights, so don't search again (it would scroll).
  const restored = useRef(!!init?.q)
  const inputRef = useRef<HTMLInputElement>(null)
  const advanced = wholeWord || regex

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
    const focus = () => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('specter:focus-find', focus)
    return () => window.removeEventListener('specter:focus-find', focus)
  }, [])

  useEffect(() => {
    saved.set(tabId, { q, matchCase, wholeWord, regex, result })
  }, [tabId, q, matchCase, wholeWord, regex, result])

  useEffect(() => onFound(tabId, (r) => setResult({ active: r.activeMatchOrdinal, matches: r.matches })), [tabId])

  // Run a new search whenever the query or options change.
  useEffect(() => {
    if (restored.current) {
      restored.current = false
      return
    }
    const wv = webviewFor(tabId)
    const wcId = wcIdFor(tabId)
    if (!wv || wcId === null) return
    const t = setTimeout(async () => {
      if (!q) {
        wv.stopFindInPage('clearSelection')
        invoke('guest:findAdvancedClear', wcId).catch(() => undefined)
        setResult(null)
        return
      }
      if (advanced) {
        wv.stopFindInPage('clearSelection')
        const r = await invoke('guest:findAdvanced', wcId, q, { matchCase, wholeWord, regex }).catch((e) => ({ matches: 0, active: 0, error: String(e) }))
        setResult(r)
      } else {
        invoke('guest:findAdvancedClear', wcId).catch(() => undefined)
        wv.findInPage(q, { matchCase, findNext: true, forward: true })
      }
    }, 120)
    return () => clearTimeout(t)
  }, [q, matchCase, wholeWord, regex, advanced, tabId])

  const step = async (forward: boolean) => {
    const wv = webviewFor(tabId)
    const wcId = wcIdFor(tabId)
    if (!wv || wcId === null || !q) return
    if (advanced) setResult(await invoke('guest:findAdvancedStep', wcId, forward).catch((e) => ({ matches: 0, active: 0, error: String(e) })))
    else wv.findInPage(q, { matchCase, forward, findNext: false })
  }

  const close = () => {
    const wv = webviewFor(tabId)
    const wcId = wcIdFor(tabId)
    wv?.stopFindInPage('clearSelection')
    if (wcId !== null) invoke('guest:findAdvancedClear', wcId).catch(() => undefined)
    saved.delete(tabId)
    setFindOpen(tabId, false)
    wv?.focus()
  }

  return (
    <div className="findbar pop" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <input
        ref={inputRef}
        value={q}
        placeholder={regex ? 'Regular expression' : 'Find in page'}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          // Enter that confirms an IME composition is not a find-next.
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) step(!e.shiftKey)
        }}
        aria-label="Find in page"
      />
      <span className="count" style={result?.error ? { color: 'var(--bad)' } : undefined}>
        {result?.error ? result.error : q && result ? (result.matches ? `${result.active}/${result.matches}` : 'No results') : ''}
      </span>
      <button className={'find-opt' + (matchCase ? ' on' : '')} onClick={() => setMatchCase(!matchCase)} data-tip="Match case">
        Aa
      </button>
      <button className={'find-opt' + (wholeWord ? ' on' : '')} onClick={() => setWholeWord(!wholeWord)} data-tip="Whole word">
        W
      </button>
      <button className={'find-opt' + (regex ? ' on' : '')} onClick={() => setRegex(!regex)} data-tip="Regular expression">
        .*
      </button>
      <button className="icon-btn sm" onClick={() => step(false)} aria-label="Previous match" data-tip="Previous" data-kbd="Shift+Enter">
        <ChevronUp size={15} />
      </button>
      <button className="icon-btn sm" onClick={() => step(true)} aria-label="Next match" data-tip="Next" data-kbd="Enter">
        <ChevronDown size={15} />
      </button>
      <button className="icon-btn sm" onClick={close} aria-label="Close find" data-tip="Close" data-kbd="Escape">
        <X size={14} />
      </button>
    </div>
  )
}
