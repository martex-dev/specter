import { describe, expect, it } from 'vitest'
import { buildMessages, buildSystemPrompt, buildUserMessage, titleFrom, trimHistory } from '../../src/main/modules/ai/prompt'
import { fitContext } from '../../src/main/modules/ai/context'
import { resolvePipeline, stageContext, stageTask, BUILTIN_AGENTS } from '../../src/main/modules/ai/agents'
import { parseSuggestions, isLoopbackUrl, quickAction, AI_QUICK_ACTIONS } from '../../src/shared/modules/ai'
import { createProvider, DisabledProvider } from '../../src/main/modules/ai/providers'

describe('system prompt', () => {
  it('demands citations and honesty when context is attached', () => {
    const s = buildSystemPrompt({ permissions: ['read'], hasContext: true, now: new Date('2026-01-02T00:00:00Z') })
    expect(s).toContain('[C1]')
    expect(s).toMatch(/not in the context, say so/)
    expect(s).toMatch(/Never fabricate/)
    expect(s).toMatch(/untrusted data/)
    expect(s).toContain('2026-01-02')
    expect(s).toContain('Do not propose actions')
  })

  it('only advertises suggestion syntax that permissions allow', () => {
    const suggest = buildSystemPrompt({ permissions: ['read', 'suggest'], hasContext: false })
    expect(suggest).toContain('» open:')
    expect(suggest).not.toContain('» note:')
    const write = buildSystemPrompt({ permissions: ['read', 'suggest', 'write', 'execute'], hasContext: false })
    expect(write).toContain('» note:')
    expect(write).toMatch(/never runs commands automatically/)
  })

  it('uses an agent persona when given', () => {
    expect(buildSystemPrompt({ permissions: ['read'], hasContext: true, agent: { name: 'Summarizer', systemPrompt: 'Be brief.' } })).toMatch(/^You are the "Summarizer" agent/)
  })
})

describe('messages', () => {
  const items = fitContext([{ kind: 'page', label: 'Example', url: 'https://example.com', text: 'Body text' }])

  it('puts context before the question in the final user turn', () => {
    const u = buildUserMessage('What is this?', items)
    expect(u.indexOf('[C1]')).toBeLessThan(u.indexOf('QUESTION'))
    expect(u.endsWith('What is this?')).toBe(true)
    expect(buildUserMessage('  plain  ', [])).toBe('plain')
  })

  it('trims history to budget and starts on a user turn', () => {
    const h = [
      { role: 'user' as const, content: 'a'.repeat(50) },
      { role: 'assistant' as const, content: 'b'.repeat(50) },
      { role: 'user' as const, content: 'c'.repeat(50) },
      { role: 'assistant' as const, content: 'd'.repeat(50) }
    ]
    expect(trimHistory(h, 1000)).toHaveLength(4)
    const t = trimHistory(h, 160)
    expect(t[0].role).toBe('user')
    expect(t.map((m) => m.content[0])).toEqual(['c', 'd'])
    expect(trimHistory(h, 10)).toEqual([])
  })

  it('builds system + history + user', () => {
    const m = buildMessages({ system: 'SYS', history: [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }], prompt: 'q2', items })
    expect(m.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(m[3].content).toContain('Body text')
  })

  it('makes short titles', () => {
    expect(titleFrom('Summarize this page', [{ label: 'Example Domain' }])).toBe('Summarize this page — Example Domain')
    expect(titleFrom('x'.repeat(100)).length).toBeLessThanOrEqual(62)
    expect(titleFrom('   ')).toBe('New chat')
  })
})

describe('agents', () => {
  it('has the five built-in agents', () => {
    expect(BUILTIN_AGENTS.map((a) => a.name)).toEqual(['Summarizer', 'Researcher', 'Source Auditor', 'Code Reviewer', 'Data Analyst'])
    for (const a of BUILTIN_AGENTS) expect(a.permissions).toContain('read')
  })

  it('resolves pipelines and feeds earlier output forward', () => {
    const p = resolvePipeline(['summarizer', 'bogus', 'summarizer', 'source-auditor'])
    expect(p.map((a) => a.id)).toEqual(['summarizer', 'source-auditor'])
    const base = fitContext([{ kind: 'page', label: 'P', text: 'content' }])
    const ctx = stageContext(base, [{ agent: p[0], output: 'summary text' }])
    expect(ctx.map((c) => c.id)).toEqual(['C1', 'A1'])
    expect(ctx[1]).toMatchObject({ kind: 'agent', label: 'Summarizer', text: 'summary text' })
    expect(stageTask(p[1], 'pricing')).toMatch(/Focus: pricing$/)
  })
})

describe('suggestions, actions and providers', () => {
  it('extracts suggested actions and strips them from the body', () => {
    const r = parseSuggestions('Answer here.\n\n» open: <https://example.com/a>\n» search: ollama models\n» open: not a url\n```\n» open: https://in-code.test\n```')
    expect(r.suggestions).toEqual([
      { kind: 'open', value: 'https://example.com/a' },
      { kind: 'search', value: 'ollama models' }
    ])
    expect(r.body).toContain('Answer here.')
    expect(r.body).not.toContain('» search')
    expect(r.body).toContain('https://in-code.test')
  })

  it('knows the quick actions the context menu uses', () => {
    for (const id of ['ask', 'explain', 'summarize', 'simplify', 'translate', 'rewrite', 'contradictions', 'sources', 'explain-code', 'debug', 'optimize', 'refactor', 'tests', 'document']) {
      if (id === 'ask') continue
      expect(quickAction(id), id).toBeTruthy()
    }
    expect(AI_QUICK_ACTIONS.some((a) => a.id === 'analyze')).toBe(true)
    expect(AI_QUICK_ACTIONS.some((a) => a.id === 'bugs')).toBe(true)
  })

  it('detects loopback provider URLs', () => {
    expect(isLoopbackUrl('http://127.0.0.1:11434')).toBe(true)
    expect(isLoopbackUrl('http://localhost:11434')).toBe(true)
    expect(isLoopbackUrl('http://[::1]:11434')).toBe(true)
    expect(isLoopbackUrl('http://10.0.0.5:11434')).toBe(false)
    expect(isLoopbackUrl('garbage')).toBe(false)
  })

  it('falls back to the disabled provider', () => {
    expect(createProvider({ enabled: false, provider: 'ollama', url: 'http://127.0.0.1:11434' })).toBeInstanceOf(DisabledProvider)
    expect(createProvider({ enabled: true, provider: 'disabled', url: '' })).toBeInstanceOf(DisabledProvider)
    expect(createProvider({ enabled: true, provider: 'unknown', url: '' })).toBeInstanceOf(DisabledProvider)
    expect(createProvider({ enabled: true, provider: 'ollama', url: 'http://127.0.0.1:11434' }).id).toBe('ollama')
  })
})
