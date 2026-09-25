import { AppWindow, Bookmark, Clock, Command as CommandIcon, Globe, Layers, Search } from 'lucide-react'
import { fuzzyBest } from '@shared/fuzzy'
import { invoke } from '../lib/ipc'
import { listCommands, runCommand } from '../lib/commands'
import { registerOmniboxProvider, type OmniItem } from '../lib/omnibox'
import { workspaceIcon } from '../lib/icons'
import { activateTab, switchWorkspace, useBrowser } from '../stores/browser'
import { Favicon } from '../components/ui'
import { openInput } from './openInput'

const strip = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')

export function registerCoreOmniboxProviders(): void {
  registerOmniboxProvider({
    id: 'tabs',
    scopes: ['default', 'tabs'],
    provide(text, scope) {
      const st = useBrowser.getState()
      const out: OmniItem[] = []
      for (const ws of Object.values(st.open)) {
        for (const t of ws.tabs) {
          if (ws.id === st.activeWsId && t.id === ws.activeTabId && scope === 'default') continue
          const s = text ? fuzzyBest(text, [t.title, strip(t.url), t.note]) : 0
          if (s === null) continue
          out.push({
            id: 'tab:' + t.id,
            kind: 'tab',
            title: t.title || strip(t.url),
            subtitle: (ws.id !== st.activeWsId ? ws.name + ' · ' : '') + strip(t.url),
            icon: <Favicon src={t.favicon} url={t.url} />,
            score: (scope === 'tabs' ? 200 : 60) + s,
            run: () => activateTab(t.id)
          })
        }
      }
      return out.sort((a, b) => b.score - a.score).slice(0, scope === 'tabs' ? 30 : 3)
    }
  })

  registerOmniboxProvider({
    id: 'history-bookmarks',
    scopes: ['default', 'history', 'bookmarks'],
    async provide(text, scope) {
      if (!text.trim()) return []
      if (scope === 'history') {
        const rows = await invoke('history:search', { text, limit: 30 })
        return rows.map((r, i) => ({ id: 'h:' + r.id, kind: 'history' as const, title: r.title || strip(r.url), subtitle: strip(r.url), url: r.url, icon: <Clock size={15} />, score: 300 - i }))
      }
      const res = await invoke('search:suggest', text)
      return res
        .filter((s) => scope !== 'bookmarks' || s.kind === 'bookmark')
        .map((s) => ({
          id: s.kind + ':' + s.url,
          kind: s.kind as OmniItem['kind'],
          title: s.title,
          subtitle: strip(s.url ?? ''),
          url: s.url,
          icon: s.kind === 'bookmark' ? <Bookmark size={15} /> : <Clock size={15} />,
          score: s.score,
          completion: s.url ? strip(s.url) : undefined
        }))
    }
  })

  registerOmniboxProvider({
    id: 'commands',
    scopes: ['default', 'command'],
    provide(text, scope) {
      if (scope === 'default' && text.trim().length < 3) return []
      const out: OmniItem[] = []
      for (const c of listCommands()) {
        const s = text ? fuzzyBest(text, [c.title, c.category, ...(c.keywords ?? [])]) : 0
        if (s === null) continue
        if (scope === 'default' && s < 90) continue
        const Icon = c.icon ?? CommandIcon
        out.push({ id: 'cmd:' + c.id, kind: 'command', title: c.title, subtitle: c.category, icon: <Icon size={15} />, score: (scope === 'command' ? 200 : 30) + s, run: () => runCommand(c.id) })
      }
      return out.sort((a, b) => b.score - a.score).slice(0, scope === 'command' ? 40 : 2)
    }
  })

  registerOmniboxProvider({
    id: 'workspaces',
    scopes: ['default', 'workspace'],
    provide(text, scope) {
      if (scope === 'default' && text.trim().length < 2) return []
      const st = useBrowser.getState()
      const out: OmniItem[] = []
      for (const w of st.workspaces) {
        const s = text ? fuzzyBest(text, [w.name]) : 0
        if (s === null || (scope === 'default' && s < 100)) continue
        const Icon = workspaceIcon(w.icon)
        out.push({
          id: 'ws:' + w.id,
          kind: 'workspace',
          title: `${w.id === st.activeWsId ? 'Current workspace' : 'Switch to workspace'}: ${w.name}`,
          subtitle: `${w.state.tabs.length} tabs`,
          icon: <Icon size={15} color={w.color} />,
          score: (scope === 'workspace' ? 200 : 40) + s,
          run: () => switchWorkspace(w.id)
        })
      }
      return out.sort((a, b) => b.score - a.score)
    }
  })

  registerOmniboxProvider({
    id: 'remote',
    scopes: ['default'],
    async provide(text) {
      if (text.trim().length < 2) return []
      const list = await invoke('search:remote', text).catch(() => [] as string[])
      return list
        .filter((s) => s.toLowerCase() !== text.trim().toLowerCase())
        .slice(0, 4)
        .map((s, i) => ({ id: 'r:' + s, kind: 'remote' as const, title: s, icon: <Search size={15} />, score: 20 - i, run: ({ newTab: nt }: { newTab: boolean }) => openInput(s, nt) }))
    }
  })

  registerOmniboxProvider({
    id: 'windows',
    scopes: ['tabs'],
    async provide(text) {
      if (text) return []
      const wins = await invoke('window:list')
      if (wins.length < 2) return []
      return wins
        .filter((w) => !w.focused)
        .map((w) => ({ id: 'win:' + w.id, kind: 'other' as const, title: w.title, subtitle: 'Other window', icon: <AppWindow size={15} />, score: 1, run: () => invoke('window:focus', w.id) }))
    }
  })
}

export const KIND_LABEL: Record<OmniItem['kind'], string> = {
  url: 'Open',
  search: 'Search',
  history: 'History',
  bookmark: 'Bookmark',
  tab: 'Switch to tab',
  command: 'Command',
  workspace: 'Workspace',
  remote: 'Suggestion',
  market: 'Market',
  ai: 'AI',
  note: 'Note',
  other: ''
}

export const KIND_ICON: Partial<Record<OmniItem['kind'], JSX.Element>> = {
  url: <Globe size={15} />,
  search: <Search size={15} />,
  workspace: <Layers size={15} />
}
