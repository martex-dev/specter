import { useEffect, useRef, useState } from 'react'
import { Copy, ExternalLink, Image as ImageIcon, Link2, ListTree, RefreshCw, ScrollText } from 'lucide-react'
import type { PageStats } from '@shared/types'
import { isInternal } from '@shared/url'
import { invoke } from '../lib/ipc'
import { wcIdFor } from '../lib/webviews'
import { newTab, useActiveTab } from '../stores/browser'
import { toast, useUi } from '../stores/ui'

type View = 'overview' | 'links' | 'images' | 'outline'

export default function PageToolsPanel() {
  const tab = useActiveTab()
  const arg = useUi((s) => s.overlayArg)
  const [view, setView] = useState<View>(typeof arg === 'string' && ['links', 'images', 'outline'].includes(arg) ? (arg as View) : 'overview')
  const [stats, setStats] = useState<PageStats | null | 'loading'>('loading')
  const [filter, setFilter] = useState('')
  const reqRef = useRef(0)

  const load = async () => {
    // Only the latest request may land: after a tab switch a slower page's
    // stats would otherwise overwrite the new tab's.
    const req = ++reqRef.current
    if (!tab || isInternal(tab.url)) return setStats(null)
    const id = wcIdFor(tab.id)
    if (id === null) return setStats(null)
    setStats('loading')
    const s = await invoke('guest:stats', id).catch(() => null)
    if (req === reqRef.current) setStats(s)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.id, tab?.url, tab?.loading])

  useEffect(() => {
    if (typeof arg === 'string' && ['links', 'images', 'outline'].includes(arg)) setView(arg as View)
  }, [arg])

  if (!tab || isInternal(tab.url)) return <div className="empty">Open a web page to use page tools.</div>
  if (stats === 'loading') return <div className="empty">Analyzing page…</div>
  if (!stats) return <div className="empty">Page information unavailable.</div>

  const links = stats.links.filter((l) => !filter || (l.href + l.text).toLowerCase().includes(filter.toLowerCase()))
  const copy = async (text: string, what: string) => {
    await invoke('app:clipboardWrite', text)
    toast({ kind: 'ok', title: `${what} copied` })
  }

  return (
    <div className="col" style={{ gap: 0, height: '100%' }}>
      <div className="row" style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)' }}>
        <div className="seg">
          <button className={view === 'overview' ? 'on' : ''} onClick={() => setView('overview')}>
            Overview
          </button>
          <button className={view === 'links' ? 'on' : ''} onClick={() => setView('links')}>
            Links {stats.links.length}
          </button>
          <button className={view === 'images' ? 'on' : ''} onClick={() => setView('images')}>
            Images {stats.images.length}
          </button>
          <button className={view === 'outline' ? 'on' : ''} onClick={() => setView('outline')}>
            Outline
          </button>
        </div>
        <span className="spacer" />
        <button className="icon-btn sm" onClick={load} data-tip="Re-analyze" aria-label="Refresh">
          <RefreshCw size={13} />
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {view === 'overview' && (
          <div className="col">
            <div style={{ fontWeight: 600 }} className="selectable">
              {stats.title}
            </div>
            {stats.description && (
              <div className="muted selectable" style={{ fontSize: 12 }}>
                {stats.description}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
              {[
                ['Words', stats.words.toLocaleString()],
                ['Reading time', `${stats.readingMinutes} min`],
                ['Characters', stats.characters.toLocaleString()],
                ['Headings', String(stats.headings.length)],
                ['Links', String(stats.links.length)],
                ['Images', String(stats.images.length)],
                ['Language', stats.lang ?? '—']
              ].map(([k, v]) => (
                <div key={k} className="card" style={{ padding: '8px 10px' }}>
                  <div className="label">{k}</div>
                  <div className="num" style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>
                    {v}
                  </div>
                </div>
              ))}
            </div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button
                className="btn sm"
                onClick={async () => {
                  const id = wcIdFor(tab.id)
                  if (id !== null) copy(await invoke('guest:cleanText', id), 'Page text')
                }}
              >
                <ScrollText size={12} /> Copy clean text
              </button>
              <button className="btn sm" onClick={() => copy(stats.links.map((l) => l.href).join('\n'), `${stats.links.length} links`)}>
                <Link2 size={12} /> Copy all links
              </button>
            </div>
          </div>
        )}
        {view === 'links' && (
          <div className="col" style={{ gap: 4 }}>
            <input className="input" placeholder="Filter links…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="row">
              <span className="muted grow" style={{ fontSize: 11.5 }}>
                {links.length} links
              </span>
              <button className="btn sm ghost" onClick={() => copy(links.map((l) => l.href).join('\n'), `${links.length} links`)}>
                <Copy size={12} /> Copy
              </button>
            </div>
            {links.slice(0, 800).map((l) => (
              <div key={l.href} className="row" style={{ minHeight: 30, fontSize: 12 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis">{l.text || '(no text)'}</div>
                  <div className="dim ellipsis" style={{ fontSize: 10.5 }}>
                    {l.href}
                  </div>
                </div>
                <button className="icon-btn sm" onClick={() => newTab(l.href, { background: true })} aria-label="Open link" data-tip="Open in background tab">
                  <ExternalLink size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {view === 'images' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 6 }}>
            {stats.images.length === 0 && <div className="muted">No images</div>}
            {stats.images.slice(0, 300).map((im) => (
              <button key={im.src} className="card" style={{ padding: 4, cursor: 'pointer', textAlign: 'left' }} onClick={() => newTab(im.src, { background: true })} data-tip={im.alt || im.src}>
                <img src={im.src} alt={im.alt} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 4, background: 'var(--bg-2)' }} loading="lazy" />
                <div className="mono dim" style={{ fontSize: 9.5, marginTop: 3 }}>
                  {im.width}×{im.height}
                </div>
              </button>
            ))}
          </div>
        )}
        {view === 'outline' && (
          <div className="col" style={{ gap: 2 }}>
            {stats.headings.length === 0 && (
              <div className="empty">
                <ListTree size={20} />
                No headings
              </div>
            )}
            {stats.headings.map((h, i) => (
              <div key={i} style={{ paddingLeft: (h.level - 1) * 14, fontSize: h.level <= 2 ? 12.5 : 12, fontWeight: h.level === 1 ? 600 : 400, color: h.level > 2 ? 'var(--fg-1)' : undefined, lineHeight: 1.6 }} className="selectable">
                <span className="dim mono" style={{ fontSize: 10, marginRight: 6 }}>
                  H{h.level}
                </span>
                {h.text}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="dim" style={{ padding: '6px 12px', fontSize: 10.5, borderTop: '1px solid var(--line)' }}>
        <ImageIcon size={10} /> Analysis runs locally in an isolated script world.
      </div>
    </div>
  )
}
