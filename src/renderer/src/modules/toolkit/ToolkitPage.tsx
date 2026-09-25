// specter://toolkit — searchable tool list on the left, the selected tool on
// the right. Deep links: specter://toolkit/<tool>[?query].
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ComponentType, type LazyExoticComponent } from 'react'
import { Globe, Lock, Search, Wrench } from 'lucide-react'
import type { PageProps } from '../../pages/registry'
import { loadUrl } from '../../stores/browser'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { fuzzyBest } from '@shared/fuzzy'
import { GROUPS, TOOLS, toolById, type ToolDef, type ToolProps } from './tools'
import './toolkit.css'

const lazyCache = new Map<string, LazyExoticComponent<ComponentType<ToolProps>>>()
function lazyTool(def: ToolDef) {
  let c = lazyCache.get(def.id)
  if (!c) lazyCache.set(def.id, (c = lazy(def.load)))
  return c
}

let lastSearch = ''

export default function ToolkitPage({ tabId, sub, query }: PageProps) {
  const toolId = sub.split('/')[0]
  const tool = toolId ? toolById(toolId) : undefined
  const [q, setQ] = useState(lastSearch)
  const [hl, setHl] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  const open = (id: string | null) => loadUrl(tabId, id ? `specter://toolkit/${id}` : 'specter://toolkit')

  const filtered = useMemo(() => {
    lastSearch = q
    if (!q.trim()) return TOOLS
    return TOOLS.map((t) => ({ t, s: fuzzyBest(q, [t.title, t.short, t.group, ...t.keywords]) }))
      .filter((x) => x.s !== null)
      .sort((a, b) => (b.s as number) - (a.s as number))
      .map((x) => x.t)
  }, [q])

  useEffect(() => setHl(0), [q])

  // Keyboard: "/" focuses search, Alt+↑/↓ switches tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      } else if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault()
        const list = filtered.length ? filtered : TOOLS
        const i = tool ? list.findIndex((x) => x.id === tool.id) : -1
        const next = list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]
        if (next) open(next.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, tool?.id])

  const groups = q.trim() ? [{ name: 'Results', items: filtered }] : GROUPS.map((g) => ({ name: g, items: TOOLS.filter((t) => t.group === g) }))
  const flat = groups.flatMap((g) => g.items)

  const Tool = tool ? lazyTool(tool) : null

  return (
    <div className="tk">
      <aside className="tk-nav" aria-label="Tools">
        <div className="tk-nav-h">
          <div className="tk-nav-title" onClick={() => open(null)}>
            <Wrench size={15} style={{ color: 'var(--accent)' }} />
            Toolkit
          </div>
          <div className="tk-nav-search">
            <Search size={13} />
            <input
              ref={searchRef}
              className="input"
              placeholder="Search tools   /"
              value={q}
              autoFocus={!tool}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setHl((h) => Math.min(flat.length - 1, h + 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setHl((h) => Math.max(0, h - 1))
                } else if (e.key === 'Enter' && flat[hl]) {
                  e.preventDefault()
                  open(flat[hl].id)
                } else if (e.key === 'Escape') setQ('')
              }}
              aria-label="Search tools"
            />
          </div>
        </div>
        <div className="tk-nav-list" role="listbox">
          {groups.map((g) => (
            <div key={g.name}>
              <div className="tk-nav-group label">{g.name}</div>
              {g.items.map((t) => {
                const i = flat.indexOf(t)
                return (
                  <button
                    key={t.id}
                    role="option"
                    aria-selected={tool?.id === t.id}
                    className={'tk-nav-item' + (tool?.id === t.id ? ' on' : '') + (q.trim() && i === hl ? ' hl' : '')}
                    onClick={() => open(t.id)}
                    title={t.description}
                  >
                    <t.icon size={14} />
                    <span className="ellipsis">{t.title}</span>
                  </button>
                )
              })}
            </div>
          ))}
          {!flat.length && <div className="empty" style={{ padding: 20 }}>No tools match “{q}”.</div>}
        </div>
        <div className="tk-nav-foot">
          <Lock size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
          Everything runs locally. Only the HTTP tester sends data — to the URL you enter.
        </div>
      </aside>

      <main className="tk-main">
        {tool && Tool ? (
          <>
            <div className="tk-head">
              <div className="tk-head-icon">
                <tool.icon size={16} />
              </div>
              <div className="grow">
                <h1>{tool.title}</h1>
                <p>{tool.description}</p>
              </div>
              {tool.network ? (
                <span className="badge warn" data-tip="Sends a request only when you press Send">
                  <Globe size={10} /> Network
                </span>
              ) : (
                <span className="badge ok" data-tip="Processed entirely on this device">
                  <Lock size={10} /> Local
                </span>
              )}
            </div>
            <ErrorBoundary name={tool.title} key={tool.id}>
              <Suspense fallback={<div className="empty">Loading {tool.short}…</div>}>
                <Tool tabId={tabId} query={query} />
              </Suspense>
            </ErrorBoundary>
          </>
        ) : (
          <Home onOpen={open} unknown={toolId && !tool ? toolId : undefined} />
        )}
      </main>
    </div>
  )
}

function Home({ onOpen, unknown }: { onOpen: (id: string) => void; unknown?: string }) {
  return (
    <div className="tk-home">
      <div className="page-kicker">Developer toolkit</div>
      <h1 className="page-title" style={{ fontSize: 22 }}>
        Small, fast, local tools
      </h1>
      <p className="page-sub" style={{ marginBottom: 20 }}>
        {unknown ? `There is no tool called “${unknown}”. ` : ''}Pick a tool — deep-link any of them with <span className="mono">specter://toolkit/&lt;tool&gt;</span>. Productivity tools (calculator, timers, todo…) live in the Tools side panel.
      </p>
      {GROUPS.map((g) => (
        <div key={g} className="section" style={{ marginTop: 18 }}>
          <div className="label" style={{ marginBottom: 8 }}>
            {g}
          </div>
          <div className="tk-home-grid">
            {TOOLS.filter((t) => t.group === g).map((t) => (
              <button key={t.id} className="tk-card" onClick={() => onOpen(t.id)}>
                <div className="tk-head-icon">
                  <t.icon size={15} />
                </div>
                <div className="grow">
                  <div className="tk-card-t">{t.title}</div>
                  <div className="tk-card-d">{t.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
