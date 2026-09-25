// AI orchestration: provider selection, status, streaming chats, agents.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { webContents } from 'electron'
import type { AiAgentRunRequest, AiChatRequest, AiChatStart, AiChunk, AiContextPreview, AiPermission, AiStartResult, AiStatus } from '@shared/modules/ai'
import { isLoopbackUrl, quickAction } from '@shared/modules/ai'
import { sendTo } from '../../ipc'
import { bus } from '../../bus'
import { uid } from '../../db'
import { createLogger } from '../../logger'
import { getSetting } from '../../services/settings'
import { createProvider } from './providers'
import { AiError, UNAVAILABLE_MESSAGE, type AIProvider, type ChatMessage } from './providers/types'
import { approxTokens, contextMeta, DEFAULT_CONTEXT_BUDGET, DEFAULT_NUM_CTX, fitContext } from './context'
import { buildMessages, buildSystemPrompt, titleFrom } from './prompt'
import { gatherContext } from './gather'
import { resolvePipeline, stageContext, stageTask } from './agents'
import * as store from './store'

const log = createLogger('ai')

// ---------------------------------------------------------------- provider

export function currentProvider(): AIProvider {
  return createProvider({ enabled: getSetting('ai.enabled'), provider: getSetting('ai.provider'), url: getSetting('ai.ollamaUrl') })
}

function permissions(): AiPermission[] {
  const p = getSetting('ai.permissions')
  return Array.isArray(p) ? p : ['read', 'suggest']
}

// ---------------------------------------------------------------- Ollama binary

let binCache: { at: number; path: string | null } | null = null

export function findOllamaBinary(): string | null {
  if (binCache && Date.now() - binCache.at < 60_000) return binCache.path
  const exe = process.platform === 'win32' ? 'ollama.exe' : 'ollama'
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const extra =
    process.platform === 'win32'
      ? [join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ollama'), join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Ollama')]
      : process.platform === 'darwin'
        ? ['/Applications/Ollama.app/Contents/Resources', '/usr/local/bin', '/opt/homebrew/bin']
        : ['/usr/local/bin', '/usr/bin', '/snap/bin']
  let found: string | null = null
  for (const d of [...extra, ...dirs]) {
    try {
      const p = join(d, exe)
      if (d && existsSync(p)) {
        found = p
        break
      }
    } catch {
      /* ignore */
    }
  }
  binCache = { at: Date.now(), path: found }
  return found
}

// ---------------------------------------------------------------- status

let statusCache: { at: number; key: string; value: AiStatus } | null = null
let statusInflight: Promise<AiStatus> | null = null

function statusKey(): string {
  return [getSetting('ai.enabled'), getSetting('ai.provider'), getSetting('ai.ollamaUrl'), getSetting('ai.model')].join('|')
}

export function invalidateStatus(): void {
  statusCache = null
}

export async function getStatus(refresh = false): Promise<AiStatus> {
  const key = statusKey()
  if (!refresh && statusCache && statusCache.key === key && Date.now() - statusCache.at < 4000) return statusCache.value
  if (statusInflight) return statusInflight
  statusInflight = (async () => {
    const p = currentProvider()
    const enabled = getSetting('ai.enabled')
    const base: Omit<AiStatus, 'running' | 'models' | 'embeddingModels' | 'model'> = {
      enabled,
      provider: p.id,
      url: p.url || getSetting('ai.ollamaUrl'),
      local: p.url ? p.local : isLoopbackUrl(getSetting('ai.ollamaUrl')),
      installed: null,
      checkedAt: Date.now()
    }
    let value: AiStatus
    try {
      const s = await p.status()
      const wanted = getSetting('ai.model')
      let model: string | null = null
      let reason: AiStatus['reason'] = s.reason === 'aborted' ? 'error' : s.reason
      let error = s.error
      if (s.running && s.models.length) {
        if (wanted && s.models.includes(wanted)) model = wanted
        else if (wanted) {
          // Allow "llama3.2" to match "llama3.2:latest".
          model = s.models.find((m) => m === wanted + ':latest') ?? null
          if (!model) {
            reason = 'model-missing'
            error = `Selected model “${wanted}” is not installed — using ${s.models[0]}`
            model = s.models[0]
          }
        } else model = s.models[0]
      }
      const installed = p.id === 'ollama' ? (s.running ? true : findOllamaBinary() !== null) : null
      if (!s.running && p.id === 'ollama' && reason === 'not-running' && installed === false) {
        reason = 'not-installed'
        error = 'Ollama is not installed — get it from ollama.com'
      }
      value = { ...base, running: s.running, models: s.models, embeddingModels: s.embeddingModels, model, version: s.version, installed, reason, error }
    } catch (err) {
      value = { ...base, running: false, models: [], embeddingModels: [], model: null, error: String((err as Error)?.message ?? err), reason: 'error' }
    }
    statusCache = { at: Date.now(), key, value }
    return value
  })().finally(() => {
    statusInflight = null
  })
  return statusInflight
}

async function requireReady(requested?: string): Promise<{ provider: AIProvider; model: string }> {
  const provider = currentProvider()
  if (provider.id === 'disabled') throw new AiError('AI is disabled. Enable it in Settings → AI.', 'disabled')
  let st = await getStatus()
  if (!st.running) st = await getStatus(true)
  if (!st.running) throw new AiError(st.reason === 'not-installed' ? st.error ?? UNAVAILABLE_MESSAGE : UNAVAILABLE_MESSAGE, st.reason === 'not-installed' ? 'not-installed' : 'not-running')
  if (!st.models.length) throw new AiError('Ollama has no chat models installed. Run: ollama pull llama3.2', 'no-models')
  const model = requested && st.models.includes(requested) ? requested : st.model
  if (!model) throw new AiError('No model selected', 'no-models')
  return { provider, model }
}

// ---------------------------------------------------------------- context preview

export async function previewContext(ctx: AiChatRequest['context']): Promise<AiContextPreview> {
  const g = await gatherContext(ctx, permissions().includes('read'))
  const items = fitContext(g.items, DEFAULT_CONTEXT_BUDGET)
  const totalChars = items.reduce((n, it) => n + it.text.length, 0)
  return { items, totalChars, budgetChars: DEFAULT_CONTEXT_BUDGET, approxTokens: approxTokens(totalChars), errors: g.errors }
}

// ---------------------------------------------------------------- streaming

interface ActiveRequest {
  controller: AbortController
  senderId: number
  model: string
}

const active = new Map<string, ActiveRequest>()

export function cancel(requestId: string): boolean {
  const r = active.get(requestId)
  if (!r) return false
  r.controller.abort()
  return true
}

export function cancelAll(): void {
  for (const r of active.values()) r.controller.abort()
}

function emit(senderId: number, chunk: AiChunk): boolean {
  const wc = webContents.fromId(senderId)
  if (!wc || wc.isDestroyed()) return false
  sendTo(senderId, 'ai:chunk', chunk)
  return true
}

function errorMessage(err: unknown): { message: string; code: string } {
  if (err instanceof AiError) return { message: err.message, code: err.code }
  return { message: String((err as Error)?.message ?? err), code: 'error' }
}

export async function startChat(senderId: number, req: AiChatRequest): Promise<AiChatStart> {
  const prompt = String(req.prompt ?? '').trim()
  if (!prompt) throw new Error('Empty prompt')
  const { provider, model } = await requireReady(req.model)
  const perms = permissions()
  const gathered = await gatherContext(req.context ?? {}, perms.includes('read'))
  const items = fitContext(gathered.items, DEFAULT_CONTEXT_BUDGET)

  const actionLabel = req.action ? quickAction(req.action)?.label : undefined
  const conversationId = req.conversationId && store.conversationExists(req.conversationId) ? req.conversationId : store.createConversation(titleFrom(actionLabel ?? prompt, items), model)
  const history = store.historyFor(conversationId) as ChatMessage[]
  const meta = contextMeta(items)
  const userMessageId = store.addMessage({ conversationId, role: 'user', content: prompt, context: meta, model, status: 'done' })
  const assistantMessageId = store.addMessage({ conversationId, role: 'assistant', content: '', context: [], model, status: 'streaming' })

  const messages = buildMessages({ system: buildSystemPrompt({ permissions: perms, hasContext: items.length > 0 }), history, prompt, items })
  const requestId = uid('air_')
  const controller = new AbortController()
  active.set(requestId, { controller, senderId, model })

  setImmediate(() => void runStream(requestId, conversationId, assistantMessageId, provider, model, messages, controller, senderId))
  return { requestId, conversationId, userMessageId, assistantMessageId, model, context: meta }
}

async function runStream(requestId: string, conversationId: string, messageId: string, provider: AIProvider, model: string, messages: ChatMessage[], controller: AbortController, senderId: number): Promise<void> {
  bus.emit('AI_STARTED', { model })
  let text = ''
  let ok = false
  try {
    const r = await provider.chat({
      model,
      messages,
      temperature: getSetting('ai.temperature'),
      numCtx: DEFAULT_NUM_CTX,
      signal: controller.signal,
      onDelta: (delta) => {
        text += delta
        if (!emit(senderId, { requestId, conversationId, delta, done: false })) controller.abort()
      }
    })
    ok = true
    store.finishMessage(messageId, r.text, 'done')
    emit(senderId, { requestId, conversationId, delta: '', done: true, stats: { evalTokens: r.evalTokens, promptTokens: r.promptTokens, durationMs: r.durationMs } })
  } catch (err) {
    const e = errorMessage(err)
    if (e.code === 'aborted') {
      store.finishMessage(messageId, text, 'stopped')
      emit(senderId, { requestId, conversationId, delta: '', done: true, stats: { stopped: true } })
    } else {
      if (e.code === 'not-running') invalidateStatus()
      log.warn(`chat failed (${e.code}): ${e.message}`)
      store.finishMessage(messageId, text, 'error', e.message)
      emit(senderId, { requestId, conversationId, delta: '', done: true, error: e.message })
    }
  } finally {
    active.delete(requestId)
    bus.emit('AI_FINISHED', { model, ok })
  }
}

export async function startAgents(senderId: number, req: AiAgentRunRequest): Promise<AiChatStart> {
  const pipeline = resolvePipeline(req.agents ?? [])
  if (!pipeline.length) throw new Error('Choose at least one agent')
  const { provider, model } = await requireReady(req.model)
  const perms = permissions()
  const gathered = await gatherContext(req.context ?? {}, perms.includes('read'))
  const items = fitContext(gathered.items, DEFAULT_CONTEXT_BUDGET)
  if (!items.length) throw new Error('Agents need context — attach the current page, a selection or notes')

  const label = `Agents: ${pipeline.map((a) => a.name).join(' → ')}`
  const prompt = req.prompt?.trim() ? `${label}\n\n${req.prompt.trim()}` : label
  const conversationId = req.conversationId && store.conversationExists(req.conversationId) ? req.conversationId : store.createConversation(titleFrom(label, items), model)
  const meta = contextMeta(items)
  const userMessageId = store.addMessage({ conversationId, role: 'user', content: prompt, context: meta, model, status: 'done' })
  const assistantMessageId = store.addMessage({ conversationId, role: 'assistant', content: '', context: [], model, status: 'streaming' })
  const requestId = uid('air_')
  const controller = new AbortController()
  active.set(requestId, { controller, senderId, model })

  setImmediate(async () => {
    bus.emit('AI_STARTED', { model })
    let text = ''
    let ok = false
    const outputs: { agent: (typeof pipeline)[number]; output: string }[] = []
    const push = (delta: string, stage: string) => {
      text += delta
      if (!emit(senderId, { requestId, conversationId, delta, done: false, stage })) controller.abort()
    }
    try {
      for (const agent of pipeline) {
        if (controller.signal.aborted) throw new AiError('Stopped', 'aborted')
        push(`${text ? '\n\n' : ''}### ${agent.name}\n\n`, agent.name)
        let out = ''
        const stageItems = stageContext(items, outputs)
        const messages = buildMessages({
          system: buildSystemPrompt({ permissions: perms.filter((p) => agent.permissions.includes(p)), hasContext: true, agent }),
          history: [],
          prompt: stageTask(agent, req.prompt),
          items: stageItems
        })
        await provider.chat({
          model,
          messages,
          temperature: Math.min(getSetting('ai.temperature'), 0.5),
          numCtx: DEFAULT_NUM_CTX,
          signal: controller.signal,
          onDelta: (d) => {
            out += d
            push(d, agent.name)
          }
        })
        outputs.push({ agent, output: out })
      }
      ok = true
      store.finishMessage(assistantMessageId, text, 'done')
      emit(senderId, { requestId, conversationId, delta: '', done: true })
    } catch (err) {
      const e = errorMessage(err)
      if (e.code === 'aborted') {
        store.finishMessage(assistantMessageId, text, 'stopped')
        emit(senderId, { requestId, conversationId, delta: '', done: true, stats: { stopped: true } })
      } else {
        store.finishMessage(assistantMessageId, text, 'error', e.message)
        emit(senderId, { requestId, conversationId, delta: '', done: true, error: e.message })
      }
    } finally {
      active.delete(requestId)
      bus.emit('AI_FINISHED', { model, ok })
    }
  })
  return { requestId, conversationId, userMessageId, assistantMessageId, model, context: meta }
}

// ---------------------------------------------------------------- embeddings

export async function embed(texts: string[], model?: string): Promise<number[][]> {
  const p = currentProvider()
  if (!p.embed) throw new AiError('Embeddings are unavailable for this provider', 'error')
  const list = (Array.isArray(texts) ? texts : []).slice(0, 256).map((t) => String(t).slice(0, 8000))
  if (!list.length) return []
  return p.embed(model || getSetting('ai.embeddingModel') || 'nomic-embed-text', list)
}

// ---------------------------------------------------------------- start Ollama

export async function startOllama(): Promise<AiStartResult> {
  const url = getSetting('ai.ollamaUrl')
  if (getSetting('ai.provider') !== 'ollama') return { ok: false, message: 'Provider is not Ollama' }
  if (!isLoopbackUrl(url)) return { ok: false, message: 'Ollama address is not on this computer — start it on that machine' }
  const st = await getStatus(true)
  if (st.running) return { ok: true, message: 'Ollama is already running' }
  const bin = findOllamaBinary()
  if (!bin) return { ok: false, message: 'Ollama is not installed — get it from ollama.com' }
  let hostPort = '127.0.0.1:11434'
  try {
    const u = new URL(url)
    hostPort = `${u.hostname}:${u.port || '11434'}`
  } catch {
    /* default */
  }
  try {
    const child = spawn(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, OLLAMA_HOST: hostPort } })
    child.on('error', (err) => log.warn('ollama serve failed', err))
    child.unref()
  } catch (err) {
    return { ok: false, message: 'Could not start Ollama: ' + String((err as Error)?.message ?? err) }
  }
  for (let i = 0; i < 16; i++) {
    await new Promise((r) => setTimeout(r, 500))
    const s = await getStatus(true)
    if (s.running) {
      log.info('started ollama serve')
      return { ok: true, message: 'Ollama started' }
    }
  }
  return { ok: false, message: 'Ollama was launched but is not responding yet — try again in a few seconds' }
}
