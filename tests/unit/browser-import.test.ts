import { describe, expect, it } from 'vitest'
import { chromeColor, chromiumProfileInfo, profileDisplayName } from '@shared/browserImport'

describe('chromeColor', () => {
  it('converts signed ARGB integers', () => {
    expect(chromeColor(-16777216)).toBe('#000000')
    expect(chromeColor(-12627531)).toBe('#3f51b5')
    expect(chromeColor(0xff1a73e8 | 0)).toBe('#1a73e8')
  })
  it('ignores missing values', () => {
    expect(chromeColor(undefined)).toBeUndefined()
    expect(chromeColor('red')).toBeUndefined()
  })
})

describe('chromiumProfileInfo', () => {
  it('reads names, accounts and colours from Local State', () => {
    const m = chromiumProfileInfo({
      profile: {
        info_cache: {
          Default: { name: 'Your Chrome', user_name: '', profile_highlight_color: -12627531 },
          'Profile 1': { name: 'Work', user_name: 'me@work.test', default_avatar_fill_color: -1 },
          'Profile 2': { name: '  ', gaia_given_name: 'Sam' }
        }
      }
    })
    expect(m.get('Default')).toEqual({ dir: 'Default', label: 'Your Chrome', account: undefined, color: '#3f51b5' })
    expect(m.get('Profile 1')).toEqual({ dir: 'Profile 1', label: 'Work', account: 'me@work.test', color: '#ffffff' })
    expect(m.get('Profile 2')?.label).toBe('Sam')
  })
  it('survives a broken or missing file', () => {
    expect(chromiumProfileInfo(null).size).toBe(0)
    expect(chromiumProfileInfo({ profile: { info_cache: 'x' } }).size).toBe(0)
  })
})

describe('profileDisplayName', () => {
  it('adds the folder name when there is a label', () => {
    expect(profileDisplayName('Profile 1', 'Work')).toBe('Work (Profile 1)')
    expect(profileDisplayName('Default')).toBe('Default')
  })
})
