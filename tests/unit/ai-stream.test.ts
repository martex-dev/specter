import { describe, expect, it } from 'vitest'
import { NdjsonParser } from '../../src/main/modules/ai/ndjson'
import { OllamaProvider, isEmbeddingModel } from '../../src/main/modules/ai/providers/ollama'
import { AiError } from '../../src/main/modules/ai/providers/types'

const enc = new TextEncoder()

function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(typeof ch === 'string' ? enc.encode(ch) : ch)
      c.close()
    }
  })
}

describe('NDJSON parser', () => {
  it('handles lines split across chunks and a final unterminated line', () => {
    const p = new NdjsonParser<{ n: number }>()
    expect(p.push('{"n":1}\n{"n"')).toEqual([{ n: 1 }])
    expect(p.push(':2}\n\n')).toEqual([{ n: 2 }])
    expect(p.push('{"n":3}')).toEqual([])
    expect(p.flush()).toEqual([{ n: 3 }])
  })

  it('decodes multi-byte UTF-8 split between byte chunks', () => {
    const bytes = enc.encode('{"t":"héllo — ✓"}\n')
    const p = new NdjsonParser<{ t: string }>()
    const out = [...p.push(bytes.slice(0, 8)), ...p.push(bytes.slice(8, 15)), ...p.push(bytes.slice(15))]
    expect(out).toEqual([{ t: 'héllo — ✓' }])
  })

  it('skips malformed lines and records them', () => {
    const p = new NdjsonParser()
    expect(p.push('not json\n{"ok":true}\n')).toEqual([{ ok: true }])
    expect(p.errors).toEqual(['not json'])
  })
})

describe('OllamaProvider', () => {
  const lines = [
    '{"message":{"role":"assistant","content":"Hel"},"done":false}\n{"message":{"role":"assistant","content":"lo"},',
    '"done":false}\n{"message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","eval_count":2,"prompt_eval_count":10,"total_duration":1500000000}\n'
  ]

  it('streams chat deltas and returns final stats', async () => {
    let body: any
    const fetchImpl = (async (url: string, init: RequestInit) => {
      expect(url).toBe('http://127.0.0.1:11434/api/chat')
      body = JSON.parse(String(init.body))
      return new Response(streamOf(lines), { status: 200 })
    }) as unknown as typeof fetch
    const p = new OllamaProvider('http://127.0.0.1:11434/', fetchImpl)
    const deltas: string[] = []
    const r = await p.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }], temperature: 0.2, numCtx: 4096, signal: new AbortController().signal, onDelta: (d) => deltas.push(d) })
    expect(deltas).toEqual(['Hel', 'lo'])
    expect(r).toMatchObject({ text: 'Hello', doneReason: 'stop', evalTokens: 2, promptTokens: 10, durationMs: 1500 })
    expect(body).toMatchObject({ model: 'm', stream: true, options: { temperature: 0.2, num_ctx: 4096 } })
    expect(p.local).toBe(true)
  })

  it('maps a missing model to a helpful error', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: "model 'nope' not found" }), { status: 404 })) as unknown as typeof fetch
    const p = new OllamaProvider('http://localhost:11434', fetchImpl)
    await expect(p.chat({ model: 'nope', messages: [], temperature: 0, signal: new AbortController().signal, onDelta: () => {} })).rejects.toMatchObject({ code: 'model-missing' })
  })

  it('surfaces errors sent inside the stream', async () => {
    const fetchImpl = (async () => new Response(streamOf(['{"error":"out of memory"}\n']), { status: 200 })) as unknown as typeof fetch
    const p = new OllamaProvider('http://localhost:11434', fetchImpl)
    await expect(p.chat({ model: 'm', messages: [], temperature: 0, signal: new AbortController().signal, onDelta: () => {} })).rejects.toThrow(/out of memory/)
  })

  it('reports "not running" when the server refuses connections', async () => {
    const fetchImpl = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    }) as unknown as typeof fetch
    const p = new OllamaProvider('http://127.0.0.1:11434', fetchImpl)
    const st = await p.status()
    expect(st).toMatchObject({ running: false, reason: 'not-running', error: 'Local AI unavailable — install/start Ollama' })
    const err = await p.chat({ model: 'm', messages: [], temperature: 0, signal: new AbortController().signal, onDelta: () => {} }).catch((e) => e)
    expect(err).toBeInstanceOf(AiError)
    expect(err.code).toBe('not-running')
  })

  it('reports an aborted request as "aborted"', async () => {
    const ctrl = new AbortController()
    const fetchImpl = (async (_u: string, init: RequestInit) =>
      new Promise((_res, rej) => {
        init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
      })) as unknown as typeof fetch
    const p = new OllamaProvider('http://127.0.0.1:11434', fetchImpl)
    const pr = p.chat({ model: 'm', messages: [], temperature: 0, signal: ctrl.signal, onDelta: () => {} })
    ctrl.abort()
    await expect(pr).rejects.toMatchObject({ code: 'aborted' })
  })

  it('separates chat and embedding models in status', async () => {
    const fetchImpl = (async (url: string) => {
      if (url.endsWith('/api/version')) return new Response(JSON.stringify({ version: '0.9.0' }))
      return new Response(
        JSON.stringify({
          models: [
            { name: 'nomic-embed-text:latest', capabilities: ['embedding'] },
            { name: 'llama3.1:8b', capabilities: ['completion', 'tools'] },
            { name: 'old-embed:latest', details: { family: 'nomic-bert' } }
          ]
        })
      )
    }) as unknown as typeof fetch
    const st = await new OllamaProvider('http://127.0.0.1:11434', fetchImpl).status()
    expect(st).toMatchObject({ running: true, models: ['llama3.1:8b'], embeddingModels: ['nomic-embed-text:latest', 'old-embed:latest'], version: '0.9.0' })
    expect(isEmbeddingModel({ name: 'qwen2.5:0.5b' })).toBe(false)
  })

  it('flags a non-loopback address as not local', () => {
    expect(new OllamaProvider('http://192.168.1.20:11434').local).toBe(false)
    expect(new OllamaProvider('http://localhost:11434').local).toBe(true)
  })
})
