// Overlays contributed by feature modules (e.g. Quick Note).
import type { ComponentType } from 'react'

const extra = new Map<string, ComponentType>()

export function registerOverlay(id: string, component: ComponentType): void {
  extra.set(id, component)
}

export function renderExtraOverlay(overlay: string | null) {
  const C = overlay ? extra.get(overlay) : undefined
  return C ? <C /> : null
}
