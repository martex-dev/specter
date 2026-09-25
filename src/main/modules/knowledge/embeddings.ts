// Local embeddings through Ollama (only when the user enabled semantic search).
// Nothing leaves the machine: the Ollama URL is expected to be local and the
// UI shows exactly which endpoint is used.
import { net } from 'electron'
import type { SemanticStatus } from '@shared/modules/knowledge'
import { getSetting } from '../../services/settings'
import { createLogger } from '../../logger'

const log = createLogger('knowledge:embed')

let cached: { at: number; key: string; status: SemanticStatus } | null = null
let preferLegacy = false

function baseUrl(): string {
  return String(getSetting('ai.ollamaUrl') || 'http://127.0.0.1:11434').replace(/\/+$/, '')
}

export function embeddingModel(): string {
  return String(getSetting('ai.embeddingModel') || '').trim()
}

async function request(path: string, body?: unknown, timeoutMs = 4000): Promise<any> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await net.fetch(baseUrl() + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      const err: any = new Error(`Ollama HTTP ${res.status}${t ? ': ' + t.slice(0, 160) : ''}`)
      err.status = res.status
      throw err
    }
    return await res.json()
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error('Ollama did not respond in time')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Whether semantic search can be used right now (cached for 30 s). */
export async function semanticStatus(force = false): Promise<SemanticStatus> {
  const enabled = !!getSetting('knowledge.semanticSearch')
  const model = embeddingModel()
  const url = baseUrl()
  const key = `${enabled}|${model}|${url}|${getSetting('ai.enabled')}|${getSetting('ai.provider')}`
  if (!force && cached && cached.key === key && Date.now() - cached.at < 30_000) return cached.status
  const status = await computeStatus(enabled, model, url)
  cached = { at: Date.now(), key, status }
  return status
}

async function computeStatus(enabled: boolean, model: string, url: string): Promise<SemanticStatus> {
  const base = { enabled, available: false, model, url }
  if (!enabled) return { ...base, reason: 'Semantic search is off (Settings → Research & knowledge)' }
  if (!getSetting('ai.enabled') || getSetting('ai.provider') === 'disabled') return { ...base, reason: 'Local AI is disabled in settings' }
  if (!model) return { ...base, reason: 'No embedding model configured (ai.embeddingModel)' }
  try {
    const tags = await request('/api/tags', undefined, 2500)
    const names: string[] = (tags?.models ?? []).map((m: any) => String(m.name ?? m.model ?? ''))
    const want = model.includes(':') ? model : model + ':latest'
    if (!names.some((n) => n === model || n === want)) return { ...base, reason: `Model “${model}” is not installed in Ollama (ollama pull ${model})` }
    return { ...base, available: true, reason: '' }
  } catch (err: any) {
    return { ...base, reason: `Ollama not reachable at ${url} (${err?.message ?? err})` }
  }
}

export function invalidateSemanticStatus(): void {
  cached = null
}

/** nomic-embed-text style models expect task prefixes. */
function prefixed(texts: string[], purpose: 'document' | 'query'): string[] {
  const m = embeddingModel().toLowerCase()
  if (m.includes('nomic')) return texts.map((t) => (purpose === 'query' ? 'search_query: ' : 'search_document: ') + t)
  return texts
}

/** Embeds texts with the configured model. Throws when Ollama fails. */
export async function embed(texts: string[], purpose: 'document' | 'query'): Promise<Float32Array[]> {
  if (!texts.length) return []
  const model = embeddingModel()
  const input = prefixed(texts, purpose)
  if (!preferLegacy) {
    try {
      const r = await request('/api/embed', { model, input, truncate: true }, 60_000)
      const out: number[][] = r?.embeddings ?? []
      if (out.length === texts.length) return out.map((v) => Float32Array.from(v))
      throw new Error('Unexpected /api/embed response')
    } catch (err: any) {
      // Older Ollama builds only have /api/embeddings.
      if (err?.status !== 404) throw err
      preferLegacy = true
      log.info('falling back to /api/embeddings')
    }
  }
  const vecs: Float32Array[] = []
  for (const prompt of input) {
    const r = await request('/api/embeddings', { model, prompt }, 60_000)
    if (!Array.isArray(r?.embedding)) throw new Error('Unexpected /api/embeddings response')
    vecs.push(Float32Array.from(r.embedding))
  }
  return vecs
}

export function toBlob(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength))
}

export function fromBlob(b: Uint8Array): Float32Array {
  const copy = b.slice()
  return new Float32Array(copy.buffer, copy.byteOffset, Math.floor(copy.byteLength / 4))
}
