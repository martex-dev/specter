// Child-process helpers: argument-array execution only (never a shell string),
// timeouts everywhere, and process-tree cleanup on Windows.
import { execFile, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  error?: string
}

/** Environment for child processes: the user's environment minus Electron/Chromium internals. */
export function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(ELECTRON_|CHROME_|GOOGLE_API_KEY|GOOGLE_DEFAULT_CLIENT)/i.test(k)) continue
    if (k === 'NODE_OPTIONS' || k === 'ORIGINAL_XDG_CURRENT_DESKTOP') continue
    env[k] = v
  }
  return { ...env, ...extra }
}

/** Runs an executable with an argument array (no shell), bounded by a timeout. Never rejects. */
export function run(
  file: string,
  args: string[],
  opts: { cwd?: string; timeout?: number; input?: string; env?: NodeJS.ProcessEnv; maxBuffer?: number } = {}
): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    let child: ChildProcess
    try {
      child = execFile(
        file,
        args,
        {
          cwd: opts.cwd,
          timeout: opts.timeout ?? 20_000,
          maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024,
          windowsHide: true,
          env: opts.env ?? cleanEnv(),
          encoding: 'utf8'
        },
        (err, stdout, stderr) => {
          const e = err as (NodeJS.ErrnoException & { code?: number | string; killed?: boolean }) | null
          let code: number | null = 0
          let error: string | undefined
          if (e) {
            if (typeof e.code === 'number') code = e.code
            else {
              code = null
              error = e.killed ? `Timed out after ${Math.round((opts.timeout ?? 20_000) / 1000)}s` : e.code === 'ENOENT' ? `${file} not found` : e.message
            }
            if (e.killed && !error) error = 'Timed out'
          }
          resolvePromise({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), error })
        }
      )
    } catch (err) {
      resolvePromise({ code: null, stdout: '', stderr: '', error: err instanceof Error ? err.message : String(err) })
      return
    }
    if (opts.input !== undefined) {
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(opts.input, 'utf8')
    }
  })
}

/** Kills a whole process tree (Windows: taskkill /T /F). */
export function killTree(pid: number | null | undefined, sync = false): Promise<void> | void {
  if (!pid) return sync ? undefined : Promise.resolve()
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* gone */
      }
    }
    return sync ? undefined : Promise.resolve()
  }
  if (sync) {
    try {
      spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 4000, stdio: 'ignore' })
    } catch {
      /* ignore */
    }
    return
  }
  return run('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { timeout: 8000 }).then(() => undefined)
}

/** Direct child processes of `pid` (excluding the console host). */
export async function childProcesses(pid: number): Promise<{ pid: number; name: string }[]> {
  if (process.platform !== 'win32') return []
  const r = await run(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process -Filter "ParentProcessId=${Math.floor(pid)}" | ForEach-Object { "$($_.ProcessId)|$($_.Name)" }`],
    { timeout: 10_000 }
  )
  return r.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [p, name] = l.split('|')
      return { pid: Number(p), name: name ?? '' }
    })
    .filter((p) => p.pid > 0 && !/^conhost\.exe$/i.test(p.name))
}

/**
 * Descendants of an MSYS/Git Bash process. Cygwin's fork/exec emulation breaks
 * the Windows parent chain, so the MSYS `ps` (which tracks POSIX parents) is used.
 * Returns Windows PIDs, deepest first.
 */
export async function msysDescendants(gitRoot: string, winpid: number): Promise<number[]> {
  const r = await run(join(gitRoot, 'usr', 'bin', 'ps.exe'), ['-e'], { timeout: 8000 })
  if (r.code !== 0) return []
  const rows = r.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((c) => c.length >= 4)
    .map((c) => ({ pid: Number(c[0]), ppid: Number(c[1]), winpid: Number(c[3]) }))
  const root = rows.find((x) => x.winpid === winpid)
  if (!root) return []
  const out: number[] = []
  const walk = (pid: number) => {
    for (const c of rows.filter((x) => x.ppid === pid && x.pid !== pid)) {
      walk(c.pid)
      out.push(c.winpid)
    }
  }
  walk(root.pid)
  return out.filter((p) => p > 0 && p !== winpid)
}

const whichCache = new Map<string, string | null>()

/** Resolves an executable on PATH (where.exe on Windows). Cached. */
export async function which(name: string): Promise<string | null> {
  if (whichCache.has(name)) return whichCache.get(name) ?? null
  let found: string | null = null
  if (process.platform === 'win32') {
    const r = await run('where.exe', [name], { timeout: 5000 })
    if (r.code === 0) found = r.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? null
  } else {
    const r = await run('which', [name], { timeout: 5000 })
    if (r.code === 0) found = r.stdout.trim() || null
  }
  whichCache.set(name, found)
  return found
}

let gitRootCache: string | null | undefined

/** The Git for Windows install root (…\Git), derived from git.exe on PATH. */
export async function gitInstallRoot(): Promise<string | null> {
  if (gitRootCache !== undefined) return gitRootCache
  const git = await which('git')
  gitRootCache = null
  if (git) {
    // …\Git\cmd\git.exe or …\Git\bin\git.exe or …\Git\mingw64\bin\git.exe
    let dir = dirname(git)
    for (let i = 0; i < 3; i++) {
      if (existsSync(join(dir, 'usr', 'bin', 'bash.exe'))) {
        gitRootCache = dir
        break
      }
      dir = resolve(dir, '..')
    }
  }
  return gitRootCache
}
