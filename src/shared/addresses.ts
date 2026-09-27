// Addresses & contact info (autofill): shared types, IPC contract and pure
// helpers — which form field wants what, what value goes in it, and how
// Chrome's stored addresses map onto SPECTER's. No Electron here.

export interface Address {
  id: string
  name: string
  organization: string
  /** Street lines, newline-separated. */
  street: string
  city: string
  state: string
  postalCode: string
  /** Country as given: an ISO code ("US") or a name. */
  country: string
  email: string
  phone: string
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
  timesUsed: number
}

export type AddressInput = Partial<Omit<Address, 'createdAt' | 'updatedAt' | 'lastUsedAt' | 'timesUsed'>>

export const ADDRESS_KEYS = ['name', 'organization', 'street', 'city', 'state', 'postalCode', 'country', 'email', 'phone'] as const
export type AddressKey = (typeof ADDRESS_KEYS)[number]

export interface AddressOffer {
  offerId: string
  webContentsId: number
  /** "Martin Nikolov, 1 Main St, Springfield" */
  summary: string
}

export interface AddressImportResult {
  added: number
  unchanged: number
}

declare module './ipc' {
  interface IpcContract {
    'addresses:list': () => Address[]
    'addresses:save': (input: AddressInput) => Address
    'addresses:remove': (id: string) => void
    'addresses:respondOffer': (offerId: string, action: 'save' | 'dismiss') => void
  }
  interface IpcEvents {
    'addresses:offer': AddressOffer
    'addresses:offerCancelled': { offerId: string }
    'addresses:changed': undefined
  }
}

// ---------------------------------------------------------------- form fields

/** What a form field asks for. */
export type FieldKind =
  | 'name'
  | 'given'
  | 'additional'
  | 'family'
  | 'organization'
  | 'street'
  | 'line1'
  | 'line2'
  | 'line3'
  | 'city'
  | 'state'
  | 'postal'
  | 'country'
  | 'email'
  | 'tel'

const AUTOCOMPLETE: Record<string, FieldKind> = {
  name: 'name',
  'given-name': 'given',
  'additional-name': 'additional',
  'family-name': 'family',
  organization: 'organization',
  'street-address': 'street',
  'address-line1': 'line1',
  'address-line2': 'line2',
  'address-line3': 'line3',
  'address-level2': 'city',
  'address-level1': 'state',
  'postal-code': 'postal',
  country: 'country',
  'country-name': 'country',
  email: 'email',
  tel: 'tel',
  'tel-national': 'tel'
}

// Checked in order: the specific ones first ("company name" is not a person's name).
const HINTS: [FieldKind, RegExp][] = [
  ['email', /e-?mail|courriel|correo/],
  ['tel', /phone|\btel\b|telephone|mobile|handy|telefon|cell/],
  ['postal', /zip|postal|post.?code|\bplz\b|pincode|pin.?code|\bcap\b|codigo.?postal/],
  ['country', /country|nation|\bland\b|\bpays\b|pa[ií]s/],
  ['state', /state|province|region|county|bundesland|provincia|prefecture/],
  ['city', /city|town|locality|suburb|\bort\b|stadt|ville|ciudad|citt[aà]/],
  ['organization', /company|organi[sz]ation|business|firma|employer/],
  ['line2', /address.?(line)?.?2|addr.?2|apartment|\bapt\b|suite|\bunit\b|flat|floor|building/],
  ['line3', /address.?(line)?.?3|addr.?3/],
  ['line1', /address.?(line)?.?1|addr.?1|street|stra(ss|ß)e|calle|\baddress\b|adresse|direcci[oó]n/],
  ['given', /first.?name|given|\bfname\b|forename|vorname|pr[ée]nom|nombre/],
  ['family', /last.?name|surname|family|\blname\b|nachname|apellido/],
  ['additional', /middle.?name|\bmname\b/],
  ['name', /full.?name|your.?name|^name$|\bname\b|recipient/]
]

/** Names that are not a person's (usernames, card holders, file names…). */
const NOT_A_PERSON = /user|login|account|card|company|file|nick|display|screen|search|coupon|promo|gift|captcha/

/**
 * What a field asks for, from its autocomplete attribute (authoritative) or its
 * name / id / placeholder / label text. `autocomplete="off"` doesn't stop it (sites
 * set it everywhere), but explicit non-address tokens (cc-number, one-time-code…) do.
 */
export function classifyField(f: { autocomplete?: string; type?: string; text: string }): FieldKind | null {
  const tokens = (f.autocomplete ?? '').toLowerCase().trim().split(/\s+/).filter(Boolean)
  for (let i = tokens.length - 1; i >= 0; i--) {
    const k = AUTOCOMPLETE[tokens[i]]
    if (k) return k
    if (/^(cc-|one-time-code|username|current-password|new-password|webauthn|bday|sex|url|photo|impp|language|transaction)/.test(tokens[i])) return null
  }
  const type = (f.type ?? '').toLowerCase()
  if (type === 'email') return 'email'
  if (type === 'tel') return 'tel'
  if (type && !['text', 'search', 'select-one', 'textarea', ''].includes(type)) return null
  const text = f.text.toLowerCase().replace(/[_\-[\]]+/g, ' ')
  if (!text.trim()) return null
  for (const [kind, re] of HINTS) {
    if (!re.test(text)) continue
    if ((kind === 'name' || kind === 'given' || kind === 'family') && NOT_A_PERSON.test(text)) return null
    return kind
  }
  return null
}

/** Splits "Anna Maria Smith" into given / additional / family names. */
export function splitName(name: string): { given: string; additional: string; family: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { given: '', additional: '', family: '' }
  if (parts.length === 1) return { given: parts[0], additional: '', family: '' }
  return { given: parts[0], additional: parts.slice(1, -1).join(' '), family: parts[parts.length - 1] }
}

/** The value an address gives a field of this kind ('' when it has none). */
export function valueFor(a: Pick<Address, AddressKey>, kind: FieldKind): string {
  const lines = a.street.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  switch (kind) {
    case 'name':
      return a.name
    case 'given':
    case 'additional':
    case 'family':
      return splitName(a.name)[kind]
    case 'organization':
      return a.organization
    case 'street':
      return lines.join('\n')
    case 'line1':
      return lines[0] ?? ''
    case 'line2':
      return lines[1] ?? ''
    case 'line3':
      return lines.slice(2).join(', ')
    case 'city':
      return a.city
    case 'state':
      return a.state
    case 'postal':
      return a.postalCode
    case 'country':
      return a.country
    case 'email':
      return a.email
    case 'tel':
      return a.phone
  }
}

/** Builds an address from the fields of a submitted form (kind → value). */
export function addressFromForm(fields: Partial<Record<FieldKind, string>>): Pick<Address, AddressKey> {
  const v = (k: FieldKind) => (fields[k] ?? '').trim()
  const name = v('name') || [v('given'), v('additional'), v('family')].filter(Boolean).join(' ')
  const street = v('street') || [v('line1'), v('line2'), v('line3')].filter(Boolean).join('\n')
  return { name, organization: v('organization'), street, city: v('city'), state: v('state'), postalCode: v('postal'), country: v('country'), email: v('email'), phone: v('tel') }
}

/** Worth offering to save: a postal address (street plus city or postcode). */
export function isSavableAddress(a: Pick<Address, AddressKey>): boolean {
  return !!a.street && !!(a.city || a.postalCode)
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** Two addresses are the same place when street and postcode (or city) match, ignoring case and punctuation. */
export function sameAddress(a: Pick<Address, AddressKey>, b: Pick<Address, AddressKey>): boolean {
  if (norm(a.street) !== norm(b.street)) return false
  return a.postalCode && b.postalCode ? norm(a.postalCode) === norm(b.postalCode) : norm(a.city) === norm(b.city)
}

/** "Martin Nikolov, 1 Main St, Springfield" — for suggestion lists and prompts. */
export function addressSummary(a: Pick<Address, AddressKey>): string {
  return [a.name || a.organization || a.email, a.street.split(/\r?\n/)[0], a.city].filter(Boolean).join(', ')
}

// ---------------------------------------------------------------- Chrome

/** Chrome's FieldType ids (components/autofill/core/browser/field_types.h). */
const CHROME: Record<number, string> = {
  3: 'first',
  4: 'middle',
  5: 'last',
  7: 'name',
  9: 'email',
  14: 'phone',
  30: 'line1',
  31: 'line2',
  83: 'line3',
  33: 'city',
  34: 'state',
  35: 'zip',
  36: 'country',
  60: 'company',
  77: 'street'
}

/** An address from Chrome's address_type_tokens rows of one guid. */
export function addressFromChromeTokens(tokens: { type: number; value: string | null }[]): Pick<Address, AddressKey> {
  const t: Record<string, string> = {}
  for (const { type, value } of tokens) if (CHROME[type] && value && value.trim()) t[CHROME[type]] = value.trim()
  return {
    name: t.name || [t.first, t.middle, t.last].filter(Boolean).join(' '),
    organization: t.company ?? '',
    street: t.street || [t.line1, t.line2, t.line3].filter(Boolean).join('\n'),
    city: t.city ?? '',
    state: t.state ?? '',
    postalCode: t.zip ?? '',
    country: t.country ?? '',
    email: t.email ?? '',
    phone: t.phone ?? ''
  }
}

/** Has anything worth keeping (Chrome also stores empty shells). */
export function isEmptyAddress(a: Pick<Address, AddressKey>): boolean {
  return ADDRESS_KEYS.every((k) => !a[k])
}
