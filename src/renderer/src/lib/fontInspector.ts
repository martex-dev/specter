// Font inspector, UI side: which tabs have it on, and switching it. The overlay runs inside
// the page (src/inject/fontInspector.ts), driven by the main process (services/fonts.ts).
import type { FontInspectorRequest } from '@shared/fontInspector'
import { invoke } from './ipc'
import { tabIdForWcId, webviewFor } from './webviews'
import { toast } from '../stores/ui'

const active = new Set<number>()

export function fontInspectorOn(wcId: number): boolean {
  return active.has(wcId)
}

/** The main process reports the overlay ended (Esc in the page, navigation, crash). */
export function fontInspectorChanged(p: { wcId: number; active: boolean }): void {
  if (p.active) active.add(p.wcId)
  else active.delete(p.wcId)
}

export async function toggleFontInspector(wcId: number, req?: FontInspectorRequest): Promise<void> {
  try {
    const on = await invoke('guest:fontInspector', wcId, req)
    fontInspectorChanged({ wcId, active: on })
    // Keyboard focus in the page, so Esc reaches the overlay.
    if (on) webviewFor(tabIdForWcId(wcId) ?? undefined)?.focus()
  } catch {
    toast({ kind: 'error', title: "Can't inspect fonts on this page" })
  }
}
