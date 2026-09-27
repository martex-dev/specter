/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// Address autofill preload (registered on profile sessions, runs in every web
// page frame's isolated world). It recognises address and contact fields,
// lists saved addresses under the focused one (closed shadow root, invisible
// to the page), fills the form with the address the user picks — requested
// only after a real click or key press — and reports submitted address forms
// so SPECTER can offer to save them. Sign-in fields are left to the password
// manager (preload/passwords.ts).
import { ipcRenderer } from 'electron'
import { classifyField, valueFor, type Address, type AddressKey, type FieldKind } from '@shared/addresses'

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
interface Item {
  id: string
  title: string
  sub: string
}

if (/^https?:$/.test(location.protocol)) {
  try {
    init()
  } catch {
    /* never break a page over autofill */
  }
}

function init(): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  const areaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!

  const isControl = (el: unknown): el is Control => el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement

  function visible(el: HTMLElement): boolean {
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none'
  }

  function labelText(el: Control): string {
    const parts: string[] = []
    if (el.id) for (const l of document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`)) parts.push(l.textContent ?? '')
    const wrap = el.closest('label')
    if (wrap) parts.push(wrap.textContent ?? '')
    const by = el.getAttribute('aria-labelledby')
    if (by) for (const id of by.split(/\s+/)) parts.push(document.getElementById(id)?.textContent ?? '')
    return parts.join(' ').slice(0, 200)
  }

  const kinds = new WeakMap<Control, FieldKind | null>()
  function kindOf(el: Control): FieldKind | null {
    if (kinds.has(el)) return kinds.get(el)!
    const type = el instanceof HTMLInputElement ? el.type : el instanceof HTMLSelectElement ? 'select-one' : 'textarea'
    const text = [el.name, el.id, (el as HTMLInputElement).placeholder ?? '', el.getAttribute('aria-label') ?? '', labelText(el)].join(' ')
    const k = el instanceof HTMLInputElement && ['password', 'hidden', 'checkbox', 'radio', 'submit', 'button', 'file', 'number', 'date'].includes(el.type) ? null : classifyField({ autocomplete: el.getAttribute('autocomplete') ?? '', type, text })
    kinds.set(el, k)
    return k
  }

  /** The address form around a field: its <form>, or the nearest ancestor with several address fields. */
  function fieldsAround(el: Control): { el: Control; kind: FieldKind }[] {
    const collect = (root: ParentNode) =>
      [...root.querySelectorAll<Control>('input, select, textarea')]
        .filter((c) => !c.disabled && visible(c))
        .map((c) => ({ el: c, kind: kindOf(c) }))
        .filter((x): x is { el: Control; kind: FieldKind } => x.kind !== null)
    if (el.form) return collect(el.form)
    let p: Element | null = el.parentElement
    for (let i = 0; p && i < 8; i++, p = p.parentElement) {
      const f = collect(p)
      if (f.length >= 3) return f
    }
    return [{ el, kind: kindOf(el)! }]
  }

  const hasPassword = (el: Control) => !!(el.form ?? el.closest('div, section, main') ?? document).querySelector('input[type=password]')

  /** Worth suggesting addresses on: an address field in a form with other address fields (or an explicit autocomplete). */
  function isAddressField(el: Control): boolean {
    const kind = kindOf(el)
    if (!kind || el.disabled || ('readOnly' in el && el.readOnly)) return false
    // Sign-in and sign-up forms: their email / username field belongs to the password manager.
    if (kind === 'email' && hasPassword(el)) return false
    if (/\b(given-name|family-name|name|street-address|address-line1|postal-code|address-level[12]|tel|email|organization|country)\b/.test(el.getAttribute('autocomplete') ?? '')) return true
    return fieldsAround(el).length >= 3
  }

  // ------------------------------------------------------------ fill

  const regionNames = (() => {
    try {
      return new Intl.DisplayNames([navigator.language || 'en', 'en'], { type: 'region' })
    } catch {
      return null
    }
  })()

  function selectOption(sel: HTMLSelectElement, value: string, kind: FieldKind): boolean {
    const want = value.trim().toLowerCase()
    if (!want) return false
    const alt = kind === 'country' && /^[a-z]{2}$/i.test(value) ? (regionNames?.of(value.toUpperCase()) ?? '').toLowerCase() : ''
    const opts = [...sel.options]
    const hit =
      opts.find((o) => o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want) ??
      (alt ? opts.find((o) => o.text.trim().toLowerCase() === alt) : undefined) ??
      opts.find((o) => want.length > 2 && o.text.trim().toLowerCase().startsWith(want))
    if (!hit || sel.value === hit.value) return !!hit
    sel.value = hit.value
    sel.dispatchEvent(new Event('input', { bubbles: true }))
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }

  function setText(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    if (el.value === value) return
    ;(el instanceof HTMLTextAreaElement ? areaSetter : valueSetter).call(el, value)
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: value }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function fill(anchor: Control, a: Pick<Address, AddressKey>): void {
    const fields = fieldsAround(anchor)
    const present = new Set(fields.map((f) => f.kind))
    const lines = a.street.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    for (const { el, kind } of fields) {
      let v = valueFor(a, kind)
      // Fewer address-line fields than street lines: the last line field takes the rest.
      if (kind === 'line1' && !present.has('line2')) v = lines.join(', ')
      else if (kind === 'line2' && !present.has('line3')) v = lines.slice(1).join(', ')
      if (!v) continue
      // Only empty fields, plus the one the user is in: never overwrite what was typed.
      if (el !== anchor && el.value && !(el instanceof HTMLSelectElement)) continue
      if (el instanceof HTMLSelectElement) selectOption(el, v, kind)
      else {
        if (kind === 'street' && el instanceof HTMLInputElement) v = v.replace(/\n/g, ', ')
        if (kind === 'country' && /^[a-z]{2}$/i.test(v)) v = regionNames?.of(v.toUpperCase()) ?? v
        if (el.maxLength > 0) v = v.slice(0, el.maxLength)
        setText(el, v)
      }
    }
  }

  // ------------------------------------------------------------ suggestions menu

  const CSS_TEXT = `
    :host { all: initial; }
    .m { font: 13px/1.3 "Segoe UI", system-ui, sans-serif; color: #e8e9ee; background: #17181d; border: 1px solid #2c2f38;
         border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,.45); padding: 4px; min-width: 260px; max-width: 420px; overflow: hidden; }
    .i { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 7px; cursor: pointer; }
    .i:hover, .i.s { background: #262932; }
    .k { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: #23262e; color: #7fd4d4; }
    .t { min-width: 0; }
    .u, .h { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .h { font-size: 11px; color: #8b8f9c; }
    .f { border-top: 1px solid #2c2f38; margin-top: 4px; padding: 7px 10px 5px; font-size: 11.5px; color: #8b8f9c; cursor: pointer; }
    .f:hover { color: #e8e9ee; }
  `
  const PIN_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>'

  let menu: { host: HTMLElement; field: Control; items: HTMLElement[]; list: Item[]; sel: number } | null = null

  function hideMenu(): void {
    if (!menu) return
    try {
      menu.host.hidePopover()
    } catch {
      /* already hidden */
    }
    menu.host.remove()
    menu = null
  }

  function place(): void {
    if (!menu) return
    const r = menu.field.getBoundingClientRect()
    if (r.bottom < 0 || r.top > innerHeight || !visible(menu.field)) return hideMenu()
    const h = menu.host.offsetHeight || 60
    const below = r.bottom + 4 + h <= innerHeight || r.top - 4 - h < 0
    menu.host.style.left = Math.max(4, Math.min(r.left, innerWidth - (menu.host.offsetWidth || 280) - 4)) + 'px'
    menu.host.style.top = (below ? r.bottom + 4 : r.top - 4 - h) + 'px'
  }

  async function pick(item: Item, field: Control): Promise<void> {
    hideMenu()
    const a = (await ipcRenderer.invoke('specter-af:fill', item.id).catch(() => null)) as Pick<Address, AddressKey> | null
    if (a) fill(field, a)
  }

  function showMenu(field: Control, list: Item[]): void {
    hideMenu()
    if (!list.length || document.activeElement !== field) return
    const host = document.createElement('specter-autofill-menu')
    host.setAttribute('popover', 'manual')
    host.style.cssText = 'position:fixed;inset:auto;margin:0;padding:0;border:0;background:transparent;overflow:visible;z-index:2147483647;'
    const shadow = host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = CSS_TEXT
    const box = document.createElement('div')
    box.className = 'm'
    box.setAttribute('role', 'listbox')
    const items = list.map((it) => {
      const row = document.createElement('div')
      row.className = 'i'
      row.setAttribute('role', 'option')
      const k = document.createElement('span')
      k.className = 'k'
      k.innerHTML = PIN_SVG
      const t = document.createElement('span')
      t.className = 't'
      const u = document.createElement('div')
      u.className = 'u'
      u.textContent = it.title
      const h = document.createElement('div')
      h.className = 'h'
      h.textContent = it.sub
      t.append(u, h)
      row.append(k, t)
      row.addEventListener('click', (e) => e.isTrusted && void pick(it, field))
      box.append(row)
      return row
    })
    const footer = document.createElement('div')
    footer.className = 'f'
    footer.textContent = 'Manage addresses…'
    footer.addEventListener('click', (e) => {
      if (!e.isTrusted) return
      hideMenu()
      ipcRenderer.send('specter-af:manage')
    })
    box.append(footer)
    box.addEventListener('mousedown', (e) => e.preventDefault())
    shadow.append(style, box)
    document.documentElement.append(host)
    try {
      host.showPopover()
    } catch {
      /* fixed position + z-index still apply */
    }
    menu = { host, field, items, list, sel: -1 }
    place()
  }

  let cache: { at: number; list: Item[] } | null = null
  async function offerFor(field: Control): Promise<void> {
    if (!isAddressField(field)) return
    if (!cache || Date.now() - cache.at > 15_000) {
      const list = (await ipcRenderer.invoke('specter-af:query').catch(() => [])) as Item[]
      cache = { at: Date.now(), list: Array.isArray(list) ? list : [] }
    }
    if (document.activeElement === field && (!menu || menu.field !== field)) showMenu(field, cache.list)
  }

  document.addEventListener(
    'focusin',
    (e) => {
      if (menu && e.target !== menu.field) hideMenu()
      if (e.isTrusted && isControl(e.target) && !(e.target instanceof HTMLSelectElement)) void offerFor(e.target)
    },
    true
  )
  document.addEventListener(
    'focusout',
    (e) => {
      if (menu && e.target === menu.field) setTimeout(() => menu && document.activeElement !== menu.field && hideMenu(), 120)
    },
    true
  )
  document.addEventListener(
    'mousedown',
    (e) => {
      if (e.isTrusted && isControl(e.target) && e.target === document.activeElement && !menu) void offerFor(e.target)
    },
    true
  )
  document.addEventListener(
    'input',
    (e) => {
      if (menu && e.isTrusted && e.target === menu.field) hideMenu()
    },
    true
  )
  addEventListener('scroll', place, { capture: true, passive: true })
  addEventListener('resize', place, { passive: true })
  addEventListener('pagehide', hideMenu)

  // ------------------------------------------------------------ submissions

  let lastSent = { key: '', at: 0 }
  /** Reports what an address form held when it was sent (the main process decides whether it's worth saving). */
  function capture(from: Element): void {
    const control = isControl(from) ? from : (from.closest('form')?.querySelector<Control>('input, select, textarea') ?? null)
    if (!control) return
    const fields: Partial<Record<FieldKind, string>> = {}
    for (const { el, kind } of fieldsAround(control)) {
      const v = el instanceof HTMLSelectElement ? (el.selectedOptions[0]?.text ?? el.value) : el.value
      if (v.trim() && !fields[kind]) fields[kind] = v.trim()
    }
    if (Object.keys(fields).length < 3) return
    const key = JSON.stringify(fields)
    if (key === lastSent.key && Date.now() - lastSent.at < 5000) return
    lastSent = { key, at: Date.now() }
    ipcRenderer.send('specter-af:submitted', fields)
  }

  document.addEventListener('submit', (e) => e.target instanceof HTMLFormElement && capture(e.target), true)
  document.addEventListener(
    'keydown',
    (e) => {
      if (!e.isTrusted) return
      if (menu && e.target === menu.field) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const n = menu.items.length
          menu.sel = menu.sel < 0 ? (e.key === 'ArrowDown' ? 0 : n - 1) : (menu.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
          menu.items.forEach((el, i) => el.classList.toggle('s', i === menu!.sel))
          return
        }
        if (e.key === 'Enter' && menu.sel >= 0) {
          e.preventDefault()
          e.stopImmediatePropagation()
          void pick(menu.list[menu.sel], menu.field)
          return
        }
        if (e.key === 'Escape' || e.key === 'Tab') hideMenu()
      }
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement) capture(e.target)
    },
    true
  )
  document.addEventListener(
    'click',
    (e) => {
      if (!e.isTrusted || !(e.target instanceof Element)) return
      const button = e.target.closest('button, input[type=submit], [role=button]')
      if (!button) return
      const form = button.closest('form')
      if (form) capture(form)
      else if (/continue|next|save|submit|place order|pay|checkout|confirm|ship|deliver|weiter|continuar|suivant/i.test(button.textContent ?? (button as HTMLInputElement).value ?? '')) {
        // Checkout pages without a <form>: the address fields near the button.
        const near = button.closest('section, main, [role=main], div')?.querySelector<Control>('input, select, textarea')
        if (near) capture(near)
      }
    },
    true
  )
}
