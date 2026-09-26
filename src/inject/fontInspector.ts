// Font inspector overlay. The main process (services/fonts.ts) evaluates this bundle in a
// tab's isolated world, so page scripts cannot see or call it. Its UI lives in a closed
// shadow root with its own inline styles: page CSS cannot restyle it and page scripts cannot
// read it — the page only ever sees one empty host element.
//
// The main process drives it through `window.__specterFonts` (the isolated world's global):
// start() / stop(), next() — a promise that resolves with the overlay's next event — and
// platform() / resolved(), which deliver the fonts Chromium reports for pinned elements
// and for the families in the "Fonts on this page" panel.
import {
  clipText,
  cssSnippet,
  formatFamily,
  formatFontStack,
  lineHeightRatio,
  matchStackEntry,
  parseCssColor,
  parseFontStack,
  rankPlatformFonts,
  tallyFamilies,
  tidyLength,
  toHex,
  weightName,
  type FamilyUse,
  type FontFamily,
  type InspectorEvent,
  type PlatformFont,
  type PlatformResult,
  type StartOptions
} from '@shared/fontInspector'

export interface InspectorApi {
  start(opts?: StartOptions): void
  stop(): void
  /** The main process's answer to a `pin` event: the fonts Chromium used for that card's text. */
  platform(card: number, result: PlatformResult): void
  /** The answer to a `resolve` event: platform fonts for each family row of that scan (null: unavailable). */
  resolved(scan: number, results: (PlatformFont[] | null)[] | null): void
  next(): Promise<InspectorEvent>
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
.btn.on { border-color: rgba(163, 177, 255, 0.45); background: rgba(163, 177, 255, 0.14); color: #a3b1ff; }
.btn.primary { background: #a3b1ff; border-color: #a3b1ff; color: #0c0d10; }
.btn.primary:hover { background: #b8c3ff; }
.card { position: fixed; width: 296px; pointer-events: auto; background: #14161b; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.35); overflow: hidden; user-select: text; cursor: default; }
.card-h { display: flex; align-items: flex-start; gap: 8px; padding: 9px 8px 9px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.065); cursor: grab; user-select: none; }
.card-h.dragging { cursor: grabbing; }
.card-titles { flex: 1; min-width: 0; }
.card-name { display: flex; align-items: center; gap: 7px; margin-top: 5px; font-size: 15px; font-weight: 600; line-height: 1.2; }
.card-name > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge { flex: none; display: inline-flex; align-items: center; height: 16px; padding: 0 5px; border-radius: 4px; font: 400 9.5px/1 ${MONO_FONT}; letter-spacing: 0.05em; text-transform: uppercase; background: #20242c; color: #b3b8c3; }
.badge.ok { background: rgba(95, 211, 154, 0.12); color: #5fd39a; }
.note { margin-top: 5px; font-size: 11px; line-height: 1.35; color: #7d8391; }
.sample { padding: 10px 12px; background: #0c0d10; color: #e9ebf0; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: 1px solid rgba(255, 255, 255, 0.065); }
.rows { display: grid; grid-template-columns: 86px 1fr; gap: 6px 10px; padding: 10px 12px; }
.rows .label { line-height: 17px; }
.v { font-size: 12px; line-height: 17px; color: #b3b8c3; overflow-wrap: anywhere; }
.mono { font: 400 11.5px/17px ${MONO_FONT}; }
.stack .used { color: #a3b1ff; font-weight: 600; }
.stack .missing { color: #545a67; text-decoration: line-through; }
.stack .rest { color: #7d8391; }
.swatch { display: inline-block; width: 11px; height: 11px; margin-right: 6px; vertical-align: -1px; border-radius: 3px; border: 1px solid rgba(255, 255, 255, 0.25); }
.card-f { display: flex; align-items: center; gap: 8px; padding: 7px 8px 7px 12px; border-top: 1px solid rgba(255, 255, 255, 0.065); }
.panel { position: fixed; top: 50px; right: 10px; width: 340px; max-height: calc(100vh - 64px); display: none; flex-direction: column; pointer-events: auto; background: #14161b; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.35); overflow: hidden; }
.panel.open { display: flex; }
.panel-h { display: flex; align-items: center; gap: 8px; padding: 9px 8px 9px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.065); }
.panel-h .card-titles .meta { margin-top: 4px; font-size: 11px; color: #7d8391; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.panel-b { overflow-y: auto; padding: 4px 0 8px; user-select: text; }
.section { padding: 10px 12px 4px; }
.fam { display: block; width: 100%; padding: 7px 12px; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.fam:hover { background: #191c22; }
.fam-top { display: flex; align-items: baseline; gap: 8px; }
.fam-name { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; color: #e9ebf0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fam-name .via { font-weight: 400; color: #7d8391; }
.count { font: 400 11px/1 ${MONO_FONT}; color: #7d8391; }
.fam-sample { margin-top: 3px; font-size: 17px; line-height: 1.3; color: #b3b8c3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fam-meta { margin-top: 3px; font: 400 10.5px/1.35 ${MONO_FONT}; color: #545a67; overflow-wrap: anywhere; }
.face { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 5px 12px; }
.face .fam-name { flex: 0 1 auto; font-weight: 500; }
.badge.bad { background: rgba(255, 107, 115, 0.12); color: #ff6b73; }
.empty { padding: 6px 12px; font-size: 11.5px; color: #7d8391; }
.tag { flex: 1; min-width: 0; font: 400 10.5px/1.2 ${MONO_FONT}; color: #545a67; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 560px) { .hint { display: none; } }
`

window.__specterFonts ??= createInspector()

function createInspector(): InspectorApi {
  let host: HTMLElement | null = null
  let tip: HTMLElement
  let tipFam: HTMLElement
  let tipMeta: HTMLElement
  let box: HTMLElement
  let layer: HTMLElement
  let frame = 0
  let placing = 0
  let pointer = { x: -1, y: -1 }

  // ------------------------------------------------------------ events for the main process
  const queue: InspectorEvent[] = []
  let waiter: ((ev: InspectorEvent) => void) | null = null
  const emit = (ev: InspectorEvent) => {
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
  // Computed colours are usually rgb(); for others (oklch(), color()) let the canvas convert to sRGB.
  const colorHex = (value: string): string => {
    const c = parseCssColor(value)
    if (c) return toHex(c)
    if (!canvas) return value
    canvas.clearRect(0, 0, 1, 1)
    canvas.fillStyle = value
    canvas.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data
    return toHex({ r, g, b, a: a / 255 })
  }

  // ------------------------------------------------------------ element under the cursor
  const ownsEvent = (e: Event) => !!host && e.composedPath().includes(host)
  const hasOwnText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.nodeValue!.trim())
  const FORM = new Set(['input', 'textarea', 'select', 'button'])
  const textElementAt = (x: number, y: number): Element | null => {
    let el = document.elementFromPoint(x, y)
    if (!el || el === host) return null
    // Descend into open shadow trees (web components) to the element really under the pointer.
    const shadowRoots: ShadowRoot[] = []
    while (el.shadowRoot) {
      const inner: Element | null = el.shadowRoot.elementFromPoint(x, y)
      if (!inner || inner === el) break
      shadowRoots.push(el.shadowRoot)
      el = inner
    }
    const node = document.caretPositionFromPoint?.(x, y, { shadowRoots })?.offsetNode
    if (node && node.nodeType === Node.TEXT_NODE && node.nodeValue!.trim()) {
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const r of range.getClientRects()) if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return node.parentElement
    }
    return FORM.has(el.localName) || hasOwnText(el) ? el : null
  }

  const describe = (el: Element) => {
    const cs = getComputedStyle(el)
    const stack = parseFontStack(cs.fontFamily)
    return { cs, stack, rendered: renderedFamily(stack, cs.fontWeight, cs.fontStyle) }
  }

  // ------------------------------------------------------------ pinned cards
  interface Card {
    root: HTMLElement
    target: Element
    /** Offset from the element's box, and that box's last known position (kept if the element goes away). */
    dx: number
    dy: number
    ax: number
    ay: number
    stack: FontFamily[]
    stackSpans: HTMLElement[]
    estimate: { name: string; index: number }
    name: HTMLElement
    badge: HTMLElement
    note: HTMLElement
  }
  const cards = new Map<number, Card>()
  let zTop = 1
  let lastCard = 0
  const tagOf = (e: Element) => clipText(e.localName + (e.id ? '#' + e.id : '') + [...e.classList].slice(0, 2).map((c) => '.' + c).join(''), 48)
  const row = (parent: HTMLElement, label: string, value: string | Node, cls = 'v') => {
    const v = el('div', cls)
    v.append(value)
    parent.append(el('div', 'label', label), v)
    return v
  }
  // Cards follow their element when the page (or any scroller) moves.
  const place = (c: Card) => {
    if (c.target.isConnected) {
      const r = c.target.getBoundingClientRect()
      c.ax = r.left
      c.ay = r.top
    }
    c.root.style.left = c.ax + c.dx + 'px'
    c.root.style.top = c.ay + c.dy + 'px'
  }
  const draggable = (c: Card, handle: HTMLElement) =>
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as Element).closest('button')) return
      e.preventDefault()
      handle.setPointerCapture(e.pointerId)
      handle.classList.add('dragging')
      let last = { x: e.clientX, y: e.clientY }
      const move = (m: PointerEvent) => {
        c.dx += m.clientX - last.x
        c.dy += m.clientY - last.y
        last = { x: m.clientX, y: m.clientY }
        place(c)
      }
      const up = () => {
        handle.classList.remove('dragging')
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
        handle.removeEventListener('pointercancel', up)
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
      handle.addEventListener('pointercancel', up)
    })
  const placeAll = () => {
    placing = 0
    cards.forEach(place)
  }
  const markStack = (c: Card, used: number) =>
    c.stackSpans.forEach((s, i) => {
      s.className = i === used ? 'used' : i < used || used < 0 ? 'missing' : 'rest'
      s.title = s.className === 'missing' ? 'Not available on this page' : ''
    })
  // A structural path the main process can resolve with DOM.querySelector; null inside shadow trees.
  const selectorFor = (e: Element): string | null => {
    if (e.getRootNode() !== document) return null
    const parts: string[] = []
    for (let n: Element = e; n !== document.documentElement; n = n.parentElement!) parts.unshift(`:nth-child(${[...n.parentElement!.children].indexOf(n) + 1})`)
    return [':root', ...parts].join(' > ')
  }

  const showPlatform = (c: Card, result: PlatformResult) => {
    const fonts = 'fonts' in result ? rankPlatformFonts(result.fonts) : []
    if (!fonts.length) {
      c.note.textContent =
        'error' in result && result.error === 'unavailable'
          ? 'Platform font unavailable — another tool is using the DevTools protocol on this tab. Estimated from the fonts this page can load.'
          : 'No text of its own to measure. Estimated from the fonts this page can load.'
      return
    }
    const [main, ...others] = fonts
    c.name.firstChild!.textContent = main.family
    c.badge.textContent = 'Platform'
    c.badge.className = 'badge ok'
    c.badge.title = 'Reported by Chromium: the font file that drew these glyphs'
    const used = matchStackEntry(c.stack, main.family)
    // Web fonts carry the family name from their font file, which needn't match the CSS name.
    if (used >= 0 || !main.custom) markStack(c, used >= 0 ? used : c.estimate.index)
    const via = used < 0 && !main.custom && c.stack[c.estimate.index]?.generic ? ` · via ${c.stack[c.estimate.index].name}` : ''
    const parts = [`${main.postScriptName || main.family} · ${main.custom ? 'web font' : 'installed'}${via} · ${main.glyphs} glyph${main.glyphs === 1 ? '' : 's'}`]
    if (others.length) parts.push('Also ' + others.map((f) => `${f.family} (${f.glyphs})`).join(', '))
    c.note.textContent = parts.join('. ')
    // The note can make the card taller; keep it on screen.
    const r = c.root.getBoundingClientRect()
    if (r.bottom > innerHeight - 8) {
      c.dy -= Math.min(r.bottom - (innerHeight - 8), r.top - 8)
      place(c)
    }
  }

  const pin = (x: number, y: number) => {
    const target = textElementAt(x, y)
    if (!target) return
    const { cs, stack, rendered } = describe(target)
    const info = { family: cs.fontFamily, size: cs.fontSize, weight: cs.fontWeight, style: cs.fontStyle, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, color: colorHex(cs.color) }
    const root = el('div', 'card')

    const head = el('div', 'card-h')
    const titles = el('div', 'card-titles')
    const name = el('div', 'card-name')
    const badge = el('span', 'badge', 'Estimate')
    badge.title = 'The first family in the stack this page can render'
    const note = el('div', 'note', 'Asking Chromium which font it used…')
    name.append(el('span', '', rendered.name), badge)
    titles.append(el('div', 'label', 'Rendered with'), name, note)
    const id = ++lastCard
    const close = el('button', 'btn icon', '×')
    close.title = 'Unpin'
    close.addEventListener('click', () => {
      root.remove()
      cards.delete(id)
      hold(null)
    })
    head.append(titles, close)

    const sample = el('div', 'sample', clipText(target.textContent || (target as HTMLInputElement).value || 'Aa Bb Cc 0123', 60))
    sample.style.fontFamily = info.family
    sample.style.fontWeight = info.weight
    sample.style.fontStyle = info.style
    sample.style.fontSize = Math.min(30, Math.max(14, parseFloat(info.size) || 16)) + 'px'

    const rows = el('div', 'rows')
    const stackEl = el('span', 'stack')
    const stackSpans = stack.map((f, i) => {
      if (i) stackEl.append(', ')
      return stackEl.appendChild(el('span', '', formatFamily(f)))
    })
    row(rows, 'Family', stackEl)
    const card: Card = { root, target, dx: 0, dy: 0, ax: 0, ay: 0, stack, stackSpans, estimate: rendered, name, badge, note }
    draggable(card, head)
    markStack(card, rendered.index)
    row(rows, 'Style', info.style)
    row(rows, 'Weight', `${info.weight} · ${weightName(info.weight)}`)
    row(rows, 'Size', tidyLength(info.size))
    const ratio = lineHeightRatio(info.lineHeight, info.size)
    row(rows, 'Line height', tidyLength(info.lineHeight) + (ratio ? ` · ${ratio}` : ''))
    row(rows, 'Letter sp.', tidyLength(info.letterSpacing))
    const swatch = el('span', 'swatch')
    swatch.style.background = info.color
    const colour = row(rows, 'Colour', swatch, 'v mono')
    colour.append(info.color)

    const foot = el('div', 'card-f')
    const copy = el('button', 'btn primary', 'Copy CSS')
    copy.addEventListener('click', () => {
      emit({ type: 'copy', text: cssSnippet(info) })
      copy.textContent = 'Copied'
      setTimeout(() => (copy.textContent = 'Copy CSS'), 1200)
    })
    foot.append(el('span', 'tag', tagOf(target)), copy)

    root.append(head, sample, rows, foot)
    root.style.zIndex = String(++zTop)
    root.addEventListener('pointerdown', () => (root.style.zIndex = String(++zTop)))
    root.addEventListener('mouseenter', () => hold(target))
    root.addEventListener('mouseleave', () => hold(null))
    layer.append(root)
    cards.set(id, card)

    const w = root.offsetWidth
    const h = root.offsetHeight
    const left = x + 14 + w > innerWidth - 8 ? Math.max(8, x - 14 - w) : x + 14
    const top = Math.max(8, Math.min(y + 14, innerHeight - 8 - h))
    const r = target.getBoundingClientRect()
    card.dx = left - r.left
    card.dy = top - r.top
    place(card)
    hideHover()
    emit({ type: 'pin', card: id, target: { selector: selectorFor(target), x: Math.round(x), y: Math.round(y), localName: target.localName } })
  }

  // ------------------------------------------------------------ fonts on this page
  let panel: HTMLElement
  let panelBody: HTMLElement
  let panelMeta: HTMLElement
  let panelButton: HTMLElement
  let scanId = 0
  let familyRows: { name: HTMLElement; estimate: string }[] = []
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'textarea'])

  /** Every element with visible text of its own, grouped by the family that renders it. */
  const scanPage = () => {
    const uses: FamilyUse[] = []
    const firstUse = new Map<string, { el: Element; stack: string; weight: string; style: string }>()
    const track = (e: Element) => {
      if (!e.checkVisibility()) return
      const cs = getComputedStyle(e)
      const family = renderedFamily(parseFontStack(cs.fontFamily), cs.fontWeight, cs.fontStyle).name
      uses.push({ family, stack: cs.fontFamily, weight: cs.fontWeight, sample: e.textContent ?? '' })
      if (!firstUse.has(family)) firstUse.set(family, { el: e, stack: cs.fontFamily, weight: cs.fontWeight, style: cs.fontStyle })
    }
    const seen = new Set<Element>()
    // Open shadow trees (web components) are walked too.
    const roots: Node[] = [document.body ?? document.documentElement]
    for (let i = 0; i < roots.length && seen.size < 5000; i++) {
      const walker = document.createTreeWalker(roots[i], NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n && seen.size < 5000; n = walker.nextNode()) {
        if (n instanceof Element) {
          if (n.shadowRoot) roots.push(n.shadowRoot)
          continue
        }
        const e = n.parentElement
        if (!e || seen.has(e) || SKIP.has(e.localName) || !n.nodeValue!.trim()) continue
        seen.add(e)
        track(e)
      }
    }
    return { families: tallyFamilies(uses), firstUse, elements: uses.length }
  }

  const renderPanel = () => {
    const { families, firstUse, elements } = scanPage()
    panelMeta.textContent = `${families.length} ${families.length === 1 ? 'family' : 'families'} · ${elements} text elements`
    panelBody.replaceChildren(el('div', 'section label', 'Families in use'))
    familyRows = []
    for (const f of families) {
      const use = firstUse.get(f.family)!
      const rowEl = el('button', 'fam')
      rowEl.title = 'Show the first use'
      const top = el('div', 'fam-top')
      const name = el('span', 'fam-name', f.family)
      familyRows.push({ name, estimate: f.family })
      top.append(name, el('span', 'count', `${f.count} ${f.count === 1 ? 'element' : 'elements'}`))
      const sample = el('div', 'fam-sample', f.sample || 'Aa Bb Cc 0123')
      sample.style.fontFamily = use.stack
      sample.style.fontWeight = use.weight
      sample.style.fontStyle = use.style
      const meta = el('div', 'fam-meta', `${f.stacks.slice(0, 2).map((st) => formatFontStack(parseFontStack(st))).join(' | ')}${f.stacks.length > 2 ? ` | +${f.stacks.length - 2}` : ''} · ${f.weights.join(' ')}`)
      rowEl.append(top, sample, meta)
      rowEl.addEventListener('click', () => {
        use.el.scrollIntoView({ block: 'center', behavior: 'instant' })
        hold(use.el)
      })
      rowEl.addEventListener('mouseleave', () => hold(null))
      panelBody.append(rowEl)
    }
    if (!families.length) panelBody.append(el('div', 'empty', 'No visible text on this page.'))
    // Ask Chromium which platform font each family's first use is drawn with.
    const targets = families.map((f) => {
      const e = firstUse.get(f.family)!.el
      const selector = selectorFor(e)
      return selector ? { selector, x: 0, y: 0, localName: e.localName } : null
    })
    if (targets.length) emit({ type: 'resolve', scan: ++scanId, targets })

    // Web fonts the page declared (@font-face / FontFace), whether or not anything uses them.
    const faces = new Map<string, FontFace[]>()
    document.fonts.forEach((f) => {
      const name = unquote(f.family)
      faces.set(name, [...(faces.get(name) ?? []), f])
    })
    panelBody.append(el('div', 'section label', `Web fonts · ${faces.size}`))
    if (!faces.size) panelBody.append(el('div', 'empty', 'None — everything here is drawn with installed fonts.'))
    for (const [name, list] of [...faces].sort((a, b) => a[0].localeCompare(b[0]))) {
      const rowEl = el('div', 'face')
      const title = el('span', 'fam-name', name)
      if (list.some((f) => f.status === 'loaded')) title.style.fontFamily = formatFamily({ name, generic: false }) + ', sans-serif'
      rowEl.append(title)
      for (const f of list) {
        const b = el('span', 'badge' + (f.status === 'loaded' ? ' ok' : f.status === 'error' ? ' bad' : ''), `${f.weight === 'normal' ? '400' : f.weight}${f.style !== 'normal' ? ' ' + f.style : ''}`)
        b.title = f.status === 'loaded' ? 'Loaded' : f.status === 'error' ? 'Failed to load' : f.status === 'loading' ? 'Loading' : 'Declared, not used yet'
        rowEl.append(b)
      }
      panelBody.append(rowEl)
    }
  }
  const togglePanel = (open = !panel.classList.contains('open')) => {
    panel.classList.toggle('open', open)
    panelButton.classList.toggle('on', open)
    if (open) renderPanel()
  }

  // ------------------------------------------------------------ hover
  // The element whose card (or panel row) is under the pointer stays outlined.
  let held: Element | null = null
  const outline = (el: Element) => {
    const r = el.getBoundingClientRect()
    Object.assign(box.style, { display: 'block', left: r.left - 2 + 'px', top: r.top - 2 + 'px', width: r.width + 4 + 'px', height: r.height + 4 + 'px' })
  }
  const hold = (el: Element | null) => {
    held = el
    if (el) outline(el)
    else box.style.display = 'none'
  }
  const hideHover = () => {
    tip.style.display = 'none'
    if (held) outline(held)
    else box.style.display = 'none'
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
  const onScroll = () => {
    hideHover()
    if (cards.size && !placing) placing = requestAnimationFrame(placeAll)
  }
  const swallow = (e: MouseEvent) => {
    if (ownsEvent(e) || e.button !== 0) return
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  const onClick = (e: MouseEvent) => {
    if (ownsEvent(e) || e.button !== 0) return
    swallow(e)
    pin(e.clientX, e.clientY)
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
    ['click', onClick],
    ['dblclick', swallow],
    ['keydown', onKey],
    ['scroll', onScroll],
    ['resize', onScroll],
    ['blur', hideHover]
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
    layer = el('div', 'layer')
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
    panelButton = el('button', 'btn', 'Fonts on page')
    panelButton.addEventListener('click', () => togglePanel())
    bar.append(title, el('span', 'hint', 'Hover text · click to pin · Esc to exit'), panelButton, exit)

    panel = el('div', 'panel')
    const panelHead = el('div', 'panel-h')
    panelMeta = el('div', 'meta')
    const panelTitles = el('div', 'card-titles')
    panelTitles.append(el('div', 'label', 'Fonts on this page'), panelMeta)
    const refresh = el('button', 'btn', 'Rescan')
    refresh.addEventListener('click', () => renderPanel())
    const closePanel = el('button', 'btn icon', '×')
    closePanel.title = 'Close'
    closePanel.addEventListener('click', () => togglePanel(false))
    panelHead.append(panelTitles, refresh, closePanel)
    panelBody = el('div', 'panel-b')
    panel.append(panelHead, panelBody)
    layer.append(box, tip, panel, bar)
    shadow.append(layer)
    document.documentElement.append(host)
    for (const [type, fn] of listeners) window.addEventListener(type, fn, true)
  }

  const api: InspectorApi = {
    start(opts) {
      if (!host || !host.isConnected) {
        host?.remove()
        mount()
      }
      if (opts?.at) pin(opts.at.x, opts.at.y)
      if (opts?.panel) togglePanel(true)
    },
    stop() {
      if (!host) return
      for (const [type, fn] of listeners) window.removeEventListener(type, fn, true)
      cancelAnimationFrame(frame)
      cancelAnimationFrame(placing)
      frame = placing = 0
      cards.clear()
      host.remove()
      host = null
      emit({ type: 'exit' })
    },
    platform(id, result) {
      const c = cards.get(id)
      if (c) showPlatform(c, result)
    },
    resolved(scan, results) {
      if (scan !== scanId) return // a newer scan replaced these rows
      if (!results) {
        panelMeta.textContent += ' · estimated (DevTools protocol in use)'
        return
      }
      results.forEach((fonts, i) => {
        const row = familyRows[i]
        const main = fonts?.length ? rankPlatformFonts(fonts)[0] : null
        if (!row || !main) return
        row.name.textContent = main.family
        row.name.title = `${main.postScriptName} · ${main.custom ? 'web font' : 'installed'} (reported by Chromium)`
        if (main.family.toLowerCase() !== row.estimate.toLowerCase()) row.name.append(el('span', 'via', main.custom ? ` · web font “${row.estimate}”` : ` · via ${row.estimate}`))
      })
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
