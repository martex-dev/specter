import { describe, expect, it } from 'vitest'
import { addressFromChromeTokens, addressFromForm, addressSummary, classifyField, isSavableAddress, sameAddress, splitName, valueFor } from '@shared/addresses'

const home = { name: 'Anna Maria Smith', organization: 'Acme', street: '1 Main St\nApt 4', city: 'Springfield', state: 'IL', postalCode: '62701', country: 'US', email: 'anna@example.test', phone: '+1 555 0100' }

describe('classifyField', () => {
  it('trusts autocomplete tokens, including section and shipping prefixes', () => {
    expect(classifyField({ autocomplete: 'shipping address-line1', text: '' })).toBe('line1')
    expect(classifyField({ autocomplete: 'section-a billing postal-code', text: '' })).toBe('postal')
    expect(classifyField({ autocomplete: 'given-name', text: 'x' })).toBe('given')
    expect(classifyField({ autocomplete: 'address-level2', text: '' })).toBe('city')
  })
  it('stays away from card, one-time-code and login fields', () => {
    expect(classifyField({ autocomplete: 'cc-name', text: 'name on card' })).toBeNull()
    expect(classifyField({ autocomplete: 'one-time-code', text: 'code' })).toBeNull()
    expect(classifyField({ autocomplete: 'username', text: 'email' })).toBeNull()
    expect(classifyField({ type: 'password', text: 'password' })).toBeNull()
    expect(classifyField({ text: 'username' })).toBeNull()
    expect(classifyField({ text: 'company name' })).toBe('organization')
  })
  it('reads names, ids and labels', () => {
    expect(classifyField({ text: 'billing_zip' })).toBe('postal')
    expect(classifyField({ text: 'First name' })).toBe('given')
    expect(classifyField({ text: 'lastName' })).toBe('family')
    expect(classifyField({ text: 'Street address' })).toBe('line1')
    expect(classifyField({ text: 'Apartment, suite, etc.' })).toBe('line2')
    expect(classifyField({ text: 'Town / City' })).toBe('city')
    expect(classifyField({ text: 'State / Province' })).toBe('state')
    expect(classifyField({ text: 'Country/Region' })).toBe('country')
    expect(classifyField({ text: 'Full name' })).toBe('name')
    expect(classifyField({ type: 'tel', text: 'x' })).toBe('tel')
    expect(classifyField({ text: 'Postleitzahl PLZ' })).toBe('postal')
    expect(classifyField({ text: 'search' })).toBeNull()
  })
})

describe('values', () => {
  it('splits names', () => {
    expect(splitName('Anna Maria Smith')).toEqual({ given: 'Anna', additional: 'Maria', family: 'Smith' })
    expect(splitName('Cher')).toEqual({ given: 'Cher', additional: '', family: '' })
  })
  it('gives each field kind its value', () => {
    expect(valueFor(home, 'given')).toBe('Anna')
    expect(valueFor(home, 'family')).toBe('Smith')
    expect(valueFor(home, 'line1')).toBe('1 Main St')
    expect(valueFor(home, 'line2')).toBe('Apt 4')
    expect(valueFor(home, 'line3')).toBe('')
    expect(valueFor(home, 'street')).toBe('1 Main St\nApt 4')
    expect(valueFor(home, 'postal')).toBe('62701')
    expect(valueFor(home, 'tel')).toBe('+1 555 0100')
  })
})

describe('saving from forms', () => {
  it('assembles an address from split fields', () => {
    const a = addressFromForm({ given: 'Anna', family: 'Smith', line1: '1 Main St', line2: 'Apt 4', city: 'Springfield', postal: '62701', email: 'anna@example.test' })
    expect(a.name).toBe('Anna Smith')
    expect(a.street).toBe('1 Main St\nApt 4')
    expect(isSavableAddress(a)).toBe(true)
    expect(isSavableAddress(addressFromForm({ name: 'Anna', email: 'a@b.test' }))).toBe(false)
  })
  it('recognises the same place written differently', () => {
    expect(sameAddress(home, { ...home, street: '1 main st.\napt. 4', postalCode: '62701 ' })).toBe(true)
    expect(sameAddress(home, { ...home, postalCode: '62702' })).toBe(false)
  })
  it('summarises', () => {
    expect(addressSummary(home)).toBe('Anna Maria Smith, 1 Main St, Springfield')
  })
})

describe('addressFromChromeTokens', () => {
  it("maps Chrome's field types", () => {
    const a = addressFromChromeTokens([
      { type: 3, value: 'Anna' },
      { type: 5, value: 'Smith' },
      { type: 7, value: 'Anna Smith' },
      { type: 77, value: '1 Main St\nApt 4' },
      { type: 30, value: '1 Main St' },
      { type: 33, value: 'Springfield' },
      { type: 34, value: 'IL' },
      { type: 35, value: '62701' },
      { type: 36, value: 'US' },
      { type: 9, value: 'anna@example.test' },
      { type: 14, value: '+15550100' },
      { type: 60, value: '' },
      { type: 999, value: 'ignored' }
    ])
    expect(a).toEqual({ name: 'Anna Smith', organization: '', street: '1 Main St\nApt 4', city: 'Springfield', state: 'IL', postalCode: '62701', country: 'US', email: 'anna@example.test', phone: '+15550100' })
  })
  it('builds name and street from parts when the combined ones are missing', () => {
    const a = addressFromChromeTokens([
      { type: 3, value: 'Anna' },
      { type: 5, value: 'Smith' },
      { type: 30, value: '1 Main St' },
      { type: 31, value: 'Apt 4' }
    ])
    expect(a.name).toBe('Anna Smith')
    expect(a.street).toBe('1 Main St\nApt 4')
  })
})
