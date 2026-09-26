// Persistence for sidebar web apps. Apps are scoped to the active browser
// profile (each profile has its own partition, so its own logins).
import type { WebApp, WebAppInput } from '@shared/modules/webapps'
import { catalogApp, clampZoom, cleanAppName, colorFor, hostOf, iconKey, isHexColor, normalizeAppUrl, WEBAPP_CATALOG } from '@shared/modules/webapps'
import { all, get, registerMigrations, run, tx, uid } from '../../db'

export function registerWebappMigrations(): void {
  registerMigrations('webapps', [
    `CREATE TABLE webapps (
       id TEXT PRIMARY KEY,
       profile_id TEXT NOT NULL,
       catalog_id TEXT,
       name TEXT NOT NULL,
       url TEXT NOT NULL,
       icon TEXT,
       color TEXT NOT NULL,
       mobile INTEGER NOT NULL DEFAULT 0,
       muted INTEGER NOT NULL DEFAULT 0,
       zoom REAL NOT NULL DEFAULT 1,
       notify INTEGER NOT NULL DEFAULT 1,
       badges INTEGER NOT NULL DEFAULT 1,
       width INTEGER,
       sort INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     );
     CREATE INDEX webapps_profile ON webapps(profile_id, sort);
     CREATE TABLE webapp_icons (host TEXT PRIMARY KEY, url TEXT NOT NULL, updated_at INTEGER NOT NULL);`
  ])
}

type Row = {
  id: string
  profile_id: string
  catalog_id: string | null
  name: string
  url: string
  icon: string | null
  color: string
  mobile: number
  muted: number
  zoom: number
  notify: number
  badges: number
  width: number | null
  sort: number
  created_at: number
}

const toApp = (r: Row): WebApp => ({
  id: r.id,
  catalogId: r.catalog_id,
  name: r.name,
  url: r.url,
  icon: r.icon,
  color: r.color,
  mobile: !!r.mobile,
  muted: !!r.muted,
  zoom: r.zoom,
  notify: !!r.notify,
  badges: !!r.badges,
  width: r.width,
  sort: r.sort,
  createdAt: r.created_at
})

const MAX_APPS = 60

export function listApps(profileId: string): WebApp[] {
  return all<Row>('SELECT * FROM webapps WHERE profile_id = ? ORDER BY sort, created_at', profileId).map(toApp)
}

function getApp(profileId: string, id: string): WebApp | undefined {
  const r = get<Row>('SELECT * FROM webapps WHERE id = ? AND profile_id = ?', id, profileId)
  return r ? toApp(r) : undefined
}

function cleanIcon(icon: unknown): string | null {
  if (typeof icon !== 'string' || !icon) return null
  if (/^https?:\/\//i.test(icon) && icon.length <= 2048) return icon
  if (/^data:image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|gif|webp|jpeg)[;,]/i.test(icon) && icon.length < 65536) return icon
  return null
}

function cleanWidth(w: unknown): number | null {
  return typeof w === 'number' && Number.isFinite(w) ? Math.round(Math.min(1600, Math.max(260, w))) : null
}

/** Inserts a new app or patches an existing one. Validates every field. */
export function saveApp(profileId: string, input: WebAppInput): WebApp {
  const now = Date.now()
  const existing = input.id ? getApp(profileId, input.id) : undefined
  if (existing) {
    const next: WebApp = { ...existing }
    if (input.name !== undefined) next.name = cleanAppName(input.name, existing.url)
    if (input.url !== undefined) {
      const u = normalizeAppUrl(input.url)
      if (!u) throw new Error('Enter a valid http(s) web address')
      if (iconKey(u) !== iconKey(existing.url)) next.icon = knownIcon(u)
      next.url = u
    }
    if (input.icon !== undefined) next.icon = cleanIcon(input.icon)
    if (input.color !== undefined && isHexColor(input.color)) next.color = input.color
    if (input.mobile !== undefined) next.mobile = !!input.mobile
    if (input.muted !== undefined) next.muted = !!input.muted
    if (input.zoom !== undefined) next.zoom = clampZoom(input.zoom)
    if (input.notify !== undefined) next.notify = !!input.notify
    if (input.badges !== undefined) next.badges = !!input.badges
    if (input.width !== undefined) next.width = cleanWidth(input.width)
    run(
      'UPDATE webapps SET name=?, url=?, icon=?, color=?, mobile=?, muted=?, zoom=?, notify=?, badges=?, width=?, updated_at=? WHERE id=? AND profile_id=?',
      next.name,
      next.url,
      next.icon,
      next.color,
      next.mobile ? 1 : 0,
      next.muted ? 1 : 0,
      next.zoom,
      next.notify ? 1 : 0,
      next.badges ? 1 : 0,
      next.width,
      now,
      next.id,
      profileId
    )
    if (next.icon && input.icon !== undefined) rememberIcon(next.url, next.icon)
    return next
  }

  const count = get<{ n: number }>('SELECT COUNT(*) AS n FROM webapps WHERE profile_id = ?', profileId)?.n ?? 0
  if (count >= MAX_APPS) throw new Error(`You can add up to ${MAX_APPS} web apps`)
  const cat = catalogApp(input.catalogId)
  if (input.catalogId && !cat) throw new Error('Unknown catalog app')
  if (cat && get('SELECT id FROM webapps WHERE profile_id = ? AND catalog_id = ?', profileId, cat.id)) throw new Error(`${cat.name} is already in your sidebar`)
  const url = normalizeAppUrl(input.url ?? cat?.url)
  if (!url) throw new Error('Enter a valid http(s) web address')
  const name = cleanAppName(input.name ?? cat?.name, url)
  const sort = (get<{ m: number | null }>('SELECT MAX(sort) AS m FROM webapps WHERE profile_id = ?', profileId)?.m ?? -1) + 1
  const app: WebApp = {
    id: uid('wa_'),
    catalogId: cat?.id ?? null,
    name,
    url,
    icon: cleanIcon(input.icon) ?? knownIcon(url),
    color: isHexColor(input.color) ? input.color : (cat?.color ?? colorFor(hostOf(url) || name)),
    mobile: input.mobile ?? !!cat?.mobile,
    muted: !!input.muted,
    zoom: clampZoom(input.zoom ?? 1),
    notify: input.notify ?? true,
    badges: input.badges ?? !cat?.noBadges,
    width: cleanWidth(input.width ?? cat?.width),
    sort,
    createdAt: now
  }
  run(
    'INSERT INTO webapps(id, profile_id, catalog_id, name, url, icon, color, mobile, muted, zoom, notify, badges, width, sort, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    app.id,
    profileId,
    app.catalogId,
    app.name,
    app.url,
    app.icon,
    app.color,
    app.mobile ? 1 : 0,
    app.muted ? 1 : 0,
    app.zoom,
    app.notify ? 1 : 0,
    app.badges ? 1 : 0,
    app.width,
    app.sort,
    now,
    now
  )
  return app
}

export function deleteApp(profileId: string, id: string): void {
  run('DELETE FROM webapps WHERE id = ? AND profile_id = ?', id, profileId)
}

export function reorderApps(profileId: string, ids: string[]): void {
  if (!Array.isArray(ids)) return
  tx(() => {
    ids.slice(0, MAX_APPS * 2).forEach((id, i) => {
      if (typeof id === 'string') run('UPDATE webapps SET sort = ? WHERE id = ? AND profile_id = ?', i, id, profileId)
    })
  })
}

// ------------------------------------------------------------------ favicon cache

function rememberIcon(pageUrl: string, icon: string): void {
  const host = iconKey(pageUrl)
  if (!host) return
  run('INSERT INTO webapp_icons(host, url, updated_at) VALUES(?,?,?) ON CONFLICT(host) DO UPDATE SET url = excluded.url, updated_at = excluded.updated_at', host, icon, Date.now())
}

function knownIcon(url: string): string | null {
  const host = iconKey(url)
  return host ? (get<{ url: string }>('SELECT url FROM webapp_icons WHERE host = ?', host)?.url ?? null) : null
}

/** host → favicon for every catalog host we've seen (used for picker tiles). */
export function iconCache(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of all<{ host: string; url: string }>('SELECT host, url FROM webapp_icons ORDER BY updated_at DESC LIMIT 500')) out[r.host] = r.url
  return out
}

export function catalogSize(): number {
  return WEBAPP_CATALOG.length
}
