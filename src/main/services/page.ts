// Page tools operating on tab guests. All scripts run in an isolated world so
// the page cannot tamper with them or observe SPECTER's helpers.
import { app, dialog, WebContentsView, BrowserWindow, type Session } from 'electron'
import { writeImageToClipboard } from './app'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AdvancedFindResult, FindOptions, MediaState } from '@shared/ipc'
import type { PageStats, ReaderArticle, SecurityInfo } from '@shared/types'
import { origin as originOf } from '@shared/url'
import { handle } from '../ipc'
import { guestById, hostWindowOf, registerGuestTab } from '../guest'
import { lastFocusedCtx, ctxForSender } from '../windows'
import { listPermissions } from './permissions'
import { activeSession } from './profiles'
import { createLogger } from '../logger'

const log = createLogger('page')
const WORLD = 1717
const certs = new Map<string, { issuer: string; subject: string; validFrom: number; validTo: number; fingerprint: string; ok: boolean }>()
const certAttached = new WeakSet<Session>()
let readabilitySource: string | null = null

function readability(): string {
  if (readabilitySource === null) readabilitySource = readFileSync(require.resolve('@mozilla/readability/Readability.js'), 'utf8')
  return readabilitySource
}

async function run<T>(wcId: number, code: string, gesture = false): Promise<T> {
  const wc = guestById(wcId)
  return (await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code }], gesture)) as T
}

export function attachCertificateCapture(ses: Session): void {
  if (certAttached.has(ses)) return
  certAttached.add(ses)
  ses.setCertificateVerifyProc((req, callback) => {
    try {
      certs.set(req.hostname, {
        issuer: req.certificate.issuerName,
        subject: req.certificate.subjectName,
        validFrom: req.certificate.validStart * 1000,
        validTo: req.certificate.validExpiry * 1000,
        fingerprint: req.certificate.fingerprint,
        ok: req.verificationResult === 'net::OK'
      })
    } catch {
      /* ignore */
    }
    callback(-3) // use Chromium's own verification result
  })
}

const STATS_JS = `(() => {
  const text = (document.body && document.body.innerText) || '';
  const words = (text.match(/[\\p{L}\\p{N}][\\p{L}\\p{N}'’-]*/gu) || []).length;
  const headings = [...document.querySelectorAll('h1,h2,h3,h4')].slice(0, 200).map(h => ({ level: Number(h.tagName[1]), text: h.innerText.trim().slice(0, 200), id: h.id || undefined })).filter(h => h.text);
  const seen = new Set();
  const links = [...document.querySelectorAll('a[href]')].map(a => ({ href: a.href, text: (a.innerText || a.title || '').trim().slice(0, 160) }))
    .filter(l => /^https?:/.test(l.href) && !seen.has(l.href) && seen.add(l.href)).slice(0, 2000);
  const iseen = new Set();
  const images = [...document.images].map(i => ({ src: i.currentSrc || i.src, alt: i.alt || '', width: i.naturalWidth, height: i.naturalHeight }))
    .filter(i => i.src && !i.src.startsWith('data:') && !iseen.has(i.src) && iseen.add(i.src)).slice(0, 1000);
  const desc = document.querySelector('meta[name="description"]')?.content || document.querySelector('meta[property="og:description"]')?.content;
  return { words, characters: text.length, readingMinutes: Math.max(1, Math.round(words / 230)), headings, links, images, title: document.title, lang: document.documentElement.lang || undefined, description: desc || undefined };
})()`

const FIND_JS = (query: string, o: FindOptions) => `(() => {
  const q = ${JSON.stringify(query)}; const o = ${JSON.stringify(o)};
  const st = window.__specterFind = { ranges: [], idx: -1 };
  if (!window.CSS || !CSS.highlights) return { matches: 0, active: 0, error: 'Highlight API unavailable' };
  CSS.highlights.delete('specter-find'); CSS.highlights.delete('specter-find-active');
  if (!document.getElementById('__specter_find_style')) {
    const s = document.createElement('style'); s.id = '__specter_find_style';
    s.textContent = '::highlight(specter-find){background:#ffe36e;color:#111}::highlight(specter-find-active){background:#ff8c2e;color:#111}';
    (document.head || document.documentElement).appendChild(s);
  }
  if (!q) return { matches: 0, active: 0 };
  let re;
  try {
    const esc = s => s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
    let src = o.regex ? q : esc(q);
    if (o.wholeWord) src = '(?<![\\\\p{L}\\\\p{N}_])(?:' + src + ')(?![\\\\p{L}\\\\p{N}_])';
    re = new RegExp(src, 'gu' + (o.matchCase ? '' : 'i'));
  } catch (e) { return { matches: 0, active: 0, error: 'Invalid regular expression' }; }
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
    acceptNode(n) { const p = n.parentElement; if (!p) return 2; const t = p.tagName; if (t === 'SCRIPT' || t === 'STYLE' || t === 'NOSCRIPT' || t === 'TEXTAREA') return 2; return 1; }
  });
  let n;
  while ((n = walker.nextNode()) && st.ranges.length < 5000) {
    const text = n.nodeValue; re.lastIndex = 0; let m;
    while ((m = re.exec(text)) && st.ranges.length < 5000) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      const r = new Range(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length); st.ranges.push(r);
    }
  }
  CSS.highlights.set('specter-find', new Highlight(...st.ranges));
  if (st.ranges.length) { st.idx = 0; window.__specterFindStep(0); }
  return { matches: st.ranges.length, active: st.ranges.length ? 1 : 0 };
})()`

const FIND_STEP_DEF = `window.__specterFindStep = (d) => {
  const st = window.__specterFind; if (!st || !st.ranges.length) return { matches: 0, active: 0 };
  st.idx = (st.idx + d + st.ranges.length) % st.ranges.length;
  const r = st.ranges[st.idx];
  CSS.highlights.set('specter-find-active', new Highlight(r));
  const el = r.startContainer.parentElement; if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
  return { matches: st.ranges.length, active: st.idx + 1 };
};`

const MEDIA_PICK = `const __pick = () => {
  const els = [...document.querySelectorAll('video, audio')];
  if (!els.length) return null;
  return els.find(e => !e.paused) || els.filter(e => e.tagName === 'VIDEO').sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0] || els[0];
};`

/** Plain visible text of a tab (for AI / research context). */
export async function pageText(wcId: number): Promise<{ url: string; title: string; text: string }> {
  const wc = guestById(wcId)
  const text = await run<string>(wcId, `(document.body && document.body.innerText) || ''`).catch(() => '')
  return { url: wc.getURL(), title: wc.getTitle(), text }
}

/** Readability-extracted article (null if the page isn't article-like). */
export async function readableArticle(wcId: number): Promise<ReaderArticle | null> {
  const code = `(() => { ${readability()}
    try {
      const art = new Readability(document.cloneNode(true), { charThreshold: 300 }).parse();
      if (!art || !art.content) return null;
      return { title: art.title || document.title, byline: art.byline || undefined, siteName: art.siteName || undefined, content: art.content, textContent: art.textContent, length: art.length, excerpt: art.excerpt || undefined, url: location.href };
    } catch (e) { return null; }
  })()`
  return run<ReaderArticle | null>(wcId, code).catch(() => null)
}

/** Current text selection in a tab. */
export async function pageSelection(wcId: number): Promise<string> {
  return run<string>(wcId, `String(window.getSelection() || '')`).catch(() => '')
}

export function registerPageIpc(): void {
  handle('guest:register', (_e, wcId, tabId) => registerGuestTab(wcId, tabId))
  handle('guest:focused', (e, wcId, info) => {
    const ctx = ctxForSender(e.sender.id)
    if (ctx) ctx.focusedGuest = wcId !== null && info ? { wcId, url: info.url, title: info.title } : null
  })

  handle('guest:screenshot', async (_e, wcId, opts) => {
    const wc = guestById(wcId)
    let png: Buffer
    if (opts.fullPage) {
      const dbg = wc.debugger
      let attachedHere = false
      try {
        if (!dbg.isAttached()) {
          dbg.attach('1.3')
          attachedHere = true
        }
        const metrics: any = await dbg.sendCommand('Page.getLayoutMetrics')
        const size = metrics.cssContentSize ?? metrics.contentSize
        const width = Math.min(Math.ceil(size.width), 8000)
        const height = Math.min(Math.ceil(size.height), 16000)
        const shot: any = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } })
        png = Buffer.from(shot.data, 'base64')
      } catch (err) {
        log.warn('full-page capture failed; falling back to viewport', err)
        png = (await wc.capturePage()).toPNG()
      } finally {
        if (attachedHere) {
          try {
            dbg.detach()
          } catch {
            /* ignore */
          }
        }
      }
    } else {
      png = (await wc.capturePage()).toPNG()
    }
    if (opts.toClipboard) {
      await writeImageToClipboard(png)
      return 'clipboard'
    }
    const dir = join(app.getPath('pictures'), 'SPECTER')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const file = join(dir, `SPECTER ${opts.fullPage ? 'Full ' : ''}Screenshot ${stamp}.png`)
    writeFileSync(file, png)
    return file
  })

  handle('guest:thumbnail', async (_e, wcId) => {
    try {
      const img = await guestById(wcId).capturePage()
      if (img.isEmpty()) return null
      return 'data:image/jpeg;base64,' + img.resize({ width: 360, quality: 'good' }).toJPEG(62).toString('base64')
    } catch {
      return null
    }
  })

  handle('guest:stats', async (_e, wcId) => {
    try {
      return await run<PageStats>(wcId, STATS_JS)
    } catch (err) {
      log.warn('stats failed', err)
      return null
    }
  })

  handle('guest:reader', async (_e, wcId) => {
    const code = `(() => { ${readability()}
      try {
        const doc = document.cloneNode(true);
        const art = new Readability(doc, { charThreshold: 300 }).parse();
        if (!art || !art.content) return null;
        return { title: art.title || document.title, byline: art.byline || undefined, siteName: art.siteName || undefined, content: art.content, textContent: art.textContent, length: art.length, excerpt: art.excerpt || undefined, url: location.href };
      } catch (e) { return null; }
    })()`
    try {
      return await run<ReaderArticle | null>(wcId, code)
    } catch (err) {
      log.warn('reader failed', err)
      return null
    }
  })

  handle('guest:cleanText', async (_e, wcId) => run<string>(wcId, `(document.body && document.body.innerText) || ''`))
  handle('guest:selection', async (_e, wcId) => {
    try {
      return await run<string>(wcId, `String(window.getSelection() || '')`)
    } catch {
      return ''
    }
  })

  handle('guest:findAdvanced', async (_e, wcId, query, opts) => run<AdvancedFindResult>(wcId, FIND_STEP_DEF + FIND_JS(query, opts)))
  handle('guest:findAdvancedStep', async (_e, wcId, forward) => run<AdvancedFindResult>(wcId, `window.__specterFindStep ? window.__specterFindStep(${forward ? 1 : -1}) : ({ matches: 0, active: 0 })`))
  handle('guest:findAdvancedClear', async (_e, wcId) => {
    await run(wcId, `window.CSS && CSS.highlights && (CSS.highlights.delete('specter-find'), CSS.highlights.delete('specter-find-active')); window.__specterFind = null; true`).catch(() => undefined)
  })

  handle('guest:security', async (_e, wcId) => {
    const wc = guestById(wcId)
    const url = wc.getURL()
    let u: URL | null = null
    try {
      u = new URL(url)
    } catch {
      /* ignore */
    }
    const origin = originOf(url)
    const cert = u ? certs.get(u.hostname) : undefined
    let cookies = 0
    try {
      cookies = (await activeSession().cookies.get({ url })).length
    } catch {
      /* ignore */
    }
    const info: SecurityInfo = {
      url,
      origin,
      protocol: u?.protocol ?? '',
      secure: u?.protocol === 'https:' && (cert ? cert.ok : true),
      certificate: cert ? { issuer: cert.issuer, subject: cert.subject, validFrom: cert.validFrom, validTo: cert.validTo, fingerprint: cert.fingerprint } : undefined,
      cookies,
      permissions: listPermissions().filter((p) => p.origin === origin)
    }
    return info
  })

  handle('guest:devtools', (_e, wcId, mode) => {
    const wc = guestById(wcId)
    if (mode === 'toggle' && wc.isDevToolsOpened()) wc.closeDevTools()
    else wc.openDevTools({ mode: 'detach', activate: true })
  })

  handle('guest:dockDevtools', (e, wcId, bounds) => {
    const wc = guestById(wcId)
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    closeDock(wcId)
    if (wc.isDevToolsOpened()) wc.closeDevTools()
    const view = new WebContentsView()
    win.contentView.addChildView(view)
    view.setBounds(roundBounds(bounds))
    wc.setDevToolsWebContents(view.webContents)
    wc.openDevTools()
    docks.set(wcId, { view, win })
    wc.once('destroyed', () => closeDock(wcId))
  })
  handle('guest:devtoolsBounds', (_e, wcId, bounds) => {
    const d = docks.get(wcId)
    if (!d) return
    if (bounds) {
      d.view.setVisible(true)
      d.view.setBounds(roundBounds(bounds))
    } else d.view.setVisible(false)
  })
  handle('guest:closeDevtools', (_e, wcId) => {
    closeDock(wcId)
    try {
      const wc = guestById(wcId)
      if (wc.isDevToolsOpened()) wc.closeDevTools()
    } catch {
      /* tab gone */
    }
  })

  handle('guest:navHistory', (_e, wcId) => {
    const nh = guestById(wcId).navigationHistory
    const active = nh.getActiveIndex()
    return nh.getAllEntries().map((en, i) => ({ offset: i - active, title: en.title, url: en.url }))
  })
  handle('guest:scrollY', async (_e, wcId) => run<number>(wcId, 'window.scrollY').catch(() => 0))
  handle('guest:setScrollY', async (_e, wcId, y) => {
    await run(wcId, `window.scrollTo({ top: ${Number(y) || 0}, behavior: 'instant' }); true`).catch(() => undefined)
  })

  handle('guest:media', async (_e, wcId) => {
    try {
      const state = await run<Omit<MediaState, 'webContentsId'> | null>(
        wcId,
        `(() => { ${MEDIA_PICK} const m = __pick(); if (!m) return null; const md = navigator.mediaSession && navigator.mediaSession.metadata;
          return { playing: !m.paused, title: (md && md.title) || document.title, artist: (md && md.artist) || undefined, duration: isFinite(m.duration) ? m.duration : undefined,
          currentTime: m.currentTime, volume: m.volume, rate: m.playbackRate, hasVideo: m.tagName === 'VIDEO' }; })()`
      )
      return state ? { ...state, webContentsId: wcId } : null
    } catch {
      return null
    }
  })
  handle('guest:mediaControl', async (_e, wcId, action, value) => {
    const v = Number(value ?? 0)
    const body: Record<string, string> = {
      play: 'm.play()',
      pause: 'm.pause()',
      toggle: 'm.paused ? m.play() : m.pause()',
      seek: `m.currentTime = Math.max(0, m.currentTime + ${v})`,
      rate: `m.playbackRate = ${Math.min(16, Math.max(0.0625, v || 1))}`,
      volume: `m.volume = ${Math.min(1, Math.max(0, v))}`,
      pip: `(document.pictureInPictureElement ? document.exitPictureInPicture() : (m.tagName === 'VIDEO' && m.requestPictureInPicture()))`
    }
    await run(wcId, `(() => { ${MEDIA_PICK} const m = __pick(); if (!m) return false; ${body[action]}; return true; })()`, true)
  })

  handle('guest:savePage', async (e, wcId) => {
    const wc = guestById(wcId)
    const win = hostWindowOf(wc) ?? BrowserWindow.fromWebContents(e.sender)
    const name = (wc.getTitle() || 'page').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120)
    const opts = { defaultPath: join(app.getPath('downloads'), name + '.html'), filters: [{ name: 'Web page, complete', extensions: ['html'] }] }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    await wc.savePage(r.filePath, 'HTMLComplete')
    return r.filePath
  })
  handle('guest:print', (_e, wcId) => guestById(wcId).print({}))
  handle('guest:copyImageAt', (_e, wcId, x, y) => guestById(wcId).copyImageAt(Math.round(x), Math.round(y)))
  handle('guest:setZoom', (_e, wcId, factor) => guestById(wcId).setZoomFactor(Math.min(5, Math.max(0.25, factor))))
  handle('guest:pageMemory', (_e, wcId) => {
    try {
      const pid = guestById(wcId).getOSProcessId()
      const m = app.getAppMetrics().find((p) => p.pid === pid)
      if (!m) return null
      return m.memory.privateBytes ?? m.memory.workingSetSize
    } catch {
      return null
    }
  })
}

const docks = new Map<number, { view: WebContentsView; win: BrowserWindow }>()

function roundBounds(b: { x: number; y: number; width: number; height: number }): Electron.Rectangle {
  return { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(1, Math.round(b.width)), height: Math.max(1, Math.round(b.height)) }
}

function closeDock(wcId: number): void {
  const d = docks.get(wcId)
  if (!d) return
  docks.delete(wcId)
  try {
    if (!d.win.isDestroyed()) d.win.contentView.removeChildView(d.view)
    d.view.webContents.close()
  } catch {
    /* ignore */
  }
}

export function focusedGuestId(): number | null {
  return lastFocusedCtx()?.focusedGuest?.wcId ?? null
}
