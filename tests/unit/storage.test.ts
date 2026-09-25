// Exercises the real storage services against an in-memory SQLite database.
import { beforeAll, describe, expect, it, vi } from 'vitest'

// Electron is not available under vitest; the services only touch it inside IPC handlers.
vi.mock('electron', () => ({
  app: { getPath: () => '.', isPackaged: false },
  ipcMain: { handle: () => undefined, on: () => undefined },
  BrowserWindow: { fromWebContents: () => null, getFocusedWindow: () => null, getAllWindows: () => [] },
  webContents: { fromId: () => null, getAllWebContents: () => [] },
  dialog: {},
  session: { fromPartition: () => ({}) },
  Notification: { isSupported: () => false },
  shell: {}
}))

import { openDatabase, get, all, registerMigrations, metaGet } from '../../src/main/db'
import { loadSettings, setSetting, getSetting } from '../../src/main/services/settings'
import { addHistory, searchHistory, suggestHistory, ftsQuery } from '../../src/main/services/history'
import { addBookmark, exportBookmarksHtml, importBookmarksHtml, listBookmarks, barFolderId, ensureBookmarkRoots } from '../../src/main/services/bookmarks'
import { ensureDefaultProfile } from '../../src/main/services/profiles'
import { createWorkspace, ensureDefaultWorkspaces, listWorkspaces, saveWorkspaceState, snapshotWorkspace, exportWorkspace } from '../../src/main/services/workspaces'

beforeAll(() => {
  openDatabase(':memory:')
  loadSettings()
  ensureDefaultProfile()
  ensureBookmarkRoots()
})

describe('migrations', () => {
  it('runs module migrations once and records versions', () => {
    registerMigrations('test', ['CREATE TABLE t1 (a INTEGER)', 'ALTER TABLE t1 ADD COLUMN b TEXT'])
    expect(metaGet('schema:test')).toBe('2')
    registerMigrations('test', ['CREATE TABLE t1 (a INTEGER)', 'ALTER TABLE t1 ADD COLUMN b TEXT'])
    expect(metaGet('schema:test')).toBe('2')
    expect(all<{ name: string }>("SELECT name FROM pragma_table_info('t1')").map((r) => r.name)).toEqual(['a', 'b'])
  })
})

describe('settings', () => {
  it('persists and reloads typed values', () => {
    setSetting('search.engine', 'google')
    setSetting('markets.tickerSymbols', ['BTC', 'XMR'])
    loadSettings()
    expect(getSetting('search.engine')).toBe('google')
    expect(getSetting('markets.tickerSymbols')).toEqual(['BTC', 'XMR'])
    expect(getSetting('tabs.suspendAfter')).toBe('30m') // default untouched
  })
})

describe('history', () => {
  it('stores visits and full-text searches them', () => {
    addHistory('https://github.com/electron/electron', 'Electron: build cross-platform desktop apps')
    addHistory('https://developer.mozilla.org/en-US/docs/Web/API', 'Web APIs | MDN')
    addHistory('https://example.com/', 'Example Domain')
    const res = searchHistory({ text: 'electron' })
    expect(res.map((r) => r.url)).toContain('https://github.com/electron/electron')
    expect(searchHistory({ text: 'mdn' })[0].url).toContain('mozilla')
    expect(searchHistory({ domain: 'example.com' }).length).toBe(1)
  })
  it('collapses rapid duplicate visits', () => {
    const before = get<{ c: number }>('SELECT COUNT(*) AS c FROM history')!.c
    addHistory('https://example.com/', 'Example Domain')
    expect(get<{ c: number }>('SELECT COUNT(*) AS c FROM history')!.c).toBe(before)
  })
  it('skips internal pages', () => {
    addHistory('specter://settings', 'Settings')
    expect(searchHistory({ text: 'settings' }).length).toBe(0)
  })
  it('prefix-matches for suggestions and is injection-safe', () => {
    expect(suggestHistory('elec')[0]?.url).toBe('https://github.com/electron/electron')
    expect(ftsQuery('a "b" OR c*')).toBe('"a" "b" "OR" "c"*')
    expect(ftsQuery('(x:y) ^z')).toBe('"x" "y" "z"*')
    expect(() => searchHistory({ text: '"unbalanced ( OR' })).not.toThrow()
  })
  it('respects the record-history setting', () => {
    setSetting('privacy.recordHistory', false)
    addHistory('https://private.example.org/', 'Private')
    expect(searchHistory({ text: 'private' }).length).toBe(0)
    setSetting('privacy.recordHistory', true)
  })
})

describe('bookmarks', () => {
  it('adds bookmarks to the bar and round-trips Netscape HTML', () => {
    addBookmark({ kind: 'bookmark', title: 'GitHub & Co <3', url: 'https://github.com', tags: ['dev'] })
    const folder = addBookmark({ kind: 'folder', title: 'Research' })
    addBookmark({ kind: 'bookmark', title: 'arXiv', url: 'https://arxiv.org', parentId: folder.id })
    const html = exportBookmarksHtml()
    expect(html).toContain('GitHub &amp; Co &lt;3')
    expect(html).toContain('PERSONAL_TOOLBAR_FOLDER')
    const target = addBookmark({ kind: 'folder', title: 'Imported' })
    const n = importBookmarksHtml(html, target.id)
    expect(n).toBe(2)
    const all = listBookmarks()
    const imported = all.filter((b) => b.title === 'GitHub & Co <3')
    expect(imported.length).toBe(2)
    expect(imported.some((b) => b.tags.includes('dev'))).toBe(true)
    expect(all.find((b) => b.id === barFolderId())).toBeTruthy()
  })
  it('ignores javascript: URLs on import', () => {
    const target = addBookmark({ kind: 'folder', title: 'Unsafe' })
    const n = importBookmarksHtml('<DL><p><DT><A HREF="javascript:alert(1)">x</A><DT><A HREF="https://ok.test">ok</A></DL><p>', target.id)
    expect(n).toBe(1)
  })
})

describe('workspaces', () => {
  it('creates defaults, saves state, snapshots and exports', () => {
    ensureDefaultWorkspaces()
    const list = listWorkspaces()
    expect(list.map((w) => w.name)).toEqual(['Personal', 'Development', 'AI / ML', 'Research', 'Trading', 'Crypto', 'Finance', 'Entertainment'])
    const ws = createWorkspace({ name: 'Test' })
    const now = Date.now()
    saveWorkspaceState(ws.id, {
      tabs: [
        { id: 'a', url: 'https://a.test', title: 'A', pinned: false, muted: false, suspended: false, lastActive: now, createdAt: now },
        { id: 'b', url: 'https://b.test', title: 'B', pinned: true, muted: false, suspended: false, lastActive: now, createdAt: now, temporary: true }
      ],
      groups: [{ id: 'g', name: 'Unused', color: 'blue', collapsed: false }],
      activeTabId: 'b',
      layout: { preset: '50/50', panes: ['a', 'b'] }
    })
    const saved = listWorkspaces().find((w) => w.id === ws.id)!
    // Temporary tabs are never persisted; dangling groups/panes are cleaned.
    expect(saved.state.tabs.map((t) => t.id)).toEqual(['a'])
    expect(saved.state.groups).toEqual([])
    expect(saved.state.activeTabId).toBe('a')
    expect(saved.state.layout.preset).toBe('single')
    const snap = snapshotWorkspace(ws.id, 'label')!
    expect(snap.tabCount).toBe(1)
    const md = exportWorkspace(saved, 'markdown')
    expect(md).toContain('[A](https://a.test)')
    expect(JSON.parse(exportWorkspace(saved, 'json')).format).toBe('specter-workspace')
  })
})
