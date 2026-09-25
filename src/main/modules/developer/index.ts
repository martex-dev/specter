// Developer: projects, git, terminal — main-process module entry.
//
// Registers IPC (domains: projects, git, terminal), the SQLite migrations
// (via ./registry), diagnostics, and process cleanup on quit. Only SPECTER's
// own UI can reach these channels; web pages never can.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { connect } from 'node:net'
import { app, shell } from 'electron'
import '@shared/modules/developer'
import { DEV_PORTS, type DevEnvironment, type ShellId } from '@shared/modules/developer'
import { handle } from '../../ipc'
import { createLogger } from '../../logger'
import { registerDiagnostic } from '../../services/diagnostics'
import { getSetting, onSettingChanged } from '../../services/settings'
import * as git from './git'
import { cancelAllIndexing, cancelIndex, enqueueIndex, listTree, readProjectFile, searchContent, searchFiles, totalIndexedFiles } from './indexer'
import { cleanEnv, which } from './proc'
import { addProject, listProjects, notifyChanged, openProject, projectDetail, removeProject, setContentIndex, syncWithSettings } from './projects'
import { listRows, requireRow, resolveInProject } from './registry'
import * as term from './terminal'
import { onIndexDone } from './indexer'

const log = createLogger('developer')

function enabled(): boolean {
  return getSetting('developer.enabled') !== false
}

function requireEnabled(): void {
  if (!enabled()) throw new Error('Developer tools are disabled in Settings → Developer')
}

// VS Code ---------------------------------------------------------------------------------

let codeCache: { exe: string | null; cli: string | null } | undefined

async function findCode(): Promise<{ exe: string | null; cli: string | null }> {
  if (codeCache) return codeCache
  const cli = await which('code')
  let exe: string | null = null
  if (cli) {
    const dir = resolve(dirname(cli), '..')
    for (const name of ['Code.exe', 'Code - Insiders.exe', 'VSCodium.exe', 'code']) {
      if (existsSync(join(dir, name))) {
        exe = join(dir, name)
        break
      }
    }
  }
  codeCache = { exe, cli }
  return codeCache
}

async function openInCode(projectId: string, rel?: string, line?: number): Promise<void> {
  const row = requireRow(projectId)
  const { exe, cli } = await findCode()
  const args = [row.path]
  if (rel) {
    const { abs } = resolveInProject(projectId, rel)
    args.push('--goto', `${abs}:${Math.max(1, Math.floor(line ?? 1))}`)
  }
  if (exe) {
    const c = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false, env: cleanEnv() })
    c.on('error', (err) => log.warn('failed to launch VS Code', err))
    c.unref()
    return
  }
  if (cli && process.platform === 'win32') {
    // code.cmd needs cmd.exe; only allow paths without cmd metacharacters.
    if (args.some((a) => /["%^&|<>!]/.test(a))) throw new Error('This path cannot be passed safely to code.cmd')
    const c = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[cli, ...args].map((a) => `"${a}"`).join(' ')}"`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: true,
      env: cleanEnv()
    })
    c.unref()
    return
  }
  if (cli) {
    spawn(cli, args, { detached: true, stdio: 'ignore', env: cleanEnv() }).unref()
    return
  }
  throw new Error('VS Code ("code") was not found on PATH')
}

// Ports -------------------------------------------------------------------------------------

function probe(port: number, host: string, timeoutMs = 350): Promise<boolean> {
  return new Promise((res) => {
    const sock = connect({ port, host })
    const done = (ok: boolean) => {
      sock.removeAllListeners()
      sock.destroy()
      res(ok)
    }
    sock.setTimeout(timeoutMs, () => done(false))
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
  })
}

async function probePorts(ports?: number[]): Promise<number[]> {
  const list = (Array.isArray(ports) && ports.length ? ports : DEV_PORTS).filter((p) => Number.isInteger(p) && p > 0 && p < 65536).slice(0, 40)
  const res = await Promise.all(list.map(async (p) => ((await probe(p, '127.0.0.1')) || (await probe(p, '::1')) ? p : null)))
  return res.filter((p): p is number => p !== null)
}

// Environment ------------------------------------------------------------------------------

async function environment(): Promise<DevEnvironment> {
  const [gv, code, shells] = await Promise.all([git.gitVersion(), findCode(), term.detectShells()])
  const pref = getSetting('developer.shell') as ShellId
  const available = shells.list.filter((s) => s.available)
  const defaultShell = available.some((s) => s.id === pref) ? pref : (available[0]?.id ?? 'powershell')
  return { git: gv, code: !!(code.exe || code.cli), shells: shells.list, defaultShell }
}

// Registration --------------------------------------------------------------------------------

export function register(): void {
  // Projects / index
  handle('projects:env', () => environment())
  handle('projects:list', () => listProjects())
  handle('projects:get', (_e, id) => projectDetail(id))
  handle('projects:add', (_e, path) => (requireEnabled(), addProject(path)))
  handle('projects:remove', (_e, id) => removeProject(id))
  handle('projects:open', (_e, id) => openProject(id))
  handle('projects:reindex', (_e, id) => {
    requireRow(id)
    enqueueIndex(id)
  })
  handle('projects:cancelIndex', (_e, id) => cancelIndex(id))
  handle('projects:setContentIndex', (_e, id, on) => setContentIndex(id, !!on))
  handle('projects:searchFiles', (_e, q, opts) => searchFiles(q, opts ?? {}))
  handle('projects:searchContent', (_e, q, opts) => searchContent(q, opts ?? {}))
  handle('projects:tree', (_e, id, rel) => listTree(id, rel))
  handle('projects:readFile', (_e, id, rel) => readProjectFile(id, rel))
  handle('projects:openInCode', (_e, id, rel, line) => openInCode(id, rel, line))
  handle('projects:reveal', (_e, id, rel) => {
    const { abs } = resolveInProject(id, rel ?? '')
    shell.showItemInFolder(abs)
  })
  handle('projects:openFolder', async (_e, id) => {
    const err = await shell.openPath(requireRow(id).path)
    if (err) throw new Error(err)
  })
  handle('projects:probePorts', (_e, ports) => probePorts(ports))

  // Git
  handle('git:status', (_e, id) => git.status(id))
  handle('git:log', (_e, id, limit) => git.logCommits(id, limit))
  handle('git:branches', (_e, id) => git.branches(id))
  handle('git:diff', (_e, id, path, opts) => git.diff(id, path, opts ?? { staged: false }))
  handle('git:show', (_e, id, hash) => git.show(id, hash))
  handle('git:stage', (_e, id, paths) => (requireEnabled(), git.stage(id, paths)))
  handle('git:unstage', (_e, id, paths) => (requireEnabled(), git.unstage(id, paths)))
  handle('git:discard', (_e, id, paths) => (requireEnabled(), git.discard(id, paths)))
  handle('git:commit', (_e, id, msg, opts) => (requireEnabled(), git.commit(id, msg, opts ?? {})))
  handle('git:checkout', (_e, id, branch) => (requireEnabled(), git.checkout(id, branch)))
  handle('git:createBranch', (_e, id, name) => (requireEnabled(), git.createBranch(id, name)))
  handle('git:undoCommit', (_e, id) => (requireEnabled(), git.undoCommit(id)))
  handle('git:remote', (_e, id, op, opId) => (requireEnabled(), git.remoteOp(id, op, opId)))
  handle('git:clone', async (_e, url, parent, opId) => {
    requireEnabled()
    const r = await git.clone(url, parent, opId)
    if (r.ok && r.path) {
      const p = await addProject(r.path)
      return { ...r, projectId: p.id }
    }
    return r
  })
  handle('git:cancel', (_e, opId) => git.cancelOp(opId))

  // Terminal
  handle('terminal:shells', async () => (await term.detectShells()).list)
  handle('terminal:list', () => term.listSessions())
  handle('terminal:create', async (_e, opts) => {
    requireEnabled()
    const projectId = opts?.projectId ?? null
    const cwd = projectId ? requireRow(projectId).path : null
    return term.createSession({ shell: opts?.shell, cwd, projectId, defaultShell: (await environment()).defaultShell })
  })
  handle('terminal:input', (_e, id, line) => (requireEnabled(), term.input(id, line)))
  handle('terminal:interrupt', (_e, id) => term.interrupt(id))
  handle('terminal:restart', (_e, id) => (requireEnabled(), term.restartSession(id)))
  handle('terminal:close', (_e, id) => term.closeSession(id))
  handle('terminal:buffer', (_e, id) => term.getBuffer(id))
  handle('terminal:clear', (_e, id) => term.clearBuffer(id))
  handle('terminal:resize', (_e, id, cols) => term.resize(id, cols))

  // Keep projects in sync with the user's folder list.
  onSettingChanged((key, value) => {
    if (key === 'developer.projectRoots') void syncWithSettings().catch((err) => log.error('project sync failed', err))
    if (key === 'developer.enabled' && value === false) {
      term.killAllSessions()
      git.cancelAllOps()
      cancelAllIndexing()
    }
  })
  onIndexDone((id) => notifyChanged(id))
  app.whenReady().then(() => {
    // After the database is open and settings are loaded.
    setTimeout(() => void syncWithSettings().catch((err) => log.error('project sync failed', err)), 1500)
  })

  // Never leave shells, git or indexers running after SPECTER quits.
  app.on('before-quit', () => {
    try {
      term.killAllSessions()
      git.cancelAllOps()
      cancelAllIndexing()
    } catch (err) {
      log.error('developer cleanup failed', err)
    }
  })

  // Diagnostics
  registerDiagnostic(async () => {
    const v = await git.gitVersion()
    return { id: 'dev-git', label: 'Git', status: v ? 'ok' : 'warn', detail: v ? `git ${v}` : 'git not found on PATH — Git features unavailable' }
  })
  registerDiagnostic(async () => {
    const { list } = await term.detectShells()
    const ok = list.filter((s) => s.available)
    return {
      id: 'dev-shells',
      label: 'Terminal shells',
      status: ok.length ? 'ok' : 'error',
      detail: (ok.length ? ok.map((s) => s.label).join(', ') : 'No shell found') + ` · ${term.sessionCount()} session(s) open · line-based (no PTY)`
    }
  })
  registerDiagnostic(() => {
    const rows = listRows()
    const ready = rows.filter((r) => r.index_state === 'ready').length
    const errors = rows.filter((r) => r.index_state === 'error').length
    return {
      id: 'dev-projects',
      label: 'Projects indexed',
      status: errors ? 'warn' : 'ok',
      detail: rows.length ? `${ready}/${rows.length} project(s) indexed · ${totalIndexedFiles().toLocaleString()} files${errors ? ` · ${errors} with errors` : ''}` : 'No projects registered (add folders in Settings → Developer)'
    }
  })
}
