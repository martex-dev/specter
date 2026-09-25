// Pure parsers for git CLI output. Unit tested.
import type { DiffFile, DiffHunk, GitBranch, GitCommitInfo, GitFileChange, GitStatus, GitStatusCode } from '@shared/modules/developer'

const code = (c: string): GitStatusCode => ('.MTADRCU?!'.includes(c) ? (c as GitStatusCode) : '.')

/**
 * Parses `git status --porcelain=v2 --branch -z` output.
 * Records are NUL-separated; rename/copy records carry an extra NUL-separated original path.
 */
export function parsePorcelainV2(out: string): GitStatus {
  const st: GitStatus = { isRepo: true, branch: null, oid: null, detached: false, upstream: null, ahead: 0, behind: 0, files: [], initial: false }
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i]
    if (!rec) continue
    if (rec.startsWith('# ')) {
      const [key, ...rest] = rec.slice(2).split(' ')
      const val = rest.join(' ')
      if (key === 'branch.oid') {
        st.initial = val === '(initial)'
        st.oid = st.initial ? null : val
      } else if (key === 'branch.head') {
        st.detached = val === '(detached)'
        st.branch = st.detached ? null : val
      } else if (key === 'branch.upstream') st.upstream = val
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(val)
        if (m) {
          st.ahead = Number(m[1])
          st.behind = Number(m[2])
        }
      }
      continue
    }
    const type = rec[0]
    if (type === '1') {
      // 1 XY sub mH mI mW hH hI path
      const f = splitFields(rec, 8)
      st.files.push(change(f[1], f[8], 'changed'))
    } else if (type === '2') {
      // 2 XY sub mH mI mW hH hI Xscore path \0 origPath
      const f = splitFields(rec, 9)
      const c = change(f[1], f[9], 'renamed')
      c.origPath = parts[i + 1]
      i++
      st.files.push(c)
    } else if (type === 'u') {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const f = splitFields(rec, 10)
      const c = change(f[1], f[10], 'unmerged')
      c.conflicted = true
      c.staged = false
      c.unstaged = true
      st.files.push(c)
    } else if (type === '?') {
      st.files.push({ path: rec.slice(2), x: '?', y: '?', kind: 'untracked', staged: false, unstaged: true, conflicted: false })
    } else if (type === '!') {
      st.files.push({ path: rec.slice(2), x: '!', y: '!', kind: 'ignored', staged: false, unstaged: false, conflicted: false })
    }
  }
  return st
}

/** Splits the first `n` space-separated fields; the remainder (a path that may contain spaces) is field n. */
function splitFields(rec: string, n: number): string[] {
  const out: string[] = []
  let pos = 0
  for (let k = 0; k < n; k++) {
    const sp = rec.indexOf(' ', pos)
    if (sp < 0) {
      out.push(rec.slice(pos))
      pos = rec.length
      break
    }
    out.push(rec.slice(pos, sp))
    pos = sp + 1
  }
  out.push(rec.slice(pos))
  return out
}

function change(xy: string, path: string, kind: GitFileChange['kind']): GitFileChange {
  const x = code(xy[0] ?? '.')
  const y = code(xy[1] ?? '.')
  return { path, x, y, kind, staged: x !== '.', unstaged: y !== '.', conflicted: false }
}

export function summarizeStatus(st: GitStatus): { staged: number; unstaged: number; untracked: number; conflicted: number; dirty: number } {
  let staged = 0
  let unstaged = 0
  let untracked = 0
  let conflicted = 0
  let dirty = 0
  for (const f of st.files) {
    if (f.kind === 'ignored') continue
    dirty++
    if (f.conflicted) conflicted++
    else if (f.kind === 'untracked') untracked++
    else {
      if (f.staged) staged++
      if (f.unstaged) unstaged++
    }
  }
  return { staged, unstaged, untracked, conflicted, dirty }
}

// Log ---------------------------------------------------------------------------

export const LOG_FORMAT = '%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e'

export function parseLog(out: string): GitCommitInfo[] {
  const commits: GitCommitInfo[] = []
  for (const rec of out.split('\x1e')) {
    const r = rec.replace(/^\s+/, '')
    if (!r) continue
    const [hash, short, author, email, at, refs, ...subject] = r.split('\x1f')
    if (!hash || !/^[0-9a-f]{7,64}$/.test(hash)) continue
    commits.push({ hash, short, author, email, date: Number(at) * 1000, refs: refs || undefined, subject: subject.join('\x1f').replace(/\s+$/, '') })
  }
  return commits
}

export const BRANCH_FORMAT = '%(HEAD)%1f%(refname)%1f%(refname:short)%1f%(upstream:short)%1f%(committerdate:unix)'

export function parseBranches(out: string): GitBranch[] {
  const list: GitBranch[] = []
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [head, refname, short, upstream, date] = line.split('\x1f')
    if (!refname || refname.endsWith('/HEAD')) continue
    list.push({ name: short, current: head === '*', upstream: upstream || null, remote: refname.startsWith('refs/remotes/'), lastCommit: Number(date) * 1000 || 0 })
  }
  return list
}

// Unified diff --------------------------------------------------------------------

/** Undoes git's C-style path quoting ("a/f\303\266o \"x\""). */
export function unquotePath(p: string): string {
  if (!p.startsWith('"') || !p.endsWith('"')) return p
  const body = p.slice(1, -1)
  const bytes: number[] = []
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '\\' && i + 1 < body.length) {
      const n = body[i + 1]
      if (/[0-7]/.test(n)) {
        bytes.push(parseInt(body.slice(i + 1, i + 4), 8))
        i += 3
        continue
      }
      const map: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 }
      bytes.push(map[n] ?? n.charCodeAt(0))
      i++
      continue
    }
    const enc = new TextEncoder().encode(c)
    bytes.push(...enc)
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

function stripPrefix(p: string): string {
  const u = unquotePath(p.trim())
  if (u === '/dev/null') return u
  return u.replace(/^[abciow]\//, '')
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

/** Parses unified diff text (git diff / git show / git diff --no-index) into files and hunks. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  let oldLeft = 0
  let newLeft = 0
  const lines = text.split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()

  const startFile = (oldPath = '', newPath = ''): DiffFile => {
    const f: DiffFile = { oldPath, newPath, status: 'modified', binary: false, hunks: [], additions: 0, deletions: 0, headers: [] }
    files.push(f)
    hunk = null
    return f
  }

  for (let raw of lines) {
    if (raw.endsWith('\r')) raw = raw.slice(0, -1)
    if (raw.startsWith('diff --git ')) {
      const m = /^diff --git (?:"?a\/)(.+?)"? (?:"?b\/)(.+?)"?$/.exec(raw)
      file = startFile(m ? unquotePath(m[1]) : '', m ? unquotePath(m[2]) : '')
      file.headers.push(raw)
      continue
    }
    if (!file || (!hunk && !raw.startsWith('@@'))) {
      // Header area (or preamble before the first file, e.g. `git show` commit text).
      if (raw.startsWith('--- ')) {
        if (!file || file.hunks.length) file = startFile()
        const p = stripPrefix(raw.slice(4).split('\t')[0])
        if (p === '/dev/null') file.status = 'added'
        else file.oldPath = p
        file.headers.push(raw)
        continue
      }
      if (!file) continue
      if (raw.startsWith('\\') && file.hunks.length) {
        file.hunks[file.hunks.length - 1].lines.push({ type: 'meta', text: raw })
        continue
      }
      if (raw.startsWith('+++ ')) {
        const p = stripPrefix(raw.slice(4).split('\t')[0])
        if (p === '/dev/null') file.status = 'deleted'
        else file.newPath = p
      } else if (raw.startsWith('new file mode')) file.status = 'added'
      else if (raw.startsWith('deleted file mode')) file.status = 'deleted'
      else if (raw.startsWith('rename from ')) {
        file.status = 'renamed'
        file.oldPath = unquotePath(raw.slice(12))
      } else if (raw.startsWith('rename to ')) {
        file.status = 'renamed'
        file.newPath = unquotePath(raw.slice(10))
      } else if (raw.startsWith('copy from ')) {
        file.status = 'copied'
        file.oldPath = unquotePath(raw.slice(10))
      } else if (raw.startsWith('copy to ')) file.newPath = unquotePath(raw.slice(8))
      else if (raw.startsWith('old mode') || raw.startsWith('new mode')) {
        if (file.status === 'modified') file.status = 'mode'
      } else if (raw.startsWith('Binary files ') || raw === 'GIT binary patch') file.binary = true
      file.headers.push(raw)
      continue
    }
    const hm = HUNK_RE.exec(raw)
    if (hm) {
      oldNo = Number(hm[1])
      newNo = Number(hm[3])
      const h: DiffHunk = {
        header: raw,
        oldStart: oldNo,
        oldLines: hm[2] === undefined ? 1 : Number(hm[2]),
        newStart: newNo,
        newLines: hm[4] === undefined ? 1 : Number(hm[4]),
        lines: []
      }
      file.hunks.push(h)
      if (file.status === 'mode') file.status = 'modified'
      hunk = h
      oldLeft = h.oldLines
      newLeft = h.newLines
      if (oldLeft === 0 && newLeft === 0) hunk = null
      continue
    }
    if (!hunk) continue
    const h = hunk as DiffHunk
    const c = raw[0]
    if (c === '+') {
      h.lines.push({ type: 'add', text: raw.slice(1), newNo: newNo++ })
      file.additions++
      newLeft--
    } else if (c === '-') {
      h.lines.push({ type: 'del', text: raw.slice(1), oldNo: oldNo++ })
      file.deletions++
      oldLeft--
    } else if (c === ' ' || raw === '') {
      h.lines.push({ type: 'ctx', text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ })
      oldLeft--
      newLeft--
    } else if (c === '\\') {
      h.lines.push({ type: 'meta', text: raw })
    } else {
      // Something unexpected (e.g. the next commit header in `git log -p`); end the hunk.
      hunk = null
    }
    if (hunk && oldLeft <= 0 && newLeft <= 0) hunk = null
  }
  for (const f of files) {
    if (!f.newPath) f.newPath = f.oldPath
    if (!f.oldPath) f.oldPath = f.newPath
  }
  return files
}

/** Builds a synthetic "new file" diff for an untracked text file. */
export function untrackedDiff(path: string, text: string): DiffFile {
  const body = text.replace(/\r\n/g, '\n')
  const lines = body.split('\n')
  const noEol = !body.endsWith('\n')
  if (!noEol) lines.pop()
  const hunk: DiffHunk = { header: `@@ -0,0 +1,${lines.length} @@`, oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines: [] }
  lines.forEach((l, i) => hunk.lines.push({ type: 'add', text: l, newNo: i + 1 }))
  if (noEol && lines.length) hunk.lines.push({ type: 'meta', text: '\\ No newline at end of file' })
  return { oldPath: '/dev/null', newPath: path, status: 'added', binary: false, hunks: lines.length ? [hunk] : [], additions: lines.length, deletions: 0, headers: [`new file ${path}`] }
}

/** Validates a branch name conservatively (git check-ref-format rules, subset). */
export function isValidBranchName(name: string): boolean {
  if (!name || name.length > 200) return false
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) return false
  if (name.includes('..') || name.includes('//') || name.includes('@{') || name === '@') return false
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20~^:?*[\\\x7f]/.test(name)) return false
  return !name.split('/').some((p) => p.startsWith('.'))
}

/** Accepts https://, http://, ssh://, git://, file:// and scp-style (user@host:path) clone URLs. */
export function isValidCloneUrl(url: string): boolean {
  const u = url.trim()
  if (!u || u.length > 2000 || u.startsWith('-') || /\s/.test(u)) return false
  if (/^(https?|ssh|git):\/\/[^\s/]+\/.+/i.test(u)) return true
  if (/^[\w.-]+@[\w.-]+:[\w./~-]+$/.test(u)) return true
  return false
}

/** Derives the destination folder name from a clone URL ("https://github.com/a/b.git" → "b"). */
export function repoNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/[/\\]+$/, '').replace(/\.git$/i, '')
  const last = trimmed.split(/[/:\\]/).pop() ?? 'repo'
  const safe = last.replace(/[<>:"|?*\x00-\x1f]/g, '').replace(/^\.+/, '')
  return safe || 'repo'
}
