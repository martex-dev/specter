// Internal page registry (specter://<id>). Pages are lazy-loaded so optional
// modules cost nothing until opened.
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface PageProps {
  tabId: string
  url: string
  sub: string
  query: URLSearchParams
}

export interface InternalPage {
  id: string
  title: string
  icon?: LucideIcon
  component: LazyExoticComponent<ComponentType<PageProps>>
  /** Shown in "All tools" listings. */
  listed?: boolean
  category?: string
}

const pages = new Map<string, InternalPage>()

export function registerPage(p: InternalPage): void {
  pages.set(p.id, p)
}

export function getPage(id: string): InternalPage | undefined {
  return pages.get(id)
}

export function listPages(): InternalPage[] {
  return [...pages.values()]
}

export function lazyPage(loader: () => Promise<{ default: ComponentType<PageProps> }>): LazyExoticComponent<ComponentType<PageProps>> {
  return lazy(loader)
}
