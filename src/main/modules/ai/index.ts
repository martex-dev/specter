// AI (local Ollama) — main-process module entry.
import '@shared/modules/ai'
import { app } from 'electron'
import { handle } from '../../ipc'
import { registerDiagnostic } from '../../services/diagnostics'
import { onSettingChanged } from '../../services/settings'
import { createLogger } from '../../logger'
import { agentInfo, BUILTIN_AGENTS } from './agents'
import * as store from './store'
import { cancel, cancelAll, embed, findOllamaBinary, getStatus, invalidateStatus, previewContext, startAgents, startChat, startOllama } from './service'

const log = createLogger('ai')

export function register(): void {
  store.registerAiMigrations()
  try {
    store.repairInterrupted()
  } catch (err) {
    log.warn('could not repair interrupted AI messages', err)
  }

  handle('ai:status', (_e, opts) => getStatus(!!opts?.refresh))
  handle('ai:chat', (e, req) => startChat(e.sender.id, req))
  handle('ai:runAgents', (e, req) => startAgents(e.sender.id, req))
  handle('ai:cancel', (_e, requestId) => cancel(requestId))
  handle('ai:previewContext', (_e, ctx) => previewContext(ctx ?? {}))
  handle('ai:conversations', (_e, limit) => store.listConversations(limit ?? 100))
  handle('ai:conversation', (_e, id) => store.loadConversation(id))
  handle('ai:deleteConversation', (_e, id) => store.deleteConversation(id))
  handle('ai:renameConversation', (_e, id, title) => store.renameConversation(id, title))
  handle('ai:clearConversations', () => store.clearConversations())
  handle('ai:agents', () => BUILTIN_AGENTS.map(agentInfo))
  handle('ai:startOllama', () => startOllama())
  handle('ai:embed', (_e, texts, model) => embed(texts, model))

  onSettingChanged((key) => {
    if (key === 'ai.enabled' || key === 'ai.provider' || key === 'ai.ollamaUrl' || key === 'ai.model') {
      invalidateStatus()
      if (key !== 'ai.model') cancelAll()
    }
  })
  app.on('before-quit', () => cancelAll())

  registerDiagnostic(async () => {
    const st = await getStatus(true)
    if (!st.enabled) return { id: 'ai-ollama-installed', label: 'Ollama installed', status: 'unknown', detail: 'AI disabled in settings' }
    const bin = findOllamaBinary()
    if (st.running) return { id: 'ai-ollama-installed', label: 'Ollama installed', status: 'ok', detail: bin ? `Found ${bin}` : `Server reachable at ${st.url}${st.version ? ' · v' + st.version : ''}` }
    return bin ? { id: 'ai-ollama-installed', label: 'Ollama installed', status: 'ok', detail: `Found ${bin}` } : { id: 'ai-ollama-installed', label: 'Ollama installed', status: 'warn', detail: 'Not found — install from ollama.com to use local AI (optional)' }
  })
  registerDiagnostic(async () => {
    const st = await getStatus()
    if (!st.enabled) return { id: 'ai-ollama-running', label: 'Ollama server', status: 'unknown', detail: 'AI disabled in settings' }
    return st.running
      ? { id: 'ai-ollama-running', label: 'Ollama server', status: 'ok', detail: `Running at ${st.url}${st.version ? ' · v' + st.version : ''}${st.local ? ' · local' : ' · NOT on this computer'}` }
      : { id: 'ai-ollama-running', label: 'Ollama server', status: 'warn', detail: `${st.error ?? 'Not reachable'} (${st.url})` }
  })
  registerDiagnostic(async () => {
    const st = await getStatus()
    if (!st.enabled || !st.running) return { id: 'ai-ollama-models', label: 'AI models', status: 'unknown', detail: st.enabled ? 'Server offline' : 'AI disabled in settings' }
    if (!st.models.length) return { id: 'ai-ollama-models', label: 'AI models', status: 'warn', detail: 'No chat models installed — run: ollama pull llama3.2' }
    return {
      id: 'ai-ollama-models',
      label: 'AI models',
      status: st.reason === 'model-missing' ? 'warn' : 'ok',
      detail: `${st.models.length} chat model${st.models.length === 1 ? '' : 's'} (${st.models.slice(0, 4).join(', ')})${st.embeddingModels.length ? ` · embeddings: ${st.embeddingModels.join(', ')}` : ''} · using ${st.model}`
    }
  })
}
