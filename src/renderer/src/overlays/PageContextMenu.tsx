import {
  AppWindow,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Brain,
  Bug,
  ClipboardPaste,
  Code2,
  Copy,
  Download,
  FileText,
  FlaskConical,
  Gauge,
  ImageIcon,
  Languages,
  Link2,
  NotebookPen,
  Plus,
  Printer,
  RotateCw,
  Scissors,
  ScrollText,
  Search,
  Sparkles,
  TestTube2,
  Camera,
  Undo2,
  Redo2,
  TextSelect,
  Layers,
  Sigma
} from 'lucide-react'
import type { ContextMenuParams } from '@shared/types'
import { SEARCH_ENGINES, searchUrl } from '@shared/settings'
import { invoke } from '../lib/ipc'
import { runCommand } from '../lib/commands'
import { commandAvailable } from '../chrome/contextual'
import { tabIdForWcId, webviewFor } from '../lib/webviews'
import { goBack, goForward, moveTabToWorkspace, newTab, reload, useBrowser } from '../stores/browser'
import { getSetting } from '../stores/settings'
import { openMenu, toast, type MenuItem } from '../stores/ui'
import { workspaceIcon } from '../lib/icons'

function looksLikeCode(s: string): boolean {
  if (s.length < 12) return false
  const signals = [/[{};]\s*$/m, /^\s{2,}\S/m, /\b(function|const|let|var|def|class|import|return|public|private|fn|impl|=>|#include)\b/, /[=!<>]==?|&&|\|\||->/, /\(\s*\)|\[\s*\]/]
  return signals.filter((r) => r.test(s)).length >= 2
}

function aiItem(action: string, label: string, icon: JSX.Element, text: string, extra?: Record<string, unknown>): MenuItem | null {
  if (!commandAvailable('ai.ask')) return null
  return { label, icon, run: () => runCommand('ai.ask', { action, text, ...extra }) }
}

export function showPageContextMenu(p: ContextMenuParams): void {
  const tabId = tabIdForWcId(p.webContentsId)
  const wv = tabId ? webviewFor(tabId) : null
  if (!wv || !tabId) return
  const rect = wv.getBoundingClientRect()
  const x = rect.left + p.x
  const y = rect.top + p.y
  const items: MenuItem[] = []
  const sel = p.selectionText.trim()
  const engine = SEARCH_ENGINES.find((e) => e.id === getSetting('search.engine'))?.name ?? 'the web'
  const push = (...xs: (MenuItem | null)[]) => xs.forEach((i) => i && items.push(i))
  const sep = () => items.length && !items[items.length - 1].separator && items.push({ separator: true })

  // Spelling suggestions.
  if (p.isEditable && p.misspelledWord) {
    for (const s of p.dictionarySuggestions.slice(0, 5)) push({ label: s, run: () => wv.replaceMisspelling(s) })
    if (!p.dictionarySuggestions.length) push({ label: 'No spelling suggestions', disabled: true })
    sep()
  }

  if (p.linkURL) {
    push(
      { label: 'Open link in new tab', icon: <Plus size={14} />, run: () => newTab(p.linkURL, { background: true, openerId: tabId }) },
      { label: 'Open link in new window', icon: <AppWindow size={14} />, run: () => invoke('window:new', { url: p.linkURL }) },
      {
        label: 'Open link in workspace',
        icon: <Layers size={14} />,
        submenu: useBrowser.getState().workspaces.map((w) => {
          const Icon = workspaceIcon(w.icon)
          return {
            label: w.name,
            icon: <Icon size={14} color={w.color} />,
            run: async () => {
              const id = newTab(p.linkURL, { background: true })
              if (w.id !== useBrowser.getState().activeWsId) await moveTabToWorkspace(id, w.id)
              toast({ kind: 'ok', title: `Opened in ${w.name}` })
            }
          }
        })
      },
      { label: 'Copy link address', icon: <Link2 size={14} />, run: () => invoke('app:clipboardWrite', p.linkURL) },
      p.linkText ? { label: 'Copy link text', icon: <Copy size={14} />, run: () => invoke('app:clipboardWrite', p.linkText) } : null,
      { label: 'Bookmark link', icon: <Bookmark size={14} />, run: () => invoke('bookmarks:add', { kind: 'bookmark', title: p.linkText || p.linkURL, url: p.linkURL }).then(() => toast({ kind: 'ok', title: 'Link bookmarked' })) },
      commandAvailable('research.saveSource') ? { label: 'Save link to research', icon: <FlaskConical size={14} />, run: () => runCommand('research.saveSource', { url: p.linkURL, title: p.linkText }) } : null
    )
    sep()
  }

  if (p.mediaType === 'image' && p.srcURL) {
    push(
      { label: 'Open image in new tab', icon: <ImageIcon size={14} />, run: () => newTab(p.srcURL, { background: true, openerId: tabId }) },
      { label: 'Save image as…', icon: <Download size={14} />, run: () => wv.downloadURL(p.srcURL) },
      { label: 'Copy image', icon: <Copy size={14} />, run: () => invoke('guest:copyImageAt', p.webContentsId, p.x, p.y) },
      { label: 'Copy image address', icon: <Link2 size={14} />, run: () => invoke('app:clipboardWrite', p.srcURL) },
      /^https?:/.test(p.srcURL) ? { label: 'Search with Google Lens', icon: <Search size={14} />, run: () => newTab('https://lens.google.com/uploadbyurl?url=' + encodeURIComponent(p.srcURL), { openerId: tabId }) } : null
    )
    sep()
  }

  if ((p.mediaType === 'video' || p.mediaType === 'audio') && p.srcURL) {
    push(
      { label: 'Picture-in-picture', icon: <AppWindow size={14} />, disabled: p.mediaType !== 'video', run: () => invoke('guest:mediaControl', p.webContentsId, 'pip') },
      {
        label: 'Playback speed',
        icon: <Gauge size={14} />,
        submenu: [0.5, 1, 1.25, 1.5, 2].map((r) => ({ label: r + '×', run: () => invoke('guest:mediaControl', p.webContentsId, 'rate', r) }))
      },
      /^https?:/.test(p.srcURL) ? { label: `Save ${p.mediaType} as…`, icon: <Download size={14} />, run: () => wv.downloadURL(p.srcURL) } : null
    )
    sep()
  }

  if (sel) {
    const short = sel.length > 32 ? sel.slice(0, 32) + '…' : sel
    push(
      { label: 'Copy', icon: <Copy size={14} />, shortcut: 'Ctrl+C', run: () => wv.copy() },
      { label: `Search ${engine} for “${short}”`, icon: <Search size={14} />, run: () => newTab(searchUrl({ 'search.engine': getSetting('search.engine'), 'search.customTemplate': getSetting('search.customTemplate') }, sel), { openerId: tabId }) }
    )
    const code = looksLikeCode(p.selectionText)
    if (commandAvailable('ai.ask')) {
      sep()
      push({ header: code ? 'SPECTER AI · code' : 'SPECTER AI' })
      if (code) {
        push(
          aiItem('explain-code', 'Explain code', <Code2 size={14} />, sel),
          aiItem('debug', 'Debug / find bugs', <Bug size={14} />, sel),
          aiItem('optimize', 'Optimize', <Gauge size={14} />, sel),
          aiItem('refactor', 'Refactor', <Sigma size={14} />, sel),
          aiItem('tests', 'Write tests', <TestTube2 size={14} />, sel),
          aiItem('document', 'Document', <FileText size={14} />, sel)
        )
      } else {
        push(
          aiItem('ask', 'Ask SPECTER AI', <Brain size={14} />, sel),
          aiItem('explain', 'Explain', <Sparkles size={14} />, sel),
          aiItem('summarize', 'Summarize', <ScrollText size={14} />, sel),
          aiItem('simplify', 'Simplify', <Sparkles size={14} />, sel),
          aiItem('translate', 'Translate', <Languages size={14} />, sel),
          aiItem('rewrite', 'Rewrite', <NotebookPen size={14} />, sel),
          aiItem('contradictions', 'Find contradictions', <Search size={14} />, sel),
          aiItem('sources', 'Find sources', <Link2 size={14} />, sel)
        )
      }
    } else {
      push({ label: 'Translate selection', icon: <Languages size={14} />, run: () => newTab(`https://translate.google.com/?sl=auto&op=translate&text=${encodeURIComponent(sel.slice(0, 4000))}`, { openerId: tabId }) })
    }
    sep()
    if (commandAvailable('notes.saveSelection')) push({ label: 'Save to notes', icon: <NotebookPen size={14} />, run: () => runCommand('notes.saveSelection', { text: sel, url: p.pageURL }) })
    if (commandAvailable('research.saveSource')) push({ label: 'Save to research', icon: <FlaskConical size={14} />, run: () => runCommand('research.saveSource', { url: p.pageURL, quote: sel }) })
    sep()
  }

  if (p.isEditable) {
    push(
      { label: 'Undo', icon: <Undo2 size={14} />, shortcut: 'Ctrl+Z', disabled: !p.editFlags.canUndo, run: () => wv.undo() },
      { label: 'Redo', icon: <Redo2 size={14} />, shortcut: 'Ctrl+Y', disabled: !p.editFlags.canRedo, run: () => wv.redo() },
      { separator: true },
      { label: 'Cut', icon: <Scissors size={14} />, shortcut: 'Ctrl+X', disabled: !p.editFlags.canCut, run: () => wv.cut() },
      !sel ? { label: 'Copy', icon: <Copy size={14} />, shortcut: 'Ctrl+C', disabled: !p.editFlags.canCopy, run: () => wv.copy() } : null,
      { label: 'Paste', icon: <ClipboardPaste size={14} />, shortcut: 'Ctrl+V', disabled: !p.editFlags.canPaste, run: () => wv.paste() },
      { label: 'Paste as plain text', icon: <ClipboardPaste size={14} />, disabled: !p.editFlags.canPaste, run: () => wv.pasteAndMatchStyle() },
      { label: 'Select all', icon: <TextSelect size={14} />, shortcut: 'Ctrl+A', run: () => wv.selectAll() }
    )
    sep()
  }

  if (!sel && !p.linkURL && !p.isEditable && p.mediaType === 'none') {
    push(
      { label: 'Back', icon: <ArrowLeft size={14} />, disabled: !wv.canGoBack(), run: () => goBack(tabId) },
      { label: 'Forward', icon: <ArrowRight size={14} />, disabled: !wv.canGoForward(), run: () => goForward(tabId) },
      { label: 'Reload', icon: <RotateCw size={14} />, run: () => reload(tabId) },
      { separator: true },
      { label: 'Save page as…', icon: <Download size={14} />, run: () => runCommand('browser.savePage') },
      { label: 'Print…', icon: <Printer size={14} />, run: () => runCommand('browser.print') },
      { label: 'Screenshot', icon: <Camera size={14} />, run: () => runCommand('page.screenshot') },
      { label: 'Reader mode', icon: <ScrollText size={14} />, run: () => runCommand('page.reader') },
      commandAvailable('ai.askPage') ? { label: 'Summarize page (AI)', icon: <Sparkles size={14} />, run: () => runCommand('ai.askPage', { prompt: 'Summarize this page in a few bullet points.' }) } : null,
      { label: 'View page source', icon: <Code2 size={14} />, run: () => newTab('view-source:' + p.pageURL, { openerId: tabId }) }
    )
    sep()
  }
  push({ label: 'Inspect', icon: <Code2 size={14} />, shortcut: 'Ctrl+Shift+I', run: () => wv.inspectElement(p.x, p.y) })
  while (items.length && items[items.length - 1].separator) items.pop()
  openMenu({ x, y, items, width: 250 })
}

