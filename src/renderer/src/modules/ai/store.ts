// AI renderer state: status, current conversation, streaming, context selection.
// Lives outside React so a stream keeps going when the panel is closed/reopened.
import { create } from 'zustand'
import type { AiChatStart, AiChunk, AiContextPreview, AiContextRequest, AiMessage, AiStatus } from '@shared/modules/ai'
import { quickAction } from '@shared/modules/ai'
import { isInternal } from '@shared/url'
import { invoke, on } from '../../lib/ipc'
import { wcIdFor } from '../../lib/webviews'
import { activeTab, activeWs, findTab, useBrowser } from '../../stores/browser'
import { getSetting } from '../../stores/settings'
import { openSidePanel, toast, useUi } from '../../stores/ui'

export interface UiMessage extends AiMessage {
  requestId?: string
  stage?: string
  stats?: AiChunk['stats']
}

export interface ContextSelection {
  page: boolean
  selection: boolean
  tabs: string[]
  workspace: boolean
  notes: boolean
}

export type AiView = 'chat' | 'history' | 'agents'

interface AiState {
  status: AiStatus | null
  statusLoading: boolean
  conversationId: string | null
  title: string
  messages: UiMessage[]
  activeRequestId: string | null
  sending: boolean
  ctx: ContextSelection
  /** Text explicitly attached as the selection (from a context menu or quick action). */
  selection: { text: string; url?: string; title?: string } | null
  notes: { text: string; label: string }
  draft: string
  model: string
  view: AiView
  error: string | null
  focusTick: number
  preview: AiContextPreview | null
  previewLoading: boolean
}

const DEFAULT_CTX: ContextSelection = { page: true, selection: true, tabs: [], workspace: false, notes: false }

export const useAi = create<AiState>(() => ({
  status: null,
  statusLoading: false,
  conversationId: null,
  title: '',
  messages: [],
  activeRequestId: null,
  sending: false,
  ctx: { ...DEFAULT_CTX },
  selection: null,
  notes: { text: '', label: 'Pasted notes' },
  draft: '',
  model: '',
  view: 'chat',
  error: null,
  focusTick: 0,
  preview: null,
  previewLoading: false
}))

const set = useAi.setState
const S = () => useAi.getState()

export const isPopoutWindow = (() => {
  try {
    return !!new URLSearchParams(location.hash.slice(1)).get('panel')
  } catch {
    return false
  }
})()

// ---------------------------------------------------------------- status polling

let statusSeq = 0
export async function refreshStatus(force = false): Promise<AiStatus | null> {
  if (!getSetting('ai.enabled')) {
    set({ status: null })
    return null
  }
  const seq = ++statusSeq
  set({ statusLoading: true })
  try {
    const st = await invoke('ai:status', { refresh: force })
    if (seq === statusSeq) set({ status: st, statusLoading: false })
    return st
  } catch (err) {
    if (seq === statusSeq) set({ statusLoading: false })
    return null
  }
}

/** Ref-counted poll interests: the effective interval is the shortest one. Paused while hidden. */
const interests = new Map<number, number>()
let interestSeq = 0
let timer: ReturnType<typeof setTimeout> | null = null
let lastPoll = 0

function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = null
  if (!interests.size) return
  const every = Math.min(...interests.values())
  const wait = Math.max(0, lastPoll + every - Date.now())
  timer = setTimeout(async () => {
    timer = null
    if (!document.hidden && getSetting('ai.enabled') && !S().activeRequestId) {
      lastPoll = Date.now()
      await refreshStatus()
    } else lastPoll = Date.now()
    schedule()
  }, wait)
}

export function addStatusInterest(everyMs: number, immediate: boolean): () => void {
  const id = ++interestSeq
  interests.set(id, everyMs)
  if (immediate && Date.now() - lastPoll > 3000) {
    lastPoll = Date.now()
    void refreshStatus()
  }
  schedule()
  return () => {
    interests.delete(id)
    schedule()
  }
}

// ---------------------------------------------------------------- streaming

const early = new Map<string, AiChunk[]>()
const pendingDelta = new Map<string, { delta: string; stage?: string }>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flushDeltas(): void {
  flushTimer = null
  if (!pendingDelta.size) return
  const updates = new Map(pendingDelta)
  pendingDelta.clear()
  set((s) => ({
    messages: s.messages.map((m) => {
      const u = m.requestId ? updates.get(m.requestId) : undefined
      return u ? { ...m, content: m.content + u.delta, stage: u.stage ?? m.stage } : m
    })
  }))
}

function applyChunk(c: AiChunk): void {
  const has = S().messages.some((m) => m.requestId === c.requestId && m.role === 'assistant')
  if (!has) {
    // The start result may not have arrived yet; keep chunks briefly.
    const list = early.get(c.requestId) ?? []
    list.push(c)
    early.set(c.requestId, list)
    setTimeout(() => early.delete(c.requestId), 30_000)
    return
  }
  if (c.delta) {
    const p = pendingDelta.get(c.requestId)
    pendingDelta.set(c.requestId, { delta: (p?.delta ?? '') + c.delta, stage: c.stage ?? p?.stage })
    if (!flushTimer) flushTimer = setTimeout(flushDeltas, 40)
  }
  if (c.done) {
    flushDeltas()
    set((s) => ({
      activeRequestId: s.activeRequestId === c.requestId ? null : s.activeRequestId,
      messages: s.messages.map((m) =>
        m.requestId === c.requestId && m.role === 'assistant' ? { ...m, status: c.error ? 'error' : c.stats?.stopped ? 'stopped' : 'done', error: c.error, stats: c.stats } : m
      )
    }))
    if (c.error && /unavailable|not responding|not installed/i.test(c.error)) void refreshStatus(true)
  }
}

let subscribed = false
export function subscribeChunks(): void {
  if (subscribed) return
  subscribed = true
  on('ai:chunk', applyChunk)
}

function adopt(start: AiChatStart, prompt: string): void {
  const now = Date.now()
  set((s) => ({
    conversationId: start.conversationId,
    title: s.conversationId === start.conversationId && s.title ? s.title : prompt.slice(0, 80),
    activeRequestId: start.requestId,
    sending: false,
    messages: [
      ...s.messages,
      { id: start.userMessageId, conversationId: start.conversationId, role: 'user', content: prompt, context: start.context, model: start.model, status: 'done', createdAt: now },
      { id: start.assistantMessageId, conversationId: start.conversationId, role: 'assistant', content: '', context: [], model: start.model, status: 'streaming', createdAt: now, requestId: start.requestId }
    ]
  }))
  const buffered = early.get(start.requestId)
  if (buffered) {
    early.delete(start.requestId)
    buffered.forEach(applyChunk)
  }
}

// ---------------------------------------------------------------- context

export interface TabChoice {
  id: string
  title: string
  url: string
  sleeping: boolean
}

export function currentPageInfo(): { wcId: number | null; url: string; title: string; readable: boolean; reason?: string } {
  if (isPopoutWindow || !useBrowser.getState().ready) return { wcId: null, url: '', title: 'Focused tab', readable: true }
  const t = activeTab()
  if (!t) return { wcId: null, url: '', title: 'No tab', readable: false, reason: 'No tab is open' }
  if (isInternal(t.url) || t.url === 'about:blank') return { wcId: null, url: t.url, title: t.title, readable: false, reason: 'SPECTER pages can’t be attached' }
  const wcId = wcIdFor(t.id)
  if (wcId === null) return { wcId: null, url: t.url, title: t.title, readable: false, reason: t.suspended ? 'Tab is sleeping' : 'Page is still loading' }
  return { wcId, url: t.url, title: t.title, readable: true }
}

export function otherTabs(): TabChoice[] {
  if (isPopoutWindow || !useBrowser.getState().ready) return []
  const ws = activeWs()
  if (!ws) return []
  return ws.tabs
    .filter((t) => t.id !== ws.activeTabId && !isInternal(t.url) && t.url !== 'about:blank')
    .map((t) => ({ id: t.id, title: t.title || t.url, url: t.url, sleeping: t.suspended || wcIdFor(t.id) === null }))
}

/** Converts the visible context selection into the request the main process honours. */
export function buildContextRequest(sel: ContextSelection = S().ctx): AiContextRequest {
  const st = S()
  const req: AiContextRequest = {}
  const page = currentPageInfo()
  if (sel.page && page.readable) req.page = { wcId: page.wcId, url: page.url, title: page.title }
  if (sel.selection) {
    if (st.selection?.text) req.selection = { text: st.selection.text, url: st.selection.url, title: st.selection.title }
    else if (page.readable && page.wcId !== null) req.selection = { wcId: page.wcId, url: page.url, title: page.title }
  }
  if (sel.tabs.length) {
    req.tabs = sel.tabs
      .map((id) => findTab(id)?.tab)
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => ({ wcId: t.suspended ? null : wcIdFor(t.id), url: t.url, title: t.title }))
  }
  if (sel.workspace && !isPopoutWindow) {
    const ws = activeWs()
    if (ws) req.workspace = { name: ws.name, tabs: ws.tabs.filter((t) => !isInternal(t.url)).map((t) => ({ url: t.url, title: t.title })) }
  }
  if (sel.notes && st.notes.text.trim()) req.notes = { text: st.notes.text, label: st.notes.label }
  return req
}

let previewSeq = 0
export async function refreshPreview(): Promise<void> {
  const seq = ++previewSeq
  const req = buildContextRequest()
  if (!Object.keys(req).length) {
    set({ preview: { items: [], totalChars: 0, budgetChars: 0, approxTokens: 0, errors: [] }, previewLoading: false })
    return
  }
  set({ previewLoading: true })
  try {
    const p = await invoke('ai:previewContext', req)
    if (seq === previewSeq) set({ preview: p, previewLoading: false })
  } catch (err) {
    if (seq === previewSeq) set({ preview: { items: [], totalChars: 0, budgetChars: 0, approxTokens: 0, errors: [errText(err)] }, previewLoading: false })
  }
}

export function setCtx(patch: Partial<ContextSelection>): void {
  set((s) => ({ ctx: { ...s.ctx, ...patch } }))
}

// ---------------------------------------------------------------- actions

function errText(err: unknown): string {
  const m = String((err as Error)?.message ?? err)
  // Electron prefixes remote errors: "Error invoking remote method 'ai:chat': Error: …"
  return m.replace(/^Error invoking remote method '[^']+':\s*(\w*Error:\s*)?/, '')
}

/**
 * Bumped by "New chat" / opening a conversation. A request that was still
 * starting when the user switched away must not land in the new view.
 */
let viewEpoch = 0

/** The user moved on while `ai:chat` / `ai:runAgents` was starting: stop that answer instead of adopting it. */
function abandoned(epoch: number, start: AiChatStart): boolean {
  if (epoch === viewEpoch) return false
  void invoke('ai:cancel', start.requestId).catch(() => undefined)
  return true
}

export async function send(prompt: string, opts: { action?: string; ctx?: ContextSelection } = {}): Promise<boolean> {
  const text = prompt.trim()
  const st = S()
  if (!text || st.activeRequestId || st.sending) return false
  const epoch = viewEpoch
  set({ sending: true, error: null, view: 'chat' })
  const context = buildContextRequest(opts.ctx ?? st.ctx)
  try {
    const start = await invoke('ai:chat', { conversationId: st.conversationId, prompt: text, action: opts.action, model: st.model || undefined, context })
    if (abandoned(epoch, start)) return false
    adopt(start, text)
    // Only clear the composer when it held what was sent (not for quick actions, and not text typed meanwhile).
    if (S().draft.trim() === text) set({ draft: '' })
    return true
  } catch (err) {
    if (epoch !== viewEpoch) return false
    set({ sending: false, error: errText(err) })
    void refreshStatus(true)
    return false
  }
}

export async function runAgents(agentIds: string[], focus?: string): Promise<boolean> {
  const st = S()
  if (st.activeRequestId || st.sending) return false
  const epoch = viewEpoch
  set({ sending: true, error: null, view: 'chat' })
  try {
    const start = await invoke('ai:runAgents', { agents: agentIds, conversationId: st.conversationId, model: st.model || undefined, context: buildContextRequest(), prompt: focus })
    if (abandoned(epoch, start)) return false
    adopt(start, focus?.trim() ? focus.trim() : 'Agent pipeline')
    // Replace the optimistic user text with what the main process stored.
    const conv = await invoke('ai:conversation', start.conversationId).catch(() => null)
    const stored = conv?.items.find((m) => m.id === start.userMessageId)
    if (stored) set((s) => ({ messages: s.messages.map((m) => (m.id === stored.id ? { ...m, content: stored.content } : m)) }))
    return true
  } catch (err) {
    if (epoch === viewEpoch) set({ sending: false, error: errText(err) })
    return false
  }
}

export function stop(): void {
  const id = S().activeRequestId
  if (id) void invoke('ai:cancel', id).catch(() => undefined)
}

export function newChat(): void {
  stop()
  viewEpoch++
  set({ conversationId: null, title: '', messages: [], activeRequestId: null, sending: false, error: null, view: 'chat', selection: null, focusTick: S().focusTick + 1 })
}

export async function loadConversation(id: string): Promise<void> {
  if (S().activeRequestId) stop()
  const epoch = ++viewEpoch
  const c = await invoke('ai:conversation', id).catch(() => null)
  // A later click (or New chat) wins over this slower load.
  if (epoch !== viewEpoch) return
  if (!c) {
    set({ sending: false })
    toast({ kind: 'warn', title: 'Conversation not found' })
    return
  }
  set({ conversationId: c.id, title: c.title, messages: c.items, activeRequestId: null, sending: false, error: null, view: 'chat' })
}

export function focusComposer(): void {
  set((s) => ({ focusTick: s.focusTick + 1 }))
}

export function openPanel(): void {
  const w = getSetting('ai.sidebarWidth')
  if (useUi.getState().sidePanel !== 'ai' && typeof w === 'number' && w >= 300) useUi.setState({ sidePanelWidth: Math.min(Math.max(300, w), Math.max(320, window.innerWidth * 0.5)) })
  openSidePanel('ai')
}

function translateTarget(): string {
  try {
    const lang = (navigator.language || 'en').split('-')[0]
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) ?? 'English'
  } catch {
    return 'English'
  }
}

export function actionPrompt(id: string): string | null {
  const a = quickAction(id)
  if (!a) return null
  return a.prompt.replace(/\{lang\}/g, translateTarget())
}

/** ai.ask: attach text as the selection and run the action (or just focus for "ask"). */
export async function askAbout(action: string | undefined, text: string): Promise<void> {
  openPanel()
  const t = activeTab()
  const src = t && !isInternal(t.url) ? { url: t.url, title: t.title } : {}
  const clean = String(text ?? '').trim()
  if (clean) {
    set({ selection: { text: clean, ...src }, ctx: { page: false, selection: true, tabs: [], workspace: false, notes: false }, view: 'chat' })
  }
  const prompt = action && action !== 'ask' ? actionPrompt(action) : null
  if (prompt && clean) {
    if (S().activeRequestId || S().sending) {
      toast({ kind: 'info', title: 'AI is still answering', body: 'Stop the current answer first.' })
      return
    }
    await send(prompt, { action })
  } else focusComposer()
}

/** ai.askPage: attach the current page and send the prompt. */
export async function askPage(prompt?: string): Promise<void> {
  openPanel()
  set({ ctx: { ...S().ctx, page: true, selection: false }, selection: null, view: 'chat' })
  if (prompt?.trim()) {
    if (S().activeRequestId || S().sending) {
      toast({ kind: 'info', title: 'AI is still answering', body: 'Stop the current answer first.' })
      return
    }
    await send(prompt)
  } else focusComposer()
}

