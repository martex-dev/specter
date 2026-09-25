import { describe, expect, it } from 'vitest'
import { isDefaultIgnored, isIgnored, isTextCandidate, looksBinary, matchRules, parseGitignore } from '../../src/main/modules/developer/ignore'

describe('built-in ignore rules', () => {
  it('skips dependency, build, cache and VCS folders', () => {
    for (const d of ['.git', 'node_modules', 'dist', 'build', 'out', '.venv', '__pycache__', 'target', '.next']) expect(isDefaultIgnored(d, true)).toBe(true)
    expect(isDefaultIgnored('src', true)).toBe(false)
    expect(isDefaultIgnored('dist', false)).toBe(false) // a *file* named dist is fine
    expect(isDefaultIgnored('.DS_Store', false)).toBe(true)
    expect(isDefaultIgnored('mod.pyc', false)).toBe(true)
  })
})

describe('gitignore', () => {
  const rules = parseGitignore(
    [
      '# comment',
      '',
      '*.log',
      '!keep.log',
      '/secret.txt',
      'tmp/',
      'docs/**/*.pdf',
      '**/generated',
      'a?c.txt',
      'build-[0-9].zip',
      'foo/bar',
      '\\#hash',
      'trailing   '
    ].join('\n')
  )

  const ig = (p: string, dir = false) => matchRules(p, dir, rules)

  it('matches basenames at any depth', () => {
    expect(ig('app.log')).toBe(true)
    expect(ig('deep/nested/app.log')).toBe(true)
    expect(ig('app.logs')).toBe(false)
  })

  it('applies negation (last match wins)', () => {
    expect(ig('keep.log')).toBe(false)
    expect(ig('sub/keep.log')).toBe(false)
  })

  it('anchors leading-slash and mid-slash patterns', () => {
    expect(ig('secret.txt')).toBe(true)
    expect(ig('sub/secret.txt')).toBe(false)
    expect(ig('foo/bar')).toBe(true)
    expect(ig('x/foo/bar')).toBe(false)
  })

  it('directory-only rules only match directories', () => {
    expect(ig('tmp', true)).toBe(true)
    expect(ig('x/tmp', true)).toBe(true)
    expect(ig('tmp', false)).toBe(false)
  })

  it('supports **, ? and character classes', () => {
    expect(ig('docs/a.pdf')).toBe(true)
    expect(ig('docs/x/y/a.pdf')).toBe(true)
    expect(ig('other/a.pdf')).toBe(false)
    expect(ig('generated', true)).toBe(true)
    expect(ig('a/b/generated', true)).toBe(true)
    expect(ig('abc.txt')).toBe(true)
    expect(ig('abbc.txt')).toBe(false)
    expect(ig('build-3.zip')).toBe(true)
    expect(ig('build-x.zip')).toBe(false)
    expect(ig('#hash')).toBe(true)
    expect(ig('trailing')).toBe(true)
  })

  it('scopes nested .gitignore rules to their folder', () => {
    const nested = parseGitignore('*.tmp\n/only-here', 'pkg')
    expect(matchRules('pkg/a.tmp', false, nested)).toBe(true)
    expect(matchRules('pkg/sub/a.tmp', false, nested)).toBe(true)
    expect(matchRules('a.tmp', false, nested)).toBe(false)
    expect(matchRules('pkg/only-here', false, nested)).toBe(true)
    expect(matchRules('pkg/sub/only-here', false, nested)).toBe(false)
  })

  it('combines built-in and gitignore rules', () => {
    expect(isIgnored('src/node_modules', true, [])).toBe(true)
    expect(isIgnored('src/index.ts', false, rules)).toBe(false)
    expect(isIgnored('logs/x.log', false, rules)).toBe(true)
  })
})

describe('content indexing filters', () => {
  it('filters by name', () => {
    expect(isTextCandidate('main.ts')).toBe(true)
    expect(isTextCandidate('Makefile')).toBe(true)
    expect(isTextCandidate('logo.png')).toBe(false)
    expect(isTextCandidate('bundle.min.js')).toBe(false)
    expect(isTextCandidate('package-lock.json')).toBe(false)
  })

  it('sniffs binary content', () => {
    expect(looksBinary(new TextEncoder().encode('hello\nworld\t\x1b[31m'))).toBe(false)
    expect(looksBinary(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]))).toBe(true)
    expect(looksBinary(new Uint8Array())).toBe(false)
  })
})
