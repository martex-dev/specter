// Provider registry. Only local providers ship with SPECTER.
//
// Adding a remote provider later: implement AIProvider with `remote: true`,
// add a descriptor below with `remote: true`. `createProvider` refuses remote
// descriptors unless `remoteOptIn` is explicitly true (a dedicated setting the
// user flips after seeing "Your context will leave this computer"). Paid /
// key-based providers are intentionally not implemented.
import { AiError, type AIProvider, type ChatResult, type ProviderStatus } from './types'
import { OllamaProvider } from './ollama'

export class DisabledProvider implements AIProvider {
  readonly id = 'disabled'
  readonly label = 'Disabled'
  readonly url = ''
  readonly local = true
  readonly remote = false
  async status(): Promise<ProviderStatus> {
    return { running: false, models: [], embeddingModels: [], error: 'AI is disabled in Settings', reason: 'disabled' }
  }
  async chat(): Promise<ChatResult> {
    throw new AiError('AI is disabled in Settings', 'disabled')
  }
}

export interface ProviderDescriptor {
  id: string
  label: string
  remote: boolean
  create: (cfg: { url: string }) => AIProvider
}

export const PROVIDERS: ProviderDescriptor[] = [
  { id: 'ollama', label: 'Ollama (local)', remote: false, create: (cfg) => new OllamaProvider(cfg.url) },
  { id: 'disabled', label: 'Disabled', remote: false, create: () => new DisabledProvider() }
]

export const REMOTE_WARNING = 'Your context will leave this computer'

export function createProvider(cfg: { enabled: boolean; provider: string; url: string; remoteOptIn?: boolean }): AIProvider {
  if (!cfg.enabled) return new DisabledProvider()
  const d = PROVIDERS.find((p) => p.id === cfg.provider)
  if (!d) return new DisabledProvider()
  if (d.remote && !cfg.remoteOptIn) return new DisabledProvider()
  return d.create({ url: cfg.url })
}
