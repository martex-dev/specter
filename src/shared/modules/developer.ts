// Developer module (projects, Git, terminal) — shared types and IPC contract.
//
// Security model: every channel below is reachable only from SPECTER's own UI
// (web pages never get a preload). Nothing here executes an arbitrary string
// except `terminal:input`, which the terminal UI calls when the user presses
// Enter. Git channels run fixed `git` sub-commands with validated arguments
// (no shell), and file reads are confined to registered projects.

export type ProjectKind =
  | 'node'
  | 'typescript'
  | 'deno'
  | 'python'
  | 'rust'
  | 'go'
  | 'dotnet'
  | 'java'
  | 'kotlin'
  | 'php'
  | 'ruby'
  | 'cpp'
  | 'dart'
  | 'static'
  | 'git'
  | 'folder'

export type IndexState = 'never' | 'queued' | 'indexing' | 'ready' | 'cancelled' | 'error'

export interface IndexStats {
  state: IndexState
  files: number
  dirs: number
  bytes: number
  contentFiles: number
  /** True when the file cap was hit and the index is partial. */
  truncated: boolean
  durationMs: number
  indexedAt: number | null
  error?: string
}

export interface IndexProgress {
  projectId: string
  state: IndexState
  files: number
  dirs: number
  contentFiles: number
  phase: 'files' | 'content' | 'done'
  current?: string
}

export interface GitCommitInfo {
  hash: string
  short: string
  author: string
  email: string
  date: number
  subject: string
  refs?: string
}

export interface GitSummary {
  branch: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
  remoteUrl: string | null
  lastCommit: GitCommitInfo | null
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
  /** staged + unstaged + untracked + conflicted (unique paths). */
  dirty: number
}

export interface ProjectInfo {
  id: string
  name: string
  path: string
  kinds: ProjectKind[]
  /** Frameworks / notable tooling detected (react, vite, electron, django…). */
  tags: string[]
  addedAt: number
  lastOpened: number | null
  contentIndex: boolean
  exists: boolean
  isGit: boolean
  index: IndexStats
  git: GitSummary | null
}

export interface ProjectScript {
  name: string
  /** The command line executed when run in the terminal. */
  command: string
  /** Human description (the underlying script body, or "standard"). */
  detail: string
  source: 'package.json' | 'composer.json' | 'Makefile' | 'standard'
}

export interface ProjectDetail extends ProjectInfo {
  readme: { file: string; markdown: string; truncated: boolean } | null
  scripts: ProjectScript[]
  packageManager: string | null
  languages: { ext: string; files: number }[]
  description: string | null
}

export interface FileHit {
  projectId: string
  projectName: string
  rel: string
  name: string
  size: number
  mtime: number
}

export interface ContentHit {
  projectId: string
  projectName: string
  rel: string
  /** Snippet with \u0001 … \u0002 around matched terms. */
  snippet: string
}

export interface TreeEntry {
  name: string
  rel: string
  dir: boolean
  size: number
  mtime: number
  ignored: boolean
}

export interface FileContent {
  rel: string
  size: number
  binary: boolean
  truncated: boolean
  text: string
}

// Git -------------------------------------------------------------------------

export type GitStatusCode = '.' | 'M' | 'T' | 'A' | 'D' | 'R' | 'C' | 'U' | '?' | '!'

export interface GitFileChange {
  path: string
  origPath?: string
  /** Index (staged) status letter. */
  x: GitStatusCode
  /** Worktree (unstaged) status letter. */
  y: GitStatusCode
  kind: 'changed' | 'renamed' | 'unmerged' | 'untracked' | 'ignored'
  staged: boolean
  unstaged: boolean
  conflicted: boolean
}

export interface GitStatus {
  isRepo: boolean
  branch: string | null
  oid: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
  files: GitFileChange[]
  /** True when the repo has no commits yet. */
  initial: boolean
  /** Configured remote names (origin…). */
  remotes?: string[]
  error?: string
}

export interface GitBranch {
  name: string
  current: boolean
  upstream: string | null
  remote: boolean
  lastCommit: number
}

export interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'meta'
  text: string
  oldNo?: number
  newNo?: number
}

export interface DiffHunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export interface DiffFile {
  oldPath: string
  newPath: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'mode'
  binary: boolean
  hunks: DiffHunk[]
  additions: number
  deletions: number
  headers: string[]
}

export interface DiffResult {
  files: DiffFile[]
  truncated: boolean
}

export interface GitOpResult {
  ok: boolean
  code: number | null
  output: string
}

export type GitRemoteOp = 'pull' | 'push' | 'fetch' | 'publish'

// Terminal --------------------------------------------------------------------

export type ShellId = 'powershell' | 'pwsh' | 'cmd' | 'gitbash' | 'wsl'

export interface ShellInfo {
  id: ShellId
  label: string
  path: string
  available: boolean
  /** Why it is unavailable, or a note (e.g. "Ctrl+C restarts the session"). */
  note?: string
}

export interface TerminalSession {
  id: string
  shell: ShellId
  title: string
  cwd: string
  projectId: string | null
  pid: number | null
  alive: boolean
  running: boolean
  runningCommand: string | null
  lastExitCode: number | null
  startedAt: number
}

export interface DevEnvironment {
  git: string | null
  code: boolean
  shells: ShellInfo[]
  defaultShell: ShellId
}

declare module '../ipc' {
  interface IpcContract {
    // Projects / index
    'projects:env': () => DevEnvironment
    'projects:list': () => ProjectInfo[]
    'projects:get': (id: string) => ProjectDetail | null
    'projects:add': (path: string) => ProjectInfo
    'projects:remove': (id: string) => void
    'projects:open': (id: string) => void
    'projects:reindex': (id: string) => void
    'projects:cancelIndex': (id: string) => void
    'projects:setContentIndex': (id: string, on: boolean) => void
    'projects:searchFiles': (query: string, opts?: { projectId?: string; limit?: number }) => FileHit[]
    'projects:searchContent': (query: string, opts?: { projectId?: string; limit?: number }) => ContentHit[]
    'projects:tree': (id: string, rel: string) => TreeEntry[]
    'projects:readFile': (id: string, rel: string) => FileContent
    'projects:openInCode': (id: string, rel?: string, line?: number) => void
    'projects:reveal': (id: string, rel?: string) => void
    'projects:openFolder': (id: string) => void
    'projects:probePorts': (ports?: number[]) => number[]

    // Git
    'git:status': (id: string) => GitStatus
    'git:log': (id: string, limit?: number) => GitCommitInfo[]
    'git:branches': (id: string) => GitBranch[]
    'git:diff': (id: string, path: string, opts: { staged: boolean; untracked?: boolean }) => DiffResult
    'git:show': (id: string, hash: string) => { commit: GitCommitInfo | null; body: string; diff: DiffResult }
    'git:stage': (id: string, paths: string[]) => GitOpResult
    'git:unstage': (id: string, paths: string[]) => GitOpResult
    /** Destructive — the UI must confirm first. Untracked files go to the recycle bin. */
    'git:discard': (id: string, paths: string[]) => GitOpResult
    'git:commit': (id: string, message: string, opts?: { amend?: boolean }) => GitOpResult
    'git:checkout': (id: string, branch: string) => GitOpResult
    'git:createBranch': (id: string, name: string) => GitOpResult
    /** Destructive — soft reset of the last commit (changes kept staged). */
    'git:undoCommit': (id: string) => GitOpResult
    /** Streams output through `git:output`; resolves when done. */
    'git:remote': (id: string, op: GitRemoteOp, opId: string) => GitOpResult
    'git:clone': (url: string, parentDir: string, opId: string) => GitOpResult & { path?: string; projectId?: string }
    'git:cancel': (opId: string) => void

    // Terminal
    'terminal:shells': () => ShellInfo[]
    'terminal:list': () => TerminalSession[]
    'terminal:create': (opts: { shell?: ShellId; projectId?: string | null }) => TerminalSession
    /** Submits one line typed by the user (to the shell, or to the running program's stdin). */
    'terminal:input': (id: string, line: string) => void
    'terminal:interrupt': (id: string) => void
    'terminal:restart': (id: string) => TerminalSession
    'terminal:close': (id: string) => void
    'terminal:buffer': (id: string) => { data: string; seq: number }
    'terminal:clear': (id: string) => void
    'terminal:resize': (id: string, cols: number) => void
  }
  interface IpcEvents {
    'projects:changed': { id?: string }
    'projects:indexProgress': IndexProgress
    'git:output': { opId: string; chunk: string }
    'git:changed': { projectId: string }
    'terminal:data': { id: string; data: string; seq: number }
    'terminal:state': TerminalSession
    'terminal:closed': { id: string }
    'terminal:cleared': { id: string; seq: number }
  }
}

export const DEV_PORTS = [3000, 3001, 5173, 5174, 4173, 8080, 8000, 4200, 5000, 4321, 8888, 6006]

// ANSI terminal model -----------------------------------------------------------
// Small ANSI model: SGR colors/attributes, \r overwrite, \b, \t, erase-in-line/
// display and cursor column moves. Everything else (cursor up, scroll regions,
// alternate screen…) is ignored — this backs a line-based terminal, not a full VT
// emulator. Pure — unit tested (tests/unit/developer-ansi.test.ts).

export interface AnsiStyle {
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
  strike?: boolean
}

export interface AnsiSpan {
  text: string
  style: AnsiStyle
}

export interface TermLine {
  id: number
  spans: AnsiSpan[]
  /** Visible length in characters. */
  len: number
}

const EMPTY: AnsiStyle = Object.freeze({}) as AnsiStyle

/** Color for palette index 0–255. 0–15 map to theme CSS variables. */
export function paletteColor(n: number): string {
  if (n < 16) return `var(--ansi-${n})`
  if (n < 232) {
    const i = n - 16
    const steps = [0, 95, 135, 175, 215, 255]
    return `rgb(${steps[Math.floor(i / 36)]},${steps[Math.floor(i / 6) % 6]},${steps[i % 6]})`
  }
  const g = 8 + (n - 232) * 10
  return `rgb(${g},${g},${g})`
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Number.isFinite(n) ? n : 0))
}

/** Applies SGR parameter text (e.g. "1;31", "38;5;208", "38:2::255:0:0") to a style; returns a new style. */
export function applySgr(params: string, style: AnsiStyle): AnsiStyle {
  // Normalise into groups: colon sub-parameters stay grouped with their lead code.
  const groups: number[][] = (params === '' ? ['0'] : params.split(';')).map((g) => g.split(':').map((x) => (x === '' ? NaN : Number(x))))
  const s: AnsiStyle = { ...style }
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    const c = Number.isNaN(g[0]) ? 0 : g[0]
    if (c === 38 || c === 48 || c === 58) {
      let color: string | undefined
      if (g.length > 1) {
        // colon form: 38:5:n  or 38:2:[cs]:r:g:b
        if (g[1] === 5) color = paletteColor(clamp255(g[2]))
        else if (g[1] === 2) {
          const rgb = g.length >= 6 ? g.slice(g.length - 3) : g.slice(2, 5)
          color = `rgb(${rgb.map(clamp255).join(',')})`
        }
      } else {
        const mode = groups[i + 1]?.[0]
        if (mode === 5) {
          color = paletteColor(clamp255(groups[i + 2]?.[0] ?? 0))
          i += 2
        } else if (mode === 2) {
          color = `rgb(${[groups[i + 2]?.[0], groups[i + 3]?.[0], groups[i + 4]?.[0]].map((v) => clamp255(v ?? 0)).join(',')})`
          i += 4
        }
      }
      if (c === 38) s.fg = color
      else if (c === 48) s.bg = color
      continue
    }
    if (c === 0) {
      for (const k of Object.keys(s)) delete (s as Record<string, unknown>)[k]
    } else if (c === 1) s.bold = true
    else if (c === 2) s.dim = true
    else if (c === 3) s.italic = true
    else if (c === 4) s.underline = true
    else if (c === 7) s.inverse = true
    else if (c === 9) s.strike = true
    else if (c === 21 || c === 22) {
      delete s.bold
      delete s.dim
    } else if (c === 23) delete s.italic
    else if (c === 24) delete s.underline
    else if (c === 27) delete s.inverse
    else if (c === 29) delete s.strike
    else if (c >= 30 && c <= 37) s.fg = paletteColor(c - 30)
    else if (c === 39) delete s.fg
    else if (c >= 40 && c <= 47) s.bg = paletteColor(c - 40)
    else if (c === 49) delete s.bg
    else if (c >= 90 && c <= 97) s.fg = paletteColor(c - 90 + 8)
    else if (c >= 100 && c <= 107) s.bg = paletteColor(c - 100 + 8)
  }
  return Object.keys(s).length ? s : EMPTY
}

export function sameStyle(a: AnsiStyle, b: AnsiStyle): boolean {
  if (a === b) return true
  return a.fg === b.fg && a.bg === b.bg && !!a.bold === !!b.bold && !!a.dim === !!b.dim && !!a.italic === !!b.italic && !!a.underline === !!b.underline && !!a.inverse === !!b.inverse && !!a.strike === !!b.strike
}

/** Takes characters [from, to) of a line's spans. */
function sliceSpans(spans: AnsiSpan[], from: number, to: number): AnsiSpan[] {
  const out: AnsiSpan[] = []
  let pos = 0
  for (const sp of spans) {
    const end = pos + sp.text.length
    if (end > from && pos < to) {
      out.push({ text: sp.text.slice(Math.max(0, from - pos), Math.min(sp.text.length, to - pos)), style: sp.style })
    }
    pos = end
    if (pos >= to) break
  }
  return out
}

function pushSpan(spans: AnsiSpan[], sp: AnsiSpan): void {
  if (!sp.text) return
  const last = spans[spans.length - 1]
  if (last && sameStyle(last.style, sp.style)) spans[spans.length - 1] = { text: last.text + sp.text, style: last.style }
  else spans.push(sp)
}

export class AnsiTerminal {
  lines: TermLine[] = []
  /** Incremented on every change (for cheap change detection). */
  version = 0
  private style: AnsiStyle = EMPTY
  private col = 0
  private pending = ''
  private nextId = 1

  constructor(private maxLines = 5000) {
    this.lines.push(this.makeLine())
  }

  private makeLine(): TermLine {
    return { id: this.nextId++, spans: [], len: 0 }
  }

  clear(): void {
    this.lines = [this.makeLine()]
    this.col = 0
    this.version++
  }

  /** Feeds raw output (may end mid escape sequence; the remainder is kept for the next call). */
  write(data: string): void {
    const s = this.pending + data
    this.pending = ''
    let i = 0
    let textStart = 0
    const flush = (end: number) => {
      if (end > textStart) this.put(s.slice(textStart, end))
    }
    while (i < s.length) {
      const ch = s.charCodeAt(i)
      if (ch === 0x1b) {
        flush(i)
        if (i + 1 >= s.length) {
          this.pending = s.slice(i)
          break
        }
        const n = s[i + 1]
        if (n === '[') {
          let j = i + 2
          while (j < s.length && s.charCodeAt(j) >= 0x30 && s.charCodeAt(j) <= 0x3f) j++
          while (j < s.length && s.charCodeAt(j) >= 0x20 && s.charCodeAt(j) <= 0x2f) j++
          if (j >= s.length) {
            if (s.length - i < 64) this.pending = s.slice(i)
            i = s.length
            textStart = i
            break
          }
          this.csi(s.slice(i + 2, j), s[j])
          i = j + 1
        } else if (n === ']' || n === 'P' || n === '_' || n === '^') {
          // OSC / DCS / APC / PM: skip until BEL or ST (ESC \)
          let j = i + 2
          let end = -1
          while (j < s.length) {
            if (s.charCodeAt(j) === 0x07) {
              end = j + 1
              break
            }
            if (s.charCodeAt(j) === 0x1b && s[j + 1] === '\\') {
              end = j + 2
              break
            }
            j++
          }
          if (end < 0) {
            if (s.length - i < 2048) this.pending = s.slice(i)
            i = s.length
            textStart = i
            break
          }
          i = end
        } else if (n === '(' || n === ')' || n === '*' || n === '+') {
          i += 3
        } else {
          i += 2
        }
        textStart = i
        continue
      }
      if (ch < 0x20 || ch === 0x7f) {
        flush(i)
        if (ch === 0x0a) this.newline()
        else if (ch === 0x0d) this.col = 0
        else if (ch === 0x08) this.col = Math.max(0, this.col - 1)
        else if (ch === 0x09) this.put(' '.repeat(8 - (this.col % 8)))
        else if (ch === 0x0c) this.clear()
        i++
        textStart = i
        continue
      }
      i++
    }
    if (textStart < s.length && !this.pending) flush(s.length)
    this.version++
  }

  private csi(params: string, final: string): void {
    const n = (d: number) => {
      const v = parseInt(params, 10)
      return Number.isFinite(v) && v > 0 ? v : d
    }
    switch (final) {
      case 'm':
        if (!/[<=>?]/.test(params)) this.style = applySgr(params, this.style)
        break
      case 'J':
        if (params === '2' || params === '3') this.clear()
        else if (params === '' || params === '0') this.truncateAt(this.col)
        break
      case 'K':
        if (params === '2') this.replaceLast({ ...this.cur(), spans: [], len: 0 })
        else if (params === '' || params === '0') this.truncateAt(this.col)
        else if (params === '1') this.overwrite(0, ' '.repeat(Math.min(this.col, this.cur().len)), EMPTY)
        break
      case 'G':
        this.col = n(1) - 1
        break
      case 'C':
        this.col += n(1)
        break
      case 'D':
        this.col = Math.max(0, this.col - n(1))
        break
      case 'H':
      case 'f':
        if (params === '' || params === '1;1') this.col = 0
        break
      default:
        break
    }
  }

  private cur(): TermLine {
    return this.lines[this.lines.length - 1]
  }

  private replaceLast(line: TermLine): void {
    this.lines[this.lines.length - 1] = line
  }

  private truncateAt(col: number): void {
    const line = this.cur()
    if (col >= line.len) return
    this.replaceLast({ id: line.id, spans: sliceSpans(line.spans, 0, col), len: col })
  }

  private newline(): void {
    this.lines.push(this.makeLine())
    this.col = 0
    if (this.lines.length > this.maxLines) this.lines.splice(0, this.lines.length - this.maxLines)
  }

  private put(text: string): void {
    this.overwrite(this.col, text, this.style)
    this.col += text.length
  }

  private overwrite(col: number, text: string, style: AnsiStyle): void {
    if (!text) return
    const line = this.cur()
    let spans: AnsiSpan[]
    let len: number
    if (col >= line.len) {
      spans = line.spans.slice()
      if (col > line.len) pushSpan(spans, { text: ' '.repeat(col - line.len), style: EMPTY })
      pushSpan(spans, { text, style })
      len = col + text.length
    } else {
      spans = []
      for (const sp of sliceSpans(line.spans, 0, col)) pushSpan(spans, sp)
      pushSpan(spans, { text, style })
      const end = col + text.length
      for (const sp of sliceSpans(line.spans, end, line.len)) pushSpan(spans, sp)
      len = Math.max(line.len, end)
    }
    this.replaceLast({ id: line.id, spans, len })
  }

  /** Plain text of the whole scrollback (for copy). */
  plainText(): string {
    return this.lines.map((l) => l.spans.map((s) => s.text).join('')).join('\n').replace(/\n+$/, '')
  }
}

/** One-shot helper: parses text with ANSI codes into lines of styled spans. */
export function parseAnsi(text: string): TermLine[] {
  const t = new AnsiTerminal(100000)
  t.write(text)
  return t.lines
}

/** Removes all escape sequences. */
export function stripAnsi(text: string): string {
  return parseAnsi(text)
    .map((l) => l.spans.map((s) => s.text).join(''))
    .join('\n')
}
