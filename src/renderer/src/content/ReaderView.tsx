import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { BookmarkPlus, Minus, Pause, Play, Plus, Square, X } from 'lucide-react'
import type { ReaderArticle } from '@shared/types'
import { invoke } from '../lib/ipc'
import { wcIdFor } from '../lib/webviews'
import { updateTab } from '../stores/browser'
import { toast } from '../stores/ui'
import { runCommand } from '../lib/commands'
import { Seg } from '../components/ui'

type ReaderTheme = 'dark' | 'light' | 'sepia'

const PREFS_KEY = 'specter.reader.prefs'

export function ReaderView({ tabId }: { tabId: string }) {
  const [article, setArticle] = useState<ReaderArticle | null | 'loading'>('loading')
  const saved = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    } catch {
      return {}
    }
  }, [])
  const [size, setSize] = useState<number>(saved.size ?? 19)
  const [width, setWidth] = useState<number>(saved.width ?? 700)
  const [lh, setLh] = useState<number>(saved.lh ?? 1.7)
  const [serif, setSerif] = useState<boolean>(saved.serif ?? true)
  const [theme, setTheme] = useState<ReaderTheme>(saved.theme ?? 'dark')
  const [progress, setProgress] = useState(0)
  const [speaking, setSpeaking] = useState<'idle' | 'playing' | 'paused'>('idle')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ size, width, lh, serif, theme }))
  }, [size, width, lh, serif, theme])

  useEffect(() => {
    const wcId = wcIdFor(tabId)
    if (wcId === null) {
      setArticle(null)
      return
    }
    invoke('guest:reader', wcId)
      .then((a) => setArticle(a))
      .catch(() => setArticle(null))
    return () => speechSynthesis.cancel()
  }, [tabId])

  const html = useMemo(() => (article && article !== 'loading' ? DOMPurify.sanitize(article.content, { FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe'], FORBID_ATTR: ['style', 'onerror', 'onload'] }) : ''), [article])

  const close = () => {
    speechSynthesis.cancel()
    updateTab(tabId, { reader: false })
  }

  const speak = () => {
    if (!article || article === 'loading') return
    if (speaking === 'playing') {
      speechSynthesis.pause()
      setSpeaking('paused')
      return
    }
    if (speaking === 'paused') {
      speechSynthesis.resume()
      setSpeaking('playing')
      return
    }
    const voices = speechSynthesis.getVoices()
    if (!voices.length) {
      toast({ kind: 'warn', title: 'Text-to-speech unavailable', body: 'No local speech voices are installed on this system.' })
      return
    }
    // Chunk text: long utterances are cut off by some engines.
    const chunks = article.textContent.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [article.textContent]
    speechSynthesis.cancel()
    chunks.forEach((c, i) => {
      const u = new SpeechSynthesisUtterance(c.trim())
      if (i === chunks.length - 1) u.onend = () => setSpeaking('idle')
      speechSynthesis.speak(u)
    })
    setSpeaking('playing')
  }

  const palette: Record<ReaderTheme, { bg: string; fg: string; muted: string; link: string }> = {
    dark: { bg: '#15171c', fg: '#dfe2e8', muted: '#8a909c', link: '#a3b1ff' },
    light: { bg: '#fbfbfa', fg: '#1d1f23', muted: '#6b6f78', link: '#3d4fd1' },
    sepia: { bg: '#f4ecd8', fg: '#3b3026', muted: '#7a6a58', link: '#8a4b1f' }
  }
  const p = palette[theme]

  return (
    <div className="reader" style={{ position: 'absolute', inset: 0, zIndex: 6, display: 'flex', flexDirection: 'column', background: p.bg, color: p.fg }}>
      <div className="reader-bar row" style={{ height: 42, padding: '0 12px', borderBottom: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)'}`, flex: 'none', background: p.bg }}>
        <span className="label" style={{ color: p.muted }}>
          Reader
        </span>
        <span className="spacer" />
        <button className="icon-btn sm" style={{ color: p.fg }} onClick={() => setSize(Math.max(13, size - 1))} aria-label="Smaller text" data-tip="Smaller text">
          <Minus size={14} />
        </button>
        <span className="mono" style={{ fontSize: 11, color: p.muted, width: 28, textAlign: 'center' }}>
          {size}
        </span>
        <button className="icon-btn sm" style={{ color: p.fg }} onClick={() => setSize(Math.min(32, size + 1))} aria-label="Larger text" data-tip="Larger text">
          <Plus size={14} />
        </button>
        <select className="select" style={{ height: 26, width: 96 }} value={width} onChange={(e) => setWidth(Number(e.target.value))} aria-label="Width">
          <option value={560}>Narrow</option>
          <option value={700}>Medium</option>
          <option value={860}>Wide</option>
          <option value={1100}>Full</option>
        </select>
        <select className="select" style={{ height: 26, width: 92 }} value={lh} onChange={(e) => setLh(Number(e.target.value))} aria-label="Line spacing">
          <option value={1.45}>Tight</option>
          <option value={1.7}>Normal</option>
          <option value={2}>Loose</option>
        </select>
        <Seg value={serif ? 'serif' : 'sans'} options={[{ value: 'serif', label: 'Serif' }, { value: 'sans', label: 'Sans' }]} onChange={(v) => setSerif(v === 'serif')} />
        <Seg value={theme} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'sepia', label: 'Sepia' }]} onChange={setTheme} />
        <button className="icon-btn sm" style={{ color: p.fg }} onClick={speak} aria-label="Read aloud" data-tip={speaking === 'playing' ? 'Pause reading' : 'Read aloud (local voice)'}>
          {speaking === 'playing' ? <Pause size={14} /> : <Play size={14} />}
        </button>
        {speaking !== 'idle' && (
          <button
            className="icon-btn sm"
            style={{ color: p.fg }}
            onClick={() => {
              speechSynthesis.cancel()
              setSpeaking('idle')
            }}
            aria-label="Stop reading"
          >
            <Square size={13} />
          </button>
        )}
        <button className="icon-btn sm" style={{ color: p.fg }} onClick={() => runCommand('save.toSpecter')} aria-label="Save to SPECTER" data-tip="Save to SPECTER">
          <BookmarkPlus size={14} />
        </button>
        <button className="icon-btn sm" style={{ color: p.fg }} onClick={close} aria-label="Exit reader" data-tip="Exit reader" data-kbd="Alt+R">
          <X size={15} />
        </button>
      </div>
      <div style={{ height: 2, background: 'transparent', flex: 'none' }}>
        <div style={{ height: 2, width: `${progress * 100}%`, background: p.link, transition: 'width 80ms linear' }} />
      </div>
      <div
        ref={scrollRef}
        className="selectable"
        style={{ flex: 1, overflowY: 'auto' }}
        onScroll={(e) => {
          const el = e.currentTarget
          setProgress(el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 1)
        }}
      >
        {article === 'loading' ? (
          <div className="empty" style={{ color: p.muted }}>
            Extracting article…
          </div>
        ) : !article ? (
          <div className="empty" style={{ color: p.muted }}>
            <div>Reader mode isn't available for this page.</div>
            <div style={{ fontSize: 12 }}>The page doesn't contain enough article-like content.</div>
            <button className="btn" onClick={close}>
              Back to page
            </button>
          </div>
        ) : (
          <article
            className="reader-article"
            style={{
              maxWidth: width,
              margin: '0 auto',
              padding: '44px 28px 120px',
              fontSize: size,
              lineHeight: lh,
              fontFamily: serif ? "'Iowan Old Style', 'Palatino Linotype', Georgia, 'Times New Roman', serif" : 'var(--font-ui)',
              ['--reader-link' as any]: p.link,
              ['--reader-muted' as any]: p.muted
            }}
          >
            {article.siteName && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: p.muted }}>{article.siteName}</div>}
            <h1 style={{ fontSize: '1.9em', lineHeight: 1.18, margin: '10px 0 8px', fontFamily: 'inherit' }}>{article.title}</h1>
            <div style={{ color: p.muted, fontSize: '0.78em', marginBottom: 28 }}>
              {[article.byline, `${Math.max(1, Math.round(article.textContent.split(/\s+/).length / 230))} min read`].filter(Boolean).join(' · ')}
            </div>
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </article>
        )}
      </div>
    </div>
  )
}
