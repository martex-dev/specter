// Project registry service: keeps the dev_projects table in sync with the
// user's `developer.projectRoots` setting, and builds project views.
import { statSync } from 'node:fs'
import type { ProjectDetail, ProjectInfo } from '@shared/modules/developer'
import { run } from '../../db'
import { broadcast } from '../../ipc'
import { bus } from '../../bus'
import { createLogger } from '../../logger'
import { getSetting, setSetting } from '../../services/settings'
import { detectProject, findReadme } from './detect'
import { cachedSummary, isGitRepo, summary } from './git'
import { cancelIndex, clearIndex, enqueueIndex, languageStats } from './indexer'
import { getRow, insertRow, listRows, normalizePath, projectIdFor, requireRow, rowKinds, rowStats, samePath, updateDetection, type ProjectRow } from './registry'
import { json } from '../../db'

const log = createLogger('developer.projects')

function exists(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

let changeTimer: NodeJS.Timeout | null = null
export function notifyChanged(id?: string): void {
  if (changeTimer) clearTimeout(changeTimer)
  changeTimer = setTimeout(() => {
    changeTimer = null
    broadcast('projects:changed', { id })
  }, 60)
}

function toInfo(r: ProjectRow): ProjectInfo {
  const ok = exists(r.path)
  const cached = ok ? cachedSummary(r.id) : null
  if (ok && (!cached || !cached.fresh) && isGitRepo(r.path)) {
    // Refresh in the background; the UI re-lists when it lands.
    void summary(r.id).then((v) => {
      if (JSON.stringify(v) !== JSON.stringify(cached?.value ?? null)) notifyChanged(r.id)
    })
  }
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    kinds: rowKinds(r),
    tags: json<string[]>(r.tags, []),
    addedAt: r.added_at,
    lastOpened: r.last_opened,
    contentIndex: !!r.content_index,
    exists: ok,
    isGit: ok && isGitRepo(r.path),
    index: rowStats(r),
    git: cached?.value ?? null
  }
}

export function listProjects(): ProjectInfo[] {
  return listRows().map(toInfo)
}

export async function projectDetail(id: string): Promise<ProjectDetail | null> {
  const r = getRow(id)
  if (!r) return null
  const ok = exists(r.path)
  const det = ok ? detectProject(r.path) : null
  if (det) {
    const kinds = JSON.stringify(det.kinds)
    const tags = JSON.stringify(det.tags)
    if (kinds !== r.kinds || tags !== r.tags || det.name !== r.name) {
      updateDetection(id, det.name, det.kinds, det.tags)
      r.kinds = kinds
      r.tags = tags
      r.name = det.name
    }
  }
  const git = ok && isGitRepo(r.path) ? await summary(id) : null
  const info = toInfo(r)
  return {
    ...info,
    git,
    readme: ok ? findReadme(r.path) : null,
    scripts: det?.scripts ?? [],
    packageManager: det?.packageManager ?? null,
    languages: languageStats(id),
    description: det?.description ?? null
  }
}

/** Reconciles the table with the `developer.projectRoots` setting. */
let syncChain: Promise<void> = Promise.resolve()
export function syncWithSettings(): Promise<void> {
  syncChain = syncChain.then(doSync, doSync)
  return syncChain
}

async function doSync(): Promise<void> {
  const roots = (getSetting('developer.projectRoots') ?? []).filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map(normalizePath)
  const wanted = new Map<string, string>()
  for (const p of roots) wanted.set(projectIdFor(p), p)
  const rows = listRows()
  let changed = false
  for (const r of rows) {
    if (!wanted.has(r.id)) {
      cancelIndex(r.id)
      run('DELETE FROM dev_projects WHERE id = ?', r.id)
      await clearIndex(r.id)
      changed = true
      log.info(`removed project ${r.name}`)
    }
  }
  for (const [id, path] of wanted) {
    if (rows.some((r) => r.id === id)) continue
    const det = exists(path) ? detectProject(path) : null
    insertRow(id, path, det?.name ?? (path.split(/[\\/]/).pop() || path), det?.kinds ?? ['folder'], det?.tags ?? [])
    changed = true
    log.info(`registered project ${path}`)
    // Filename indexing of an explicitly added project (never content, unless opted in).
    if (det) enqueueIndex(id)
  }
  if (changed) notifyChanged()
}

export async function addProject(path: string): Promise<ProjectInfo> {
  if (typeof path !== 'string' || !path.trim()) throw new Error('No folder given')
  const norm = normalizePath(path)
  if (!exists(norm)) throw new Error('Folder not found: ' + norm)
  if (/^[a-zA-Z]:\\?$/.test(norm) || norm === '/') throw new Error('Refusing to register a whole drive as a project — pick a project folder.')
  const roots = getSetting('developer.projectRoots') ?? []
  if (!roots.some((r) => samePath(r, norm))) setSetting('developer.projectRoots', [...roots, norm])
  await syncWithSettings()
  return toInfo(requireRow(projectIdFor(norm)))
}

export async function removeProject(id: string): Promise<void> {
  const r = requireRow(id)
  const roots = getSetting('developer.projectRoots') ?? []
  setSetting(
    'developer.projectRoots',
    roots.filter((p) => !samePath(p, r.path))
  )
  await syncWithSettings()
}

export function openProject(id: string): void {
  const r = requireRow(id)
  run('UPDATE dev_projects SET last_opened = ? WHERE id = ?', Date.now(), id)
  bus.emit('PROJECT_OPENED', { projectId: id, path: r.path })
  notifyChanged(id)
}

export function setContentIndex(id: string, on: boolean): void {
  requireRow(id)
  run('UPDATE dev_projects SET content_index = ? WHERE id = ?', on ? 1 : 0, id)
  enqueueIndex(id)
  notifyChanged(id)
}
