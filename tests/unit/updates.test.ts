import { describe, expect, it } from 'vitest'
import {
  canAutoInstall,
  compareVersions,
  describeUpdateState,
  detectUpdateMode,
  initialUpdateState,
  isLoopbackFeed,
  summarizeUpdateError,
  updateReducer,
  type UpdateEvent,
  type UpdateState
} from '../../src/shared/updates'

const base = { isPackaged: true, platform: 'win32', hasUpdateConfig: true, hasUninstaller: true }

describe('detectUpdateMode', () => {
  it('is inert in development', () => {
    expect(detectUpdateMode({ ...base, isPackaged: false })).toBe('dev')
  })
  it('uses the real updater only for NSIS installs', () => {
    expect(detectUpdateMode(base)).toBe('nsis')
    expect(canAutoInstall('nsis')).toBe(true)
  })
  it('falls back to notify-only for portable builds even though app-update.yml exists', () => {
    expect(detectUpdateMode({ ...base, portableDir: 'C:\\Users\\me\\Downloads', hasUninstaller: false })).toBe('portable')
    expect(detectUpdateMode({ ...base, portableDir: 'D:\\apps' })).toBe('portable')
    expect(canAutoInstall('portable')).toBe(false)
  })
  it('treats an unpacked folder (no uninstaller or no update config) as notify-only', () => {
    expect(detectUpdateMode({ ...base, hasUninstaller: false })).toBe('unpacked')
    expect(detectUpdateMode({ ...base, hasUpdateConfig: false })).toBe('unpacked')
  })
  it('does not auto-install on other platforms', () => {
    expect(detectUpdateMode({ ...base, platform: 'linux' })).toBe('other')
    expect(detectUpdateMode({ ...base, platform: 'darwin' })).toBe('other')
  })
  it('an empty portable dir variable is not portable', () => {
    expect(detectUpdateMode({ ...base, portableDir: '' })).toBe('nsis')
  })
})

const run = (s: UpdateState, ...events: UpdateEvent[]) => events.reduce(updateReducer, s)
const fresh = () => initialUpdateState('nsis', '0.2.0', true)

describe('updateReducer', () => {
  it('walks checking → available → downloading → ready', () => {
    let s = run(fresh(), { type: 'checking' })
    expect(s.phase).toBe('checking')
    s = run(s, { type: 'available', version: '0.2.1', releaseUrl: 'u', at: 5 })
    expect(s).toMatchObject({ phase: 'available', latest: '0.2.1', lastCheck: 5 })
    s = run(s, { type: 'progress', progress: { percent: 42.7, transferred: 42, total: 100, bytesPerSecond: 10 } })
    expect(s.phase).toBe('downloading')
    expect(describeUpdateState(s)).toBe('Downloading SPECTER 0.2.1 — 42%')
    s = run(s, { type: 'downloaded', version: '0.2.1' })
    expect(s).toMatchObject({ phase: 'ready', latest: '0.2.1', releaseUrl: 'u', progress: undefined })
    expect(describeUpdateState(s)).toBe('SPECTER 0.2.1 is ready — restart to update.')
  })

  it('reports up to date with the check time', () => {
    const s = run(fresh(), { type: 'checking' }, { type: 'up-to-date', latest: '0.2.0', at: 9 })
    expect(s).toMatchObject({ phase: 'up-to-date', lastCheck: 9 })
    expect(describeUpdateState(s)).toMatch(/Up to date/)
  })

  it('surfaces errors instead of pretending to be up to date', () => {
    const s = run(fresh(), { type: 'checking' }, { type: 'error', message: 'net::ERR_INTERNET_DISCONNECTED', at: 3 })
    expect(s).toMatchObject({ phase: 'error', error: 'net::ERR_INTERNET_DISCONNECTED' })
    expect(describeUpdateState(s)).toBe('You appear to be offline.')
    // A new check clears the old error.
    expect(run(s, { type: 'checking' }).error).toBeUndefined()
  })

  it('keeps a downloaded update ready through later checks and errors', () => {
    const ready = run(fresh(), { type: 'available', version: '0.2.1', at: 1 }, { type: 'downloaded', version: '0.2.1' })
    expect(run(ready, { type: 'checking' })).toBe(ready)
    expect(run(ready, { type: 'up-to-date', at: 2 })).toBe(ready)
    expect(run(ready, { type: 'available', version: '0.2.2', at: 2 })).toBe(ready)
    const errored = run(ready, { type: 'error', message: 'offline', at: 2 })
    expect(errored).toMatchObject({ phase: 'ready', error: 'offline' })
  })

  it('does not restart a check in the middle of a download', () => {
    const dl = run(fresh(), { type: 'available', version: '0.2.1', at: 1 }, { type: 'progress', progress: { percent: 10, transferred: 1, total: 10, bytesPerSecond: 1 } })
    expect(run(dl, { type: 'checking' })).toBe(dl)
  })

  it('goes back to ready if the installer fails to start', () => {
    const ready = run(fresh(), { type: 'downloaded', version: '0.2.1' })
    const inst = run(ready, { type: 'installing' })
    expect(inst.phase).toBe('installing')
    const failed = run(inst, { type: 'install-failed', message: 'spawn EACCES' })
    expect(failed).toMatchObject({ phase: 'ready', error: 'spawn EACCES' })
    // installing only follows ready
    expect(run(fresh(), { type: 'installing' }).phase).toBe('idle')
  })

  it('reset forgets a vanished download', () => {
    const ready = run(fresh(), { type: 'downloaded', version: '0.2.1' })
    const s = run(ready, { type: 'reset', message: 'missing' })
    expect(s).toMatchObject({ phase: 'error', error: 'missing' })
    expect(s.latest).toBeUndefined()
    expect(run(ready, { type: 'reset' }).phase).toBe('idle')
  })

  it('tracks the auto switch', () => {
    const s = run(fresh(), { type: 'auto', auto: false })
    expect(s.auto).toBe(false)
    expect(describeUpdateState(s)).toBe('Automatic checks are off.')
  })
})

describe('describeUpdateState', () => {
  it('says so in development builds', () => {
    expect(describeUpdateState(initialUpdateState('dev', '0.2.0', false))).toMatch(/Development build/)
  })
  it('notify-only builds do not claim a download is starting', () => {
    const s = run(initialUpdateState('portable', '0.2.0', true), { type: 'available', version: '0.3.0', at: 1 })
    expect(describeUpdateState(s)).toBe('SPECTER 0.3.0 is available (you have 0.2.0).')
  })
})

describe('summarizeUpdateError', () => {
  it('recognises a release without latest.yml', () => {
    expect(summarizeUpdateError('Cannot find latest.yml in the latest release artifacts (https://github.com/martex-dev/specter/releases/download/v0.2.0/latest.yml): HttpError: 404')).toMatch(/latest\.yml/)
  })
  it('recognises offline, rate-limit and timeout errors', () => {
    expect(summarizeUpdateError('net::ERR_NAME_NOT_RESOLVED')).toBe('You appear to be offline')
    expect(summarizeUpdateError('HttpError: 403 rate limit exceeded')).toMatch(/rate limit/)
    expect(summarizeUpdateError('Request timed out')).toMatch(/did not respond/)
  })
  it('falls back to a generic label', () => {
    expect(summarizeUpdateError('something odd')).toBe('Update check failed')
  })
})

describe('isLoopbackFeed', () => {
  it('only accepts loopback http(s) URLs', () => {
    expect(isLoopbackFeed('http://127.0.0.1:8123/')).toBe(true)
    expect(isLoopbackFeed('http://localhost:8123/feed/')).toBe(true)
    expect(isLoopbackFeed('https://example.com/')).toBe(false)
    expect(isLoopbackFeed('http://127.0.0.1.evil.com/')).toBe(false)
    expect(isLoopbackFeed('file:///C:/x')).toBe(false)
    expect(isLoopbackFeed(undefined)).toBe(false)
  })
})

describe('compareVersions (shared)', () => {
  it('orders versions', () => {
    expect(compareVersions('0.2.1', '0.2.0')).toBe(1)
    expect(compareVersions('v0.2.0', '0.2.0')).toBe(0)
  })
  it('sorts pre-releases before their release', () => {
    expect(compareVersions('0.3.0', '0.3.0-beta.1')).toBe(1)
    expect(compareVersions('0.3.0-beta.1', '0.3.0')).toBe(-1)
    expect(compareVersions('0.3.0-beta.2', '0.3.0-beta.10')).toBe(-1)
    expect(compareVersions('0.3.0-rc.1', '0.3.0-beta.9')).toBe(1)
    expect(compareVersions('0.3.0-beta', '0.3.0-beta.1')).toBe(-1)
    expect(compareVersions('v0.3.0-beta.1', '0.3.0-beta.1')).toBe(0)
    expect(compareVersions('0.3.0-beta.1', '0.2.9')).toBe(1)
    expect(compareVersions('1.0.0+build.5', '1.0.0')).toBe(0)
  })
})
