// Local AI module — shared types and IPC contract augmentation.
//
// AI is optional and local-first: the main process talks to an Ollama server
// (default http://127.0.0.1:11434). Nothing is sent anywhere unless the user
// explicitly triggers a request, and only the context items the user selected
// are gathered.

export type AiPermission = 'read' | 'suggest' | 'write' | 'execute'

export interface AiStatus {
  enabled: boolean
  provider: string
  /** Server reachable. */
  running: boolean
  /** Chat-capable models (embedding-only models are excluded). */
  models: string[]
  /** Embedding models reported by the server. */
  embeddingModels: string[]
  /** Resolved chat model (setting, or first available). */
  model: string | null
  url: string
  /** True when the provider address is this computer (loopback). */
  local: boolean
  /** Ollama executable found on this machine (null = unknown). */
  installed: boolean | null
  version?: string
  error?: string
  /** Machine-readable failure reason for tailored UI. */
  reason?: 'disabled' | 'not-installed' | 'not-running' | 'no-models' | 'model-missing' | 'bad-url' | 'error'
  checkedAt: number
}

export type AiContextKind = 'page' | 'selection' | 'tab' | 'workspace' | 'notes' | 'agent'

/** What the renderer asks the main process to gather. Only these items are ever read. */
export interface AiContextRequest {
  /** Current page. wcId null = the focused tab of the last focused window. */
  page?: { wcId: number | null; url?: string; title?: string }
  /** Selected text: either explicit text, or read from the page's current selection. */
  selection?: { text?: string; wcId?: number | null; url?: string; title?: string }
  /** Other open tabs. wcId null = tab is sleeping/internal (only title + URL are sent). */
  tabs?: { wcId: number | null; url: string; title: string }[]
  /** Workspace overview (names and URLs of its tabs — no page content). */
  workspace?: { name: string; tabs: { url: string; title: string }[] }
  /** Notes pasted or attached by the user. */
  notes?: { text: string; label?: string }
}

/** A gathered context item exactly as it will be placed in the prompt. */
export interface AiContextItem {
  /** Citation id, e.g. "C1". */
  id: string
  kind: AiContextKind
  label: string
  url?: string
  text: string
  /** Characters before truncation. */
  originalChars: number
  truncated: boolean
  /** Why the item has no content (e.g. sleeping tab). */
  note?: string
}

/** Metadata persisted with a message (no page text is stored). */
export type AiContextMeta = Omit<AiContextItem, 'text'> & { chars: number }

export interface AiContextPreview {
  items: AiContextItem[]
  totalChars: number
  budgetChars: number
  approxTokens: number
  errors: string[]
}

export interface AiChatRequest {
  conversationId?: string | null
  /** The user's message, exactly as shown in the transcript. */
  prompt: string
  /** Quick action id (for titles / analytics-free labelling only). */
  action?: string
  model?: string
  context: AiContextRequest
}

export interface AiChatStart {
  requestId: string
  conversationId: string
  userMessageId: string
  assistantMessageId: string
  model: string
  context: AiContextMeta[]
}

export interface AiChunk {
  requestId: string
  conversationId?: string
  delta: string
  done: boolean
  error?: string
  /** Agent pipeline stage label, when running agents. */
  stage?: string
  /** Final stats on done. */
  stats?: { evalTokens?: number; promptTokens?: number; durationMs?: number; stopped?: boolean }
}

export interface AiMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  context: AiContextMeta[]
  model?: string
  status: 'done' | 'streaming' | 'error' | 'stopped'
  error?: string
  createdAt: number
}

export interface AiConversationSummary {
  id: string
  title: string
  model: string
  createdAt: number
  updatedAt: number
  messages: number
}

export interface AiConversation extends AiConversationSummary {
  items: AiMessage[]
}

export interface AiAgentInfo {
  id: string
  name: string
  role: string
  permissions: AiPermission[]
  context: AiContextKind[]
  output: 'markdown' | 'list' | 'table'
  tools: string[]
}

export interface AiAgentRunRequest {
  agents: string[]
  conversationId?: string | null
  model?: string
  context: AiContextRequest
  /** Optional instruction/topic from the user. */
  prompt?: string
}

export interface AiStartResult {
  ok: boolean
  message: string
}

// ---------------------------------------------------------------- quick actions

export interface AiQuickAction {
  id: string
  label: string
  kind: 'text' | 'code' | 'page'
  /** Instruction sent as the user message. */
  prompt: string
}

export const AI_QUICK_ACTIONS: AiQuickAction[] = [
  { id: 'explain', label: 'Explain', kind: 'text', prompt: 'Explain the selected text clearly. Define any jargon.' },
  { id: 'summarize', label: 'Summarize', kind: 'text', prompt: 'Summarize the selected text in a few concise bullet points.' },
  { id: 'simplify', label: 'Simplify', kind: 'text', prompt: 'Rewrite the selected text in plain, simple language without losing meaning.' },
  { id: 'translate', label: 'Translate', kind: 'text', prompt: 'Translate the selected text into {lang}. If it is already in {lang}, translate it into English instead. Output only the translation.' },
  { id: 'rewrite', label: 'Rewrite', kind: 'text', prompt: 'Rewrite the selected text to be clearer and more concise while keeping its meaning and tone.' },
  { id: 'analyze', label: 'Analyze', kind: 'text', prompt: 'Analyze the selected text: main claims, supporting evidence, assumptions and weaknesses.' },
  { id: 'contradictions', label: 'Find contradictions', kind: 'text', prompt: 'List any contradictions, inconsistencies or unsupported claims in the selected text. Quote the conflicting parts. If there are none, say so.' },
  { id: 'sources', label: 'Find sources', kind: 'text', prompt: 'Identify which claims in the selected text would need sources, and list any sources, links or references that the context itself mentions. Do not invent URLs.' },
  { id: 'explain-code', label: 'Explain', kind: 'code', prompt: 'Explain what the selected code does, step by step.' },
  { id: 'debug', label: 'Debug', kind: 'code', prompt: 'Debug the selected code: identify likely errors and explain how to fix them.' },
  { id: 'optimize', label: 'Optimize', kind: 'code', prompt: 'Suggest performance and clarity optimizations for the selected code, with the improved version.' },
  { id: 'refactor', label: 'Refactor', kind: 'code', prompt: 'Refactor the selected code for readability and maintainability. Show the refactored code and explain the changes.' },
  { id: 'tests', label: 'Write tests', kind: 'code', prompt: 'Write unit tests for the selected code covering normal cases, edge cases and failure cases.' },
  { id: 'document', label: 'Document', kind: 'code', prompt: 'Write documentation comments for the selected code and a short usage explanation.' },
  { id: 'bugs', label: 'Find bugs', kind: 'code', prompt: 'Review the selected code for bugs, edge cases and security issues. List each with severity and a fix.' },
  { id: 'page-summary', label: 'Summarize page', kind: 'page', prompt: 'Summarize this page in a few bullet points.' },
  { id: 'page-keypoints', label: 'Key facts', kind: 'page', prompt: 'List the key facts, numbers and names on this page.' },
  { id: 'page-questions', label: 'Open questions', kind: 'page', prompt: 'What important questions does this page leave unanswered?' }
]

export function quickAction(id: string): AiQuickAction | undefined {
  return AI_QUICK_ACTIONS.find((a) => a.id === id)
}

// ---------------------------------------------------------------- suggested actions

/** An action the model proposed. SPECTER never performs it without the user's confirmation. */
export interface AiSuggestion {
  kind: 'open' | 'search' | 'note'
  value: string
}

const SUGGESTION_RE = /^\s*(?:[-*]\s*)?(?:»|>>|→)\s*(open|search|note)\s*:\s*(.+?)\s*$/i

/** Splits "» open: …" / "» search: …" / "» note: …" lines out of an answer. */
export function parseSuggestions(text: string): { body: string; suggestions: AiSuggestion[] } {
  const suggestions: AiSuggestion[] = []
  const keep: string[] = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const m = inFence ? null : SUGGESTION_RE.exec(line)
    if (!m) {
      keep.push(line)
      continue
    }
    const kind = m[1].toLowerCase() as AiSuggestion['kind']
    let value = m[2].replace(/^[`<"']+|[`>"']+$/g, '').trim()
    if (kind === 'open') {
      const url = /https?:\/\/[^\s)>\]"'`]+/i.exec(value)?.[0]
      if (!url) continue
      value = url
    }
    if (value && !suggestions.some((s) => s.kind === kind && s.value === value)) suggestions.push({ kind, value: value.slice(0, 500) })
  }
  return { body: keep.join('\n').replace(/\n{3,}$/g, '\n').trimEnd(), suggestions: suggestions.slice(0, 6) }
}

/** Loopback check for provider URLs ("processed locally" vs "leaves this computer"). */
export function isLoopbackUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase()
    return h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h) || h.endsWith('.localhost')
  } catch {
    return false
  }
}

declare module '../ipc' {
  interface IpcContract {
    'ai:status': (opts?: { refresh?: boolean }) => AiStatus
    'ai:chat': (req: AiChatRequest) => AiChatStart
    'ai:cancel': (requestId: string) => boolean
    'ai:previewContext': (ctx: AiContextRequest) => AiContextPreview
    'ai:conversations': (limit?: number) => AiConversationSummary[]
    'ai:conversation': (id: string) => AiConversation | null
    'ai:deleteConversation': (id: string) => void
    'ai:renameConversation': (id: string, title: string) => void
    'ai:clearConversations': () => number
    'ai:agents': () => AiAgentInfo[]
    'ai:runAgents': (req: AiAgentRunRequest) => AiChatStart
    'ai:startOllama': () => AiStartResult
    /** Local embeddings (default model: setting ai.embeddingModel). For knowledge/semantic search. */
    'ai:embed': (texts: string[], model?: string) => number[][]
  }
  interface IpcEvents {
    'ai:chunk': AiChunk
  }
}
