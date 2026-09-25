// Agent abstraction and built-in agents. Pure (no Electron).
//
// An agent is a persona + instructions run over the user-selected context.
// Agents have no tools that act on the world: `tools` only lists read-only
// capabilities, and every agent's output is plain text shown to the user.
// A pipeline runs agents sequentially; each later agent also sees the earlier
// agents' outputs as extra context items.
import type { AiAgentInfo, AiContextItem, AiContextKind, AiPermission } from '@shared/modules/ai'

export interface Agent {
  id: string
  name: string
  role: string
  systemPrompt: string
  /** Read-only capabilities (documentation; agents never execute anything). */
  tools: string[]
  permissions: AiPermission[]
  /** Context kinds the agent is designed for. */
  context: AiContextKind[]
  output: 'markdown' | 'list' | 'table'
  /** The instruction given as the user turn. */
  task: string
}

export const BUILTIN_AGENTS: Agent[] = [
  {
    id: 'summarizer',
    name: 'Summarizer',
    role: 'Condenses the context into its essential points',
    systemPrompt: 'You write faithful, compact summaries. You never add information that is not in the context.',
    tools: ['read-context'],
    permissions: ['read'],
    context: ['page', 'selection', 'tab', 'notes'],
    output: 'list',
    task: 'Summarize the context in 5–8 bullet points, most important first. Cite items like [C1].'
  },
  {
    id: 'researcher',
    name: 'Researcher',
    role: 'Extracts claims, evidence and open questions',
    systemPrompt: 'You are a careful research analyst. You separate what the sources state from what they merely imply.',
    tools: ['read-context'],
    permissions: ['read', 'suggest'],
    context: ['page', 'selection', 'tab', 'notes'],
    output: 'markdown',
    task: 'List the key claims with the evidence given for each (cite [Cn]). Then list open questions the context does not answer, and what kind of source could answer them.'
  },
  {
    id: 'source-auditor',
    name: 'Source Auditor',
    role: 'Checks how well claims are sourced',
    systemPrompt: 'You audit sourcing quality. You are skeptical, specific and fair.',
    tools: ['read-context'],
    permissions: ['read'],
    context: ['page', 'selection', 'tab'],
    output: 'table',
    task: 'Produce a Markdown table with columns: Claim | Source given in context | Assessment (well-sourced / weakly sourced / unsourced). Only include claims that appear in the context. Finish with one sentence on overall reliability.'
  },
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    role: 'Reviews code for bugs, security and clarity',
    systemPrompt: 'You are a senior software engineer doing a thorough, constructive code review.',
    tools: ['read-context'],
    permissions: ['read', 'suggest'],
    context: ['selection', 'page', 'notes'],
    output: 'list',
    task: 'Review the code in the context. List issues by severity (critical, major, minor) with the affected lines quoted and a concrete fix. If the context contains no code, say so.'
  },
  {
    id: 'data-analyst',
    name: 'Data Analyst',
    role: 'Extracts and interprets numbers and tables',
    systemPrompt: 'You are a precise data analyst. You only use numbers that literally appear in the context.',
    tools: ['read-context'],
    permissions: ['read'],
    context: ['page', 'selection', 'notes', 'tab'],
    output: 'table',
    task: 'Extract the important numbers and metrics from the context into a Markdown table (Metric | Value | Where [Cn]). Then give 2–4 observations. Do not compute or invent values that are not supported by the context.'
  }
]

export function getAgent(id: string): Agent | undefined {
  return BUILTIN_AGENTS.find((a) => a.id === id)
}

export function agentInfo(a: Agent): AiAgentInfo {
  return { id: a.id, name: a.name, role: a.role, permissions: a.permissions, context: a.context, output: a.output, tools: a.tools }
}

/** Resolves ids to agents, dropping unknown ids and duplicates (max 5 stages). */
export function resolvePipeline(ids: string[]): Agent[] {
  const seen = new Set<string>()
  const out: Agent[] = []
  for (const id of ids) {
    const a = getAgent(id)
    if (a && !seen.has(id)) {
      seen.add(id)
      out.push(a)
    }
  }
  return out.slice(0, 5)
}

/** Earlier stage outputs become extra context items (A1, A2…) for later stages. */
export function stageContext(base: AiContextItem[], previous: { agent: Agent; output: string }[], maxCharsEach = 4000): AiContextItem[] {
  const extra = previous.map((p, i) => {
    const t = p.output.length > maxCharsEach ? p.output.slice(0, maxCharsEach) + '\n[truncated]' : p.output
    return { id: 'A' + (i + 1), kind: 'agent' as const, label: p.agent.name, text: t, originalChars: p.output.length, truncated: p.output.length > maxCharsEach }
  })
  return [...base, ...extra]
}

export function stageTask(agent: Agent, userPrompt?: string): string {
  const focus = userPrompt?.trim()
  return focus ? `${agent.task}\n\nFocus: ${focus}` : agent.task
}
