/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// Video tools preload: SPECTER's built-in speed controller (see
// services/video.ts). Registered on profile sessions, it runs in every web
// page's isolated world, so page scripts can't see its variables, listeners or
// IPC. It only does what the page could do to its own media elements (set
// playbackRate / currentTime) and exposes nothing to the page.
import { ipcRenderer } from 'electron'
import { SEEK_SECONDS, clampSpeed, formatSpeed, isTypingTarget, rateChangeDecision, sameSpeed, speedFor, videoActionFor, type VideoAction, type VideoCommand, type VideoPageConfig } from '@shared/video'

type Media = HTMLMediaElement

let cfg: VideoPageConfig = { enabled: false, keys: [], step: 0.1, preferred: 1.8, badge: true }
let keyMap = new Map<string, VideoAction>()
let started = false
/** The speed the user chose on this page; null leaves the page's own speed alone. */
let desired: number | null = null
/** The last speed other than 1×, for R pressed at 1×. */
let last: number | null = null
/** Last trusted click or key press in a watched document. */
let lastInput = 0
let life = new AbortController()

const media = new Set<Media>()
/** The rate SPECTER just set on an element, so the ratechange it causes isn't taken for the site's. */
const expected = new WeakMap<Media, number>()
const loadedAt = new WeakMap<Media, number>()
const restoredAt = new WeakMap<Media, number[]>()
/** Observed documents (the page and its same-origin frames) and open shadow roots. */
const watched = new Map<Document | ShadowRoot, MutationObserver>()
let framed = new WeakSet<Element>()
let listened = new WeakSet<Window>()
const frameDoc = new WeakMap<Element, Document>()

const isMedia = (n: Node): n is Media => n.nodeName === 'VIDEO' || n.nodeName === 'AUDIO'
const hasSource = (m: Media) => !!(m.currentSrc || m.src || m.srcObject || m.readyState > 0)

// ---------------------------------------------------------------- media registry

function track(m: Media): void {
  if (media.has(m)) return
  media.add(m)
  const opts = { signal: life.signal }
  m.addEventListener('ratechange', () => onRateChange(m), opts)
  // Loading a new source silently resets playbackRate to defaultPlaybackRate.
  const reapply = () => {
    if (cfg.enabled && desired !== null && !sameSpeed(m.playbackRate, desired)) apply(m, desired)
  }
  m.addEventListener('loadstart', () => (loadedAt.set(m, Date.now()), reapply()), opts)
  m.addEventListener('emptied', () => loadedAt.set(m, Date.now()), opts)
  m.addEventListener('loadedmetadata', reapply, opts)
  m.addEventListener('play', reapply, opts)
  reapply()
}

function scan(root: Document | ShadowRoot | Element): void {
  for (const m of root.querySelectorAll('video, audio')) track(m as Media)
  for (const f of root.querySelectorAll('iframe, frame')) enterFrame(f)
  // Players built as web components (e.g. Reddit's) keep their <video> in an open shadow root.
  for (const el of root.querySelectorAll('*')) if (el.shadowRoot && el.localName.includes('-')) observe(el.shadowRoot)
}

/** Same-origin frame documents, as far as they can be reached (cross-origin frames can't). */
function frameDocs(doc: Document, out: Document[] = [doc]): Document[] {
  for (const f of doc.querySelectorAll('iframe, frame')) {
    try {
      const d = (f as HTMLIFrameElement).contentDocument
      if (d && !out.includes(d) && out.length < 50) frameDocs(d, (out.push(d), out))
    } catch {
      /* cross-origin */
    }
  }
  return out
}

/** Media elements on the page (the tracked ones, or a fresh scan when the tools are off). */
function allMedia(): Media[] {
  if (!started) return frameDocs(document).flatMap((d) => [...d.querySelectorAll<Media>('video, audio')])
  // Gone from the page, or left behind in a frame document that navigated away.
  for (const m of media) if ((!m.isConnected || !m.ownerDocument.defaultView) && m.paused) media.delete(m)
  return [...media]
}

/** Whether the page has media to act on; looks again before saying no (a player may have attached its shadow root late). */
function hasMediaNow(): boolean {
  if (allMedia().some(hasSource)) return true
  if (!started) return false
  for (const root of [...watched.keys()]) scan(root)
  return allMedia().some(hasSource)
}

/** The element seeking acts on: playing, then the biggest video, then anything with a source. */
function target(): Media | null {
  const list = allMedia().filter(hasSource)
  const area = (m: Media) => m.clientWidth * m.clientHeight
  return list.filter((m) => !m.paused).sort((a, b) => area(b) - area(a))[0] ?? list.sort((a, b) => area(b) - area(a))[0] ?? null
}

function apply(m: Media, rate: number): void {
  expected.set(m, rate)
  try {
    m.playbackRate = rate
  } catch {
    expected.delete(m)
  }
}

function currentRate(): number {
  return target()?.playbackRate ?? desired ?? 1
}

let reportTimer: ReturnType<typeof setTimeout> | undefined
function setSpeed(rate: number): number {
  const r = clampSpeed(rate)
  if (!sameSpeed(r, 1)) last = r
  // Back at 1×, stop holding the page to a speed (live streams adjust their own rate to catch up).
  desired = sameSpeed(r, 1) ? null : r
  for (const m of allMedia()) apply(m, r)
  showBadges()
  if (cfg.enabled) {
    clearTimeout(reportTimer)
    reportTimer = setTimeout(() => ipcRenderer.send('specter-video:speed', r), 600)
  }
  return r
}

function seek(by: number): void {
  const m = target()
  if (!m) return
  const end = Number.isFinite(m.duration) ? m.duration : Infinity
  m.currentTime = Math.min(end, Math.max(0, m.currentTime + by))
  showBadge(m, 1800, (by > 0 ? '+' : '−') + Math.abs(by) + ' s')
}

function run(action: VideoCommand, value?: number): number | null {
  if (!hasMediaNow()) return null
  if (action === 'set') return setSpeed(value ?? 1)
  if (action === 'rewind' || action === 'advance') {
    seek(action === 'rewind' ? -SEEK_SECONDS : SEEK_SECONDS)
    return currentRate()
  }
  const next = speedFor(action, currentRate(), { step: cfg.step, preferred: cfg.preferred, last })
  return next === null ? currentRate() : setSpeed(next)
}

function onRateChange(m: Media): void {
  const exp = expected.get(m)
  if (exp !== undefined) {
    expected.delete(m)
    if (sameSpeed(m.playbackRate, exp)) return
  }
  if (!cfg.enabled) return
  const now = Date.now()
  const decision = rateChangeDecision({ desired, actual: m.playbackRate, ours: false, msSinceUserInput: now - lastInput, msSinceLoad: now - (loadedAt.get(m) ?? 0) })
  if (decision === 'adopt') setSpeed(m.playbackRate)
  else if (decision === 'restore' && desired !== null) {
    // A site that keeps resetting the speed wins after a few rounds instead of looping forever.
    const recent = (restoredAt.get(m) ?? []).filter((t) => now - t < 5000)
    if (recent.length >= 8) return
    restoredAt.set(m, [...recent, now])
    apply(m, desired)
    showBadge(m)
  }
}

// ---------------------------------------------------------------- badge

// The badge lives in a closed shadow root (page scripts can't reach inside,
// page CSS can't style it) on a host whose inline !important styles win over
// the page's. As a manual popover it sits in the top layer: above the page,
// unclipped by the player's overflow, and above a fullscreen player.
const HOST_STYLE =
  'all:initial!important;position:fixed!important;inset:auto!important;z-index:2147483647!important;margin:0!important;padding:0!important;' +
  'border:0!important;background:none!important;overflow:visible!important;width:auto!important;height:auto!important;'
const BADGE_CSS = `
.b{display:flex;align-items:center;gap:1px;padding:2px;border-radius:4px;background:rgba(12,14,18,.82);border:1px solid rgba(255,255,255,.14);
  color:#e9ecf1;font:600 12px/1 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.02em;box-shadow:0 2px 8px rgba(0,0,0,.35);
  opacity:0;transition:opacity .25s ease;user-select:none;-webkit-user-select:none;cursor:default}
.b.on{opacity:1}
.v{min-width:42px;padding:0 4px;text-align:center;font-variant-numeric:tabular-nums}
button{all:unset;box-sizing:border-box;width:18px;height:18px;display:grid;place-items:center;border-radius:3px;color:inherit;font:inherit;cursor:pointer;opacity:.7}
button:hover{background:rgba(255,255,255,.14);opacity:1}
@media (prefers-reduced-motion:reduce){.b{transition:none}}`
const MIN_W = 160
const MIN_H = 90

interface Badge {
  host: HTMLElement
  box: HTMLElement
  label: HTMLElement
  shown: boolean
  hover: boolean
  hideAt: number
  goneAt: number
  note: string
  noteUntil: number
}
const badges = new Map<HTMLVideoElement, Badge>()
let raf = 0

function makeBadge(v: HTMLVideoElement): Badge {
  const doc = v.ownerDocument
  const host = doc.createElement('div')
  host.setAttribute('popover', 'manual')
  host.style.cssText = HOST_STYLE + 'display:none!important;'
  const root = host.attachShadow({ mode: 'closed' })
  const style = doc.createElement('style')
  style.textContent = BADGE_CSS
  const box = doc.createElement('div')
  box.className = 'b'
  const label = doc.createElement('span')
  label.className = 'v'
  const button = (text: string, title: string, action: VideoAction) => {
    const b = doc.createElement('button')
    b.textContent = text
    b.title = title
    b.tabIndex = -1
    // Keep keyboard focus (and the player's click handling) where it was.
    b.addEventListener('pointerdown', (e) => (e.preventDefault(), e.stopPropagation()))
    b.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.isTrusted) run(action)
    })
    return b
  }
  box.append(button('−', 'Slower', 'slower'), label, button('+', 'Faster', 'faster'))
  root.append(style, box)
  const badge: Badge = { host, box, label, shown: false, hover: false, hideAt: 0, goneAt: 0, note: '', noteUntil: 0 }
  box.addEventListener('pointerenter', () => (badge.hover = true))
  box.addEventListener('pointerleave', () => ((badge.hover = false), (badge.hideAt = Date.now() + 1200)))
  badges.set(v, badge)
  return badge
}

function onScreen(v: HTMLVideoElement): DOMRect | null {
  if (!v.isConnected) return null
  const r = v.getBoundingClientRect()
  const win = v.ownerDocument.defaultView
  if (!win || r.width < MIN_W || r.height < MIN_H || r.bottom <= 0 || r.right <= 0 || r.top >= win.innerHeight || r.left >= win.innerWidth) return null
  return r
}

function place(b: Badge, r: DOMRect): void {
  b.host.style.setProperty('left', Math.max(4, Math.round(r.left + 8)) + 'px', 'important')
  b.host.style.setProperty('top', Math.max(4, Math.round(r.top + 8)) + 'px', 'important')
}

function popUp(b: Badge): void {
  try {
    if (b.host.matches(':popover-open')) b.host.hidePopover()
    b.host.showPopover()
  } catch {
    /* page removed it or its document is going away; it still shows, just not in the top layer */
  }
}

/** Shows the badge on a video for a moment (with an optional note such as "+10 s"). */
function showBadge(m: Media, ms = 1800, note = ''): void {
  if (!started || !cfg.badge || m.nodeName !== 'VIDEO') return
  const v = m as HTMLVideoElement
  const r = onScreen(v)
  if (!r) return
  const b = badges.get(v) ?? makeBadge(v)
  const doc = v.ownerDocument
  if (!b.host.isConnected) (doc.body ?? doc.documentElement)?.appendChild(b.host)
  if (!b.shown) {
    b.host.style.setProperty('display', 'block', 'important')
    popUp(b)
    b.shown = true
  }
  place(b, r)
  b.hideAt = Math.max(b.hideAt, Date.now() + ms)
  b.goneAt = 0
  if (note) ((b.note = note), (b.noteUntil = Date.now() + 800))
  b.label.textContent = note || formatSpeed(v.playbackRate)
  b.box.classList.add('on')
  if (!raf) raf = requestAnimationFrame(tick)
}

function showBadges(): void {
  for (const m of media) showBadge(m)
}

function hideBadge(b: Badge): void {
  b.shown = false
  b.box.classList.remove('on')
  try {
    b.host.hidePopover()
  } catch {
    /* not open */
  }
  b.host.style.setProperty('display', 'none', 'important')
}

/** Follows the video while a badge is visible, then fades it out. */
function tick(): void {
  raf = 0
  const now = Date.now()
  let any = false
  for (const [v, b] of badges) {
    if (!b.shown) continue
    const r = onScreen(v)
    if (r && (b.hover || now < b.hideAt)) {
      place(b, r)
      b.goneAt = 0
      const text = now < b.noteUntil ? b.note : formatSpeed(v.playbackRate)
      if (b.label.textContent !== text) b.label.textContent = text
      b.box.classList.add('on')
      any = true
    } else if (!b.goneAt) {
      b.box.classList.remove('on')
      b.goneAt = now + 300
      any = true
    } else if (now >= b.goneAt) hideBadge(b)
    else any = true
  }
  if (any) raf = requestAnimationFrame(tick)
}

function removeBadges(): void {
  for (const b of badges.values()) b.host.remove()
  badges.clear()
  cancelAnimationFrame(raf)
  raf = 0
}

let hoverAt = 0
function onPointerMove(e: PointerEvent, doc: Document): void {
  const now = Date.now()
  if (!started || !cfg.badge || now - hoverAt < 120) return
  hoverAt = now
  for (const m of media) {
    if (m.nodeName !== 'VIDEO' || m.ownerDocument !== doc || !hasSource(m)) continue
    const r = m.getBoundingClientRect()
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return showBadge(m)
  }
}

// ---------------------------------------------------------------- documents

function onMutations(records: MutationRecord[]): void {
  for (const r of records)
    for (const n of r.addedNodes) {
      if (n.nodeType !== 1) continue
      const el = n as Element
      if (isMedia(el)) track(el)
      else if (el.localName === 'iframe' || el.localName === 'frame') enterFrame(el)
      if (el.shadowRoot && el.localName.includes('-')) observe(el.shadowRoot)
      if (el.firstElementChild) scan(el)
    }
}

function observe(root: Document | ShadowRoot): void {
  if (watched.has(root)) return
  const mo = new MutationObserver(onMutations)
  mo.observe(root, { childList: true, subtree: true })
  watched.set(root, mo)
  scan(root)
}

/** Follows a frame into each same-origin document it loads. */
function enterFrame(f: Element): void {
  if (framed.has(f)) return
  framed.add(f)
  const enter = () => {
    let doc: Document | null = null
    try {
      doc = (f as HTMLIFrameElement).contentDocument
    } catch {
      /* cross-origin */
    }
    const old = frameDoc.get(f)
    if (old && old !== doc) {
      watched.get(old)?.disconnect()
      watched.delete(old)
    }
    const win = doc?.defaultView
    if (!doc || !win) return
    frameDoc.set(f, doc)
    watch(doc)
    if (!listened.has(win)) {
      listened.add(win)
      listen(win, life.signal)
    }
  }
  f.addEventListener('load', enter, { signal: life.signal })
  enter()
}

function watch(doc: Document): void {
  if (watched.has(doc)) return
  observe(doc)
  // Media that start loading before the observer sees them (e.g. created and played in one task).
  const found = (e: Event) => e.target && isMedia(e.target as Node) && started && track(e.target as Media)
  doc.addEventListener('loadstart', found, { capture: true, signal: life.signal })
  doc.addEventListener('play', found, { capture: true, signal: life.signal })
  const win = doc.defaultView
  win?.addEventListener('pointermove', (e) => onPointerMove(e, doc), { capture: true, passive: true, signal: life.signal })
  // Entering fullscreen puts the player on top of the top layer; move shown badges back above it.
  doc.addEventListener('fullscreenchange', () => {
    for (const [v, b] of badges) if (b.shown && v.ownerDocument === doc) popUp(b)
  }, { signal: life.signal })
}

/** Keys and clicks are watched from document start, so the page's own listeners can't run first. */
function listen(win: Window, signal?: AbortSignal): void {
  const input = (e: Event) => {
    if (e.isTrusted) lastInput = Date.now()
  }
  win.addEventListener('pointerdown', input, { capture: true, signal })
  win.addEventListener('click', input, { capture: true, signal })
  win.addEventListener('keydown', (e) => onKey(e, win.document), { capture: true, signal })
}

function typing(e: KeyboardEvent, doc: Document): boolean {
  const els: (Element | null)[] = [e.composedPath()[0] as Element | null]
  let a = doc.activeElement
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement
  els.push(a)
  return els.some((el) => el && el.nodeType === 1 && isTypingTarget({ tagName: el.tagName, type: (el as HTMLInputElement).type, isContentEditable: (el as HTMLElement).isContentEditable, role: el.getAttribute('role') }))
}

function onKey(e: KeyboardEvent, doc: Document): void {
  if (!e.isTrusted) return
  lastInput = Date.now()
  if (!started || e.defaultPrevented || e.isComposing) return
  const action = videoActionFor({ key: e.key, code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey }, keyMap)
  if (!action || typing(e, doc) || !hasMediaNow()) return
  // Only a bound key on a page with media is taken from the page; everything else passes through.
  e.preventDefault()
  e.stopImmediatePropagation()
  run(action)
}

function start(): void {
  if (started) return
  started = true
  watch(document)
}

function stop(): void {
  if (!started) return
  started = false
  // Switched back on later, the page keeps whatever speed it has by then.
  desired = null
  life.abort()
  life = new AbortController()
  for (const mo of watched.values()) mo.disconnect()
  watched.clear()
  framed = new WeakSet()
  listened = new WeakSet()
  media.clear()
  removeBadges()
}

function configure(c: VideoPageConfig): void {
  cfg = { ...c, siteSpeed: undefined }
  keyMap = new Map(c.keys)
  if (!cfg.badge) removeBadges()
  if (cfg.enabled) start()
  else stop()
}

try {
  listen(window)
  ipcRenderer.on('specter-video:config', (_e, c: VideoPageConfig) => c && typeof c === 'object' && configure(c))
  ipcRenderer.on('specter-video:command', (_e, msg: { id?: unknown; action?: unknown; value?: unknown }) => {
    if (!msg || typeof msg.id !== 'number' || typeof msg.action !== 'string') return
    let rate: number | null = null
    try {
      rate = run(msg.action as VideoCommand, typeof msg.value === 'number' ? msg.value : undefined)
    } catch {
      /* answer anyway */
    }
    ipcRenderer.send('specter-video:result', msg.id, rate)
  })
  void ipcRenderer.invoke('specter-video:init').then((c: VideoPageConfig | null) => {
    if (!c) return
    if (c.enabled && c.siteSpeed && !sameSpeed(c.siteSpeed, 1)) desired = last = clampSpeed(c.siteSpeed)
    configure(c)
  }, () => {})
} catch {
  /* never break a page over a speed control */
}
