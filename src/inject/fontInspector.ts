// Font inspector overlay. The main process (services/fonts.ts) evaluates this bundle in a
// tab's isolated world, so page scripts cannot see or call it. Its UI lives in a closed
// shadow root with its own inline styles: page CSS cannot restyle it and page scripts cannot
// read it — the page only ever sees one empty host element.
//
// The main process drives it through `window.__specterFonts` (the isolated world's global):
// start() / stop(), and next(), a promise that resolves with the overlay's next event.
import { formatFamily, parseFontStack, weightName, type FontFamily } from '@shared/fontInspector'

export interface StartOptions {}

export interface InspectorApi {
  start(opts: StartOptions): void
  stop(): void
  next(): Promise<{ type: 'exit' }>
}

declare global {
  interface Window {
    __specterFonts?: InspectorApi
  }
}

const UI_FONT = "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
const MONO_FONT = "'Cascadia Code', 'Cascadia Mono', Consolas, monospace"

// SPECTER Dark tokens (styles/base.css), inlined: the page's CSS variables must not reach the overlay.
const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
.layer { position: fixed; inset: 0; pointer-events: none; font: 400 12px/1.4 ${UI_FONT}; color: #e9ebf0; -webkit-font-smoothing: antialiased; text-align: left; direction: ltr; }
.box { position: fixed; display: none; border: 1px solid rgba(163, 177, 255, 0.85); background: rgba(163, 177, 255, 0.07); border-radius: 2px; }
.tip { position: fixed; display: none; max-width: 340px; padding: 6px 9px 7px; background: #14161b; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 6px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45), 0 1px 4px rgba(0, 0, 0, 0.3); white-space: nowrap; }
.tip-fam { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.tip-meta { margin-top: 2px; font: 400 10.5px/1.3 ${MONO_FONT}; color: #7d8391; }
.bar { position: fixed; top: 10px; right: 10px; display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 5px 0 11px; pointer-events: auto; background: rgba(20, 22, 27, 0.95); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 7px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45); user-select: none; }
.label { font: 400 10px/1 ${MONO_FONT}; letter-spacing: 0.09em; text-transform: uppercase; color: #7d8391; white-space: nowrap; }
.label b { font-weight: 400; color: #a3b1ff; }
.hint { font-size: 11.5px; color: #7d8391; white-space: nowrap; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 22px; padding: 0 8px; border-radius: 5px; border: 1px solid rgba(255, 255, 255, 0.12); background: #191c22; color: #e9ebf0; font: 500 11.5px/1 ${UI_FONT}; cursor: pointer; white-space: nowrap; }
.btn:hover { background: #20242c; }
.btn.icon { width: 22px; padding: 0; font-size: 14px; }
@media (max-width: 560px) { .hint { display: none; } }
`

window.__specterFonts ??= createInspector()

function createInspector(): InspectorApi {
  let host: HTMLElement | null = null
  let tip: HTMLElement
  let tipFam: HTMLElement
  let tipMeta: HTMLElement
  let box: HTMLElement
  let frame = 0
  let pointer = { x: -1, y: -1 }

  // ------------------------------------------------------------ events for the main process
  const queue: { type: 'exit' }[] = []
  let waiter: ((ev: { type: 'exit' }) => void) | null = null
  const emit = (ev: { type: 'exit' }) => {
    if (waiter) {
      const w = waiter
      waiter = null
      w(ev)
    } else queue.push(ev)
  }

  // ------------------------------------------------------------ which family renders?
  // Estimate: the first family in the stack the browser can render. The main process
  // refines this with the platform font Chromium actually used where it can.
  const canvas = document.createElement('canvas').getContext('2d')
  const availability = new Map<string, boolean>()
  let webFamilies: Set<string> | null = null
  document.fonts.addEventListener('loadingdone', () => {
    availability.clear()
    webFamilies = null
  })
  const isWebFamily = (name: string) => {
    if (!webFamilies) {
      webFamilies = new Set()
      document.fonts.forEach((f) => webFamilies!.add(unquote(f.family).toLowerCase()))
    }
    return webFamilies.has(name.toLowerCase())
  }
  const available = (name: string, weight: string, style: string): boolean => {
    const key = `${name.toLowerCase()}|${weight}|${style}`
    const hit = availability.get(key)
    if (hit !== undefined) return hit
    const family = formatFamily({ name, generic: false })
    let ok = false
    if (isWebFamily(name)) {
      // A web font renders only once a matching face has loaded.
      try {
        ok = document.fonts.check(`${style} ${weight} 16px ${family}`)
      } catch {
        ok = false
      }
    } else if (canvas) {
      // A local font renders if text measures differently from both fallbacks.
      const probe = 'mmmmmmmmmmlli1WQ@#&'
      for (const base of ['monospace', 'serif']) {
        canvas.font = `${style} ${weight} 72px ${base}`
        const w0 = canvas.measureText(probe).width
        canvas.font = `${style} ${weight} 72px ${family}, ${base}`
        if (canvas.measureText(probe).width !== w0) {
          ok = true
          break
        }
      }
    }
    availability.set(key, ok)
    return ok
  }
  const renderedFamily = (stack: FontFamily[], weight: string, style: string): { name: string; index: number } => {
    for (let i = 0; i < stack.length; i++) {
      const f = stack[i]
      if (f.generic || available(f.name, weight, style)) return { name: f.name, index: i }
    }
    return { name: 'Browser default', index: -1 }
  }

  // ------------------------------------------------------------ element under the cursor
  const ownsEvent = (e: Event) => !!host && e.composedPath().includes(host)
  const hasOwnText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.nodeValue!.trim())
  const FORM = new Set(['input', 'textarea', 'select', 'button'])
  const textElementAt = (x: number, y: number): Element | null => {
    const pos = document.caretPositionFromPoint?.(x, y)
    const node = pos?.offsetNode
    if (node && node.nodeType === Node.TEXT_NODE && node.nodeValue!.trim()) {
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const r of range.getClientRects()) if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return node.parentElement
    }
    const el = document.elementFromPoint(x, y)
    if (!el || el === host) return null
    return FORM.has(el.localName) || hasOwnText(el) ? el : null
  }

  const describe = (el: Element) => {
    const cs = getComputedStyle(el)
    const stack = parseFontStack(cs.fontFamily)
    return { cs, stack, rendered: renderedFamily(stack, cs.fontWeight, cs.fontStyle) }
  }

  // ------------------------------------------------------------ hover
  const hideHover = () => {
    tip.style.display = 'none'
    box.style.display = 'none'
  }
  const outline = (el: Element) => {
    const r = el.getBoundingClientRect()
    Object.assign(box.style, { display: 'block', left: r.left - 2 + 'px', top: r.top - 2 + 'px', width: r.width + 4 + 'px', height: r.height + 4 + 'px' })
  }
  const updateHover = () => {
    frame = 0
    const el = textElementAt(pointer.x, pointer.y)
    if (!el) return hideHover()
    const { cs, rendered } = describe(el)
    tipFam.textContent = rendered.name
    tipMeta.textContent = `${Math.round(parseFloat(cs.fontSize) * 10) / 10}px · ${cs.fontWeight} ${weightName(cs.fontWeight)}${cs.fontStyle !== 'normal' ? ' · ' + cs.fontStyle : ''}`
    tip.style.display = 'block'
    const tw = tip.offsetWidth
    const th = tip.offsetHeight
    const x = pointer.x + 14 + tw > innerWidth - 6 ? pointer.x - 10 - tw : pointer.x + 14
    const y = pointer.y + 18 + th > innerHeight - 6 ? pointer.y - 10 - th : pointer.y + 18
    tip.style.left = Math.max(4, x) + 'px'
    tip.style.top = Math.max(4, y) + 'px'
    outline(el)
  }

  const onMove = (e: MouseEvent) => {
    pointer = { x: e.clientX, y: e.clientY }
    if (ownsEvent(e)) return hideHover()
    if (!frame) frame = requestAnimationFrame(updateHover)
  }
  const onScroll = () => hideHover()
  const swallow = (e: MouseEvent) => {
    if (ownsEvent(e) || e.button !== 0) return
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopImmediatePropagation()
    api.stop()
  }
  const listeners: [string, (e: any) => void][] = [
    ['mousemove', onMove],
    ['pointerdown', swallow],
    ['mousedown', swallow],
    ['pointerup', swallow],
    ['mouseup', swallow],
    ['click', swallow],
    ['dblclick', swallow],
    ['keydown', onKey],
    ['scroll', onScroll],
    ['blur', onScroll]
  ]

  // ------------------------------------------------------------ mount / unmount
  const mount = () => {
    host = document.createElement('specter-font-inspector')
    // Inline !important beats any page rule aimed at the host; nothing inherits into the shadow tree.
    host.style.setProperty('all', 'initial', 'important')
    for (const [k, v] of Object.entries({ position: 'fixed', top: '0', left: '0', width: '0', height: '0', 'z-index': '2147483647', display: 'block', 'pointer-events': 'none' })) host.style.setProperty(k, v, 'important')
    const shadow = host.attachShadow({ mode: 'closed' })
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(CSS) // constructed sheets aren't subject to the page's style-src CSP
    shadow.adoptedStyleSheets = [sheet]
    const layer = el('div', 'layer')
    box = el('div', 'box')
    tip = el('div', 'tip')
    tipFam = el('div', 'tip-fam')
    tipMeta = el('div', 'tip-meta')
    tip.append(tipFam, tipMeta)
    const bar = el('div', 'bar')
    const title = el('span', 'label')
    title.append('Font inspector ', el('b', '', '●'))
    const exit = el('button', 'btn icon', '×')
    exit.title = 'Exit (Esc)'
    exit.addEventListener('click', () => api.stop())
    bar.append(title, el('span', 'hint', 'Hover text · Esc to exit'), exit)
    layer.append(box, tip, bar)
    shadow.append(layer)
    document.documentElement.append(host)
    for (const [type, fn] of listeners) window.addEventListener(type, fn, true)
  }

  const api: InspectorApi = {
    start() {
      if (!host || !host.isConnected) {
        host?.remove()
        mount()
      }
    },
    stop() {
      if (!host) return
      for (const [type, fn] of listeners) window.removeEventListener(type, fn, true)
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      host.remove()
      host = null
      emit({ type: 'exit' })
    },
    next() {
      const ev = queue.shift()
      return ev ? Promise.resolve(ev) : new Promise((resolve) => (waiter = resolve))
    }
  }
  return api
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function unquote(family: string): string {
  return family.trim().replace(/^(['"])(.*)\1$/, '$2')
}
