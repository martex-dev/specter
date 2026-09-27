// Addresses & contact info for form autofill, per profile in specter.db. The
// page side is src/preload/autofill.ts: it lists saved addresses under address
// fields and asks for one only after a real click on it (so a site sees an
// address only when the user chooses to give it one), and reports submitted
// address forms so SPECTER can offer to save them.
import { ipcMain, session as electronSession, webContents, type IpcMainEvent, type IpcMainInvokeEvent, type Session, type WebContents } from 'electron'
import { join } from 'node:path'
import {
  ADDRESS_KEYS,
  addressFromForm,
  addressSummary,
  isEmptyAddress,
  isSavableAddress,
  sameAddress,
  type Address,
  type AddressInput,
  type AddressKey,
  type FieldKind
} from '@shared/addresses'
import { all, get, registerMigrations, run, uid } from '../db'
import { broadcast, handle, sendTo } from '../ipc'
import { createLogger } from '../logger'
import { owningGuestOf } from '../guest'
import { activeProfileId } from './profiles'
import { getSetting } from './settings'

const log = createLogger('addresses')

registerMigrations('addresses', [
  `CREATE TABLE addresses (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    organization TEXT NOT NULL DEFAULT '',
    street TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT '',
    postal_code TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_used_at INTEGER,
    times_used INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_addresses_profile ON addresses(profile_id);`
])

type Row = {
  id: string
  name: string
  organization: string
  street: string
  city: string
  state: string
  postal_code: string
  country: string
  email: string
  phone: string
  created_at: number
  updated_at: number
  last_used_at: number | null
  times_used: number
}

const toAddress = (r: Row): Address => ({
  id: r.id,
  name: r.name,
  organization: r.organization,
  street: r.street,
  city: r.city,
  state: r.state,
  postalCode: r.postal_code,
  country: r.country,
  email: r.email,
  phone: r.phone,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastUsedAt: r.last_used_at ?? undefined,
  timesUsed: r.times_used
})

const COLUMN: Record<AddressKey, string> = {
  name: 'name',
  organization: 'organization',
  street: 'street',
  city: 'city',
  state: 'state',
  postalCode: 'postal_code',
  country: 'country',
  email: 'email',
  phone: 'phone'
}

const clean = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export function listAddresses(profileId = activeProfileId()): Address[] {
  return all<Row>('SELECT * FROM addresses WHERE profile_id = ? ORDER BY COALESCE(last_used_at, updated_at) DESC', profileId).map(toAddress)
}

const changed = () => broadcast('addresses:changed', undefined)

/**
 * Adds an address unless the profile already has the same place (then nothing
 * changes). Returns whether it was added. Used by saving, importing and the UI.
 */
export function addAddress(input: Pick<Address, AddressKey>, profileId = activeProfileId()): boolean {
  const a = Object.fromEntries(ADDRESS_KEYS.map((k) => [k, clean(input[k], k === 'street' ? 1000 : 500)])) as Pick<Address, AddressKey>
  if (isEmptyAddress(a)) return false
  if (listAddresses(profileId).some((x) => (a.street ? sameAddress(x, a) : !x.street && x.name === a.name && x.email === a.email && x.phone === a.phone))) return false
  const now = Date.now()
  run(
    `INSERT INTO addresses(id, profile_id, ${ADDRESS_KEYS.map((k) => COLUMN[k]).join(', ')}, created_at, updated_at) VALUES(?,?,${ADDRESS_KEYS.map(() => '?').join(',')},?,?)`,
    uid('ad_'),
    profileId,
    ...ADDRESS_KEYS.map((k) => a[k]),
    now,
    now
  )
  return true
}

// ---------------------------------------------------------------- save offers

const offers = new Map<string, { hostId: number; tabWcId: number; address: Pick<Address, AddressKey>; timer: NodeJS.Timeout }>()

function dropOffer(offerId: string, notify: boolean): void {
  const o = offers.get(offerId)
  if (!o) return
  clearTimeout(o.timer)
  offers.delete(offerId)
  if (notify) sendTo(o.hostId, 'addresses:offerCancelled', { offerId })
}

function offerToSave(wc: WebContents, fields: Partial<Record<FieldKind, string>>): void {
  if (!getSetting('autofill.saveAddresses')) return
  const address = addressFromForm(fields)
  if (!isSavableAddress(address)) return
  const known = listAddresses().find((x) => sameAddress(x, address))
  if (known) {
    run('UPDATE addresses SET last_used_at = ?, times_used = times_used + 1 WHERE id = ?', Date.now(), known.id)
    return
  }
  const tabId = owningGuestOf(wc.id)
  const tab = tabId !== undefined ? webContents.fromId(tabId) : undefined
  const host = tab?.hostWebContents
  if (!tab || !host || host.isDestroyed()) return
  for (const [id, o] of offers) if (o.tabWcId === tab.id) dropOffer(id, true)
  const offerId = uid('ado_')
  offers.set(offerId, { hostId: host.id, tabWcId: tab.id, address, timer: setTimeout(() => dropOffer(offerId, true), 10 * 60_000) })
  tab.once('destroyed', () => dropOffer(offerId, false))
  sendTo(host.id, 'addresses:offer', { offerId, webContentsId: tab.id, summary: addressSummary(address) })
}

// ---------------------------------------------------------------- page side

/** Only web pages in tabs, web-app panels and their pop-ups — never SPECTER's own UI. */
function fromWebPage(e: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const wc = e.sender
  if (wc.isDestroyed() || wc.session === electronSession.defaultSession) return false
  const t = wc.getType()
  const url = e.senderFrame?.url ?? ''
  return (t === 'webview' || t === 'window') && /^https?:/.test(url)
}

const FIELD_KINDS = new Set<FieldKind>(['name', 'given', 'additional', 'family', 'organization', 'street', 'line1', 'line2', 'line3', 'city', 'state', 'postal', 'country', 'email', 'tel'])

function registerGuestIpc(): void {
  // The list shows who and where, never the whole record, until one is picked.
  ipcMain.handle('specter-af:query', (e) => {
    if (!fromWebPage(e) || !getSetting('autofill.addresses')) return []
    return listAddresses()
      .slice(0, 8)
      .map((a) => ({ id: a.id, title: a.name || a.organization || a.email || a.street.split('\n')[0], sub: [a.street.split('\n')[0], a.city, a.email].filter(Boolean).join(', ') }))
  })

  ipcMain.handle('specter-af:fill', (e, id: unknown) => {
    if (!fromWebPage(e) || typeof id !== 'string' || !getSetting('autofill.addresses')) return null
    const r = get<Row>('SELECT * FROM addresses WHERE id = ? AND profile_id = ?', id, activeProfileId())
    if (!r) return null
    run('UPDATE addresses SET last_used_at = ?, times_used = times_used + 1 WHERE id = ?', Date.now(), r.id)
    const { id: _id, createdAt: _c, updatedAt: _u, lastUsedAt: _l, timesUsed: _t, ...address } = toAddress(r)
    return address
  })

  ipcMain.on('specter-af:submitted', (e, fields: unknown) => {
    if (!fromWebPage(e) || !fields || typeof fields !== 'object') return
    const f: Partial<Record<FieldKind, string>> = {}
    for (const [k, v] of Object.entries(fields as Record<string, unknown>)) if (FIELD_KINDS.has(k as FieldKind) && typeof v === 'string') f[k as FieldKind] = v.slice(0, 1000)
    try {
      offerToSave(e.sender, f)
    } catch (err) {
      log.warn('could not offer to save an address', err)
    }
  })

  ipcMain.on('specter-af:manage', (e) => {
    if (!fromWebPage(e)) return
    const tabId = owningGuestOf(e.sender.id)
    const host = tabId !== undefined ? webContents.fromId(tabId)?.hostWebContents : undefined
    if (host) sendTo(host.id, 'command:run', { id: 'browser.openUrl', args: { url: 'specter://addresses' } })
  })
}

const attached = new WeakSet<Session>()
/** Registers the page-side autofill preload on a profile session. */
export function attachAutofill(ses: Session): void {
  if (attached.has(ses)) return
  attached.add(ses)
  try {
    ses.registerPreloadScript({ type: 'frame', id: 'specter-autofill', filePath: join(__dirname, '../preload/autofill.js') })
  } catch (err) {
    log.warn('could not register the autofill preload', err)
  }
}

// ---------------------------------------------------------------- UI

export function registerAddressesIpc(): void {
  registerGuestIpc()

  handle('addresses:list', () => listAddresses())

  handle('addresses:save', (_e, input: AddressInput) => {
    const values = Object.fromEntries(ADDRESS_KEYS.map((k) => [k, clean(input[k], k === 'street' ? 1000 : 500)])) as Pick<Address, AddressKey>
    if (isEmptyAddress(values)) throw new Error('Fill in at least one field.')
    if (input.id) {
      const cur = get<Row>('SELECT * FROM addresses WHERE id = ? AND profile_id = ?', input.id, activeProfileId())
      if (!cur) throw new Error('This address no longer exists.')
      run(`UPDATE addresses SET ${ADDRESS_KEYS.map((k) => COLUMN[k] + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`, ...ADDRESS_KEYS.map((k) => values[k]), Date.now(), cur.id)
      changed()
      return toAddress(get<Row>('SELECT * FROM addresses WHERE id = ?', cur.id)!)
    }
    const now = Date.now()
    const id = uid('ad_')
    run(
      `INSERT INTO addresses(id, profile_id, ${ADDRESS_KEYS.map((k) => COLUMN[k]).join(', ')}, created_at, updated_at) VALUES(?,?,${ADDRESS_KEYS.map(() => '?').join(',')},?,?)`,
      id,
      activeProfileId(),
      ...ADDRESS_KEYS.map((k) => values[k]),
      now,
      now
    )
    changed()
    return toAddress(get<Row>('SELECT * FROM addresses WHERE id = ?', id)!)
  })

  handle('addresses:remove', (_e, id) => {
    run('DELETE FROM addresses WHERE id = ? AND profile_id = ?', id, activeProfileId())
    changed()
  })

  handle('addresses:respondOffer', (_e, offerId, action) => {
    const o = offers.get(offerId)
    if (!o) return
    dropOffer(offerId, false)
    if (action === 'save' && addAddress(o.address)) {
      log.info('address saved')
      changed()
    }
  })
}
