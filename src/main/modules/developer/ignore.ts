// Ignore rules for the project file indexer. Pure — unit tested.
//
// Two layers:
//  1. Built-in directory names that are never walked (VCS metadata, dependency
//     folders, build output, caches, virtualenvs…).
//  2. .gitignore files (root and nested), with the common subset of gitignore
//     semantics: comments, negation, directory-only rules, anchored rules,
//     `*`, `?`, `**`, and character classes.

export const DEFAULT_IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  'jspm_packages',
  '.pnpm-store',
  '.yarn',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.astro',
  '.turbo',
  '.vercel',
  '.output',
  '.cache',
  '.parcel-cache',
  '.angular',
  'coverage',
  '.nyc_output',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.tox',
  '.eggs',
  'target',
  'obj',
  '.gradle',
  '.idea',
  '.vs',
  'Pods',
  'DerivedData',
  '.terraform',
  '.dart_tool',
  'vendor'
])

export const DEFAULT_IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
const IGNORED_FILE_EXT = /\.(pyc|pyo|class|o|obj|so|dylib|dll\.a|tsbuildinfo)$/i

export interface IgnoreRule {
  /** Directory (relative to the project root, '' = root) the rule file lives in. */
  base: string
  negate: boolean
  dirOnly: boolean
  regex: RegExp
  source: string
}

/** Converts one gitignore glob (already stripped of !, leading / and trailing /) to a regex body. */
function globToRegex(glob: string): string {
  let re = ''
  let i = 0
  while (i < glob.length) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const prevSlash = i === 0 || glob[i - 1] === '/'
        const nextSlash = glob[i + 2] === '/'
        if (prevSlash && nextSlash) {
          // "**/" matches zero or more directories
          re += '(?:.*/)?'
          i += 3
          continue
        }
        if (prevSlash && i + 2 === glob.length) {
          // trailing "/**" matches everything inside
          re += '.*'
          i += 2
          continue
        }
        re += '[^/]*'
        i += 2
        continue
      }
      re += '[^/]*'
      i++
    } else if (c === '?') {
      re += '[^/]'
      i++
    } else if (c === '[') {
      const end = glob.indexOf(']', i + 1)
      if (end < 0) {
        re += '\\['
        i++
      } else {
        let cls = glob.slice(i + 1, end)
        if (cls.startsWith('!')) cls = '^' + cls.slice(1)
        re += '[' + cls.replace(/\\/g, '\\\\') + ']'
        i = end + 1
      }
    } else if (c === '\\' && i + 1 < glob.length) {
      re += escapeRe(glob[i + 1])
      i += 2
    } else {
      re += escapeRe(c)
      i++
    }
  }
  return re
}

function escapeRe(s: string): string {
  return s.replace(/[.+^${}()|[\]\\/]/g, '\\$&')
}

/** Parses the text of a .gitignore located at `base` (relative dir, '' for root). */
export function parseGitignore(text: string, base = ''): IgnoreRule[] {
  const rules: IgnoreRule[] = []
  // Like git, ignore a UTF-8 byte order mark (Notepad / PowerShell 5 write one).
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    let line = raw.replace(/(?<!\\)\s+$/, '')
    if (!line || line.startsWith('#')) continue
    let negate = false
    if (line.startsWith('!')) {
      negate = true
      line = line.slice(1)
    } else if (line.startsWith('\\!') || line.startsWith('\\#')) {
      line = line.slice(1)
    }
    let dirOnly = false
    if (line.endsWith('/')) {
      dirOnly = true
      line = line.replace(/\/+$/, '')
    }
    if (!line) continue
    // A slash at the start or in the middle anchors the pattern to `base`.
    const anchored = line.includes('/')
    if (line.startsWith('/')) line = line.slice(1)
    if (!line) continue
    let body = globToRegex(line)
    body = anchored ? '^' + body + '$' : '(?:^|/)' + body + '$'
    try {
      rules.push({ base, negate, dirOnly, regex: new RegExp(body), source: raw })
    } catch {
      /* malformed pattern — skip */
    }
  }
  return rules
}

/** True if `rel` (forward slashes, relative to the project root) is ignored by the rules. Last match wins. */
export function matchRules(rel: string, isDir: boolean, rules: IgnoreRule[]): boolean {
  let ignored = false
  for (const r of rules) {
    if (r.dirOnly && !isDir) continue
    let sub = rel
    if (r.base) {
      if (!rel.startsWith(r.base + '/')) continue
      sub = rel.slice(r.base.length + 1)
    }
    if (r.regex.test(sub)) ignored = !r.negate
  }
  return ignored
}

/** Built-in rules: directory names never walked and junk files never listed. */
export function isDefaultIgnored(name: string, isDir: boolean): boolean {
  if (isDir) return DEFAULT_IGNORED_DIRS.has(name)
  return DEFAULT_IGNORED_FILES.has(name) || IGNORED_FILE_EXT.test(name)
}

export function isIgnored(rel: string, isDir: boolean, rules: IgnoreRule[]): boolean {
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  return isDefaultIgnored(name, isDir) || matchRules(rel, isDir, rules)
}

// Content indexing ------------------------------------------------------------

const BINARY_EXT = new Set(
  (
    'png jpg jpeg gif bmp ico webp avif tif tiff psd ai svgz heic ' +
    'mp3 wav ogg flac m4a aac mp4 m4v mov avi mkv webm wmv ' +
    'zip gz tgz bz2 xz 7z rar tar zst lz4 jar war ear apk ipa nupkg whl ' +
    'exe dll so dylib lib a o obj pdb bin dat db sqlite sqlite3 mdb ' +
    'woff woff2 ttf otf eot ' +
    'pdf doc docx xls xlsx ppt pptx odt ods ' +
    'class pyc pyo wasm node map lock'
  ).split(/\s+/)
)

/** Whether a file is a candidate for content indexing, judged by name alone. */
export function isTextCandidate(name: string): boolean {
  const lower = name.toLowerCase()
  if (lower.endsWith('.min.js') || lower.endsWith('.min.css')) return false
  if (lower === 'package-lock.json' || lower === 'yarn.lock' || lower === 'pnpm-lock.yaml' || lower === 'cargo.lock') return false
  const dot = lower.lastIndexOf('.')
  if (dot <= 0) return true
  return !BINARY_EXT.has(lower.slice(dot + 1))
}

/** Heuristic binary sniff: NUL bytes or a high ratio of control characters. */
export function looksBinary(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 8000)
  if (n === 0) return false
  let ctrl = 0
  for (let i = 0; i < n; i++) {
    const b = buf[i]
    if (b === 0) return true
    if (b < 7 || (b > 13 && b < 32 && b !== 27)) ctrl++
  }
  return ctrl / n > 0.1
}
