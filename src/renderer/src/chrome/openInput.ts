import { activeTab, navigate, newTab } from '../stores/browser'
/** Opens omnibox-style input (URL or search) in the current or a new tab. */
export function openInput(text: string, inNewTab = false): void {
  const t = activeTab()
  if (inNewTab || !t) {
    const id = newTab('specter://newtab')
    navigate(id, text, { fromOmnibox: true })
  } else navigate(t.id, text, { fromOmnibox: true })
}
