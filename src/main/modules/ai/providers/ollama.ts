// Ollama provider — talks to a local Ollama server over its HTTP API.
//   GET  /api/tags        installed models
//   GET  /api/version     server version
//   POST /api/chat        streaming NDJSON chat
//   POST /api/embed       embeddings (falls back to /api/embeddings on old servers)
// No Electron imports: `fetchImpl` is injectable for unit tests.
import { NdjsonParser } from '../ndjson'
import { AiError, UNAVAILABLE_MESSAGE, type AIProvider, type ChatOptions, type ChatResult, type ProviderStatus } from './types'
import { isLoopbackUrl } from '@shared/modules/ai'

type FetchFn = typeof fetch

interface OllamaTag {
  name: string
  model?: string
  capabilities?: string[]
  details?: { family?: string; families?: string[] | null }
}

interface OllamaChatLine {
  message?: { role: string; content: string }
  done?: boolean
  done_reason?: string
  error?: string
  eval_count?: number
  prompt_eval_count?: number
  total_duration?: number
}

const NET_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET', 'ENETUNREACH', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'])

/** Header/first-byte timeout for chat (cold model loads can take a while). */
const CHAT_CONNECT_MS = 180_000
/** Max silence between streamed lines. */
const CHAT_IDLE_MS = 120_000

export function isEmbeddingModel(t: OllamaTag): boolean {
  if (t.capabilities?.length) return t.capabilities.includes('embedding') && !t.capabilities.includes('completion')
  const fam = [t.details?.family, ...(t.details?.families ?? [])].filter(Boolean).join(' ')
  return /embed/i.test(t.name) || /\bbert\b|nomic-bert/i.test(fam)
}

function describeNetError(err: unknown): { reason: 'not-running' | 'error'; message: string } {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } }
  const code = e?.cause?.code
  if ((code && NET_CODES.has(code)) || /fetch failed|ECONNREFUSED/i.test(String(e?.message))) return { reason: 'not-running', message: UNAVAILABLE_MESSAGE }
  if (e?.name === 'TimeoutError') return { reason: 'not-running', message: 'Ollama did not respond in time' }
  return { reason: 'error', message: String(e?.cause?.message ?? e?.message ?? err) }
}

export class OllamaProvider implements AIProvider {
  readonly id = 'ollama'
  readonly label = 'Ollama'
  readonly remote = false
  readonly local: boolean
  readonly url: string
  private fetchImpl: FetchFn

  constructor(url: string, fetchImpl?: FetchFn) {
    this.url = url.trim().replace(/\/+$/, '')
    this.local = isLoopbackUrl(this.url)
    this.fetchImpl = fetchImpl ?? ((...a) => fetch(...a))
  }

  private endpoint(path: string): string {
    let u: URL
    try {
      u = new URL(this.url)
    } catch {
      throw new AiError(`Invalid Ollama address “${this.url}”`, 'bad-url')
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new AiError(`Unsupported Ollama address “${this.url}”`, 'bad-url')
    return this.url + path
  }

  async status(): Promise<ProviderStatus> {
    let tagsUrl: string
    try {
      tagsUrl = this.endpoint('/api/tags')
    } catch (err) {
      return { running: false, models: [], embeddingModels: [], error: (err as Error).message, reason: 'bad-url' }
    }
    try {
      const res = await this.fetchImpl(tagsUrl, { signal: AbortSignal.timeout(2500) })
      if (!res.ok) return { running: false, models: [], embeddingModels: [], error: `Ollama responded with HTTP ${res.status}`, reason: 'error' }
      const body = (await res.json()) as { models?: OllamaTag[] }
      const tags = Array.isArray(body?.models) ? body.models : []
      const models = tags.filter((t) => !isEmbeddingModel(t)).map((t) => t.name)
      const embeddingModels = tags.filter(isEmbeddingModel).map((t) => t.name)
      let version: string | undefined
      try {
        const v = await this.fetchImpl(this.endpoint('/api/version'), { signal: AbortSignal.timeout(1500) })
        if (v.ok) version = ((await v.json()) as { version?: string }).version
      } catch {
        /* optional */
      }
      return {
        running: true,
        models,
        embeddingModels,
        version,
        reason: models.length ? undefined : 'no-models',
        error: models.length ? undefined : embeddingModels.length ? 'Only embedding models are installed — pull a chat model' : 'No models installed'
      }
    } catch (err) {
      const d = describeNetError(err)
      return { running: false, models: [], embeddingModels: [], error: d.message, reason: d.reason }
    }
  }

  async chat(o: ChatOptions): Promise<ChatResult> {
    const idle = new AbortController()
    const signal = AbortSignal.any([o.signal, idle.signal])
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => idle.abort(new AiError('Ollama did not start responding in time', 'error')), CHAT_CONNECT_MS)
    const bump = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => idle.abort(new AiError('Ollama stopped responding', 'error')), CHAT_IDLE_MS)
    }
    const started = Date.now()
    let text = ''
    try {
      let res: Response
      try {
        res = await this.fetchImpl(this.endpoint('/api/chat'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: o.model,
            messages: o.messages,
            stream: true,
            options: { temperature: o.temperature, ...(o.numCtx ? { num_ctx: o.numCtx } : {}) }
          }),
          signal
        })
      } catch (err) {
        throw this.mapError(err, o.signal, idle.signal)
      }
      if (!res.ok || !res.body) {
        let msg = `HTTP ${res.status}`
        try {
          const j = (await res.json()) as { error?: string }
          if (j?.error) msg = j.error
        } catch {
          /* non-JSON body */
        }
        if (res.status === 404 || /not found/i.test(msg)) throw new AiError(`Model “${o.model}” is not installed. Run: ollama pull ${o.model}`, 'model-missing')
        throw new AiError(`Ollama error: ${msg}`, 'error')
      }
      bump()
      const parser = new NdjsonParser<OllamaChatLine>()
      const reader = res.body.getReader()
      let final: OllamaChatLine | null = null
      const handle = (lines: OllamaChatLine[]) => {
        for (const l of lines) {
          if (l.error) throw new AiError(`Ollama error: ${l.error}`, /not found/i.test(l.error) ? 'model-missing' : 'error')
          const d = l.message?.content ?? ''
          if (d) {
            text += d
            o.onDelta(d)
          }
          if (l.done) final = l
        }
      }
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          bump()
          handle(parser.push(value))
        }
        handle(parser.flush())
      } catch (err) {
        reader.cancel().catch(() => undefined)
        if (err instanceof AiError) throw err
        throw this.mapError(err, o.signal, idle.signal)
      }
      const f = final as OllamaChatLine | null
      return {
        text,
        doneReason: f?.done_reason,
        evalTokens: f?.eval_count,
        promptTokens: f?.prompt_eval_count,
        durationMs: f?.total_duration ? Math.round(f.total_duration / 1e6) : Date.now() - started
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private mapError(err: unknown, user: AbortSignal, idle: AbortSignal): AiError {
    if (user.aborted) return new AiError('Stopped', 'aborted')
    if (idle.aborted) return idle.reason instanceof AiError ? idle.reason : new AiError('Ollama stopped responding', 'error')
    if (err instanceof AiError) return err
    const d = describeNetError(err)
    return new AiError(d.message, d.reason)
  }

  async embed(model: string, input: string[], signal?: AbortSignal): Promise<number[][]> {
    const sig = signal ?? AbortSignal.timeout(60_000)
    try {
      const res = await this.fetchImpl(this.endpoint('/api/embed'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input }),
        signal: sig
      })
      if (res.ok) {
        const j = (await res.json()) as { embeddings?: number[][] }
        if (Array.isArray(j.embeddings)) return j.embeddings
      } else if (res.status !== 404) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new AiError(`Ollama error: ${j.error ?? 'HTTP ' + res.status}`, /not found/i.test(j.error ?? '') ? 'model-missing' : 'error')
      }
      // Older servers: one prompt per request.
      const out: number[][] = []
      for (const text of input) {
        const r = await this.fetchImpl(this.endpoint('/api/embeddings'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt: text }),
          signal: sig
        })
        const j = (await r.json().catch(() => ({}))) as { embedding?: number[]; error?: string }
        if (!r.ok || !Array.isArray(j.embedding)) throw new AiError(`Ollama error: ${j.error ?? 'HTTP ' + r.status}`, /not found/i.test(j.error ?? '') ? 'model-missing' : 'error')
        out.push(j.embedding)
      }
      return out
    } catch (err) {
      if (err instanceof AiError) throw err
      const d = describeNetError(err)
      throw new AiError(d.message, d.reason)
    }
  }
}
