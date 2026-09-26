import { useEffect, useMemo, useRef, useState } from 'react'
import { Command as CommandIcon, Globe, Search, Layers } from 'lucide-react'
import { fuzzyBest, fuzzyMatch } from '@shared/fuzzy'
import { listCommands, runCommand, shortcutFor, type Command } from '../lib/commands'
import { workspaceIcon } from '../lib/icons'
import { activateTab, switchWorkspace, useBrowser } from '../stores/browser'
import { closeOverlay, useUi } from '../stores/ui'
import { Favicon, Kbd } from '../components/ui'
import { openInput } from '../chrome/openInput'
import { end } from '../lib/perf'

interface Item {
  id: string
  group: string
  title: string
  sub?: string
  icon: JSX.Element
  shortcut?: string
  score: number
  run: () => void
  positions?: number[]
}

const RECENT_KEY = 'specter.palette.recent'

function recentCommands(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}

function pushRecent(id: string): void {
  const list = [id, ...recentCommands().filter((x) => x !== id)].slice(0, 8)
  localStorage.setItem(RECENT_KEY, JSON.stringify(list))
}

function Highlight({ text, positions }: { text: string; positions?: number[] }) {
  if (!positions?.length) return <>{text}</>
  const set = new Set(positions)
  // Positions are UTF-16 offsets; iterate by code point (so emoji stay whole) but
  // track the offset, or every match after an emoji is highlighted one char late.
  let at = 0
  return (
    <>
      {[...text].map((ch, i) => {
        const hit = set.has(at)
        at += ch.length
        return hit ? <mark key={i}>{ch}</mark> : <span key={i}>{ch}</span>
      })}
    </>
  )
}

export function CommandPalette() {
  const initial = useUi((s) => s.paletteQuery)
  const [q, setQ] = useState(initial)
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    end('palette', 'paletteOpen')
  }, [])

  const items = useMemo<Item[]>(() => {
    const onlyCommands = q.startsWith('>')
    const query = (onlyCommands ? q.slice(1) : q).trim()
    const out: Item[] = []
    const cmdItem = (c: Command, score: number): Item => {
      const Icon = c.icon ?? CommandIcon
      return {
        id: 'c:' + c.id,
        group: query ? 'Commands' : 'Recent & suggested',
        title: c.title,
        sub: c.description ?? c.category,
        icon: <Icon size={15} />,
        shortcut: shortcutFor(c.id),
        score,
        positions: query ? fuzzyMatch(query, c.title)?.positions : undefined,
        run: () => {
          pushRecent(c.id)
          runCommand(c.id)
        }
      }
    }
    const cmds = listCommands()
    if (!query) {
      const recent = recentCommands()
        .map((id) => cmds.find((c) => c.id === id))
        .filter((c): c is Command => !!c)
      const suggested = ['workspace.switcher', 'tabs.search', 'browser.newTab', 'research.newMission', 'ui.focusMode', 'ai.toggle', 'browser.history', 'browser.downloads', 'page.screenshot', 'system.openMonitor', 'developer.toolkit', 'market.open']
        .map((id) => cmds.find((c) => c.id === id))
        .filter((c): c is Command => !!c && !recent.includes(c))
      ;[...recent, ...suggested].slice(0, 14).forEach((c, i) => out.push(cmdItem(c, 100 - i)))
      return out
    }
    for (const c of cmds) {
      const s = fuzzyBest(query, [c.title, c.category + ' ' + c.title, ...(c.keywords ?? []), c.description])
      if (s !== null) out.push(cmdItem(c, s))
    }
    if (!onlyCommands) {
      const st = useBrowser.getState()
      for (const ws of Object.values(st.open)) {
        for (const t of ws.tabs) {
          const s = fuzzyBest(query, [t.title, t.url])
          if (s !== null)
            out.push({
              id: 't:' + t.id,
              group: 'Open tabs',
              title: t.title,
              sub: t.url.replace(/^https?:\/\//, ''),
              icon: <Favicon src={t.favicon} url={t.url} />,
              score: s - 10,
              positions: fuzzyMatch(query, t.title)?.positions,
              run: () => activateTab(t.id)
            })
        }
      }
      for (const w of st.workspaces) {
        const s = fuzzyBest(query, [w.name, 'workspace ' + w.name])
        if (s !== null) {
          const Icon = workspaceIcon(w.icon)
          out.push({ id: 'w:' + w.id, group: 'Workspaces', title: w.name, sub: `${w.state.tabs.length} tabs`, icon: <Icon size={15} color={w.color} />, score: s - 5, positions: fuzzyMatch(query, w.name)?.positions, run: () => switchWorkspace(w.id) })
        }
      }
      out.push({ id: 'web', group: 'Web', title: `Search the web for “${query}”`, icon: <Search size={15} />, score: -1000, run: () => openInput(query, true) })
      if (/\.\w{2,}/.test(query) && !/\s/.test(query)) out.push({ id: 'url', group: 'Web', title: `Open ${query}`, icon: <Globe size={15} />, score: 50, run: () => openInput(query, true) })
    }
    // Group ordering: best score per group decides group order.
    out.sort((a, b) => b.score - a.score)
    const groupOrder: string[] = []
    for (const it of out) if (!groupOrder.includes(it.group)) groupOrder.push(it.group)
    return groupOrder.flatMap((g) => out.filter((i) => i.group === g).slice(0, g === 'Commands' ? 30 : 8))
  }, [q])

  useEffect(() => setSel(0), [q])
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.sel')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const exec = (it: Item | undefined) => {
    if (!it) return
    closeOverlay()
    setTimeout(() => it.run(), 0)
  }

  let lastGroup = ''
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closeOverlay()}>
      {/* Keys are handled on the search field; clicking a header, the footer or the
          list's scrollbar must not strand focus outside it (Escape would stop working). */}
      <div className="palette pop" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.target !== inputRef.current && requestAnimationFrame(() => inputRef.current?.focus())}>
        <div className="palette-input-row">
          {q.startsWith('>') ? <CommandIcon size={18} /> : <Search size={18} />}
          <input
            ref={inputRef}
            className="palette-input"
            value={q}
            placeholder="Search or run a command…   ( > commands only )"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((s) => Math.min(items.length - 1, s + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((s) => Math.max(0, s - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                exec(items[sel])
              } else if (e.key === 'Escape') closeOverlay()
            }}
            aria-label="Command search"
          />
          <Kbd keys="Escape" />
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {items.length === 0 && <div className="empty">No matching commands</div>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup
            lastGroup = it.group
            return (
              <div key={it.id}>
                {header && <div className="palette-group label">{it.group}</div>}
                <div className={'palette-item' + (i === sel ? ' sel' : '')} role="option" aria-selected={i === sel} onMouseMove={() => setSel(i)} onClick={() => exec(it)}>
                  <span className="pi-icon">{it.icon}</span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis">
                      <Highlight text={it.title} positions={it.positions} />
                    </div>
                    {it.sub && <div className="pi-sub ellipsis">{it.sub}</div>}
                  </div>
                  {it.shortcut && <Kbd keys={it.shortcut} />}
                </div>
              </div>
            )
          })}
        </div>
        <div className="palette-foot">
          <span>
            <Kbd keys="Up" /> <Kbd keys="Down" /> navigate
          </span>
          <span>
            <Kbd keys="Enter" /> run
          </span>
          <span className="spacer" />
          <span className="row" style={{ gap: 6 }}>
            <Layers size={12} /> {listCommands().length} commands
          </span>
        </div>
      </div>
    </div>
  )
}
