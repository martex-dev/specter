import { dialog } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import type { Bookmark } from '@shared/types'
import { all, get, json, run, tx, uid } from '../db'
import { broadcast, handle, windowOf } from '../ipc'
import { activeProfileId } from './profiles'

type Row = {
  id: string
  parent_id: string | null
  kind: 'bookmark' | 'folder'
  title: string
  url: string | null
  tags: string
  workspace_id: string | null
  sort: number
  created_at: number
  favicon: string | null
}

const toBookmark = (r: Row): Bookmark => ({
  id: r.id,
  parentId: r.parent_id,
  kind: r.kind,
  title: r.title,
  url: r.url ?? undefined,
  tags: json<string[]>(r.tags, []),
  workspaceId: r.workspace_id ?? undefined,
  sort: r.sort,
  createdAt: r.created_at,
  favicon: r.favicon ?? undefined
})

export const barFolderId = (profileId = activeProfileId()): string => 'bar_' + profileId
export const otherFolderId = (profileId = activeProfileId()): string => 'other_' + profileId

export function ensureBookmarkRoots(p = activeProfileId()): void {
  if (!get('SELECT id FROM bookmarks WHERE id = ?', barFolderId(p)))
    run("INSERT INTO bookmarks(id, parent_id, kind, title, sort, created_at, profile_id) VALUES(?, NULL, 'folder', 'Bookmarks Bar', 0, ?, ?)", barFolderId(p), Date.now(), p)
  if (!get('SELECT id FROM bookmarks WHERE id = ?', otherFolderId(p)))
    run("INSERT INTO bookmarks(id, parent_id, kind, title, sort, created_at, profile_id) VALUES(?, NULL, 'folder', 'Other Bookmarks', 1, ?, ?)", otherFolderId(p), Date.now(), p)
}

export function listBookmarks(): Bookmark[] {
  ensureBookmarkRoots()
  return all<Row>('SELECT * FROM bookmarks WHERE profile_id = ? ORDER BY sort, created_at', activeProfileId()).map(toBookmark)
}

let batching = 0
function changed(): void {
  if (!batching) broadcast('bookmarks:changed', undefined)
}

/**
 * Runs many bookmark writes in one transaction with a single change broadcast
 * (one broadcast per imported bookmark made every window re-list all bookmarks
 * thousands of times and froze SPECTER on large imports).
 */
export function bookmarkBatch<T>(fn: () => T): T {
  batching++
  try {
    return tx(fn)
  } finally {
    batching--
    changed()
  }
}

/** Adds a bookmark or folder; importers pass the profile they're filling (default: the active one). */
export function addBookmark(b: Partial<Bookmark> & { title: string; kind: Bookmark['kind'] }, profileId = activeProfileId()): Bookmark {
  ensureBookmarkRoots(profileId)
  const id = uid('bm_')
  const parent = b.parentId ?? barFolderId(profileId)
  const sort = (get<{ m: number }>('SELECT COALESCE(MAX(sort), -1) AS m FROM bookmarks WHERE parent_id = ?', parent)?.m ?? -1) + 1
  run(
    'INSERT INTO bookmarks(id, parent_id, kind, title, url, tags, workspace_id, sort, created_at, favicon, profile_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    id,
    parent,
    b.kind,
    b.title,
    b.url ?? null,
    JSON.stringify(b.tags ?? []),
    b.workspaceId ?? null,
    sort,
    Date.now(),
    b.favicon ?? null,
    profileId
  )
  changed()
  return toBookmark(get<Row>('SELECT * FROM bookmarks WHERE id = ?', id)!)
}

function removeRecursive(id: string): void {
  for (const c of all<{ id: string }>('SELECT id FROM bookmarks WHERE parent_id = ?', id)) removeRecursive(c.id)
  run('DELETE FROM bookmarks WHERE id = ?', id)
}

/** Removes a bookmark or folder (with its contents). The two root folders are kept. */
export function removeBookmark(id: string): void {
  if (id.startsWith('bar_') || id.startsWith('other_')) return
  tx(() => removeRecursive(id))
  broadcast('bookmarks:changed', undefined)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function exportBookmarksHtml(): string {
  const items = listBookmarks()
  const children = (pid: string | null) => items.filter((i) => i.parentId === pid).sort((a, b) => a.sort - b.sort)
  const render = (pid: string | null, depth: number): string => {
    const pad = '    '.repeat(depth)
    let out = `${pad}<DL><p>\n`
    for (const it of children(pid)) {
      const ts = Math.floor(it.createdAt / 1000)
      if (it.kind === 'folder') {
        const bar = it.id.startsWith('bar_') ? ' PERSONAL_TOOLBAR_FOLDER="true"' : ''
        out += `${pad}    <DT><H3 ADD_DATE="${ts}"${bar}>${escapeHtml(it.title)}</H3>\n` + render(it.id, depth + 1)
      } else {
        const tags = it.tags.length ? ` TAGS="${escapeHtml(it.tags.join(','))}"` : ''
        out += `${pad}    <DT><A HREF="${escapeHtml(it.url ?? '')}" ADD_DATE="${ts}"${tags}>${escapeHtml(it.title)}</A>\n`
      }
    }
    return out + `${pad}</DL><p>\n`
  }
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<!-- Exported by SPECTER -->\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n${render(null, 0)}`
}

/** Parses Netscape bookmark HTML (exported by every major browser). */
export function importBookmarksHtml(html: string, parentId: string): number {
  let count = 0
  const stack: string[] = [parentId]
  const re = /<DT><H3[^>]*>([\s\S]*?)<\/H3>|<DT><A\s+([^>]*)>([\s\S]*?)<\/A>|<\/DL>/gi
  const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim()
  bookmarkBatch(() => {
    let m: RegExpExecArray | null
    let first = true
    while ((m = re.exec(html))) {
      if (m[1] !== undefined) {
        const f = addBookmark({ kind: 'folder', title: decode(m[1]) || 'Folder', parentId: stack[stack.length - 1] })
        stack.push(f.id)
        first = false
      } else if (m[2] !== undefined) {
        const href = /HREF="([^"]*)"/i.exec(m[2])?.[1]
        const tags = /TAGS="([^"]*)"/i.exec(m[2])?.[1]
        if (href && /^(https?|ftp|file):/i.test(href)) {
          addBookmark({ kind: 'bookmark', title: decode(m[3]) || href, url: decode(href), parentId: stack[stack.length - 1], tags: tags ? decode(tags).split(',') : [] })
          count++
        }
      } else if (stack.length > 1 && !first) {
        stack.pop()
      }
    }
  })
  return count
}

export function registerBookmarksIpc(): void {
  handle('bookmarks:list', () => listBookmarks())
  handle('bookmarks:add', (_e, b) => addBookmark(b))
  handle('bookmarks:update', (_e, id, patch) => {
    const cur = get<Row>('SELECT * FROM bookmarks WHERE id = ?', id)
    if (!cur) return
    run(
      'UPDATE bookmarks SET title = ?, url = ?, tags = ?, workspace_id = ?, favicon = ? WHERE id = ?',
      patch.title ?? cur.title,
      patch.url ?? cur.url,
      patch.tags ? JSON.stringify(patch.tags) : cur.tags,
      patch.workspaceId !== undefined ? patch.workspaceId || null : cur.workspace_id,
      patch.favicon ?? cur.favicon,
      id
    )
    broadcast('bookmarks:changed', undefined)
  })
  handle('bookmarks:remove', (_e, id) => removeBookmark(id))
  handle('bookmarks:move', (_e, id, parentId, index) => {
    const target = parentId ?? barFolderId()
    // Prevent moving a folder into itself/descendant.
    let p: string | null = target
    while (p) {
      if (p === id) return
      p = get<{ parent_id: string | null }>('SELECT parent_id FROM bookmarks WHERE id = ?', p)?.parent_id ?? null
    }
    tx(() => {
      const siblings = all<{ id: string }>('SELECT id FROM bookmarks WHERE parent_id = ? AND id != ? ORDER BY sort, created_at', target, id).map((r) => r.id)
      siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, id)
      run('UPDATE bookmarks SET parent_id = ? WHERE id = ?', target, id)
      siblings.forEach((sid, i) => run('UPDATE bookmarks SET sort = ? WHERE id = ?', i, sid))
    })
    broadcast('bookmarks:changed', undefined)
  })
  handle('bookmarks:findByUrl', (_e, url) => {
    const r = get<Row>("SELECT * FROM bookmarks WHERE url = ? AND profile_id = ? AND kind = 'bookmark' LIMIT 1", url, activeProfileId())
    return r ? toBookmark(r) : null
  })
  handle('bookmarks:importHtml', async (e) => {
    const win = windowOf(e)
    const opts = { properties: ['openFile' as const], filters: [{ name: 'Bookmarks HTML', extensions: ['html', 'htm'] }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return 0
    const folder = addBookmark({ kind: 'folder', title: 'Imported ' + new Date().toLocaleDateString(), parentId: otherFolderId() })
    return importBookmarksHtml(readFileSync(r.filePaths[0], 'utf8'), folder.id)
  })
  handle('bookmarks:exportHtml', async (e) => {
    const win = windowOf(e)
    const opts = { defaultPath: 'specter-bookmarks.html', filters: [{ name: 'HTML', extensions: ['html'] }] }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, exportBookmarksHtml())
    return r.filePath
  })
}
