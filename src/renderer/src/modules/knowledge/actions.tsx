// Command implementations shared by the palette, context menus, capture
// dialogs and the module's own UI.
import { CirclePlus, FlaskConical } from 'lucide-react'
import type { MissionSummary } from '@shared/modules/knowledge'
import { isInternal } from '@shared/url'
import { invoke } from '../../lib/ipc'
import { wcIdFor } from '../../lib/webviews'
import { activeTab, findTab } from '../../stores/browser'
import { getSetting } from '../../stores/settings'
import { openMenu, openSidePanel, toast, useUi } from '../../stores/ui'
import { promptText } from '../../components/prompt'
import { currentWorkspaceId, hostOf, openInternal } from './lib'

function quoteBlock(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((l) => '> ' + l)
    .join('\n')
}

function titleFor(url: string | undefined, title: string | undefined): string {
  if (title) return title
  const t = activeTab()
  if (t && url && t.url === url) return t.title
  return url ? hostOf(url) : ''
}

export function openNote(id: string): void {
  openInternal('specter://notes/' + id)
}

export async function newNote(init: { title?: string; body?: string; missionId?: string | null; open?: boolean } = {}): Promise<string> {
  const n = await invoke('notes:create', { title: init.title ?? '', body: init.body ?? '', workspaceId: currentWorkspaceId(), missionId: init.missionId ?? null })
  if (init.open !== false) openNote(n.id)
  return n.id
}

/** notes.saveSelection { text, url?, title? } */
export async function saveSelectionNote(args: { text?: string; url?: string; title?: string } = {}): Promise<void> {
  const text = (args.text ?? '').trim()
  if (!text) {
    toast({ kind: 'warn', title: 'Nothing selected', body: 'Select some text on the page first.' })
    return
  }
  const pageTitle = titleFor(args.url, args.title)
  const body = quoteBlock(text) + (args.url ? `\n\n— Source: [${pageTitle || hostOf(args.url)}](${args.url})` : '') + '\n'
  const n = await invoke('notes:create', {
    title: pageTitle ? `Clip · ${pageTitle}`.slice(0, 200) : text.split('\n')[0].slice(0, 80),
    body,
    tags: ['clip'],
    sourceUrl: args.url ?? null,
    workspaceId: currentWorkspaceId()
  })
  toast({ kind: 'ok', title: 'Saved to notes', body: n.title, action: { label: 'Open', run: () => openNote(n.id) } })
}

/** notes.savePage { url, title, text? } */
export async function savePageNote(args: { url?: string; title?: string; text?: string } = {}): Promise<void> {
  const tab = activeTab()
  const url = args.url ?? (tab && !isInternal(tab.url) ? tab.url : '')
  const text = (args.text ?? '').trim()
  if (!url && !text) {
    toast({ kind: 'warn', title: 'Open a web page to save it as a note' })
    return
  }
  // Text without a page (e.g. an AI answer given without page context) is saved as-is.
  const title = titleFor(url || undefined, args.title) || url || 'Untitled'
  const body = url ? `[${title}](${url})\n\n${text ? quoteBlock(text) + '\n\n' : ''}` : text + '\n'
  const n = await invoke('notes:create', { title, body, tags: url ? ['page'] : [], sourceUrl: url || null, workspaceId: currentWorkspaceId() })
  toast({ kind: 'ok', title: url ? 'Page saved to notes' : 'Saved to notes', body: title, action: { label: 'Open', run: () => openNote(n.id) } })
}

/** Menu to choose a mission; resolves null if dismissed. */
function pickMission(missions: MissionSummary[], current: string | null): Promise<MissionSummary | 'new' | null> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: MissionSummary | 'new' | null) => {
      if (done) return
      done = true
      unsub()
      resolve(v)
    }
    const sorted = [...missions].sort((a, b) => (a.id === current ? -1 : b.id === current ? 1 : b.updatedAt - a.updatedAt))
    openMenu({
      x: Math.round(window.innerWidth / 2 - 160),
      y: 96,
      width: 320,
      items: [
        { header: 'Save source to research mission' },
        ...sorted.slice(0, 12).map((m) => ({
          label: m.title,
          icon: <FlaskConical size={14} />,
          checked: m.id === current,
          run: () => finish(m)
        })),
        { separator: true },
        { label: 'New mission…', icon: <CirclePlus size={14} />, run: () => finish('new') }
      ]
    })
    // Resolve null when the menu closes without a choice.
    const unsub = useUi.subscribe((s) => {
      if (!s.menu) setTimeout(() => finish(null), 0)
    })
  })
}

export async function createMissionInteractive(open = true): Promise<MissionSummary | null> {
  const title = await promptText({ title: 'New research mission', label: 'Topic', placeholder: 'e.g. Solid-state batteries in 2026', confirmLabel: 'Create' })
  if (!title || !title.trim()) return null
  const m = await invoke('research:create', { title: title.trim(), workspaceId: currentWorkspaceId() })
  if (open) openInternal('specter://research/' + m.id)
  return m
}

/** research.saveSource { url?, title?, quote?, missionId? } */
export async function saveResearchSource(args: { url?: string; title?: string; quote?: string; missionId?: string } = {}): Promise<void> {
  const tab = activeTab()
  const url = args.url ?? (tab && !isInternal(tab.url) ? tab.url : '')
  if (!url || isInternal(url)) {
    toast({ kind: 'warn', title: 'Open a web page to save it as a source' })
    return
  }
  // Choose the mission.
  let mission: MissionSummary | null = null
  const missions = await invoke('research:missions')
  if (args.missionId) mission = missions.find((m) => m.id === args.missionId) ?? null
  if (!mission) {
    if (!missions.length) mission = await createMissionInteractive(false)
    else if (missions.length === 1) mission = missions[0]
    else {
      const pick = await pickMission(missions, await invoke('research:current'))
      if (pick === 'new') mission = await createMissionInteractive(false)
      else mission = pick
    }
  }
  if (!mission) return

  // Capture readable text when saving the page that is open in the active tab.
  let extracted = null
  if (tab && tab.url === url) {
    const wcId = wcIdFor(tab.id)
    if (wcId !== null) extracted = await invoke('knowledge:extract', wcId).catch(() => null)
  }
  const title = args.title || extracted?.title || titleFor(url, undefined) || url
  const { id: sourceId } = await invoke('research:upsert', {
    kind: 'source',
    missionId: mission.id,
    url,
    title,
    siteName: extracted?.siteName || hostOf(url),
    author: extracted?.author || undefined,
    excerpt: extracted?.excerpt || undefined,
    text: extracted?.text || undefined
  })
  const quote = (args.quote ?? '').trim()
  if (quote) await invoke('research:upsert', { kind: 'evidence', missionId: mission.id, sourceId, quote })
  await invoke('research:setCurrent', mission.id)
  const words = extracted?.text ? extracted.text.split(/\s+/).length : 0
  const m = mission
  toast({
    kind: 'ok',
    title: `Saved to “${m.title}”`,
    body: quote ? 'Source and evidence quote saved' : words ? `Source saved · ${words.toLocaleString()} words captured locally` : 'Link saved (open the page and save again to capture its text)',
    action: { label: 'Open', run: () => openResearchPanel(m.id) }
  })
}

export function openResearchPanel(missionId?: string): void {
  if (missionId) invoke('research:setCurrent', missionId).catch(() => undefined)
  try {
    openSidePanel('research')
  } catch {
    openInternal('specter://research' + (missionId ? '/' + missionId : ''))
  }
}

/** knowledge.savePage { tabId? } */
export async function saveToKnowledge(args: { tabId?: string } = {}): Promise<void> {
  const tab = args.tabId ? findTab(args.tabId)?.tab : activeTab()
  if (!tab || isInternal(tab.url)) {
    toast({ kind: 'warn', title: 'Open a web page to save it to the knowledge base' })
    return
  }
  const wcId = wcIdFor(tab.id)
  if (wcId === null) {
    toast({ kind: 'warn', title: 'Tab is not loaded', body: 'Activate the tab (it may be suspended) and try again.' })
    return
  }
  const doc = await invoke('knowledge:savePage', wcId, currentWorkspaceId())
  const semantic = getSetting('knowledge.semanticSearch')
  toast({
    kind: 'ok',
    title: 'Saved to knowledge base',
    body: `${doc.title} · ${doc.chunks} chunks indexed locally${semantic ? ' · embeddings queued' : ''}`,
    action: { label: 'Open', run: () => openInternal('specter://knowledge?doc=' + doc.id) }
  })
}
