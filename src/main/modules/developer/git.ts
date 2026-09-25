// Git integration via the `git` CLI. Every call uses an argument array (no
// shell), a timeout, and hardening flags for read-only operations so that
// merely *looking* at a repository cannot run repo-configured programs
// (fsmonitor hooks, external diff drivers, textconv filters).
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { shell } from 'electron'
import type { DiffResult, GitBranch, GitCommitInfo, GitOpResult, GitRemoteOp, GitStatus, GitSummary } from '@shared/modules/developer'
import { broadcast } from '../../ipc'
import { createLogger } from '../../logger'
import { cleanEnv, killTree, run, type RunResult } from './proc'
import { BRANCH_FORMAT, LOG_FORMAT, isValidBranchName, isValidCloneUrl, parseBranches, parseLog, parsePorcelainV2, parseUnifiedDiff, repoNameFromUrl, summarizeStatus, untrackedDiff } from './gitParse'
import { requireRow, resolveInProject } from './registry'
import { looksBinary } from './ignore'

const log = createLogger('developer.git')

const MAX_DIFF_BYTES = 3 * 1024 * 1024
const SAFE_READ = ['-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false', '-c', 'color.ui=never', '--no-optional-locks', '--literal-pathspecs']
const SAFE_WRITE = ['-c', 'core.quotepath=false', '-c', 'color.ui=never', '--literal-pathspecs']

function gitEnv(): NodeJS.ProcessEnv {
  return cleanEnv({ GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'auto', LC_ALL: 'C', LANG: 'C' })
}

export function git(cwd: string, args: string[], opts: { timeout?: number; input?: string; write?: boolean; maxBuffer?: number } = {}): Promise<RunResult> {
  return run('git', [...(opts.write ? SAFE_WRITE : SAFE_READ), ...args], { cwd, timeout: opts.timeout ?? 20_000, input: opts.input, env: gitEnv(), maxBuffer: opts.maxBuffer })
}

let versionCache: string | null | undefined
export async function gitVersion(): Promise<string | null> {
  if (versionCache !== undefined) return versionCache
  const r = await run('git', ['--version'], { timeout: 8000 })
  versionCache = r.code === 0 ? r.stdout.trim().replace(/^git version\s*/, '') : null
  return versionCache
}

export function isGitRepo(path: string): boolean {
  return existsSync(join(path, '.git'))
}

function result(r: RunResult): GitOpResult {
  return { ok: r.code === 0, code: r.code, output: (r.stdout + (r.stderr ? (r.stdout ? '\n' : '') + r.stderr : '') + (r.error ? '\n' + r.error : '')).trim() }
}

function changed(projectId: string): void {
  invalidateSummary(projectId)
  broadcast('git:changed', { projectId })
  // Project list badges (branch, dirty count) re-read the summary.
  broadcast('projects:changed', { id: projectId })
}

// Status / summary -------------------------------------------------------------------

export async function status(projectId: string): Promise<GitStatus> {
  const row = requireRow(projectId)
  const empty: GitStatus = { isRepo: false, branch: null, oid: null, detached: false, upstream: null, ahead: 0, behind: 0, files: [], initial: false }
  if (!isGitRepo(row.path)) return empty
  const [r, remotes] = await Promise.all([git(row.path, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], { timeout: 30_000 }), git(row.path, ['remote'])])
  if (r.code !== 0) return { ...empty, isRepo: true, error: (r.stderr || r.error || 'git status failed').trim() }
  const st = parsePorcelainV2(r.stdout)
  st.remotes = remotes.code === 0 ? remotes.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : []
  return st
}

const summaryCache = new Map<string, { at: number; value: GitSummary | null }>()
const summaryInflight = new Map<string, Promise<GitSummary | null>>()

export function invalidateSummary(projectId: string): void {
  summaryCache.delete(projectId)
}

export function cachedSummary(projectId: string): { value: GitSummary | null; fresh: boolean } | null {
  const c = summaryCache.get(projectId)
  if (!c) return null
  return { value: c.value, fresh: Date.now() - c.at < 15_000 }
}

export function summary(projectId: string): Promise<GitSummary | null> {
  const existing = summaryInflight.get(projectId)
  if (existing) return existing
  const p = (async () => {
    const row = requireRow(projectId)
    if (!isGitRepo(row.path)) return null
    const [st, lg, remote] = await Promise.all([
      status(projectId),
      git(row.path, ['log', '-1', '--format=' + LOG_FORMAT]),
      git(row.path, ['config', '--get-regexp', '^remote\\..*\\.url$'])
    ])
    if (!st.isRepo) return null
    const counts = summarizeStatus(st)
    let remoteUrl: string | null = null
    if (remote.code === 0) {
      const urls = remote.stdout
        .split(/\r?\n/)
        .map((l) => /^remote\.(.+)\.url (.+)$/.exec(l.trim()))
        .filter((m): m is RegExpExecArray => !!m)
      remoteUrl = (urls.find((m) => m[1] === 'origin') ?? urls[0])?.[2] ?? null
    }
    return {
      branch: st.branch,
      detached: st.detached,
      upstream: st.upstream,
      ahead: st.ahead,
      behind: st.behind,
      remoteUrl: remoteUrl ? redactUrl(remoteUrl) : null,
      lastCommit: lg.code === 0 ? (parseLog(lg.stdout)[0] ?? null) : null,
      ...counts
    }
  })()
    .catch((err) => {
      log.warn('git summary failed', err)
      return null
    })
    .then((v) => {
      summaryCache.set(projectId, { at: Date.now(), value: v })
      summaryInflight.delete(projectId)
      return v
    })
  summaryInflight.set(projectId, p)
  return p
}

/** Strips credentials embedded in remote URLs (https://user:token@host/…). */
export function redactUrl(url: string): string {
  return url.replace(/^(\w+:\/\/)[^@/]+@/, '$1')
}

export async function logCommits(projectId: string, limit = 40): Promise<GitCommitInfo[]> {
  const row = requireRow(projectId)
  if (!isGitRepo(row.path)) return []
  const n = Math.max(1, Math.min(500, Math.floor(limit)))
  const r = await git(row.path, ['log', '-n', String(n), '--format=' + LOG_FORMAT])
  return r.code === 0 ? parseLog(r.stdout) : []
}

export async function branches(projectId: string): Promise<GitBranch[]> {
  const row = requireRow(projectId)
  if (!isGitRepo(row.path)) return []
  const r = await git(row.path, ['for-each-ref', '--sort=-committerdate', '--format=' + BRANCH_FORMAT, 'refs/heads', 'refs/remotes'])
  return r.code === 0 ? parseBranches(r.stdout) : []
}

// Diffs --------------------------------------------------------------------------------

export async function diff(projectId: string, path: string, opts: { staged: boolean; untracked?: boolean }): Promise<DiffResult> {
  const { root, abs, rel } = resolveInProject(projectId, path)
  if (opts.untracked) {
    try {
      const st = statSync(abs)
      if (st.isDirectory()) {
        const entries = readdirSync(abs).slice(0, 50)
        return { files: [{ oldPath: '/dev/null', newPath: rel, status: 'added', binary: false, hunks: [], additions: 0, deletions: 0, headers: [`Untracked directory (${entries.length} entries)`] }], truncated: false }
      }
      if (st.size > MAX_DIFF_BYTES) return { files: [{ oldPath: '/dev/null', newPath: rel, status: 'added', binary: false, hunks: [], additions: 0, deletions: 0, headers: ['File too large to display'] }], truncated: true }
      const buf = await readFile(abs)
      if (looksBinary(buf)) return { files: [{ oldPath: '/dev/null', newPath: rel, status: 'added', binary: true, hunks: [], additions: 0, deletions: 0, headers: [] }], truncated: false }
      return { files: [untrackedDiff(rel, buf.toString('utf8'))], truncated: false }
    } catch (err) {
      throw new Error('Cannot read file: ' + (err instanceof Error ? err.message : String(err)))
    }
  }
  const args = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '-M']
  if (opts.staged) args.push('--cached')
  args.push('--', rel)
  const r = await git(root, args, { maxBuffer: MAX_DIFF_BYTES * 2 })
  if (r.code !== 0) throw new Error((r.stderr || r.error || 'git diff failed').trim())
  const truncated = r.stdout.length > MAX_DIFF_BYTES
  return { files: parseUnifiedDiff(truncated ? r.stdout.slice(0, MAX_DIFF_BYTES) : r.stdout), truncated }
}

export async function show(projectId: string, hash: string): Promise<{ commit: GitCommitInfo | null; body: string; diff: DiffResult }> {
  const row = requireRow(projectId)
  if (!/^[0-9a-f]{4,64}$/i.test(hash)) throw new Error('Invalid commit hash')
  const [meta, body, patch] = await Promise.all([
    git(row.path, ['log', '-1', '--format=' + LOG_FORMAT, hash]),
    git(row.path, ['log', '-1', '--format=%b', hash]),
    git(row.path, ['show', '--no-ext-diff', '--no-textconv', '--no-color', '-M', '--format=', hash], { maxBuffer: MAX_DIFF_BYTES * 2 })
  ])
  if (patch.code !== 0) throw new Error((patch.stderr || patch.error || 'git show failed').trim())
  const truncated = patch.stdout.length > MAX_DIFF_BYTES
  return {
    commit: meta.code === 0 ? (parseLog(meta.stdout)[0] ?? null) : null,
    body: body.code === 0 ? body.stdout.trim() : '',
    diff: { files: parseUnifiedDiff(truncated ? patch.stdout.slice(0, MAX_DIFF_BYTES) : patch.stdout), truncated }
  }
}

// Mutations ------------------------------------------------------------------------------

function relPaths(projectId: string, paths: string[]): { root: string; rels: string[] } {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error('No paths')
  if (paths.length > 5000) throw new Error('Too many paths')
  const row = requireRow(projectId)
  return { root: row.path, rels: paths.map((p) => resolveInProject(projectId, p).rel || '.') }
}

export async function stage(projectId: string, paths: string[]): Promise<GitOpResult> {
  const { root, rels } = relPaths(projectId, paths)
  const r = result(await git(root, ['add', '-A', '--', ...rels], { write: true, timeout: 60_000 }))
  changed(projectId)
  return r
}

export async function unstage(projectId: string, paths: string[]): Promise<GitOpResult> {
  const { root, rels } = relPaths(projectId, paths)
  const head = await git(root, ['rev-parse', '--verify', '-q', 'HEAD'])
  const r =
    head.code === 0
      ? result(await git(root, ['reset', '-q', 'HEAD', '--', ...rels], { write: true, timeout: 60_000 }))
      : result(await git(root, ['rm', '-q', '--cached', '-r', '--', ...rels], { write: true, timeout: 60_000 }))
  changed(projectId)
  return r
}

/** Discards working-tree changes. Tracked files are restored from the index; untracked files go to the recycle bin. */
export async function discard(projectId: string, paths: string[]): Promise<GitOpResult> {
  const { root, rels } = relPaths(projectId, paths)
  const st = await status(projectId)
  const untracked = new Set(st.files.filter((f) => f.kind === 'untracked').map((f) => f.path))
  const tracked = rels.filter((r) => !untracked.has(r))
  const out: string[] = []
  let ok = true
  for (const r of rels.filter((r) => untracked.has(r))) {
    try {
      await shell.trashItem(resolveInProject(projectId, r).abs)
      out.push(`Moved to Recycle Bin: ${r}`)
    } catch (err) {
      ok = false
      out.push(`Could not remove ${r}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (tracked.length) {
    const r = await git(root, ['checkout', '-q', '--', ...tracked], { write: true, timeout: 60_000 })
    if (r.code !== 0) ok = false
    out.push(result(r).output || `Restored ${tracked.length} file(s)`)
  }
  changed(projectId)
  return { ok, code: ok ? 0 : 1, output: out.join('\n').trim() }
}

export async function commit(projectId: string, message: string, opts: { amend?: boolean } = {}): Promise<GitOpResult> {
  const row = requireRow(projectId)
  const msg = String(message ?? '').replace(/\r\n/g, '\n').trim()
  if (!msg && !opts.amend) return { ok: false, code: null, output: 'Commit message is empty.' }
  const args = ['commit', '-F', '-']
  if (opts.amend) args.push('--amend')
  if (opts.amend && !msg) args.splice(1, 2, '--no-edit')
  const r = result(await git(row.path, args, { write: true, input: msg || undefined, timeout: 120_000 }))
  changed(projectId)
  return r
}

export async function checkout(projectId: string, branch: string): Promise<GitOpResult> {
  const row = requireRow(projectId)
  const name = String(branch ?? '')
  if (!isValidBranchName(name)) return { ok: false, code: null, output: 'Invalid branch name.' }
  // Remote branch (origin/foo) → create a local tracking branch.
  const isRemote = (await git(row.path, ['show-ref', '--verify', '-q', 'refs/remotes/' + name])).code === 0
  const isLocal = (await git(row.path, ['show-ref', '--verify', '-q', 'refs/heads/' + name])).code === 0
  const args = isLocal || !isRemote ? ['switch', name] : ['switch', '--track', name]
  const r = result(await git(row.path, args, { write: true, timeout: 120_000 }))
  changed(projectId)
  return r
}

export async function createBranch(projectId: string, name: string): Promise<GitOpResult> {
  const row = requireRow(projectId)
  if (!isValidBranchName(name)) return { ok: false, code: null, output: 'Invalid branch name.' }
  const r = result(await git(row.path, ['switch', '-c', name], { write: true, timeout: 60_000 }))
  changed(projectId)
  return r
}

export async function undoCommit(projectId: string): Promise<GitOpResult> {
  const row = requireRow(projectId)
  const parent = await git(row.path, ['rev-parse', '--verify', '-q', 'HEAD~1'])
  if (parent.code !== 0) return { ok: false, code: null, output: 'There is no previous commit to reset to.' }
  const r = result(await git(row.path, ['reset', '--soft', 'HEAD~1'], { write: true }))
  changed(projectId)
  return r
}

// Streaming operations (pull / push / fetch / clone) -----------------------------------

const running = new Map<string, ChildProcess>()

function streamGit(opId: string, cwd: string, args: string[], timeoutMs: number): Promise<GitOpResult> {
  return new Promise((resolvePromise) => {
    let output = ''
    const emit = (chunk: string) => {
      output += chunk
      if (output.length > 200_000) output = output.slice(-150_000)
      broadcast('git:output', { opId, chunk })
    }
    emit(`$ git ${args.join(' ')}\n`)
    let child: ChildProcess
    try {
      child = spawn('git', [...SAFE_WRITE, ...args], { cwd, windowsHide: true, env: gitEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      emit(msg + '\n')
      resolvePromise({ ok: false, code: null, output: msg })
      return
    }
    running.set(opId, child)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', emit)
    child.stderr?.on('data', emit)
    const timer = setTimeout(() => {
      emit(`\nTimed out after ${Math.round(timeoutMs / 60000)} min — stopping.\n`)
      killTree(child.pid)
    }, timeoutMs)
    let done = false
    const finish = (code: number | null, err?: Error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      running.delete(opId)
      if (err) emit((err as NodeJS.ErrnoException).code === 'ENOENT' ? 'git was not found on PATH.\n' : err.message + '\n')
      emit(code === 0 ? '\n✓ Done\n' : `\n✗ git exited with code ${code ?? 'n/a'}\n`)
      resolvePromise({ ok: code === 0, code, output })
    }
    child.on('error', (err) => finish(null, err))
    child.on('close', (code) => finish(code))
  })
}

export function cancelOp(opId: string): void {
  const c = running.get(opId)
  if (c) killTree(c.pid)
}

export function cancelAllOps(): void {
  for (const c of running.values()) killTree(c.pid, true)
  running.clear()
}

export async function remoteOp(projectId: string, op: GitRemoteOp, opId: string): Promise<GitOpResult> {
  const row = requireRow(projectId)
  if (typeof opId !== 'string' || !/^[\w-]{4,64}$/.test(opId)) throw new Error('Invalid operation id')
  let args: string[]
  if (op === 'pull') args = ['pull', '--no-edit', '--progress']
  else if (op === 'push') args = ['push', '--progress']
  else if (op === 'fetch') args = ['fetch', '--all', '--prune', '--progress']
  else if (op === 'publish') {
    const st = await status(projectId)
    if (!st.branch) return { ok: false, code: null, output: 'Not on a branch.' }
    const remotes = await git(row.path, ['remote'])
    const remote = remotes.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    const target = remote.includes('origin') ? 'origin' : remote[0]
    if (!target) return { ok: false, code: null, output: 'This repository has no remote.' }
    args = ['push', '--progress', '-u', target, st.branch]
  } else throw new Error('Unknown operation')
  const r = await streamGit(opId, row.path, args, 10 * 60_000)
  changed(projectId)
  return r
}

export async function clone(url: string, parentDir: string, opId: string): Promise<GitOpResult & { path?: string }> {
  if (typeof opId !== 'string' || !/^[\w-]{4,64}$/.test(opId)) throw new Error('Invalid operation id')
  if (!isValidCloneUrl(url)) return { ok: false, code: null, output: 'That does not look like a git repository URL.' }
  let st
  try {
    st = statSync(parentDir)
  } catch {
    return { ok: false, code: null, output: 'Destination folder does not exist.' }
  }
  if (!st.isDirectory()) return { ok: false, code: null, output: 'Destination is not a folder.' }
  const dest = join(parentDir, repoNameFromUrl(url))
  if (existsSync(dest) && readdirSync(dest).length > 0) return { ok: false, code: null, output: `${dest} already exists and is not empty.` }
  const r = await streamGit(opId, parentDir, ['clone', '--progress', '--', url.trim(), dest], 60 * 60_000)
  return { ...r, path: r.ok ? dest : undefined }
}
