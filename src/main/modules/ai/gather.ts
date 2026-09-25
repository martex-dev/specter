// Context gathering. Reads ONLY the items the renderer explicitly selected.
import type { AiContextRequest } from '@shared/modules/ai'
import { focusedGuestId, pageSelection, pageText, readableArticle } from '../../services/page'
import { AiError } from './providers/types'
import type { RawContextItem } from './context'

const READ_TIMEOUT_MS = 6000
const MAX_TABS = 8
/** Hard cap before budgeting, so a giant page can't blow up memory/IPC. */
const MAX_RAW_CHARS = 400_000

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))])
}

async function readTab(wcId: number): Promise<{ url: string; title: string; text: string } | null> {
  try {
    const [art, plain] = await Promise.all([withTimeout(readableArticle(wcId), READ_TIMEOUT_MS, null), withTimeout(pageText(wcId), READ_TIMEOUT_MS, null)])
    if (!plain && !art) return null
    const articleText = art?.textContent?.trim() ?? ''
    // Prefer the Readability article when it captured a substantial part of the page.
    const useArticle = articleText.length >= 600 && articleText.length >= (plain?.text.length ?? 0) * 0.25
    return {
      url: plain?.url ?? art?.url ?? '',
      title: plain?.title || art?.title || '',
      text: (useArticle ? articleText : (plain?.text ?? articleText)).slice(0, MAX_RAW_CHARS)
    }
  } catch {
    return null
  }
}

function hasAny(ctx: AiContextRequest): boolean {
  return !!(ctx.page || ctx.selection || ctx.tabs?.length || ctx.workspace || ctx.notes?.text?.trim())
}

export interface GatherResult {
  items: RawContextItem[]
  errors: string[]
}

export async function gatherContext(ctx: AiContextRequest, canRead: boolean): Promise<GatherResult> {
  if (!hasAny(ctx)) return { items: [], errors: [] }
  if (!canRead) throw new AiError('The AI “Read” permission is off. Enable it in Settings → AI to attach pages, selections or notes.', 'error')
  const items: RawContextItem[] = []
  const errors: string[] = []

  if (ctx.selection) {
    let text = ctx.selection.text ?? ''
    if (!text && ctx.selection.wcId != null) text = await withTimeout(pageSelection(ctx.selection.wcId), READ_TIMEOUT_MS, '')
    if (text.trim()) items.push({ kind: 'selection', label: ctx.selection.title || 'Selection', url: ctx.selection.url, text: text.slice(0, MAX_RAW_CHARS) })
    else errors.push('No text is selected')
  }

  if (ctx.page) {
    const wcId = ctx.page.wcId ?? focusedGuestId()
    const got = wcId != null ? await readTab(wcId) : null
    if (got && got.text.trim()) items.push({ kind: 'page', label: got.title || got.url || 'Untitled page', url: got.url, text: got.text })
    else errors.push(wcId == null ? 'No web page is open in the current tab' : 'Could not read the current page')
  }

  for (const t of (ctx.tabs ?? []).slice(0, MAX_TABS)) {
    if (t.wcId == null) {
      items.push({ kind: 'tab', label: t.title || t.url, url: t.url, text: '', note: 'tab is sleeping or internal — only its title and address are included' })
      continue
    }
    const got = await readTab(t.wcId)
    if (got && got.text.trim()) items.push({ kind: 'tab', label: got.title || t.title || got.url, url: got.url || t.url, text: got.text })
    else items.push({ kind: 'tab', label: t.title || t.url, url: t.url, text: '', note: 'page content could not be read' })
  }
  if ((ctx.tabs?.length ?? 0) > MAX_TABS) errors.push(`Only the first ${MAX_TABS} tabs were included`)

  if (ctx.workspace) {
    const lines = ctx.workspace.tabs.slice(0, 60).map((t) => `- ${t.title || '(untitled)'} — ${t.url}`)
    items.push({ kind: 'workspace', label: ctx.workspace.name, text: `Workspace “${ctx.workspace.name}” has ${ctx.workspace.tabs.length} open tabs:\n${lines.join('\n')}` })
  }

  if (ctx.notes?.text?.trim()) items.push({ kind: 'notes', label: ctx.notes.label || 'Pasted notes', text: ctx.notes.text.slice(0, MAX_RAW_CHARS) })

  return { items, errors }
}
