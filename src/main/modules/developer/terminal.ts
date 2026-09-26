// Line-based integrated terminal (no PTY, no native modules).
//
// Each session is a persistent shell process with piped stdio. When the user
// submits a line while the shell is idle, it is wrapped so the shell prints a
// per-session sentinel after the command finishes:
//
//   __SPX<nonce>|<ok>|<exit code>|<cwd>|__
//
// The sentinel is stripped from the output stream and used to track "running",
// the exit code and the working directory. While a command is running, submitted
// lines are written raw to stdin (so simple prompts can be answered).
// Ctrl+C kills the running command's process tree; if nothing is killable (a
// pure PowerShell loop, or WSL) the session is restarted in the same directory.
//
// Full-screen/TUI programs (vim, less, htop…) cannot work without a PTY.
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { ShellId, ShellInfo, TerminalSession } from '@shared/modules/developer'
import { broadcast } from '../../ipc'
import { createLogger } from '../../logger'
import { childProcesses, cleanEnv, gitInstallRoot, killTree, msysDescendants, run, which } from './proc'

const log = createLogger('developer.terminal')

const BUFFER_MAX = 512 * 1024
const BUFFER_KEEP = 384 * 1024
const MAX_SESSIONS = 12

interface ShellDef {
  id: ShellId
  label: string
  exe: string
  args: (cwd: string) => string[]
  cwdForSpawn: (cwd: string) => string | undefined
  env?: Record<string, string>
  verbatim?: boolean
  init: (nonce: string) => string
  wrap: (cmd: string, nonce: string, cols: number) => string
  promptToken?: (nonce: string) => string
  /** Ctrl+C cannot target child processes (WSL: Linux processes). */
  restartOnInterrupt?: boolean
  eol: string
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

function powershellDef(id: 'powershell' | 'pwsh', exe: string, label: string): ShellDef {
  return {
    id,
    label,
    exe,
    args: () => ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-NoExit', '-Command', '-'],
    cwdForSpawn: (cwd) => cwd,
    eol: '\n',
    init: (nonce) =>
      [
        "$ProgressPreference='SilentlyContinue'",
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
        '$OutputEncoding=[Text.Encoding]::UTF8',
        "function global:Clear-Host { [Console]::Out.Write([string][char]27 + '[2J') }",
        // With redirected output the host drops colors; emit ANSI for -ForegroundColor/-BackgroundColor instead.
        'function global:Write-Host { param([Parameter(Position=0,ValueFromPipeline=$true,ValueFromRemainingArguments=$true)]$Object,[switch]$NoNewline,$Separator=\' \',[ConsoleColor]$ForegroundColor,[ConsoleColor]$BackgroundColor) process { $m=@{Black=30;DarkBlue=34;DarkGreen=32;DarkCyan=36;DarkRed=31;DarkMagenta=35;DarkYellow=33;Gray=37;DarkGray=90;Blue=94;Green=92;Cyan=96;Red=91;Magenta=95;Yellow=93;White=97}; $t = if ($null -eq $Object) { \'\' } else { (@($Object) | ForEach-Object { "$_" }) -join "$Separator" }; $p = \'\'; if ($PSBoundParameters.ContainsKey(\'ForegroundColor\')) { $p += [string][char]27 + \'[\' + $m["$ForegroundColor"] + \'m\' }; if ($PSBoundParameters.ContainsKey(\'BackgroundColor\')) { $p += [string][char]27 + \'[\' + ($m["$BackgroundColor"] + 10) + \'m\' }; if ($p) { $t = $p + $t + [string][char]27 + \'[0m\' }; if ($NoNewline) { [Console]::Out.Write($t) } else { [Console]::Out.WriteLine($t) } } }',
        `[Console]::Out.WriteLine("__SPX${nonce}|True|0|$((Get-Location).ProviderPath)|__")`
      ].join('; '),
    wrap: (cmd, nonce, cols) =>
      [
        '$__spx_e=$Error.Count',
        '$global:LASTEXITCODE=$null',
        '$__spx_ok=$true',
        `try { . ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(cmd)}')))) | Out-String -Stream -Width ${cols} | ForEach-Object { $_.TrimEnd() }; $__spx_ok=$? } catch { $__spx_ok=$false; $__spx_x=$_.Exception; if ($__spx_x.InnerException -is [System.Management.Automation.ParseException]) { [Console]::Error.WriteLine($__spx_x.InnerException.Message) } else { [Console]::Error.WriteLine(($_ | Out-String).TrimEnd()) } }`,
        'if ($Error.Count -gt $__spx_e) { $__spx_ok=$false }',
        '$__spx_c = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } elseif ($__spx_ok) { 0 } else { 1 }',
        `[Console]::Out.WriteLine("__SPX${nonce}|$__spx_ok|$__spx_c|$((Get-Location).ProviderPath)|__")`
      ].join('; ')
  }
}

function cmdDef(): ShellDef {
  return {
    id: 'cmd',
    label: 'Command Prompt',
    exe: process.env.ComSpec || 'cmd.exe',
    verbatim: true,
    // The prompt is a unique token that is stripped from the output.
    args: () => ['/D', '/Q', '/K', 'prompt', '__SPXP__'],
    cwdForSpawn: (cwd) => cwd,
    eol: '\r\n',
    promptToken: () => '__SPXP__',
    init: (nonce) => `chcp 65001>nul\r\necho __SPX${nonce}^|-^|0^|%CD%^|__`,
    wrap: (cmd, nonce) => `${cmd.replace(/\r?\n/g, '\r\n')}\r\necho __SPX${nonce}^|-^|%ERRORLEVEL%^|%CD%^|__`
  }
}

function bashWrap(cwdExpr: string) {
  return (cmd: string, nonce: string) =>
    `eval "$(printf '%s' '${b64(cmd)}' | base64 -d)"; __spx_c=$?; printf '__SPX%s|%s|%s|%s|__\\n' '${nonce}' "$([ $__spx_c -eq 0 ] && echo True || echo False)" "$__spx_c" "${cwdExpr}"`
}

function gitBashDef(root: string): ShellDef {
  return {
    id: 'gitbash',
    label: 'Git Bash',
    exe: join(root, 'usr', 'bin', 'bash.exe'),
    args: () => ['--login', '-s'],
    cwdForSpawn: (cwd) => cwd,
    env: { MSYSTEM: 'MINGW64', CHERE_INVOKING: '1', TERM: 'dumb' },
    eol: '\n',
    init: (nonce) => `printf '__SPX%s|True|0|%s|__\\n' '${nonce}' "$(pwd -W 2>/dev/null || pwd)"`,
    wrap: bashWrap('$(pwd -W 2>/dev/null || pwd)')
  }
}

function wslDef(exe: string): ShellDef {
  return {
    id: 'wsl',
    label: 'WSL',
    exe,
    args: (cwd) => (cwd ? ['--cd', cwd, '-e', 'bash', '--login', '-s'] : ['-e', 'bash', '--login', '-s']),
    cwdForSpawn: (cwd) => (/^[a-zA-Z]:\\/.test(cwd) ? cwd : undefined),
    env: { TERM: 'dumb' },
    eol: '\n',
    restartOnInterrupt: true,
    init: (nonce) => `printf '__SPX%s|True|0|%s|__\\n' '${nonce}' "$PWD"`,
    wrap: bashWrap('$PWD')
  }
}

// Shell discovery ------------------------------------------------------------------------

let shellCache: { at: number; list: ShellInfo[]; defs: Map<ShellId, ShellDef> } | null = null

export async function detectShells(force = false): Promise<{ list: ShellInfo[]; defs: Map<ShellId, ShellDef> }> {
  if (shellCache && !force && Date.now() - shellCache.at < 5 * 60_000) return shellCache
  const defs = new Map<ShellId, ShellDef>()
  const list: ShellInfo[] = []
  if (process.platform === 'win32') {
    const sysRoot = process.env.SystemRoot || 'C:\\Windows'
    const ps = join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const psPath = existsSync(ps) ? ps : ((await which('powershell')) ?? '')
    list.push({ id: 'powershell', label: 'Windows PowerShell', path: psPath, available: !!psPath })
    if (psPath) defs.set('powershell', powershellDef('powershell', psPath, 'PowerShell'))

    const pwsh = await which('pwsh')
    list.push({ id: 'pwsh', label: 'PowerShell 7', path: pwsh ?? '', available: !!pwsh, note: pwsh ? undefined : 'pwsh.exe not found on PATH' })
    if (pwsh) defs.set('pwsh', powershellDef('pwsh', pwsh, 'PowerShell 7'))

    const cmd = cmdDef()
    list.push({ id: 'cmd', label: 'Command Prompt', path: cmd.exe, available: true, note: 'Non-ASCII input may not round-trip' })
    defs.set('cmd', cmd)

    const gitRoot = await gitInstallRoot()
    list.push({ id: 'gitbash', label: 'Git Bash', path: gitRoot ? join(gitRoot, 'usr', 'bin', 'bash.exe') : '', available: !!gitRoot, note: gitRoot ? undefined : 'Git for Windows not found' })
    if (gitRoot) defs.set('gitbash', gitBashDef(gitRoot))

    const wsl = join(sysRoot, 'System32', 'wsl.exe')
    let wslOk = false
    let wslNote = 'wsl.exe not found'
    if (existsSync(wsl)) {
      const r = await new Promise<{ code: number | null; out: string }>((res) => {
        const c = spawn(wsl, ['-l', '-q'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
        const chunks: Buffer[] = []
        const t = setTimeout(() => {
          killTree(c.pid)
          res({ code: null, out: '' })
        }, 6000)
        c.stdout?.on('data', (d: Buffer) => chunks.push(d))
        c.on('error', () => {
          clearTimeout(t)
          res({ code: null, out: '' })
        })
        c.on('close', (code) => {
          clearTimeout(t)
          res({ code, out: Buffer.concat(chunks).toString('utf16le').replace(/\0/g, '') })
        })
      })
      const distros = r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      wslOk = r.code === 0 && distros.length > 0
      wslNote = wslOk ? `${distros[0]} · Ctrl+C restarts the session` : 'No WSL distribution installed'
      if (wslOk) defs.set('wsl', wslDef(wsl))
    }
    list.push({ id: 'wsl', label: 'WSL', path: wslOk ? wsl : '', available: wslOk, note: wslNote })
  } else {
    const bash = (await which('bash')) ?? '/bin/sh'
    defs.set('gitbash', { ...gitBashDef('/'), exe: bash, label: 'Shell', env: { TERM: 'dumb' }, wrap: bashWrap('$PWD'), init: (n) => `printf '__SPX%s|True|0|%s|__\\n' '${n}' "$PWD"` })
    list.push({ id: 'gitbash', label: 'Shell', path: bash, available: true })
  }
  shellCache = { at: Date.now(), list, defs }
  return shellCache
}

// Sessions -------------------------------------------------------------------------------

interface Session {
  info: TerminalSession
  def: ShellDef
  proc: ChildProcess | null
  nonce: string
  buffer: string
  seq: number
  pending: string
  cols: number
  ready: boolean
  queue: string[]
  lastChar: string
  interruptTimer: NodeJS.Timeout | null
  generation: number
}

const sessions = new Map<string, Session>()
let counter = 0

function publicInfo(s: Session): TerminalSession {
  return { ...s.info }
}

function emitState(s: Session): void {
  broadcast('terminal:state', publicInfo(s))
}

function append(s: Session, data: string): void {
  if (!data) return
  const clearAt = Math.max(data.lastIndexOf('\x1b[2J'), data.lastIndexOf('\x0c'))
  if (clearAt >= 0) s.buffer = data.slice(clearAt)
  else s.buffer += data
  if (s.buffer.length > BUFFER_MAX) {
    const cut = s.buffer.indexOf('\n', s.buffer.length - BUFFER_KEEP)
    s.buffer = s.buffer.slice(cut >= 0 ? cut + 1 : s.buffer.length - BUFFER_KEEP)
  }
  s.lastChar = data[data.length - 1]
  s.seq++
  broadcast('terminal:data', { id: s.info.id, data, seq: s.seq })
}

function ensureNewline(s: Session): void {
  if (s.lastChar && s.lastChar !== '\n') append(s, '\r\n')
}

const DIM = '\x1b[2m'
const RESET_DIM = '\x1b[22m'

function promptLine(s: Session, cmd: string): string {
  const sym = s.def.id === 'gitbash' || s.def.id === 'wsl' ? '$' : s.def.id === 'cmd' ? '>' : 'PS>'
  return `\x1b[38;5;110m${displayCwd(s.info.cwd)}\x1b[39m \x1b[1;38;5;147m${sym}\x1b[22;39m ${cmd}\r\n`
}

/** Shortens the home directory to "~" for the echoed prompt. */
export function displayCwd(cwd: string): string {
  const home = homedir()
  const norm = (p: string) => p.replace(/\//g, '\\').toLowerCase()
  if (process.platform === 'win32' && norm(cwd).startsWith(norm(home))) {
    const rest = cwd.slice(home.length)
    if (!rest || /^[\\/]/.test(rest)) return '~' + rest
  }
  return cwd
}

/** Handles stdout: strips sentinels / prompt tokens, updates state. */
function onStdout(s: Session, text: string): void {
  let buf = s.pending + text
  s.pending = ''
  const marker = `__SPX${s.nonce}|`
  const prompt = s.def.promptToken?.(s.nonce)
  let out = ''
  for (;;) {
    const mi = buf.indexOf(marker)
    const pi = prompt ? buf.indexOf(prompt) : -1
    if (mi < 0 && pi < 0) break
    if (pi >= 0 && (mi < 0 || pi < mi)) {
      let before = buf.slice(0, pi)
      if (before.endsWith('\r\n')) before = before.slice(0, -2)
      else if (before.endsWith('\n')) before = before.slice(0, -1)
      out += before
      buf = buf.slice(pi + prompt!.length)
      continue
    }
    const end = buf.indexOf('|__', mi + marker.length)
    if (end < 0) {
      out += buf.slice(0, mi)
      s.pending = buf.slice(mi)
      buf = ''
      break
    }
    out += buf.slice(0, mi)
    const payload = buf.slice(mi + marker.length, end)
    let rest = buf.slice(end + 3)
    if (rest.startsWith('\r\n')) rest = rest.slice(2)
    else if (rest.startsWith('\n')) rest = rest.slice(1)
    buf = rest
    flushOut(s, out)
    out = ''
    onSentinel(s, payload)
  }
  if (buf) {
    // Hold back a possible partial marker / prompt token at the end of the chunk.
    const hold = partialSuffix(buf, [marker, ...(prompt ? [prompt] : [])])
    out += buf.slice(0, buf.length - hold)
    s.pending += buf.slice(buf.length - hold)
  }
  flushOut(s, out)
}

function partialSuffix(buf: string, tokens: string[]): number {
  let best = 0
  for (const t of tokens) {
    for (let k = Math.min(t.length - 1, buf.length); k > best; k--) {
      if (buf.endsWith(t.slice(0, k))) {
        best = k
        break
      }
    }
  }
  return best
}

function flushOut(s: Session, text: string): void {
  if (!text) return
  append(s, text)
}

function onSentinel(s: Session, payload: string): void {
  const [okRaw, codeRaw, ...cwdParts] = payload.split('|')
  const cwd = cwdParts.join('|').trim()
  const code = Number.parseInt(codeRaw, 10)
  if (cwd) s.info.cwd = cwd
  const wasReady = s.ready
  s.ready = true
  if (!wasReady) {
    // Startup sentinel.
    s.info.running = false
    emitState(s)
    const q = s.queue.splice(0)
    for (const line of q) submit(s, line)
    return
  }
  const ok = okRaw === '-' ? code === 0 : okRaw === 'True'
  s.info.running = false
  s.info.runningCommand = null
  s.info.lastExitCode = Number.isFinite(code) ? code : ok ? 0 : 1
  if (s.interruptTimer) {
    clearTimeout(s.interruptTimer)
    s.interruptTimer = null
  }
  if (Number.isFinite(code) && code !== 0) {
    ensureNewline(s)
    append(s, `${DIM}[exit ${code}]${RESET_DIM}\r\n`)
  } else if (!ok) {
    ensureNewline(s)
  }
  s.info.title = titleFor(s)
  emitState(s)
}

function titleFor(s: Session): string {
  const dir = basename(s.info.cwd.replace(/[\\/]+$/, '')) || s.info.cwd
  return s.info.running && s.info.runningCommand ? s.info.runningCommand.slice(0, 40) : `${dir}`
}

function startProcess(s: Session): void {
  const def = s.def
  s.nonce = randomBytes(5).toString('hex')
  s.pending = ''
  s.ready = false
  s.generation++
  const gen = s.generation
  let cwd = s.info.cwd
  const spawnCwd = def.cwdForSpawn(cwd)
  if (spawnCwd && !isDir(spawnCwd)) cwd = homedir()
  const env = cleanEnv({
    ...(def.env ?? {}),
    // Colors for tools that check for a TTY — unless the user opted out with NO_COLOR.
    ...(process.env.NO_COLOR ? {} : { FORCE_COLOR: '1', CLICOLOR_FORCE: '1' }),
    COLUMNS: String(s.cols),
    SPECTER_TERMINAL: '1',
    ...(process.env.GIT_CONFIG_COUNT || process.env.NO_COLOR ? {} : { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'color.ui', GIT_CONFIG_VALUE_0: 'always' }),
    GIT_PAGER: 'cat',
    PAGER: 'cat'
  })
  let proc: ChildProcess
  try {
    proc = spawn(def.exe, def.args(cwd), {
      cwd: def.cwdForSpawn(cwd) ?? homedir(),
      env,
      windowsHide: true,
      windowsVerbatimArguments: !!def.verbatim,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  } catch (err) {
    append(s, `\x1b[31mFailed to start ${def.label}: ${err instanceof Error ? err.message : String(err)}\x1b[39m\r\n`)
    s.info.alive = false
    s.info.running = false
    emitState(s)
    return
  }
  s.proc = proc
  s.info.pid = proc.pid ?? null
  s.info.alive = true
  s.info.running = true
  s.info.runningCommand = null
  const outDec = new StringDecoder('utf8')
  const errDec = new StringDecoder('utf8')
  proc.stdout?.on('data', (d: Buffer) => gen === s.generation && onStdout(s, outDec.write(d)))
  proc.stderr?.on('data', (d: Buffer) => {
    if (gen !== s.generation) return
    const t = errDec.write(d)
    if (t) append(s, `\x1b[31m${t}\x1b[39m`)
  })
  proc.stdin?.on('error', () => undefined)
  proc.on('error', (err) => {
    if (gen !== s.generation) return
    append(s, `\x1b[31m${def.label} error: ${err.message}\x1b[39m\r\n`)
  })
  proc.on('exit', (code) => {
    if (gen !== s.generation) return
    s.proc = null
    s.info.alive = false
    s.info.running = false
    s.info.runningCommand = null
    s.info.pid = null
    s.info.title = titleFor(s)
    ensureNewline(s)
    append(s, `${DIM}[${def.label} exited${code !== null ? ` with code ${code}` : ''} — press Enter to start a new session]${RESET_DIM}\r\n`)
    emitState(s)
  })
  write(s, def.init(s.nonce) + def.eol)
  emitState(s)
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function write(s: Session, text: string): void {
  try {
    s.proc?.stdin?.write(text, 'utf8')
  } catch (err) {
    log.warn('terminal write failed', err)
  }
}

function submit(s: Session, line: string): void {
  if (!s.info.alive) {
    s.queue.push(line)
    restart(s, false)
    return
  }
  if (!s.ready) {
    s.queue.push(line)
    return
  }
  if (s.info.running) {
    // Raw input for the running program.
    append(s, `${DIM}${line}${RESET_DIM}\r\n`)
    write(s, line + s.def.eol)
    return
  }
  ensureNewline(s)
  append(s, promptLine(s, line))
  if (!line.trim()) return
  s.info.running = true
  s.info.runningCommand = line.trim()
  s.info.title = titleFor(s)
  emitState(s)
  write(s, s.def.wrap(line, s.nonce, s.cols) + s.def.eol)
}

function restart(s: Session, announce = true): void {
  const old = s.proc
  s.generation++ // ignore events from the old process
  s.proc = null
  if (old?.pid) void killTree(old.pid)
  if (s.interruptTimer) {
    clearTimeout(s.interruptTimer)
    s.interruptTimer = null
  }
  if (announce) {
    ensureNewline(s)
    append(s, `\x1b[33m— session restarted in ${s.info.cwd} —\x1b[39m\r\n`)
  }
  startProcess(s)
}

// Public API -----------------------------------------------------------------------------

export async function createSession(opts: { shell?: ShellId; cwd?: string | null; projectId?: string | null; defaultShell: ShellId }): Promise<TerminalSession> {
  if (sessions.size >= MAX_SESSIONS) throw new Error(`At most ${MAX_SESSIONS} terminal sessions can be open`)
  const { defs } = await detectShells()
  const wanted = opts.shell ?? opts.defaultShell
  const def = defs.get(wanted) ?? defs.get('powershell') ?? defs.get('gitbash') ?? [...defs.values()][0]
  if (!def) throw new Error('No shell available')
  const cwd = opts.cwd && isDir(opts.cwd) ? opts.cwd : homedir()
  const id = 't' + (++counter).toString(36) + randomBytes(3).toString('hex')
  const s: Session = {
    info: { id, shell: def.id, title: basename(cwd) || cwd, cwd, projectId: opts.projectId ?? null, pid: null, alive: false, running: true, runningCommand: null, lastExitCode: null, startedAt: Date.now() },
    def,
    proc: null,
    nonce: '',
    buffer: '',
    seq: 0,
    pending: '',
    cols: 120,
    ready: false,
    queue: [],
    lastChar: '',
    interruptTimer: null,
    generation: 0
  }
  sessions.set(id, s)
  append(s, `${DIM}${def.label} · line-based terminal (no PTY): full-screen programs like vim or less will not work. Ctrl+C stops the running command.${RESET_DIM}\r\n`)
  startProcess(s)
  return publicInfo(s)
}

function need(id: string): Session {
  const s = sessions.get(id)
  if (!s) throw new Error('Terminal session not found')
  return s
}

export function listSessions(): TerminalSession[] {
  return [...sessions.values()].map(publicInfo)
}

export function input(id: string, line: string): void {
  const s = need(id)
  if (typeof line !== 'string') throw new Error('Invalid input')
  if (line.length > 64 * 1024) throw new Error('Input too long')
  submit(s, line.replace(/\r\n/g, '\n'))
}

export async function interrupt(id: string): Promise<void> {
  const s = need(id)
  ensureNewline(s)
  append(s, '^C\r\n')
  if (!s.info.alive || !s.info.running || !s.ready) {
    if (!s.ready && s.info.alive) restart(s)
    return
  }
  if (s.def.restartOnInterrupt || !s.proc?.pid) {
    restart(s)
    return
  }
  const gen = s.generation
  const pid = s.proc.pid
  let kids: number[]
  if (s.def.id === 'gitbash') {
    const root = await gitInstallRoot()
    kids = root ? await msysDescendants(root, pid) : []
  } else kids = (await childProcesses(pid)).map((k) => k.pid)
  if (gen !== s.generation) return
  await Promise.all(kids.map((k) => killTree(k)))
  if (s.interruptTimer) clearTimeout(s.interruptTimer)
  // If the shell itself is busy (e.g. a PowerShell loop), restart it.
  s.interruptTimer = setTimeout(
    () => {
      s.interruptTimer = null
      if (gen === s.generation && s.info.running) restart(s)
    },
    kids.length ? 2500 : 600
  )
}

export function restartSession(id: string): TerminalSession {
  const s = need(id)
  restart(s)
  return publicInfo(s)
}

export function closeSession(id: string): void {
  const s = sessions.get(id)
  if (!s) {
    // Already gone (e.g. killed when developer tools were turned off): still let the UI drop its tab.
    if (typeof id === 'string') broadcast('terminal:closed', { id })
    return
  }
  s.generation++
  if (s.interruptTimer) clearTimeout(s.interruptTimer)
  const pid = s.proc?.pid
  s.proc = null
  sessions.delete(id)
  if (pid) void killTree(pid)
  broadcast('terminal:closed', { id })
}

export function getBuffer(id: string): { data: string; seq: number } {
  const s = need(id)
  return { data: s.buffer, seq: s.seq }
}

export function clearBuffer(id: string): void {
  const s = need(id)
  s.buffer = ''
  s.lastChar = ''
  s.seq++
  broadcast('terminal:cleared', { id, seq: s.seq })
}

export function resize(id: string, cols: number): void {
  const s = need(id)
  if (Number.isFinite(cols)) s.cols = Math.max(40, Math.min(400, Math.floor(cols)))
}

export function killAllSessions(): void {
  for (const s of sessions.values()) {
    s.generation++
    if (s.interruptTimer) clearTimeout(s.interruptTimer)
    if (s.proc?.pid) killTree(s.proc.pid, true)
    s.proc = null
  }
  const ids = [...sessions.keys()]
  sessions.clear()
  for (const id of ids) broadcast('terminal:closed', { id })
}

export function sessionCount(): number {
  return sessions.size
}

/** For diagnostics: quick self-test that PowerShell starts and answers. */
export async function powershellWorks(): Promise<boolean> {
  const r = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], { timeout: 8000 })
  return r.code === 0
}
