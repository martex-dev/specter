/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// Video tools preload: SPECTER's built-in speed controller (see
// services/video.ts). Registered on profile sessions, it runs in every web
// page's isolated world, so page scripts can't see its variables, listeners or
// IPC. It only does what the page could do to its own media elements (set
// playbackRate / currentTime) and exposes nothing to the page.
import { ipcRenderer } from 'electron'
import { SEEK_SECONDS, clampSpeed, isTypingTarget, rateChangeDecision, sameSpeed, speedFor, videoActionFor, type VideoAction, type VideoCommand, type VideoPageConfig } from '@shared/video'

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
const watched = new Map<Document, MutationObserver>()

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

function scan(root: ParentNode): void {
  for (const m of root.querySelectorAll('video, audio')) track(m as Media)
}

/** Media elements on the page (the tracked ones, or a fresh scan when the tools are off). */
function allMedia(): Media[] {
  if (!started) return [...document.querySelectorAll<Media>('video, audio')]
  for (const m of media) if (!m.isConnected && m.paused) media.delete(m)
  return [...media]
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
}

function run(action: VideoCommand, value?: number): number | null {
  if (!allMedia().some(hasSource)) return null
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
  }
}

// ---------------------------------------------------------------- documents

function onMutations(records: MutationRecord[]): void {
  for (const r of records)
    for (const n of r.addedNodes) {
      if (n.nodeType !== 1) continue
      if (isMedia(n)) track(n)
      else if ((n as Element).firstElementChild) scan(n as Element)
    }
}

function watch(doc: Document): void {
  if (watched.has(doc)) return
  const mo = new MutationObserver(onMutations)
  mo.observe(doc, { childList: true, subtree: true })
  watched.set(doc, mo)
  scan(doc)
  // Media that start loading before the observer sees them (e.g. created and played in one task).
  const found = (e: Event) => e.target && isMedia(e.target as Node) && started && track(e.target as Media)
  doc.addEventListener('loadstart', found, { capture: true, signal: life.signal })
  doc.addEventListener('play', found, { capture: true, signal: life.signal })
}

/** Keys and clicks are watched from document start, so the page's own listeners can't run first. */
function listen(win: Window): void {
  const input = (e: Event) => {
    if (e.isTrusted) lastInput = Date.now()
  }
  win.addEventListener('pointerdown', input, true)
  win.addEventListener('click', input, true)
  win.addEventListener('keydown', (e) => onKey(e, win.document), true)
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
  if (!action || typing(e, doc) || !allMedia().some(hasSource)) return
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
  life.abort()
  life = new AbortController()
  for (const mo of watched.values()) mo.disconnect()
  watched.clear()
  media.clear()
}

function configure(c: VideoPageConfig): void {
  cfg = { ...c, siteSpeed: undefined }
  keyMap = new Map(c.keys)
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
