// Keyboard shortcut definitions shared between main (guest input interception)
// and renderer (chrome keydown handling).

export const DEFAULT_KEYBINDINGS: Record<string, string> = {
  'browser.newTab': 'Ctrl+T',
  'browser.closeTab': 'Ctrl+W',
  'browser.reopenClosedTab': 'Ctrl+Shift+T',
  'browser.nextTab': 'Ctrl+Tab',
  'browser.prevTab': 'Ctrl+Shift+Tab',
  'browser.reload': 'Ctrl+R',
  'browser.hardReload': 'Ctrl+Shift+R',
  'browser.reloadF5': 'F5',
  'browser.back': 'Alt+Left',
  'browser.forward': 'Alt+Right',
  'browser.focusAddressBar': 'Ctrl+L',
  'browser.focusAddressBarAlt': 'Alt+D',
  'browser.find': 'Ctrl+F',
  'browser.newWindow': 'Ctrl+N',
  'browser.bookmarkPage': 'Ctrl+D',
  'browser.history': 'Ctrl+H',
  'browser.downloads': 'Ctrl+J',
  'browser.devtoolsDock': 'F12',
  'browser.devtoolsAlt': 'Ctrl+Shift+I',
  'browser.zoomIn': 'Ctrl+=',
  'browser.zoomOut': 'Ctrl+-',
  'browser.zoomReset': 'Ctrl+0',
  'browser.fullscreen': 'F11',
  'browser.print': 'Ctrl+P',
  'browser.savePage': 'Ctrl+S',
  'browser.viewSource': 'Ctrl+U',
  'browser.home': 'Alt+Home',
  'browser.stop': 'Escape',
  'browser.tab1': 'Ctrl+1',
  'browser.tab2': 'Ctrl+2',
  'browser.tab3': 'Ctrl+3',
  'browser.tab4': 'Ctrl+4',
  'browser.tab5': 'Ctrl+5',
  'browser.tab6': 'Ctrl+6',
  'browser.tab7': 'Ctrl+7',
  'browser.tab8': 'Ctrl+8',
  'browser.tabLast': 'Ctrl+9',
  'palette.open': 'Ctrl+K',
  'palette.commands': 'Ctrl+Shift+P',
  'tabs.search': 'Ctrl+Shift+A',
  'workspace.switcher': 'Ctrl+Shift+W',
  'ui.focusMode': 'Ctrl+Shift+F',
  'ai.toggle': 'Alt+Space',
  'capture.quick': 'Ctrl+Shift+C',
  'notes.quick': 'Ctrl+Shift+N',
  'save.toSpecter': 'Ctrl+Shift+S',
  'page.reader': 'Alt+R',
  'page.screenshot': 'Ctrl+Shift+X',
  'ui.toggleSidebar': 'Ctrl+B',
  'ui.toggleBookmarksBar': 'Ctrl+Shift+B',
  'help.open': 'F1',
  'layout.split': 'Ctrl+Alt+S'
}

export interface KeyInput {
  key: string
  /** Physical key (KeyboardEvent.code), used when the layout reports a non-Latin character. */
  code?: string
  control?: boolean
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
}

const KEY_ALIASES: Record<string, string> = {
  arrowleft: 'Left',
  arrowright: 'Right',
  arrowup: 'Up',
  arrowdown: 'Down',
  ' ': 'Space',
  spacebar: 'Space',
  esc: 'Escape',
  escape: 'Escape',
  '+': '=',
  plus: '=',
  add: '=',
  subtract: '-',
  minus: '-',
  _: '-',
  del: 'Delete',
  return: 'Enter'
}

export function normalizeKey(key: string): string {
  const lower = key.toLowerCase()
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower]
  if (key.length <= 1) return key.toUpperCase()
  // F1..F24, Tab, Enter, Home etc.
  return key[0].toUpperCase() + key.slice(1)
}

/** Converts a key event into the canonical "Ctrl+Shift+K" form. */
export function eventToAccelerator(e: KeyInput): string | null {
  let key = normalizeKey(e.key)
  if (['Control', 'Shift', 'Alt', 'Meta', 'Os', 'AltGraph'].includes(key)) return null
  const ctrl = !!(e.control || e.ctrl)
  // Non-Latin layouts (Cyrillic, Greek, ...) report the localized letter for Ctrl+T ("т"),
  // AZERTY reports "&" for Ctrl+1: fall back to the physical key so shortcuts work on
  // every layout. Ctrl+Alt is AltGr on Windows, where the typed character must win.
  if (e.code && !(ctrl && e.alt)) {
    const letter = /^Key([A-Z])$/.exec(e.code)
    const digit = /^Digit(\d)$/.exec(e.code)
    if (letter && !/^[A-Z]$/.test(key)) key = letter[1]
    else if (digit && !/^\d$/.test(key)) key = digit[1]
  }
  const parts: string[] = []
  if (ctrl) parts.push('Ctrl')
  if (e.alt) parts.push('Alt')
  if (e.shift) parts.push('Shift')
  if (e.meta) parts.push('Meta')
  // Shift+digit produces symbols on most layouts; Ctrl+Shift+= comes through as "+"
  parts.push(key === ')' ? '0' : key)
  return parts.join('+')
}

export function normalizeAccelerator(acc: string): string {
  const parts = acc.split('+').map((p) => p.trim()).filter(Boolean)
  // handle "Ctrl++"
  if (acc.endsWith('++')) parts.push('=')
  const mods = new Set<string>()
  let key = ''
  for (const p of parts) {
    const l = p.toLowerCase()
    if (l === 'ctrl' || l === 'control' || l === 'cmdorctrl' || l === 'commandorcontrol') mods.add('Ctrl')
    else if (l === 'alt' || l === 'option') mods.add('Alt')
    else if (l === 'shift') mods.add('Shift')
    else if (l === 'meta' || l === 'cmd' || l === 'super' || l === 'win') mods.add('Meta')
    else key = normalizeKey(p)
  }
  const order = ['Ctrl', 'Alt', 'Shift', 'Meta'].filter((m) => mods.has(m))
  return [...order, key].join('+')
}

export function resolveBindings(overrides: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = { ...DEFAULT_KEYBINDINGS, ...overrides }
  const out: Record<string, string> = {}
  for (const [cmd, acc] of Object.entries(merged)) if (acc) out[cmd] = normalizeAccelerator(acc)
  return out
}

/** Builds accelerator → command lookup. */
export function bindingIndex(bindings: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>()
  for (const [cmd, acc] of Object.entries(bindings)) map.set(acc, cmd)
  return map
}

/**
 * Shortcuts that are safe to swallow even when a web page has focus.
 * Everything else (e.g. Ctrl+F inside Google Docs) still goes to the page first
 * only if we don't claim it; we claim all bound chords except plain keys.
 */
export function isChord(acc: string): boolean {
  return acc.includes('+') || /^F\d{1,2}$/.test(acc)
}

export function prettyAccelerator(acc: string): string {
  return acc
    .replace('Left', '←')
    .replace('Right', '→')
    .replace('Up', '↑')
    .replace('Down', '↓')
    .replace(/(^|\+)=$/, '$1+')
}
