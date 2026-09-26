import { BookmarkPlus, Brain, Copy, FileSearch, FlaskConical, Gauge, GitBranch, Link2, PictureInPicture2, ScrollText, Sparkles } from 'lucide-react'
import type { PageKind } from '@shared/url'
import { invoke } from '../lib/ipc'
import { getCommand, runCommand } from '../lib/commands'
import { wcIdFor } from '../lib/webviews'
import { findTab } from '../stores/browser'
import { toast, type MenuItem } from '../stores/ui'

/**
 * True when a command is registered and its `when` guard passes (e.g. the AI
 * commands exist even with AI switched off, but refuse to run then).
 */
export function commandAvailable(id: string): boolean {
  const c = getCommand(id)
  if (!c) return false
  try {
    return !c.when || c.when()
  } catch {
    return false
  }
}

/** Subtle, page-type-aware actions. Only returns actions whose commands can run. */
export function contextualActions(kind: PageKind, tabId: string): MenuItem[] {
  const tab = findTab(tabId)?.tab
  if (!tab) return []
  const items: MenuItem[] = []
  const cmd = (id: string, label: string, icon: JSX.Element, args?: unknown) => {
    if (commandAvailable(id)) items.push({ label, icon, run: () => runCommand(id, args) })
  }

  if (kind === 'github-repo') {
    const parts = new URL(tab.url).pathname.split('/').filter(Boolean)
    const repo = `${parts[0]}/${parts[1]}`
    items.push({
      label: 'Copy clone command',
      icon: <GitBranch size={14} />,
      run: () => {
        invoke('app:clipboardWrite', `git clone https://github.com/${repo}.git`)
        toast({ kind: 'ok', title: 'Clone command copied', body: `git clone https://github.com/${repo}.git` })
      }
    })
    cmd('developer.cloneRepo', 'Clone into a local project…', <GitBranch size={14} />, { url: `https://github.com/${repo}.git` })
    cmd('ai.askPage', 'Explain this repository (AI)', <Brain size={14} />, { prompt: 'Explain what this repository does, its main components, and how to get started.' })
  }
  if (kind === 'paper' || kind === 'pdf') {
    cmd('research.saveSource', 'Save as research source', <FlaskConical size={14} />)
    cmd('ai.askPage', 'Summarize paper (AI)', <Sparkles size={14} />, { prompt: 'Summarize this paper: problem, method, key results, limitations.' })
    cmd('page.extractLinks', 'Extract references & links', <Link2 size={14} />)
  }
  if (kind === 'video') {
    items.push({
      label: 'Picture-in-picture',
      icon: <PictureInPicture2 size={14} />,
      run: () => {
        const wcId = wcIdFor(tabId)
        if (wcId !== null) invoke('guest:mediaControl', wcId, 'pip')
      }
    })
    items.push({
      label: 'Playback speed',
      icon: <Gauge size={14} />,
      submenu: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3].map((r) => ({
        label: r + '×',
        run: () => {
          const wcId = wcIdFor(tabId)
          if (wcId !== null) invoke('guest:mediaControl', wcId, 'rate', r)
        }
      }))
    })
  }
  if (kind === 'finance') {
    cmd('ai.askPage', 'Extract key metrics (AI)', <FileSearch size={14} />, { prompt: 'Extract the important numbers and financial metrics on this page as a table. Only use numbers that appear on the page.' })
    cmd('research.saveSource', 'Save as research source', <FlaskConical size={14} />)
  }
  if (kind === 'docs') {
    cmd('ai.askPage', 'Summarize documentation (AI)', <Sparkles size={14} />, { prompt: 'Summarize this documentation page and list the key APIs or steps.' })
  }
  // Generic actions available on every page.
  cmd('ai.askPage', kind === 'generic' ? 'Summarize page (AI)' : 'Ask AI about this page', <Sparkles size={14} />, kind === 'generic' ? { prompt: 'Summarize this page in a few bullet points.' } : undefined)
  cmd('page.reader', 'Reader mode', <ScrollText size={14} />)
  cmd('save.toSpecter', 'Save to SPECTER…', <BookmarkPlus size={14} />)
  items.push({ label: 'Copy page link', icon: <Copy size={14} />, run: () => invoke('app:clipboardWrite', tab.url) })
  // De-duplicate identical labels.
  const seen = new Set<string>()
  return items.filter((i) => (i.label && !seen.has(i.label) ? (seen.add(i.label), true) : false))
}
