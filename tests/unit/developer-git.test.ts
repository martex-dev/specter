import { describe, expect, it } from 'vitest'
import {
  isValidBranchName,
  isValidCloneUrl,
  parseBranches,
  parseLog,
  parsePorcelainV2,
  parseUnifiedDiff,
  repoNameFromUrl,
  summarizeStatus,
  unquotePath,
  untrackedDiff
} from '../../src/main/modules/developer/gitParse'

describe('git status --porcelain=v2 -z', () => {
  const out = [
    '# branch.oid 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb src/app.ts',
    '1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb docs/read me.md',
    '1 MM N... 100644 100644 100644 aaaaaaa bbbbbbb both.txt',
    '1 A. N... 000000 100644 100644 0000000 bbbbbbb new file.ts',
    '2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 src/renamed.ts',
    'src/original.ts',
    'u UU N... 100644 100644 100644 100644 aaaaaaa bbbbbbb ccccccc conflict.txt',
    '? untracked dir/file.txt',
    '! ignored.log',
    ''
  ].join('\0')

  it('parses branch headers', () => {
    const st = parsePorcelainV2(out)
    expect(st.branch).toBe('main')
    expect(st.oid).toBe('1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b')
    expect(st.upstream).toBe('origin/main')
    expect(st.ahead).toBe(2)
    expect(st.behind).toBe(1)
    expect(st.detached).toBe(false)
    expect(st.initial).toBe(false)
  })

  it('parses entries including paths with spaces, renames and conflicts', () => {
    const st = parsePorcelainV2(out)
    const by = Object.fromEntries(st.files.map((f) => [f.path, f]))
    expect(by['src/app.ts']).toMatchObject({ x: '.', y: 'M', staged: false, unstaged: true, kind: 'changed' })
    expect(by['docs/read me.md']).toMatchObject({ x: 'M', y: '.', staged: true, unstaged: false })
    expect(by['both.txt']).toMatchObject({ staged: true, unstaged: true })
    expect(by['new file.ts']).toMatchObject({ x: 'A', staged: true })
    expect(by['src/renamed.ts']).toMatchObject({ kind: 'renamed', origPath: 'src/original.ts', x: 'R' })
    expect(by['conflict.txt']).toMatchObject({ kind: 'unmerged', conflicted: true })
    expect(by['untracked dir/file.txt']).toMatchObject({ kind: 'untracked', x: '?' })
    expect(by['ignored.log']).toMatchObject({ kind: 'ignored' })
    expect(st.files).toHaveLength(8)
  })

  it('summarizes counts', () => {
    expect(summarizeStatus(parsePorcelainV2(out))).toEqual({ staged: 4, unstaged: 2, untracked: 1, conflicted: 1, dirty: 7 })
  })

  it('handles detached HEAD and initial repos', () => {
    const d = parsePorcelainV2('# branch.oid abcdef0\0# branch.head (detached)\0')
    expect(d.detached).toBe(true)
    expect(d.branch).toBeNull()
    const i = parsePorcelainV2('# branch.oid (initial)\0# branch.head master\0? a.txt\0')
    expect(i.initial).toBe(true)
    expect(i.oid).toBeNull()
    expect(i.branch).toBe('master')
    expect(i.files).toHaveLength(1)
  })
})

describe('unified diff parser', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 83db48f..bf269f4 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,4 +1,5 @@ export function x() {',
    ' const a = 1',
    '-const b = 2',
    '+const b = 3',
    '+const c = 4',
    ' ',
    ' return a',
    '@@ -10 +11 @@',
    '-old',
    '+new',
    '\\ No newline at end of file',
    'diff --git a/new.txt b/new.txt',
    'new file mode 100644',
    'index 0000000..e69de29',
    '--- /dev/null',
    '+++ b/new.txt',
    '@@ -0,0 +1,2 @@',
    '+hello',
    '+-- not a header',
    'diff --git a/old name.txt b/new name.txt',
    'similarity index 100%',
    'rename from old name.txt',
    'rename to new name.txt',
    'diff --git a/img.png b/img.png',
    'index 1234567..89abcde 100644',
    'Binary files a/img.png and b/img.png differ',
    'diff --git a/gone.txt b/gone.txt',
    'deleted file mode 100644',
    '--- a/gone.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-bye',
    ''
  ].join('\n')

  const files = parseUnifiedDiff(diff)

  it('finds every file with its status', () => {
    expect(files.map((f) => [f.newPath, f.status])).toEqual([
      ['src/a.ts', 'modified'],
      ['new.txt', 'added'],
      ['new name.txt', 'renamed'],
      ['img.png', 'modified'],
      ['gone.txt', 'deleted']
    ])
    expect(files[2].oldPath).toBe('old name.txt')
    expect(files[3].binary).toBe(true)
  })

  it('numbers lines and counts additions/deletions', () => {
    const f = files[0]
    expect(f.additions).toBe(3)
    expect(f.deletions).toBe(2)
    expect(f.hunks).toHaveLength(2)
    const h = f.hunks[0]
    expect(h).toMatchObject({ oldStart: 1, oldLines: 4, newStart: 1, newLines: 5 })
    expect(h.lines.map((l) => [l.type, l.oldNo ?? null, l.newNo ?? null, l.text])).toEqual([
      ['ctx', 1, 1, 'const a = 1'],
      ['del', 2, null, 'const b = 2'],
      ['add', null, 2, 'const b = 3'],
      ['add', null, 3, 'const c = 4'],
      ['ctx', 3, 4, ''],
      ['ctx', 4, 5, 'return a']
    ])
    expect(f.hunks[1]).toMatchObject({ oldStart: 10, oldLines: 1, newStart: 11, newLines: 1 })
    expect(f.hunks[1].lines.at(-1)).toMatchObject({ type: 'meta' })
  })

  it('does not mistake "--" content lines for headers', () => {
    expect(files[1].hunks[0].lines.map((l) => l.text)).toEqual(['hello', '-- not a header'])
    expect(files[4].hunks[0].lines).toEqual([{ type: 'del', text: 'bye', oldNo: 1 }])
  })

  it('parses plain unified diffs without git headers and CRLF input', () => {
    const plain = '--- a/x.txt\r\n+++ b/x.txt\r\n@@ -1 +1 @@\r\n-a\r\n+b\r\n--- a/y.txt\r\n+++ b/y.txt\r\n@@ -1 +1 @@\r\n-c\r\n+d\r\n'
    const r = parseUnifiedDiff(plain)
    expect(r.map((f) => f.newPath)).toEqual(['x.txt', 'y.txt'])
    expect(r[1].hunks[0].lines.map((l) => l.type)).toEqual(['del', 'add'])
  })

  it('builds diffs for untracked files', () => {
    const d = untrackedDiff('a.txt', 'one\r\ntwo')
    expect(d.status).toBe('added')
    expect(d.additions).toBe(2)
    expect(d.hunks[0].lines.map((l) => l.type)).toEqual(['add', 'add', 'meta'])
  })

  it('unquotes C-style paths', () => {
    expect(unquotePath('"f\\303\\266o \\"x\\".txt"')).toBe('föo "x".txt')
    expect(unquotePath('plain.txt')).toBe('plain.txt')
  })
})

describe('log / branches / validation', () => {
  it('parses log records', () => {
    const out = 'a'.repeat(40) + '\x1faaaaaaa\x1fAda\x1fada@x.io\x1f1700000000\x1fHEAD -> main\x1fFix: thing\x1e\n' + 'b'.repeat(40) + '\x1fbbbbbbb\x1fBob\x1fb@x.io\x1f1690000000\x1f\x1fInitial\x1e\n'
    const c = parseLog(out)
    expect(c).toHaveLength(2)
    expect(c[0]).toMatchObject({ short: 'aaaaaaa', author: 'Ada', date: 1700000000000, refs: 'HEAD -> main', subject: 'Fix: thing' })
    expect(c[1].refs).toBeUndefined()
  })

  it('parses branches', () => {
    const out = '*\x1frefs/heads/main\x1fmain\x1forigin/main\x1f1700000000\n \x1frefs/remotes/origin/HEAD\x1forigin/HEAD\x1f\x1f1\n \x1frefs/remotes/origin/dev\x1forigin/dev\x1f\x1f1690000000\n'
    const b = parseBranches(out)
    expect(b).toEqual([
      { name: 'main', current: true, upstream: 'origin/main', remote: false, lastCommit: 1700000000000 },
      { name: 'origin/dev', current: false, upstream: null, remote: true, lastCommit: 1690000000000 }
    ])
  })

  it('validates branch names', () => {
    for (const ok of ['main', 'feature/x-1', 'fix_2.0']) expect(isValidBranchName(ok)).toBe(true)
    for (const bad of ['', '-f', 'a..b', 'a b', 'x.lock', 'a~1', 'a^', 'a:b', '.hidden', 'a/.b', 'a//b', 'x/', '@', 'a@{1}']) expect(isValidBranchName(bad)).toBe(false)
  })

  it('validates clone URLs and derives folder names', () => {
    expect(isValidCloneUrl('https://github.com/user/repo.git')).toBe(true)
    expect(isValidCloneUrl('git@github.com:user/repo.git')).toBe(true)
    expect(isValidCloneUrl('ssh://git@host/repo')).toBe(true)
    expect(isValidCloneUrl('--upload-pack=evil')).toBe(false)
    expect(isValidCloneUrl('ext::sh -c touch% /tmp/pwned')).toBe(false)
    expect(isValidCloneUrl('file:///etc')).toBe(false)
    expect(repoNameFromUrl('https://github.com/user/repo.git')).toBe('repo')
    expect(repoNameFromUrl('git@github.com:user/My-Repo')).toBe('My-Repo')
    expect(repoNameFromUrl('https://host/x/..')).toBe('repo')
  })
})
