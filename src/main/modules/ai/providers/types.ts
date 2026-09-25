// AI provider abstraction. SPECTER ships only local providers (Ollama). A
// future remote provider must set `remote: true`; the registry refuses to use
// it unless the user explicitly opted in, and the UI must warn that
// "Your context will leave this computer".

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  model: string
  messages: ChatMessage[]
  temperature: number
  numCtx?: number
  signal: AbortSignal
  onDelta: (delta: string) => void
}

export interface ChatResult {
  text: string
  doneReason?: string
  evalTokens?: number
  promptTokens?: number
  durationMs?: number
}

export type ProviderFailure = 'not-running' | 'no-models' | 'model-missing' | 'bad-url' | 'aborted' | 'error' | 'disabled' | 'not-installed'

export interface ProviderStatus {
  running: boolean
  models: string[]
  embeddingModels: string[]
  version?: string
  error?: string
  reason?: ProviderFailure
}

export interface AIProvider {
  readonly id: string
  readonly label: string
  /** Endpoint address shown to the user. */
  readonly url: string
  /** Endpoint is this computer (loopback). */
  readonly local: boolean
  /** Sends data to a third-party service over the internet (requires opt-in). */
  readonly remote: boolean
  status(): Promise<ProviderStatus>
  chat(o: ChatOptions): Promise<ChatResult>
  embed?(model: string, input: string[], signal?: AbortSignal): Promise<number[][]>
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly code: ProviderFailure
  ) {
    super(message)
    this.name = 'AiError'
  }
}

export const UNAVAILABLE_MESSAGE = 'Local AI unavailable — install/start Ollama'
