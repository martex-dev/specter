/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// Password manager preload (registered on profile sessions, runs in every web
// page frame's isolated world). It finds sign-in forms, shows saved logins
// under the focused field, fills the one the user picks and reports submitted
// logins so SPECTER can offer to save them. It exposes nothing to the page:
// the suggestion list lives in a closed shadow root, and passwords are only
// requested after a real (isTrusted) click or key press on it. The main process
// decides which logins this frame may see from Chromium's own record of the
// frame's origin.
import { ipcRenderer } from 'electron'

interface Suggestion {
  id: string
  username: string
  host: string
  exact: boolean
}

if (/^https?:$/.test(location.protocol)) {
  try {
    init()
  } catch {
    /* never break a page over autofill */
  }
}

function init(): void {
  const USERNAME_HINT = /user|e-?mail|login|identifier|account|phone|mobile|benutzer|usuario|correo|utilisateur|courriel|логин|почта/i
  const TEXT_TYPES = new Set(['text', 'email', 'tel'])
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

  const isInput = (el: unknown): el is HTMLInputElement => el instanceof HTMLInputElement
  const isPassword = (el: HTMLInputElement): boolean => el.type === 'password'
  const isText = (el: HTMLInputElement): boolean => TEXT_TYPES.has(el.type)

  function visible(el: HTMLElement): boolean {
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05
  }

  const usable = (i: HTMLInputElement) => !i.disabled && visible(i)
  const passwordsIn = (root: ParentNode) => [...root.querySelectorAll<HTMLInputElement>('input[type=password]')].filter(usable)
  const hinted = (i: HTMLInputElement) => i.type === 'email' || /\b(username|email)\b/.test(i.autocomplete) || USERNAME_HINT.test(`${i.name} ${i.id} ${i.placeholder} ${i.getAttribute('aria-label') ?? ''}`)

  /** The form, or the nearest ancestor holding a password field, around an input. */
  function loginRoot(el: Element): ParentNode | null {
    const form = isInput(el) ? el.form : el.closest('form')
    if (form && form.querySelector('input[type=password]')) return form
    let p: Element | null = el.parentElement
    for (let i = 0; p && i < 8; i++, p = p.parentElement) if (p.querySelector('input[type=password]')) return p
    return null
  }

  /** The username field of a sign-in form: explicit autocomplete, else the text field right before the password. */
  function usernameIn(root: ParentNode, pw: HTMLInputElement | undefined, forFill: boolean): HTMLInputElement | undefined {
    const inputs = [...root.querySelectorAll<HTMLInputElement>('input')]
    const texts = inputs.filter((i) => isText(i) && usable(i) && !(forFill && i.readOnly))
    const byAutocomplete = texts.find((i) => /\b(username|email)\b/.test(i.autocomplete))
    if (byAutocomplete) return byAutocomplete
    if (pw) {
      const before = texts.filter((i) => i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING)
      if (before.length) return before[before.length - 1]
    } else {
      const h = texts.find(hinted)
      if (h) return h
    }
    // Password step of a two-step sign-in: the account is often kept in a hidden field.
    if (!forFill) return inputs.find((i) => /\busername\b/.test(i.autocomplete) && i.value)
    return undefined
  }

  /** The password field to fill: not a "new password" field unless it's the only one. */
  function fillablePassword(pws: HTMLInputElement[]): HTMLInputElement | undefined {
    return pws.find((p) => p.autocomplete !== 'new-password') ?? (pws.length === 1 ? pws[0] : undefined)
  }

  const attrs = (i: HTMLInputElement) => `${i.name} ${i.id} ${i.placeholder} ${i.getAttribute('aria-label') ?? ''}`

  /** A password field for choosing a new password (sign-up, change password), where a strong one can be suggested. */
  function isNewPasswordField(el: HTMLInputElement): boolean {
    if (!isPassword(el) || el.readOnly || el.disabled) return false
    if (el.autocomplete === 'new-password') return true
    if (el.autocomplete === 'current-password' || /current|old|existing/i.test(attrs(el))) return false
    if (/new|confirm|create|regist|sign.?up|repeat|retype|verify/i.test(attrs(el))) return true
    // Two password fields are password + confirmation; with three, the first is the current one.
    const pws = passwordsIn(loginRoot(el) ?? document)
    return pws.length >= 2 && pws.indexOf(el) >= (pws.length >= 3 ? 1 : 0)
  }

  /** A field worth showing suggestions on: a password field, the username of a sign-in form, or a lone username step. */
  function isLoginField(el: HTMLInputElement): boolean {
    if (el.readOnly || el.disabled) return false
    if (isPassword(el)) return !isNewPasswordField(el) || passwordsIn(loginRoot(el) ?? document).length === 1
    if (!isText(el)) return false
    const root = loginRoot(el)
    if (root) return usernameIn(root, fillablePassword(passwordsIn(root)), true) === el
    return /\b(username|webauthn)\b/.test(el.autocomplete) || (hinted(el) && !!el.form && el.form.querySelectorAll('input:not([type=hidden])').length <= 3)
  }

  // ------------------------------------------------------------ fill

  function setValue(input: HTMLInputElement, value: string): void {
    if (input.value === value) return
    // The prototype setter (this world's) skips framework value trackers, so React & co. see a change.
    valueSetter.call(input, value)
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: value }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function fillAround(anchor: HTMLInputElement | null, login: { username: string; password: string }): boolean {
    const root = (anchor && loginRoot(anchor)) ?? (anchor?.form as ParentNode | null) ?? document
    const pw = fillablePassword(passwordsIn(root))
    const user = usernameIn(root, pw, true) ?? (anchor && isText(anchor) && !anchor.readOnly ? anchor : undefined)
    if (user && login.username) setValue(user, login.username)
    if (pw) setValue(pw, login.password)
    return !!(pw || (user && login.username))
  }

  // ------------------------------------------------------------ suggestions menu

  let cache: { at: number; list: Suggestion[] } | null = null
  async function suggestions(): Promise<Suggestion[]> {
    if (cache && Date.now() - cache.at < 15_000) return cache.list
    const list = ((await ipcRenderer.invoke('specter-pw:query').catch(() => [])) ?? []) as Suggestion[]
    cache = { at: Date.now(), list: Array.isArray(list) ? list : [] }
    return cache.list
  }

  /** One row of the menu: a saved login, or a suggested new password. */
  interface Entry {
    title: string
    sub: string
    mono?: boolean
    run: () => void
  }
  let menu: { host: HTMLElement; field: HTMLInputElement; items: HTMLElement[]; entries: Entry[]; sel: number } | null = null

  const CSS = `
    :host { all: initial; }
    .m { font: 13px/1.3 "Segoe UI", system-ui, sans-serif; color: #e8e9ee; background: #17181d; border: 1px solid #2c2f38;
         border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,.45); padding: 4px; min-width: 240px; max-width: 380px; overflow: hidden; }
    .i { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 7px; cursor: pointer; }
    .i:hover, .i.s { background: #262932; }
    .k { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: #23262e; color: #9aa3ff; }
    .t { min-width: 0; }
    .u { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .h { font-size: 11px; color: #8b8f9c; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .h.mono { font: 12px/1.4 Consolas, "Cascadia Mono", monospace; color: #c9ccd6; letter-spacing: .02em; }
    .f { border-top: 1px solid #2c2f38; margin-top: 4px; padding: 7px 10px 5px; font-size: 11.5px; color: #8b8f9c; display: flex; gap: 6px; align-items: center; cursor: pointer; }
    .f:hover { color: #e8e9ee; }
  `
  const KEY_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/></svg>'

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
    menu.host.style.left = Math.max(4, Math.min(r.left, innerWidth - (menu.host.offsetWidth || 260) - 4)) + 'px'
    menu.host.style.top = (below ? r.bottom + 4 : r.top - 4 - h) + 'px'
  }

  function select(i: number): void {
    if (!menu) return
    menu.sel = i
    menu.items.forEach((el, n) => el.classList.toggle('s', n === i))
  }

  async function pick(s: Suggestion, field: HTMLInputElement): Promise<void> {
    const login = (await ipcRenderer.invoke('specter-pw:fill', s.id).catch(() => null)) as { username: string; password: string } | null
    if (login) fillAround(field, login)
  }

  function showMenu(field: HTMLInputElement, entries: Entry[]): void {
    hideMenu()
    if (!entries.length || document.activeElement !== field) return
    const host = document.createElement('specter-password-menu')
    host.setAttribute('popover', 'manual')
    host.style.cssText = 'position:fixed;inset:auto;margin:0;padding:0;border:0;background:transparent;overflow:visible;z-index:2147483647;'
    const shadow = host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = CSS
    const box = document.createElement('div')
    box.className = 'm'
    box.setAttribute('role', 'listbox')
    const items = entries.map((en) => {
      const item = document.createElement('div')
      item.className = 'i'
      item.setAttribute('role', 'option')
      const k = document.createElement('span')
      k.className = 'k'
      k.innerHTML = KEY_SVG
      const t = document.createElement('span')
      t.className = 't'
      const u = document.createElement('div')
      u.className = 'u'
      u.textContent = en.title
      const h = document.createElement('div')
      h.className = en.mono ? 'h mono' : 'h'
      h.textContent = en.sub
      t.append(u, h)
      item.append(k, t)
      item.addEventListener('click', (e) => {
        if (!e.isTrusted) return
        hideMenu()
        en.run()
      })
      box.append(item)
      return item
    })
    const footer = document.createElement('div')
    footer.className = 'f'
    footer.textContent = 'Manage passwords…'
    footer.addEventListener('click', (e) => {
      if (!e.isTrusted) return
      hideMenu()
      ipcRenderer.send('specter-pw:manage')
    })
    box.append(footer)
    // Keep focus (and the caret) in the page's field while the menu is used.
    box.addEventListener('mousedown', (e) => e.preventDefault())
    shadow.append(style, box)
    document.documentElement.append(host)
    try {
      host.showPopover()
    } catch {
      /* older engines: the fixed position + z-index still apply */
    }
    menu = { host, field, items, entries, sel: -1 }
    place()
  }

  const loginEntry = (s: Suggestion, field: HTMLInputElement): Entry => ({
    title: s.username || '(no username)',
    sub: s.exact ? '••••••••' : `Saved for ${s.host}`,
    run: () => void pick(s, field)
  })

  /** Puts a suggested password into every new-password field of the form (password and confirmation). */
  function fillNewPassword(field: HTMLInputElement, password: string): void {
    const targets = passwordsIn(loginRoot(field) ?? document).filter(isNewPasswordField)
    for (const p of targets.length ? targets : [field]) setValue(p, password)
  }

  async function offerFor(field: HTMLInputElement): Promise<void> {
    const fresh = isNewPasswordField(field)
    if (!fresh && !isLoginField(field)) return
    const entries: Entry[] = []
    if (fresh) {
      const max = field.maxLength > 0 ? field.maxLength : undefined
      const generated = (await ipcRenderer.invoke('specter-pw:generate', max).catch(() => null)) as string | null
      if (generated) entries.push({ title: 'Use a strong password', sub: generated, mono: true, run: () => fillNewPassword(field, generated) })
    }
    // A lone "new-password" field is often a mislabelled sign-in field: offer saved logins too.
    if (!fresh || isLoginField(field)) entries.push(...(await suggestions()).slice(0, 8).map((s) => loginEntry(s, field)))
    if (document.activeElement === field && (!menu || menu.field !== field)) showMenu(field, entries)
  }

  document.addEventListener(
    'focusin',
    (e) => {
      const t = e.target
      if (menu && t !== menu.field) hideMenu()
      if (e.isTrusted && isInput(t)) void offerFor(t)
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
  // Clicking a field that already has focus (after Escape or picking) brings the list back.
  document.addEventListener(
    'mousedown',
    (e) => {
      const t = e.target
      if (e.isTrusted && isInput(t) && t === document.activeElement && !menu) void offerFor(t)
    },
    true
  )
  // Typing in the field puts the list away (it's back on the next click).
  document.addEventListener(
    'input',
    (e) => {
      if (menu && e.isTrusted && e.target === menu.field && menu.field.value) hideMenu()
    },
    true
  )
  addEventListener('scroll', place, { capture: true, passive: true })
  addEventListener('resize', place, { passive: true })
  addEventListener('pagehide', hideMenu)

  // ------------------------------------------------------------ submissions

  let lastSent = { key: '', at: 0 }

  function passwordFromForm(pws: HTMLInputElement[]): string {
    const vals = pws.map((p) => p.value).filter(Boolean)
    const fresh = pws.find((p) => p.autocomplete === 'new-password' && p.value)
    if (fresh) return fresh.value
    if (vals.length >= 3) return vals[1] // current, new, confirm
    if (vals.length === 2) return vals[1] // new + confirm (same value), or current + new
    return vals[0] ?? ''
  }

  /** Reports the login in a sign-in form that is being submitted; a username-only step reports just the username. */
  function capture(from: Element): void {
    const root = loginRoot(from)
    if (!root) {
      const form = from.closest('form') ?? (isInput(from) ? from.form : null)
      const user = form && usernameIn(form, undefined, false)
      // Only a real username step (a lone account field), not any form that happens to have an email box.
      if (user?.value && user.value.length < 256 && isLoginField(user)) ipcRenderer.send('specter-pw:username', user.value)
      return
    }
    const pws = [...root.querySelectorAll<HTMLInputElement>('input[type=password]')].filter((p) => p.value)
    if (!pws.length) return
    const password = passwordFromForm(pws)
    const user = usernameIn(root, pws[0], false)
    const username = user?.value ?? ''
    const key = username + '\u0000' + password
    if (key === lastSent.key && Date.now() - lastSent.at < 5000) return
    lastSent = { key, at: Date.now() }
    ipcRenderer.send('specter-pw:submitted', { username, password })
    // Single-page apps often sign in without navigating: every password field going away
    // counts as success (a form re-rendered with an error still has one). Navigations
    // and pop-ups closing are seen by the main process.
    const gone = () => passwordsIn(document).length === 0
    for (const ms of [1500, 4000]) setTimeout(() => gone() && ipcRenderer.send('specter-pw:succeeded'), ms)
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
          select(menu.sel < 0 ? (e.key === 'ArrowDown' ? 0 : n - 1) : (menu.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
          return
        }
        if (e.key === 'Enter' && menu.sel >= 0) {
          e.preventDefault()
          e.stopImmediatePropagation()
          const entry = menu.entries[menu.sel]
          hideMenu()
          entry.run()
          return
        }
        if (e.key === 'Escape' || e.key === 'Tab') hideMenu()
      }
      if (e.key === 'Enter' && isInput(e.target)) capture(e.target)
    },
    true
  )
  document.addEventListener(
    'click',
    (e) => {
      if (!e.isTrusted || !(e.target instanceof Element)) return
      const button = e.target.closest('button, input[type=submit], input[type=button], input[type=image], [role=button], a')
      // Links only when they act as a button, not "Forgot password?" and friends.
      if (button instanceof HTMLAnchorElement && !/^(#|javascript:|$)/i.test(button.getAttribute('href') ?? '')) return
      if (button) capture(button)
    },
    true
  )

  // Filling from SPECTER's toolbar (the key button next to the address).
  ipcRenderer.on('specter-pw:fill-now', (_e, login: { username: string; password: string }) => {
    const active = document.activeElement
    const anchor =
      (isInput(active) && isLoginField(active) ? active : null) ??
      passwordsIn(document)[0] ??
      [...document.querySelectorAll<HTMLInputElement>('input')].find((i) => usable(i) && isLoginField(i))
    // Frames without a sign-in form ignore it (the login is sent to every frame of the site).
    if (anchor) fillAround(anchor, login)
  })
}
