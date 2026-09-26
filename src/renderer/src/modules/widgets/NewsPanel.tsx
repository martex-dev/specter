// News / RSS reader side panel.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCheck, Eye, EyeOff, Pencil, Plus, RefreshCw, RotateCcw, Rss, Settings2, Trash2, X } from 'lucide-react'
import type { NewsFeed, NewsItem, NewsSettings } from '@shared/modules/widgets'
import { invoke, on } from '../../lib/ipc'
import { timeAgo } from '../../lib/format'
import { Favicon } from '../../components/ui'
import { confirmAction, promptText } from '../../components/prompt'
import { newTab } from '../../stores/browser'
import { openMenu, toast } from '../../stores/ui'
import { errorText, useVisibleInterval } from './store'
import { ErrorState, siteFavicon } from './ui'
import './widgets.css'

export function useNews(filter: { feedId?: string; unreadOnly?: boolean; limit?: number }) {
  const [feeds, setFeeds] = useState<NewsFeed[]>([])
  const [items, setItems] = useState<NewsItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(() => {
    Promise.all([invoke('news:feeds'), invoke('news:items', filter)])
      .then(([f, i]) => {
        setFeeds(f)
        setItems(i)
        setError(null)
      })
      .catch((e) => setError(errorText(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.feedId, filter.unreadOnly, filter.limit])
  useEffect(() => {
    reload()
    return on('news:changed', reload)
  }, [reload])
  return { feeds, items, error, reload }
}

export function openItem(item: NewsItem, background = false): void {
  if (!item.link) return
  newTab(item.link, { background })
  if (!item.read) invoke('news:markRead', { ids: [item.id] }).catch(() => undefined)
}

function FeedManager({ feeds, onClose }: { feeds: NewsFeed[]; onClose: () => void }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [settings, setSettings] = useState<NewsSettings | null>(null)
  useEffect(() => {
    invoke('news:settings').then(setSettings).catch(() => undefined)
  }, [])
  const add = async () => {
    const u = url.trim()
    if (!u) return
    setBusy(true)
    try {
      const f = await invoke('news:addFeed', u)
      toast({ kind: 'ok', title: `Added ${f.title}`, body: `${f.total} items` })
      setUrl('')
    } catch (e) {
      toast({ kind: 'error', title: 'Could not add feed', body: errorText(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="wg-pad">
      <div className="wg-sec-h">
        <span className="label">Feeds</span>
        <span className="spacer" />
        <button className="icon-btn sm" onClick={onClose} aria-label="Done" data-tip="Back to articles">
          <X size={13} />
        </button>
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <input className="input grow" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Feed or website URL" aria-label="Feed URL" />
        <button className="btn sm primary" onClick={add} disabled={busy || !url.trim()}>
          {busy ? <RefreshCw size={12} className="wg-spin" /> : <Plus size={12} />} Add
        </button>
      </div>
      <div className="wg-feeds">
        {feeds.map((f) => (
          <div key={f.id} className="wg-feed">
            <Favicon src={siteFavicon(f.siteUrl || f.url)} url={f.siteUrl || f.url} size={14} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="ellipsis">{f.title}</div>
              <div className={'ellipsis wg-feed-s' + (f.lastError ? ' bad' : '')} title={f.url}>
                {f.lastError ? (
                  <>
                    <AlertTriangle size={10} /> {errorText(f.lastError)}
                  </>
                ) : f.lastFetched ? (
                  `${f.total} items · fetched ${timeAgo(f.lastFetched)}`
                ) : (
                  'Not fetched yet'
                )}
              </div>
            </div>
            <button
              className="icon-btn sm"
              aria-label="Rename feed"
              data-tip="Rename"
              onClick={async () => {
                const t = await promptText({ title: 'Rename feed', label: 'Name', initial: f.title })
                if (t) invoke('news:renameFeed', f.id, t).catch(() => undefined)
              }}
            >
              <Pencil size={12} />
            </button>
            <button
              className="icon-btn sm"
              aria-label="Remove feed"
              data-tip="Remove"
              onClick={async () => {
                if (await confirmAction(`Remove “${f.title}”?`, 'Its saved articles and read state are deleted.', 'Remove', true)) invoke('news:removeFeed', f.id).catch(() => undefined)
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {!feeds.length && <div className="wg-muted-row">No feeds. Add one above or restore the defaults.</div>}
      </div>
      <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        <span className="label">Refresh every</span>
        <select
          className="select"
          style={{ height: 26 }}
          value={settings?.intervalMin ?? 30}
          onChange={(e) =>
            invoke('news:setSettings', { intervalMin: Number(e.target.value) })
              .then(setSettings)
              .catch(() => undefined)
          }
          aria-label="Refresh interval"
        >
          {[10, 15, 30, 60, 120, 360].map((m) => (
            <option key={m} value={m}>
              {m < 60 ? `${m} min` : `${m / 60} h`}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => invoke('news:resetDefaults').catch(() => undefined)} data-tip="Re-add Hacker News, BBC World, The Verge and Ars Technica">
          <RotateCcw size={12} /> Restore defaults
        </button>
      </div>
      <p className="wg-fine">Feeds refresh only while the reader or a news widget is open. Articles open in a new tab; favicons load from each feed’s own site.</p>
    </div>
  )
}

export default function NewsPanel() {
  const [feedId, setFeedId] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [manage, setManage] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [interval, setIntervalMin] = useState(30)
  const filter = useMemo(() => ({ feedId: feedId || undefined, unreadOnly, limit: 150 }), [feedId, unreadOnly])
  const { feeds, items, error, reload } = useNews(filter)
  const feedById = useMemo(() => new Map(feeds.map((f) => [f.id, f])), [feeds])

  useEffect(() => {
    invoke('news:settings')
      .then((s) => setIntervalMin(s.intervalMin))
      .catch(() => undefined)
  }, [manage])

  const refresh = (force: boolean) => {
    setRefreshing(true)
    invoke('news:refresh', { force })
      .then((r) => {
        if (force && r.errors.length) toast({ kind: 'warn', title: `${r.errors.length} feed${r.errors.length > 1 ? 's' : ''} failed to refresh`, body: r.errors.map((e) => `${feedById.get(e.feedId)?.title ?? e.feedId}: ${errorText(e.error)}`).join('\n') })
      })
      .catch((e) => toast({ kind: 'error', title: 'Refresh failed', body: errorText(e) }))
      .finally(() => {
        setRefreshing(false)
        reload()
      })
  }
  // Refresh stale feeds when opened and on the user's interval — only while visible.
  useVisibleInterval(() => refresh(false), interval * 60_000, [interval])

  const totalUnread = feeds.reduce((s, f) => s + f.unread, 0)
  const lastFetched = feeds.reduce((m, f) => Math.max(m, f.lastFetched ?? 0), 0)

  if (manage) return <FeedManager feeds={feeds} onClose={() => setManage(false)} />

  return (
    <div className="wg wg-news">
      <div className="wg-toolbar">
        <select className="select grow" style={{ height: 26, minWidth: 0 }} value={feedId} onChange={(e) => setFeedId(e.target.value)} aria-label="Feed">
          <option value="">All feeds{totalUnread ? ` (${totalUnread})` : ''}</option>
          {feeds.map((f) => (
            <option key={f.id} value={f.id}>
              {f.title}
              {f.unread ? ` (${f.unread})` : ''}
            </option>
          ))}
        </select>
        <button className={'icon-btn sm' + (unreadOnly ? ' on' : '')} onClick={() => setUnreadOnly(!unreadOnly)} aria-pressed={unreadOnly} data-tip={unreadOnly ? 'Showing unread only' : 'Show unread only'} aria-label="Unread only">
          {unreadOnly ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
        <button className="icon-btn sm" onClick={() => invoke('news:markRead', feedId ? { feedId } : { all: true }).catch(() => undefined)} data-tip="Mark all as read" aria-label="Mark all as read">
          <CheckCheck size={13} />
        </button>
        <button className="icon-btn sm" onClick={() => refresh(true)} disabled={refreshing} data-tip="Refresh now" aria-label="Refresh">
          <RefreshCw size={13} className={refreshing ? 'wg-spin' : ''} />
        </button>
        <button className="icon-btn sm" onClick={() => setManage(true)} data-tip="Manage feeds" aria-label="Manage feeds">
          <Settings2 size={13} />
        </button>
      </div>
      {error && <ErrorState error={error} onRetry={reload} />}
      {items && !items.length && (
        <div className="empty">
          <Rss size={22} />
          <div>{refreshing ? 'Fetching feeds…' : unreadOnly ? 'All caught up.' : feeds.length ? 'No articles yet.' : 'No feeds — add one in Manage feeds.'}</div>
        </div>
      )}
      <div className="wg-items">
        {items?.map((it) => {
          const f = feedById.get(it.feedId)
          return (
            <a
              key={it.id}
              href={it.link || undefined}
              className={'wg-item' + (it.read ? ' read' : '')}
              onClick={(e) => {
                e.preventDefault()
                openItem(it, e.ctrlKey || e.metaKey)
              }}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  openItem(it, true)
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                openMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: [
                    { label: 'Open in background tab', run: () => openItem(it, true) },
                    { label: it.read ? 'Mark as unread' : 'Mark as read', run: () => invoke('news:markRead', { ids: [it.id], read: !it.read }).catch(() => undefined) },
                    { label: 'Copy link', run: () => invoke('app:clipboardWrite', it.link).catch(() => undefined) }
                  ]
                })
              }}
              title={it.link}
            >
              <Favicon src={siteFavicon(f?.siteUrl || f?.url || it.link)} url={f?.siteUrl || it.link} size={14} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="wg-item-t">{it.title}</div>
                {it.summary && <div className="wg-item-s">{it.summary}</div>}
                <div className="wg-item-m">
                  <span className="ellipsis">{f?.title ?? 'Feed'}</span>
                  {it.author && <span className="ellipsis"> · {it.author}</span>}
                  <span> · {timeAgo(it.published ?? it.fetchedAt)}</span>
                </div>
              </div>
              {!it.read && <span className="wg-unread-dot" aria-label="Unread" />}
            </a>
          )
        })}
      </div>
      <div className="wg-pad" style={{ paddingTop: 0 }}>
        <div className="wg-source">
          <span className="ellipsis">
            {feeds.length} RSS/Atom feeds{lastFetched ? ` · refreshed ${timeAgo(lastFetched)}` : ''} · every {interval < 60 ? `${interval} min` : `${interval / 60} h`} while open
          </span>
        </div>
      </div>
    </div>
  )
}
