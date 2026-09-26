import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Globe, Lock, LockOpen, Search, ShieldAlert, ShieldCheck, Sparkles, Star, ZoomIn, Hexagon, CornerDownLeft } from 'lucide-react'
import { detectPageKind, displayUrl, interpretInput, isInternal, parseScope, toUrl, type OmniboxScope } from '@shared/url'
import { SEARCH_ENGINES } from '@shared/settings'
import { invoke } from '../lib/ipc'
import { omniboxProviders, type OmniItem } from '../lib/omnibox'
import { runCommand, shortcutFor } from '../lib/commands'
import { activeTab, useActiveTab } from '../stores/browser'
import { getSetting, useSetting } from '../stores/settings'
import { openMenu, useUi } from '../stores/ui'
import { Kbd } from '../components/ui'
import { KIND_ICON, KIND_LABEL } from './omniboxProviders'
import { openInput } from './openInput'
import { contextualActions } from './contextual'
import { SiteInfoPopover } from './SiteInfo'
import { record } from '../lib/perf'

const SCOPE_LABEL: Record<OmniboxScope, string> = {
  tabs: 'Tabs',
  history: 'History',
  bookmarks: 'Bookmarks',
  workspace: 'Workspace',
  command: 'Command',
  ai: 'AI',
  notes: 'Notes',
  market: 'Market'
}

export function Omnibox() {
  const tab = useActiveTab()
  const engineId = useSetting('search.engine')
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState('')
  const [items, setItems] = useState<OmniItem[]>([])
  const [sel, setSel] = useState(0)
  const [open, setOpen] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const [siteInfo, setSiteInfo] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const typedRef = useRef('')
  const deletingRef = useRef(false)
  const composingRef = useRef(false)
  const reqRef = useRef(0)

  const url = tab?.url ?? ''
  const engine = SEARCH_ENGINES.find((e) => e.id === engineId)
  const scoped = parseScope(text)

  // Keep the displayed text in sync with the tab when not editing. Switching tabs
  // (Ctrl+Tab, Ctrl+W) while editing also resets it, or Enter would load the
  // previous tab's address/typed text into the new one.
  const shownTabRef = useRef(tab?.id)
  useEffect(() => {
    const switched = shownTabRef.current !== tab?.id
    shownTabRef.current = tab?.id
    if (!focused || switched) setText(url === 'specter://newtab' ? '' : url)
    if (switched) {
      reqRef.current++
      typedRef.current = ''
      setOpen(false)
      setSiteInfo(false)
    }
  }, [url, focused, tab?.id])

  useEffect(() => {
    if (!url || isInternal(url)) return setBookmarked(false)
    invoke('bookmarks:findByUrl', url)
      .then((b) => setBookmarked(!!b))
      .catch(() => setBookmarked(false))
    const refresh = () => invoke('bookmarks:findByUrl', url).then((b) => setBookmarked(!!b))
    window.addEventListener('specter:bookmarks-changed', refresh)
    return () => window.removeEventListener('specter:bookmarks-changed', refresh)
  }, [url])

  const focusInput = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [])


  // Build suggestions.
  const compute = useCallback(
    async (value: string) => {
      const id = ++reqRef.current
      const t0 = performance.now()
      const sc = parseScope(value)
      const scope: OmniboxScope | 'default' = sc ? sc.scope : 'default'
      const q = sc ? sc.query : value.trim()
      const base: OmniItem[] = []
      if (scope === 'default' && q) {
        const intent = interpretInput(q)
        if (intent.kind === 'url') base.push({ id: 'typed', kind: 'url', title: intent.url.replace(/^https:\/\//, ''), subtitle: 'Open address', icon: <Globe size={15} />, score: 1000, url: intent.url })
        else base.push({ id: 'typed', kind: 'search', title: q, subtitle: `Search ${engine?.name ?? 'the web'}`, icon: <Search size={15} />, score: 1000 })
      }
      const results = await Promise.all(
        omniboxProviders(scope).map(async (p) => {
          try {
            return await p.provide(q, scope)
          } catch {
            return []
          }
        })
      )
      if (id !== reqRef.current) return
      let merged = [...base, ...results.flat()]
      // De-duplicate URL suggestions.
      const seen = new Set<string>()
      merged = merged.filter((m) => {
        const k = m.url ? m.url.replace(/\/$/, '') : m.id
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      merged.sort((a, b) => b.score - a.score)
      // Search-what-you-typed stays first for plain queries unless a URL strongly matches.
      setItems(merged.slice(0, scope === 'default' ? 10 : 40))
      record('omniboxSuggest', performance.now() - t0)
      setSel(0)

      // Inline autocomplete from a strong history/bookmark URL match.
      if (scope === 'default' && !deletingRef.current && q && !/\s/.test(q) && inputRef.current) {
        const typed = typedRef.current
        const hit = merged.find((m) => m.completion && m.completion.toLowerCase().startsWith(typed.toLowerCase()))
        if (hit && hit.completion && hit.completion.length > typed.length && document.activeElement === inputRef.current && inputRef.current.value === typed) {
          const host = hit.completion.split('/')[0]
          const completion = host.toLowerCase().startsWith(typed.toLowerCase()) && host.length > typed.length ? host : hit.completion
          inputRef.current.value = typed + completion.slice(typed.length)
          inputRef.current.setSelectionRange(typed.length, inputRef.current.value.length)
          setItems((prev) => [{ id: 'typed', kind: 'url', title: completion, subtitle: 'Open address', icon: <Globe size={15} />, score: 1000, url: 'https://' + completion }, ...prev.filter((p) => p.id !== 'typed')])
        }
      }
    },
    [engine?.name]
  )

  useEffect(() => {
    const f = (e: Event) => {
      if ((e as CustomEvent<{ clear?: boolean }>).detail?.clear) {
        typedRef.current = ''
        setText('')
        setOpen(false)
        if (inputRef.current) inputRef.current.value = ''
      }
      focusInput()
    }
    // New-tab "fakebox": typing there continues in the omnibox.
    const typed = (e: Event) => {
      const t = (e as CustomEvent<string>).detail ?? ''
      setFocused(true)
      setTimeout(() => {
        const el = inputRef.current
        if (!el) return
        el.focus()
        if (t) {
          typedRef.current = t
          setText(t)
          setOpen(true)
          compute(t)
        }
      }, 0)
    }
    window.addEventListener('specter:focus-omnibox', f)
    window.addEventListener('specter:omnibox-type', typed)
    return () => {
      window.removeEventListener('specter:focus-omnibox', f)
      window.removeEventListener('specter:omnibox-type', typed)
    }
  }, [focusInput, compute])

  const onChange = (v: string) => {
    typedRef.current = v
    setText(v)
    setOpen(true)
    compute(v)
  }

  const commit = (item: OmniItem | undefined, newTabMode: boolean) => {
    const raw = inputRef.current?.value ?? text
    setOpen(false)
    inputRef.current?.blur()
    if (!item || item.id === 'typed') {
      const sc = parseScope(raw)
      if (sc) {
        // Scoped input with no selection: run the top result if any.
        const top = items.find((i) => i.id !== 'typed')
        if (top) return commit(top, newTabMode)
        return
      }
      if (raw.trim()) openInput(raw, newTabMode)
      return
    }
    if (item.run) item.run({ newTab: newTabMode })
    else if (item.url) openInput(item.url, newTabMode)
    else openInput(item.title, newTabMode)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    deletingRef.current = e.key === 'Backspace' || e.key === 'Delete'
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        compute(text)
      } else setSel((s) => Math.min(items.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(0, s - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const inputVal = inputRef.current?.value ?? text
      // Ctrl+Enter: wrap in www. / .com
      if (e.ctrlKey && /^[\w-]+$/.test(inputVal.trim())) return commit({ id: 'x', kind: 'url', title: '', url: `https://www.${inputVal.trim()}.com`, score: 0 }, e.altKey)
      const item = open ? items[sel] : undefined
      commit(item && !(item.id === 'typed' && inputVal !== text) ? item : undefined, e.altKey || e.shiftKey)
    } else if (e.key === 'Escape') {
      if (open && items.length) {
        setOpen(false)
        if (inputRef.current) inputRef.current.value = text
      } else {
        setText(url === 'specter://newtab' ? '' : url)
        inputRef.current?.blur()
      }
    } else if (e.key === 'Tab' && open && items.length) {
      e.preventDefault()
      setSel((s) => (e.shiftKey ? Math.max(0, s - 1) : Math.min(items.length - 1, s + 1)))
    }
  }

  const loading = !!tab?.loading
  const internal = isInternal(url)
  // SPECTER pages have no site info; don't leave a hidden popover armed to pop
  // up on the next web page.
  useEffect(() => {
    if (internal) setSiteInfo(false)
  }, [internal])
  const secure = url.startsWith('https://')
  const isFile = url.startsWith('file:')
  const kind = useMemo(() => (tab && !internal ? detectPageKind(url, tab.title) : 'generic'), [url, tab, internal])
  const actions = useMemo(() => (tab && !internal ? contextualActions(kind, tab.id) : []), [kind, tab, internal])
  const shown = displayUrl(url)
  const hostEnd = shown.indexOf('/')
  const zoom = tab?.zoom && Math.abs(tab.zoom - 1) > 0.01 ? tab.zoom : null

  return (
    <div className="omnibox-wrap">
      <div className={'omnibox' + (focused ? ' focused' : '') + (!open || !items.length ? ' closed' : '')}>
        <div className="omnibox-row">
          {scoped ? (
            <span className="scope-chip">{SCOPE_LABEL[scoped.scope]}</span>
          ) : (
            <button
              className={'site-chip' + (internal ? ' internal' : !secure && !isFile && url && url !== 'about:blank' ? ' insecure' : '')}
              onClick={() => url && !internal && setSiteInfo((v) => !v)}
              data-tip={internal ? 'SPECTER page' : secure ? 'Connection is secure — view site info' : url ? 'Not secure — view site info' : 'Search or enter address'}
              aria-label="Site information"
            >
              {focused && !url ? <Search size={14} /> : internal ? <Hexagon size={14} /> : secure ? <Lock size={13} /> : url && !isFile ? <LockOpen size={13} /> : <Globe size={14} />}
              {!focused && !internal && url && !secure && !isFile && url !== 'about:blank' && <span>Not secure</span>}
            </button>
          )}
          <div style={{ position: 'relative', flex: 1, minWidth: 0, height: '100%', display: 'flex' }}>
            <input
              ref={inputRef}
              className="omnibox-input"
              value={text}
              spellCheck={false}
              placeholder={`Search ${engine?.name ?? 'the web'}, enter address, or type @ for scopes`}
              style={!focused && shown ? { opacity: 0 } : undefined}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              onFocus={(e) => {
                setFocused(true)
                useUi.setState({ omniboxFocused: true })
                e.target.select()
              }}
              onBlur={() => {
                setTimeout(() => {
                  // Ignore transient blurs (e.g. clicking a suggestion re-focuses).
                  if (document.activeElement === inputRef.current) return
                  setFocused(false)
                  setOpen(false)
                  useUi.setState({ omniboxFocused: false })
                }, 120)
              }}
              aria-label="Address and search bar"
              aria-expanded={open}
              aria-autocomplete="list"
            />
            {!focused && shown && (
              <div
                className="omnibox-display"
                style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center' }}
                onMouseDown={(e) => {
                  e.preventDefault()
                  focusInput()
                }}
              >
                <span className="ellipsis">
                  {hostEnd > 0 && !internal ? (
                    <>
                      <span className="host">{shown.slice(0, hostEnd)}</span>
                      <span className="rest">{shown.slice(hostEnd)}</span>
                    </>
                  ) : (
                    <span className="host">{shown}</span>
                  )}
                </span>
              </div>
            )}
          </div>
          {!focused && tab && !internal && url && (
            <>
              {(tab.loadMs !== undefined || (tab.blocked ?? 0) > 0) && (
                <span className="omni-meta" data-tip={`Page loaded in ${tab.loadMs ?? '—'} ms · ${tab.blocked ?? 0} tracker request${tab.blocked === 1 ? '' : 's'} blocked on this page`}>
                  {tab.loadMs !== undefined && <span>{tab.loadMs >= 1000 ? (tab.loadMs / 1000).toFixed(2) + 's' : tab.loadMs + 'ms'}</span>}
                  {(tab.blocked ?? 0) > 0 && (
                    <span className="ok">
                      <ShieldCheck size={10} /> {tab.blocked}
                    </span>
                  )}
                </span>
              )}
              {zoom && (
                <button className="icon-btn omni-action" onClick={() => runCommand('browser.zoomReset')} data-tip={`Zoom ${Math.round(zoom * 100)}% — click to reset`}>
                  <ZoomIn size={14} />
                </button>
              )}
              {(tab.blockedPopups?.length ?? 0) > 0 && (
                <button className="icon-btn omni-action" style={{ color: 'var(--warn)' }} data-tip="Pop-ups blocked on this page">
                  <ShieldAlert size={14} />
                </button>
              )}
              {actions.length > 0 && (
                <button
                  className="icon-btn omni-action"
                  onClick={(e) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    openMenu({ x: r.left - 200, y: r.bottom + 6, items: [{ header: 'Page actions' }, ...actions], width: 240 })
                  }}
                  data-tip="Contextual actions for this page"
                  aria-label="Page actions"
                >
                  <Sparkles size={14} />
                </button>
              )}
              <button className={'icon-btn omni-action' + (tab.reader ? ' on' : '')} onClick={() => runCommand('page.reader')} data-tip="Reader mode" data-kbd={shortcutFor('page.reader')} aria-label="Reader mode">
                <BookOpen size={14} />
              </button>
              <button className={'icon-btn omni-action' + (bookmarked ? ' on' : '')} onClick={() => runCommand('browser.bookmarkPage')} data-tip={bookmarked ? 'Edit bookmark' : 'Bookmark this page'} data-kbd={shortcutFor('browser.bookmarkPage')} aria-label="Bookmark">
                <Star size={14} fill={bookmarked ? 'currentColor' : 'none'} />
              </button>
            </>
          )}
        </div>
        {focused && open && items.length > 0 && (
          <div className="omni-suggestions" role="listbox" onMouseDown={(e) => e.preventDefault()}>
            {items.map((it, i) => (
              <div key={it.id + i} className={'omni-item' + (i === sel ? ' sel' : '')} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={(e) => commit(it, e.ctrlKey || e.button === 1)}>
                <span className="ic">{it.icon ?? KIND_ICON[it.kind] ?? <Globe size={15} />}</span>
                <span className="t ellipsis">{it.title}</span>
                {it.subtitle && <span className="s ellipsis grow">— {it.subtitle}</span>}
                {!it.subtitle && <span className="grow" />}
                {i === sel ? (
                  <span className="kind label" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {KIND_LABEL[it.kind]} <CornerDownLeft size={11} />
                  </span>
                ) : (
                  <span className="kind label">{KIND_LABEL[it.kind]}</span>
                )}
              </div>
            ))}
            <div className="omni-hint">
              <span>
                <Kbd keys="Alt+Enter" /> new tab
              </span>
              <span>
                <b className="mono">@tabs @history @bookmarks @ws @cmd @ai</b> scopes
              </span>
              <span className="spacer" />
              <span>{getSetting('search.remoteSuggestions') ? 'Remote suggestions on' : 'Local suggestions only'}</span>
            </div>
          </div>
        )}
        {loading && !focused && (
          <div className="progress-line">
            <i />
          </div>
        )}
      </div>
      {siteInfo && tab && <SiteInfoPopover tabId={tab.id} onClose={() => setSiteInfo(false)} />}
    </div>
  )
}

export function omniboxToUrl(input: string): string | null {
  return toUrl(input)
}

export function currentTabUrl(): string {
  return activeTab()?.url ?? ''
}
