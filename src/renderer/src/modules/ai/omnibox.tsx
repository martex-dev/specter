// Omnibox: "@ai question" / "? question" → Ask SPECTER AI; low-score "Ask AI"
// suggestion for question-like input in the default scope.
import { Globe, Sparkles } from 'lucide-react'
import { registerOmniboxProvider, type OmniItem } from '../../lib/omnibox'
import { getSetting } from '../../stores/settings'
import { toast } from '../../stores/ui'
import { askPage, currentPageInfo, openPanel, send, useAi } from './store'

const NO_CONTEXT = { page: false, selection: false, tabs: [], workspace: false, notes: false }

function askPlain(q: string): void {
  openPanel()
  if (useAi.getState().activeRequestId || useAi.getState().sending) {
    useAi.setState({ draft: q, view: 'chat' })
    toast({ kind: 'info', title: 'AI is still answering', body: 'Your question is in the composer — send it when the current answer finishes.' })
    return
  }
  useAi.setState({ ctx: NO_CONTEXT, selection: null, view: 'chat' })
  void send(q, { ctx: NO_CONTEXT })
}

function short(q: string): string {
  return q.length > 70 ? q.slice(0, 69) + '…' : q
}

export function registerAiOmnibox(): void {
  registerOmniboxProvider({
    id: 'ai',
    scopes: ['ai', 'default'],
    provide(text, scope) {
      if (!getSetting('ai.enabled')) return []
      const q = text.trim()
      if (scope === 'ai') {
        if (!q) return [{ id: 'ai:open', kind: 'ai', title: 'Open SPECTER AI', subtitle: 'Type a question after @ai', icon: <Sparkles size={15} />, score: 300, run: () => openPanel() }]
        const items: OmniItem[] = [{ id: 'ai:ask', kind: 'ai', title: `Ask SPECTER AI: ${short(q)}`, subtitle: 'No page context', icon: <Sparkles size={15} />, score: 300, run: () => askPlain(q) }]
        const page = currentPageInfo()
        if (page.readable && page.wcId !== null)
          items.push({ id: 'ai:askPage', kind: 'ai', title: `Ask about this page: ${short(q)}`, subtitle: page.title || page.url, icon: <Globe size={15} />, score: 290, run: () => void askPage(q) })
        return items
      }
      if (q.length > 12 && q.endsWith('?') && !/^\w+:\/\//.test(q)) {
        return [{ id: 'ai:ask', kind: 'ai', title: `Ask AI: ${short(q)}`, subtitle: 'SPECTER AI · local', icon: <Sparkles size={15} />, score: 5, run: () => askPlain(q) }]
      }
      return []
    }
  })
}
