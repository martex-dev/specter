// Right-click menu inside a sidebar app's page. The page context menu only
// handles tab guests, so without this a right-click in a panel did nothing
// (no copy / paste / open link).
import { ArrowLeft, ArrowUpRight, ClipboardPaste, Code2, Copy, Link2, Plus, Redo2, RotateCw, Scissors, TextSelect, Undo2 } from 'lucide-react'
import type { ContextMenuParams } from '@shared/types'
import { invoke } from '../../lib/ipc'
import { newTab } from '../../stores/browser'
import { openMenu, type MenuItem } from '../../stores/ui'
import { appIdForWcId, goBack, openInTab, reloadApp, viewOf } from './store'

export function showAppContextMenu(p: ContextMenuParams): void {
  const id = appIdForWcId(p.webContentsId)
  const wv = id ? viewOf(id) : null
  if (!id || !wv) return
  const rect = wv.getBoundingClientRect()
  const items: MenuItem[] = []
  const sep = () => items.length && !items[items.length - 1].separator && items.push({ separator: true })
  const sel = p.selectionText.trim()
  const web = (u: string) => /^https?:/i.test(u)

  if (p.isEditable && p.misspelledWord) {
    for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, run: () => wv.replaceMisspelling(s) })
    sep()
  }
  if (p.linkURL && web(p.linkURL)) {
    items.push(
      { label: 'Open link in new tab', icon: <Plus size={14} />, run: () => newTab(p.linkURL) },
      { label: 'Copy link address', icon: <Link2 size={14} />, run: () => void invoke('app:clipboardWrite', p.linkURL).catch(() => undefined) }
    )
    sep()
  }
  if (p.mediaType === 'image' && web(p.srcURL)) {
    items.push(
      { label: 'Open image in new tab', icon: <Plus size={14} />, run: () => newTab(p.srcURL) },
      { label: 'Copy image address', icon: <Link2 size={14} />, run: () => void invoke('app:clipboardWrite', p.srcURL).catch(() => undefined) }
    )
    sep()
  }
  if (p.isEditable) {
    items.push(
      { label: 'Undo', icon: <Undo2 size={14} />, shortcut: 'Ctrl+Z', disabled: !p.editFlags.canUndo, run: () => wv.undo() },
      { label: 'Redo', icon: <Redo2 size={14} />, shortcut: 'Ctrl+Y', disabled: !p.editFlags.canRedo, run: () => wv.redo() },
      { separator: true },
      { label: 'Cut', icon: <Scissors size={14} />, shortcut: 'Ctrl+X', disabled: !p.editFlags.canCut, run: () => wv.cut() },
      { label: 'Copy', icon: <Copy size={14} />, shortcut: 'Ctrl+C', disabled: !p.editFlags.canCopy, run: () => wv.copy() },
      { label: 'Paste', icon: <ClipboardPaste size={14} />, shortcut: 'Ctrl+V', disabled: !p.editFlags.canPaste, run: () => wv.paste() },
      { label: 'Select all', icon: <TextSelect size={14} />, shortcut: 'Ctrl+A', run: () => wv.selectAll() }
    )
    sep()
  } else if (sel) {
    items.push({ label: 'Copy', icon: <Copy size={14} />, shortcut: 'Ctrl+C', run: () => wv.copy() })
    sep()
  }
  if (!sel && !p.linkURL && !p.isEditable && p.mediaType === 'none') {
    items.push(
      { label: 'Back', icon: <ArrowLeft size={14} />, disabled: !wv.canGoBack(), run: () => goBack(id) },
      { label: 'Reload', icon: <RotateCw size={14} />, run: () => reloadApp(id) },
      { label: 'Open page in a tab', icon: <ArrowUpRight size={14} />, run: () => openInTab(id) }
    )
    sep()
  }
  items.push({ label: 'Inspect', icon: <Code2 size={14} />, run: () => wv.inspectElement(p.x, p.y) })
  openMenu({ x: rect.left + p.x, y: rect.top + p.y, items, width: 230 })
}
