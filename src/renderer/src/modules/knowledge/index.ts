// Notes, research & knowledge — renderer module entry.
// Registers commands, internal pages, side panels, the Quick Note overlay and
// omnibox providers. Heavy UI is lazy-loaded so it costs nothing until used.
import { lazy } from 'react'
import { BookOpen, FilePlus2, FlaskConical, Globe, Library, NotebookPen, PanelRight, Quote, Search, StickyNote } from 'lucide-react'
import { registerCommands } from '../../lib/commands'
import { lazyPage, registerPage } from '../../pages/registry'
import { sidePanels } from '../../lib/registry'
import { openOverlay, toggleSidePanel } from '../../stores/ui'
import { registerOverlay } from '../overlays'
import { QuickNote } from './QuickNote'
import { registerKnowledgeOmnibox } from './omnibox'
import { createMissionInteractive, newNote, savePageNote, saveResearchSource, saveSelectionNote, saveToKnowledge } from './actions'
import { openInternal } from './lib'
import './knowledge.css'

export function register(): void {
  registerOverlay('quickNote', QuickNote)

  registerPage({ id: 'notes', title: 'Notes', icon: NotebookPen, component: lazyPage(() => import('./NotesPage')), listed: true, category: 'Knowledge' })
  registerPage({ id: 'research', title: 'Research', icon: FlaskConical, component: lazyPage(() => import('./ResearchPage')), listed: true, category: 'Knowledge' })
  registerPage({ id: 'knowledge', title: 'Knowledge', icon: Library, component: lazyPage(() => import('./KnowledgePage')), listed: true, category: 'Knowledge' })

  sidePanels.register({ id: 'notes', title: 'Notes', icon: NotebookPen, order: 20, component: lazy(() => import('./NotesPanel')), popout: true, shortcutCommand: 'notes.panel' })
  sidePanels.register({ id: 'research', title: 'Research', icon: FlaskConical, order: 30, component: lazy(() => import('./ResearchPanel')), popout: true, shortcutCommand: 'research.panel' })

  registerCommands([
    { id: 'notes.quick', title: 'Quick note', category: 'Knowledge', icon: StickyNote, keywords: ['capture', 'jot', 'memo'], description: 'Capture a note into the current workspace', run: () => openOverlay('quickNote') },
    { id: 'notes.open', title: 'Open notes', category: 'Knowledge', icon: NotebookPen, keywords: ['markdown', 'notebook'], run: () => openInternal('specter://notes') },
    { id: 'notes.new', title: 'New note', category: 'Knowledge', icon: FilePlus2, keywords: ['create', 'markdown'], run: () => newNote() },
    { id: 'notes.panel', title: 'Toggle notes panel', category: 'Knowledge', icon: PanelRight, run: () => toggleSidePanel('notes') },
    { id: 'notes.saveSelection', title: 'Save selection to notes', category: 'Knowledge', icon: Quote, hidden: true, run: (a) => saveSelectionNote(a ?? {}) },
    { id: 'notes.savePage', title: 'Save page as note', category: 'Knowledge', icon: NotebookPen, keywords: ['clip'], run: (a) => savePageNote(a ?? {}) },
    { id: 'research.open', title: 'Open research', category: 'Research', icon: FlaskConical, keywords: ['missions', 'sources', 'citations'], run: () => openInternal('specter://research') },
    { id: 'research.newMission', title: 'New research mission', category: 'Research', icon: FlaskConical, keywords: ['research mode', 'project', 'topic'], run: () => createMissionInteractive(true) },
    { id: 'research.panel', title: 'Toggle research panel', category: 'Research', icon: PanelRight, run: () => toggleSidePanel('research') },
    { id: 'research.saveSource', title: 'Save page as research source', category: 'Research', icon: Globe, keywords: ['cite', 'evidence', 'source'], run: (a) => saveResearchSource(a ?? {}) },
    { id: 'knowledge.open', title: 'Open knowledge base', category: 'Knowledge', icon: Library, keywords: ['kb', 'library', 'semantic'], run: () => openInternal('specter://knowledge') },
    { id: 'knowledge.savePage', title: 'Save page to knowledge base', category: 'Knowledge', icon: BookOpen, keywords: ['index', 'archive', 'readable'], run: (a) => saveToKnowledge(a ?? {}) },
    {
      id: 'knowledge.search',
      title: 'Search knowledge base',
      category: 'Knowledge',
      icon: Search,
      keywords: ['find', 'semantic', 'notes'],
      run: (a?: { query?: string }) => openInternal('specter://knowledge' + (a?.query ? '?q=' + encodeURIComponent(a.query) : '?tab=search'))
    }
  ])

  registerKnowledgeOmnibox()
}
