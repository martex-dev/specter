// Omnibox suggestion providers. Core providers live here; power-tool modules
// (markets, AI, notes…) register extra providers.
import type { ReactNode } from 'react'
import type { OmniboxScope } from '@shared/url'

export interface OmniItem {
  id: string
  kind: 'url' | 'search' | 'history' | 'bookmark' | 'tab' | 'command' | 'workspace' | 'remote' | 'market' | 'ai' | 'note' | 'other'
  title: string
  subtitle?: string
  icon?: ReactNode
  url?: string
  /** Custom action; when absent, url is navigated. */
  run?: (opts: { newTab: boolean }) => void
  score: number
  /** Text used for inline autocompletion (usually host+path). */
  completion?: string
}

export interface OmniboxProvider {
  id: string
  /** Scopes this provider participates in; 'default' = unscoped typing. */
  scopes: (OmniboxScope | 'default')[]
  provide: (text: string, scope: OmniboxScope | 'default') => OmniItem[] | Promise<OmniItem[]>
}

const providers = new Map<string, OmniboxProvider>()

export function registerOmniboxProvider(p: OmniboxProvider): void {
  providers.set(p.id, p)
}

export function omniboxProviders(scope: OmniboxScope | 'default'): OmniboxProvider[] {
  return [...providers.values()].filter((p) => p.scopes.includes(scope))
}
