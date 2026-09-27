import { useEffect, useState } from 'react'
import { MapPinned, Pencil, Plus, Trash2 } from 'lucide-react'
import { ADDRESS_KEYS, type Address, type AddressKey } from '@shared/addresses'
import { invoke, ipcErrorText, on } from '../lib/ipc'
import { Modal, Switch } from '../components/ui'
import { confirmAction } from '../components/prompt'
import { setSetting, useSetting } from '../stores/settings'
import { toast } from '../stores/ui'
import type { PageProps } from './registry'

const LABELS: Record<AddressKey, string> = {
  name: 'Name',
  organization: 'Company',
  street: 'Street address',
  city: 'City',
  state: 'State / province',
  postalCode: 'Postcode / ZIP',
  country: 'Country',
  email: 'Email',
  phone: 'Phone'
}

function regionName(code: string): string {
  if (!/^[a-z]{2}$/i.test(code)) return code
  try {
    return new Intl.DisplayNames([navigator.language, 'en'], { type: 'region' }).of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

export default function Addresses(_: PageProps) {
  const [list, setList] = useState<Address[] | null>(null)
  const [editing, setEditing] = useState<Address | 'new' | null>(null)
  const load = () => invoke('addresses:list').then(setList).catch(() => setList([]))
  useEffect(() => {
    void load()
    return on('addresses:changed', () => void load())
  }, [])

  return (
    <div className="page">
      <div className="page-h">
        <div className="grow">
          <div className="page-kicker">Browser</div>
          <h1 className="page-title">Addresses</h1>
          <div className="page-sub">Names, addresses, emails and phone numbers SPECTER can fill into forms · stored only on this PC</div>
        </div>
        <button className="btn" onClick={() => setEditing('new')}>
          <Plus size={14} /> Add
        </button>
      </div>

      <div className="section">
        <div className="card setting-group">
          <div className="setting">
            <div className="st-text">
              <div className="st-title">Suggest saved addresses</div>
              <div className="st-desc">Address and contact fields list your saved addresses; pick one to fill the form. Sites see an address only when you pick it.</div>
            </div>
            <AutofillSetting k="autofill.addresses" />
          </div>
          <div className="setting">
            <div className="st-text">
              <div className="st-title">Offer to save addresses</div>
              <div className="st-desc">After you send a form with a new address, SPECTER asks whether to keep it.</div>
            </div>
            <AutofillSetting k="autofill.saveAddresses" />
          </div>
        </div>
      </div>

      <div className="section">
        {list !== null && list.length === 0 && (
          <div className="empty">
            No saved addresses yet. Add one, fill in a form and save it, or import them from Chrome in Settings → Profiles.
          </div>
        )}
        {list && list.length > 0 && (
          <div className="card">
            {list.map((a) => (
              <div key={a.id} className="ad-row">
                <MapPinned size={16} className="accent" style={{ flex: 'none' }} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontWeight: 600 }}>
                    {a.name || a.organization || a.email || 'Address'}
                    {a.name && a.organization ? <span className="muted"> · {a.organization}</span> : null}
                  </div>
                  <div className="muted ellipsis" style={{ fontSize: 12 }}>
                    {[a.street.replace(/\n/g, ', '), a.city, a.state, a.postalCode, regionName(a.country)].filter(Boolean).join(', ')}
                  </div>
                  {(a.email || a.phone) && <div className="muted ellipsis" style={{ fontSize: 12 }}>{[a.email, a.phone].filter(Boolean).join(' · ')}</div>}
                </div>
                <button className="icon-btn sm" onClick={() => setEditing(a)} aria-label="Edit" data-tip="Edit">
                  <Pencil size={13} />
                </button>
                <button
                  className="icon-btn sm"
                  aria-label="Delete"
                  data-tip="Delete"
                  onClick={async () => {
                    if (await confirmAction('Delete this address?', [a.name, a.street.split('\n')[0], a.city].filter(Boolean).join(', '), 'Delete', true)) invoke('addresses:remove', a.id)
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && <EditAddress address={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function AutofillSetting({ k }: { k: 'autofill.addresses' | 'autofill.saveAddresses' }) {
  const v = useSetting(k)
  return <Switch on={!!v} onChange={(x) => setSetting(k, x)} />
}

function EditAddress({ address, onClose }: { address: Address | null; onClose: () => void }) {
  const [v, setV] = useState<Record<AddressKey, string>>(() => Object.fromEntries(ADDRESS_KEYS.map((k) => [k, address?.[k] ?? ''])) as Record<AddressKey, string>)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await invoke('addresses:save', { id: address?.id, ...v })
      onClose()
    } catch (err) {
      toast({ kind: 'error', title: 'Couldn’t save', body: ipcErrorText(err) })
    } finally {
      setBusy(false)
    }
  }
  const field = (k: AddressKey, wide = false) => (
    <label key={k} className="col" style={{ gap: 4, gridColumn: wide ? '1 / -1' : undefined }}>
      <span className="label">{LABELS[k]}</span>
      {k === 'street' ? (
        <textarea className="input" rows={2} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} style={{ resize: 'vertical', height: 'auto', padding: 8 }} />
      ) : (
        <input className="input" type={k === 'email' ? 'email' : k === 'phone' ? 'tel' : 'text'} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} spellCheck={false} />
      )}
    </label>
  )
  return (
    <Modal
      title={address ? 'Edit address' : 'Add address'}
      icon={<MapPinned size={16} />}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || ADDRESS_KEYS.every((k) => !v[k].trim())} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <form
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {field('name')}
        {field('organization')}
        {field('street', true)}
        {field('city')}
        {field('state')}
        {field('postalCode')}
        {field('country')}
        {field('email')}
        {field('phone')}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
