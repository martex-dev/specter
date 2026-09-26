// AI (local Ollama) — renderer module entry.
import { lazy } from 'react'
import { Bot, Brain, MessageSquarePlus, PanelRight, Sparkles, Users } from 'lucide-react'
import { registerCommands } from '../../lib/commands'
import { sidePanels, hudItems, statusItems } from '../../lib/registry'
import { getSetting } from '../../stores/settings'
import { toggleSidePanel, useUi } from '../../stores/ui'
import { askAbout, askPage, newChat, openPanel, runAgents, subscribeChunks, useAi } from './store'
import { registerAiOmnibox } from './omnibox'
import { AiHudItem, AiStatusItem } from './StatusItems'

const enabled = () => getSetting('ai.enabled')

export function register(): void {
  subscribeChunks()

  sidePanels.register({
    id: 'ai',
    title: 'SPECTER AI',
    icon: Sparkles,
    order: 10,
    popout: true,
    enabled,
    shortcutCommand: 'ai.toggle',
    component: lazy(() => import('./AiPanel'))
  })

  hudItems.register({ id: 'ai', order: 40, component: AiHudItem, enabled })
  statusItems.register({ id: 'ai', side: 'right', order: 40, component: AiStatusItem })

  registerCommands([
    {
      id: 'ai.toggle',
      title: 'Toggle AI panel',
      category: 'AI',
      icon: PanelRight,
      keywords: ['assistant', 'ollama', 'llm', 'sidebar', 'chat'],
      when: enabled,
      run: () => {
        if (useUi.getState().sidePanel === 'ai') toggleSidePanel('ai')
        else openPanel()
      }
    },
    { id: 'ai.open', title: 'Open SPECTER AI', category: 'AI', icon: Sparkles, keywords: ['assistant', 'ollama', 'chat'], when: enabled, run: () => openPanel() },
    {
      id: 'ai.ask',
      title: 'Ask AI about selection',
      category: 'AI',
      icon: Brain,
      hidden: true,
      when: enabled,
      run: (args?: { action?: string; text?: string; prompt?: string }) => askAbout(args?.action, args?.text ?? '', args?.prompt)
    },
    {
      id: 'ai.askPage',
      title: 'Ask AI about this page',
      category: 'AI',
      icon: Sparkles,
      keywords: ['summarize', 'summary', 'explain page'],
      when: enabled,
      run: (args?: { prompt?: string }) => askPage(args?.prompt)
    },
    {
      id: 'ai.newChat',
      title: 'New AI chat',
      category: 'AI',
      icon: MessageSquarePlus,
      when: enabled,
      run: () => {
        newChat()
        openPanel()
      }
    },
    {
      id: 'ai.agents',
      title: 'Run AI agents on this page',
      category: 'AI',
      icon: Users,
      description: 'Summarizer, Researcher, Source Auditor, Code Reviewer, Data Analyst',
      keywords: ['agent', 'pipeline', 'audit', 'research'],
      when: enabled,
      run: async (args?: { agents?: string[]; focus?: string }) => {
        openPanel()
        useAi.setState({ ctx: { ...useAi.getState().ctx, page: true }, view: 'agents' })
        if (args?.agents?.length) await runAgents(args.agents, args.focus)
      }
    },
    {
      id: 'ai.history',
      title: 'AI conversation history',
      category: 'AI',
      icon: Bot,
      when: enabled,
      run: () => {
        openPanel()
        useAi.setState({ view: 'history' })
      }
    }
  ])

  registerAiOmnibox()
}
