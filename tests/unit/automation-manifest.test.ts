import { describe, expect, it } from 'vitest'
import { EXAMPLE_PLUGIN, validateManifest } from '../../src/main/modules/automation/manifest'

const base = {
  id: 'my-plugin',
  name: 'My plugin',
  version: '1.2.3',
  permissions: ['tabs', 'notifications'],
  commands: [{ id: 'open', title: 'Open', actions: [{ type: 'openUrl', url: 'https://example.com' }] }],
  events: [],
  settings: []
}

describe('plugin manifest validation', () => {
  it('accepts the bundled example plugin', () => {
    const r = validateManifest(JSON.parse(JSON.stringify(EXAMPLE_PLUGIN)), EXAMPLE_PLUGIN.id)
    expect(r.ok).toBe(true)
  })

  it('accepts a minimal valid manifest', () => {
    const r = validateManifest(base, 'my-plugin')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.manifest.commands[0].id).toBe('open')
  })

  it('requires the folder name to equal the id', () => {
    const r = validateManifest(base, 'other')
    expect(r.ok).toBe(false)
  })

  it('rejects unknown fields (strict schema)', () => {
    expect(validateManifest({ ...base, main: 'index.js' }).ok).toBe(false)
    expect(validateManifest({ ...base, commands: [{ ...base.commands[0], script: 'x' }] }).ok).toBe(false)
  })

  it('rejects code-execution style actions', () => {
    const r = validateManifest({ ...base, commands: [{ id: 'x', title: 'X', actions: [{ type: 'exec', command: 'calc.exe' }] }] })
    expect(r.ok).toBe(false)
    const r2 = validateManifest({ ...base, commands: [{ id: 'x', title: 'X', actions: [{ type: 'openUrl', url: 'file:///C:/Windows' }] }] })
    expect(r2.ok).toBe(false)
  })

  it('requires permissions for every action', () => {
    const r = validateManifest({ ...base, permissions: ['notifications'] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/requires the "tabs" permission/)
  })

  it('requires the events permission for event handlers', () => {
    const events = [{ trigger: { type: 'event', event: 'TAB_CREATED' }, actions: [{ type: 'notify', title: 'x' }] }]
    expect(validateManifest({ ...base, events }).ok).toBe(false)
    expect(validateManifest({ ...base, events, permissions: ['tabs', 'notifications', 'events'] }).ok).toBe(true)
  })

  it('validates ids, versions, settings and ui', () => {
    expect(validateManifest({ ...base, id: 'Bad Id' }).ok).toBe(false)
    expect(validateManifest({ ...base, version: 'one' }).ok).toBe(false)
    expect(validateManifest({ ...base, permissions: ['filesystem'] }).ok).toBe(false)
    expect(validateManifest({ ...base, settings: [{ key: 'user', title: 'User', type: 'string', default: 3 }] }).ok).toBe(false)
    expect(validateManifest({ ...base, settings: [{ key: 'user', title: 'User', type: 'string', default: 'me' }] }).ok).toBe(true)
    expect(validateManifest({ ...base, ui: { quickLinks: [{ title: 'x', url: 'http://insecure.example' }] } }).ok).toBe(false)
    expect(validateManifest({ ...base, ui: { sidePanelUrl: 'https://example.com' } }).ok).toBe(true)
    expect(validateManifest({ ...base, commands: [base.commands[0], base.commands[0]] }).ok).toBe(false)
    expect(validateManifest('not an object').ok).toBe(false)
  })
})
