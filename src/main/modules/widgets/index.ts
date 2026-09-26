// Widgets — main-process module entry.
//
// Weather (Open-Meteo), news/RSS, calendar + ICS import + reminders, speed
// test (Cloudflare), currency rates, and a small key-value store for the
// purely local widgets (clocks, sticky notes, countdowns, preferences).
import { isDbOpen } from '../../db'
import { handle } from '../../ipc'
import { registerDiagnostic } from '../../services/diagnostics'
import { deleteEvent, eventCount, importIcs, initCalendar, listEvents, saveEvent, scheduleReminders, upcomingEvents } from './calendar'
import { fxRates, initCurrency } from './currency'
import { addFeed, listFeeds, listItems, markRead, newsSettings, refresh, removeFeed, renameFeed, resetDefaultFeeds, setNewsSettings, unreadCount } from './news'
import { cancelSpeedTest, clearSpeedHistory, runSpeedTest, speedHistory } from './speedtest'
import { isKvKey, kvGet, kvSet } from './store'
import { forecast, initWeather, searchPlaces } from './weather'

export function register(): void {
  initWeather()
  initCurrency()
  initCalendar()

  handle('weather:search', (_e, q) => searchPlaces(q))
  handle('weather:forecast', (_e, place, force) => forecast(place, !!force))

  handle('news:feeds', () => listFeeds())
  handle('news:addFeed', (_e, url) => addFeed(url))
  handle('news:removeFeed', (_e, id) => removeFeed(id))
  handle('news:renameFeed', (_e, id, title) => renameFeed(id, title))
  handle('news:refresh', (_e, opts) => refresh(opts ?? {}))
  handle('news:items', (_e, q) => listItems(q ?? {}))
  handle('news:markRead', (_e, q) => markRead(q ?? {}))
  handle('news:unread', () => unreadCount())
  handle('news:settings', () => newsSettings())
  handle('news:setSettings', (_e, s) => setNewsSettings(s ?? {}))
  handle('news:resetDefaults', () => resetDefaultFeeds())

  handle('widgets:kvGet', (_e, key) => {
    if (!isKvKey(key)) throw new Error('Unknown widget key')
    return kvGet<unknown>(key, null)
  })
  handle('widgets:kvSet', (_e, key, value) => {
    if (!isKvKey(key)) throw new Error('Unknown widget key')
    kvSet(key, value)
  })

  handle('widgets:calList', (_e, from, to) => listEvents(from, to))
  handle('widgets:calUpcoming', (_e, limit) => upcomingEvents(limit))
  handle('widgets:calSave', (_e, ev) => saveEvent(ev))
  handle('widgets:calDelete', (_e, id) => deleteEvent(id))
  handle('widgets:calImportIcs', (e) => importIcs(e))

  handle('widgets:speedRun', (_e, opts) => runSpeedTest(opts ?? { upload: true }))
  handle('widgets:speedCancel', () => cancelSpeedTest())
  handle('widgets:speedHistory', () => speedHistory())
  handle('widgets:speedClear', () => clearSpeedHistory())

  handle('widgets:fxRates', (_e, force) => fxRates(!!force))

  registerDiagnostic(() => {
    try {
      const feeds = listFeeds()
      const failing = feeds.filter((f) => f.lastError)
      return {
        id: 'widgets',
        label: 'Widgets',
        status: failing.length && failing.length === feeds.length ? 'warn' : 'ok',
        detail: `${feeds.length} news feeds (${failing.length} failing), ${unreadCount()} unread · ${eventCount()} calendar events`
      }
    } catch (err) {
      return { id: 'widgets', label: 'Widgets', status: 'unknown', detail: err instanceof Error ? err.message : String(err) }
    }
  })

  // Arm the reminder timer once the database is available.
  const arm = () => (isDbOpen() ? scheduleReminders() : setTimeout(arm, 2000))
  setTimeout(arm, 3000)
}
