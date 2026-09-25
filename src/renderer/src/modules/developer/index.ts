// Developer: projects, git, terminal — renderer module entry.
import { createElement, lazy } from 'react'
import { FileCode2, FolderGit2, FolderPlus, GitBranch, GitFork, Search, SquareTerminal } from 'lucide-react'
import '@shared/modules/developer'
import { fuzzyBest } from '@shared/fuzzy'
import { registerCommands } from '../../lib/commands'
import { registerPage, lazyPage } from '../../pages/registry'
import { sidePanels } from '../../lib/registry'
import { registerOmniboxProvider, type OmniItem } from '../../lib/omnibox'
import { invoke } from '../../lib/ipc'
import { getSetting } from '../../stores/settings'
import { openOverlay, openSidePanel, toast } from '../../stores/ui'
import { newTab } from '../../stores/browser'
import { registerOverlay } from '../overlays'
import { CloneOverlay, FileSearchOverlay, ProjectPickerOverlay } from './overlays'
import { addProjectFlow, cloneRepoFlow, ensureDevData, errMsg, loadEnv, openProjectPage, openTerminalFor, useDev } from './store'
import './developer.css'

const enabled = () => getSetting('developer.enabled') !== false

export function register(): void {
  registerPage({ id: 'projects', title: 'Projects', icon: FolderGit2, component: lazyPage(() => import('./ProjectsPage')), listed: true, category: 'Developer' })
  registerPage({ id: 'terminal', title: 'Terminal', icon: SquareTerminal, component: lazyPage(() => import('./TerminalPage')), listed: true, category: 'Developer' })

  sidePanels.register({ id: 'terminal', title: 'Terminal', icon: SquareTerminal, order: 60, popout: true, enabled, shortcutCommand: 'developer.terminal', component: lazy(() => import('./TerminalView')) })
  sidePanels.register({ id: 'git', title: 'Git', icon: GitBranch, order: 70, popout: true, enabled, shortcutCommand: 'developer.git', component: lazy(() => import('./GitPanel')) })

  registerOverlay('developer.clone', CloneOverlay)
  registerOverlay('developer.projects', ProjectPickerOverlay)
  registerOverlay('developer.files', FileSearchOverlay)

  registerCommands([
    {
      id: 'developer.open',
      title: 'Open developer workspace (projects)',
      category: 'Developer',
      icon: FolderGit2,
      keywords: ['projects', 'code', 'workspace', 'repo'],
      when: enabled,
      run: () => openProjectPage()
    },
    {
      id: 'developer.openProject',
      title: 'Open project…',
      category: 'Developer',
      icon: FolderGit2,
      keywords: ['project', 'switch', 'repo'],
      when: enabled,
      run: (args?: { projectId?: string }) => {
        if (args?.projectId) return openProjectPage(args.projectId)
        ensureDevData()
        openOverlay('developer.projects')
      }
    },
    {
      id: 'developer.terminal',
      title: 'Terminal',
      description: 'Open the integrated (line-based) terminal',
      category: 'Developer',
      icon: SquareTerminal,
      keywords: ['shell', 'powershell', 'cmd', 'console', 'wsl', 'bash'],
      when: enabled,
      permissions: ['execute'],
      // Opens the panel only; commands run when the user types them and presses Enter.
      run: (args?: { projectId?: string; page?: boolean }) => {
        if (args?.projectId) return openTerminalFor(args.projectId, { page: args.page })
        if (args?.page) return newTab('specter://terminal')
        openSidePanel('terminal')
      }
    },
    {
      id: 'developer.git',
      title: 'Git panel',
      category: 'Developer',
      icon: GitBranch,
      keywords: ['git', 'commit', 'diff', 'status', 'branch'],
      when: enabled,
      run: () => openSidePanel('git')
    },
    {
      id: 'developer.cloneRepo',
      title: 'Clone Git repository…',
      category: 'Developer',
      icon: GitFork,
      keywords: ['git', 'clone', 'github'],
      when: enabled,
      permissions: ['network', 'filesystem'],
      run: (args?: { url?: string }) => cloneRepoFlow(args?.url)
    },
    {
      id: 'developer.addProject',
      title: 'Add project folder…',
      category: 'Developer',
      icon: FolderPlus,
      keywords: ['project', 'folder', 'index'],
      when: enabled,
      permissions: ['filesystem'],
      run: () => addProjectFlow()
    },
    {
      id: 'developer.searchFiles',
      title: 'Search project files…',
      category: 'Developer',
      icon: Search,
      keywords: ['find', 'file', 'quick open', 'go to file'],
      when: enabled,
      run: () => {
        ensureDevData()
        openOverlay('developer.files')
      }
    },
    {
      id: 'developer.terminalPage',
      title: 'Open terminal in a tab',
      category: 'Developer',
      icon: SquareTerminal,
      when: enabled,
      run: () => newTab('specter://terminal')
    }
  ])

  // Omnibox: project names and indexed filenames (low priority, local only).
  registerOmniboxProvider({
    id: 'developer',
    scopes: ['default'],
    async provide(text) {
      const q = text.trim()
      if (q.length < 3 || !enabled() || /^[a-z]+:\/\//i.test(q) || q.includes(' ')) return []
      ensureDevData()
      const out: OmniItem[] = []
      for (const p of useDev.getState().projects) {
        const s = fuzzyBest(q, [p.name])
        if (s === null || s < 60) continue
        out.push({
          id: 'devp:' + p.id,
          kind: 'other',
          title: p.name,
          subtitle: `Project · ${p.path}`,
          icon: createElement(FolderGit2, { size: 15 }),
          score: 25 + s / 20,
          run: () => openProjectPage(p.id)
        })
      }
      try {
        const hasCode = !!(await loadEnv())?.code
        const hits = await invoke('projects:searchFiles', q, { limit: 3 })
        for (const h of hits) {
          out.push({
            id: 'devf:' + h.projectId + ':' + h.rel,
            kind: 'other',
            title: h.name,
            subtitle: `${h.projectName}/${h.rel} · ${hasCode ? 'Enter: open in VS Code · Shift+Enter: open file location' : 'Enter: open file location'}`,
            icon: createElement(FileCode2, { size: 15 }),
            score: 18,
            run: ({ newTab: alt }) => {
              if (alt || !hasCode) invoke('projects:reveal', h.projectId, h.rel)
              else invoke('projects:openInCode', h.projectId, h.rel, 1).catch((err) => toast({ kind: 'error', title: 'VS Code', body: errMsg(err) }))
            }
          })
        }
      } catch {
        /* index unavailable */
      }
      return out.slice(0, 4)
    }
  })
}
