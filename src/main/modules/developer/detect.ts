// Project type detection, README discovery and runnable scripts. Reads only a
// handful of well-known files at the project root.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ProjectKind, ProjectScript } from '@shared/modules/developer'

export interface Detection {
  name: string
  kinds: ProjectKind[]
  tags: string[]
  description: string | null
  packageManager: string | null
  scripts: ProjectScript[]
}

function readJson(path: string): any {
  try {
    const st = statSync(path)
    if (st.size > 2 * 1024 * 1024) return null
    return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''))
  } catch {
    return null
  }
}

function readText(path: string, max = 512 * 1024): string | null {
  try {
    const st = statSync(path)
    if (!st.isFile() || st.size > max) return null
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function listRoot(root: string): string[] {
  try {
    return readdirSync(root)
  } catch {
    return []
  }
}

const FRAMEWORK_DEPS: [string, string][] = [
  ['next', 'next.js'],
  ['react', 'react'],
  ['vue', 'vue'],
  ['svelte', 'svelte'],
  ['@angular/core', 'angular'],
  ['solid-js', 'solid'],
  ['astro', 'astro'],
  ['nuxt', 'nuxt'],
  ['electron', 'electron'],
  ['vite', 'vite'],
  ['webpack', 'webpack'],
  ['express', 'express'],
  ['fastify', 'fastify'],
  ['@nestjs/core', 'nestjs'],
  ['vitest', 'vitest'],
  ['jest', 'jest'],
  ['tailwindcss', 'tailwind'],
  ['react-native', 'react-native']
]

export function detectProject(root: string): Detection {
  const files = listRoot(root)
  const has = (f: string) => files.includes(f)
  const lower = files.map((f) => f.toLowerCase())
  const kinds = new Set<ProjectKind>()
  const tags = new Set<string>()
  let name = basename(root) || root
  let description: string | null = null
  let packageManager: string | null = null
  const scripts: ProjectScript[] = []

  // Node / TypeScript
  const pkg = has('package.json') ? readJson(join(root, 'package.json')) : null
  if (pkg) {
    kinds.add('node')
    if (typeof pkg.name === 'string' && pkg.name) name = pkg.name
    if (typeof pkg.description === 'string' && pkg.description) description = pkg.description
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    if (deps.typescript || has('tsconfig.json')) kinds.add('typescript')
    for (const [dep, tag] of FRAMEWORK_DEPS) if (deps[dep]) tags.add(tag)
    packageManager =
      typeof pkg.packageManager === 'string'
        ? pkg.packageManager.split('@')[0]
        : has('pnpm-lock.yaml')
          ? 'pnpm'
          : has('yarn.lock')
            ? 'yarn'
            : has('bun.lockb') || has('bun.lock')
              ? 'bun'
              : 'npm'
    if (pkg.scripts && typeof pkg.scripts === 'object') {
      for (const [k, v] of Object.entries(pkg.scripts)) {
        if (typeof v !== 'string') continue
        const cmd = packageManager === 'yarn' ? `yarn ${k}` : packageManager === 'bun' ? `bun run ${k}` : `${packageManager} run ${k}`
        scripts.push({ name: k, command: cmd, detail: v, source: 'package.json' })
      }
    }
  } else if (has('tsconfig.json')) kinds.add('typescript')
  if (has('deno.json') || has('deno.jsonc')) kinds.add('deno')

  // Python
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py') || has('Pipfile') || has('setup.cfg')) {
    kinds.add('python')
    const py = readText(join(root, 'pyproject.toml'))
    if (py) {
      const m = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(py)
      if (m && !pkg) name = m[1]
      const d = /^\s*description\s*=\s*["']([^"']+)["']/m.exec(py)
      if (d && !description) description = d[1]
      if (/\[tool\.poetry\]/.test(py)) tags.add('poetry')
      if (/django/i.test(py)) tags.add('django')
      if (/fastapi/i.test(py)) tags.add('fastapi')
      if (/flask/i.test(py)) tags.add('flask')
    }
    if (has('manage.py')) tags.add('django')
    if (has('uv.lock')) tags.add('uv')
  }

  // Rust
  if (has('Cargo.toml')) {
    kinds.add('rust')
    const cargo = readText(join(root, 'Cargo.toml'))
    const m = cargo && /^\s*name\s*=\s*"([^"]+)"/m.exec(cargo)
    if (m && !pkg) name = m[1]
    scripts.push(
      { name: 'build', command: 'cargo build', detail: 'cargo build', source: 'standard' },
      { name: 'run', command: 'cargo run', detail: 'cargo run', source: 'standard' },
      { name: 'test', command: 'cargo test', detail: 'cargo test', source: 'standard' }
    )
  }

  // Go
  if (has('go.mod')) {
    kinds.add('go')
    const mod = readText(join(root, 'go.mod'))
    const m = mod && /^module\s+(\S+)/m.exec(mod)
    if (m && !pkg) name = m[1].split('/').pop() || name
    scripts.push(
      { name: 'build', command: 'go build ./...', detail: 'go build ./...', source: 'standard' },
      { name: 'test', command: 'go test ./...', detail: 'go test ./...', source: 'standard' }
    )
  }

  // .NET
  const sln = files.find((f) => /\.sln$/i.test(f))
  const proj = files.find((f) => /\.(cs|fs|vb)proj$/i.test(f))
  if (sln || proj) {
    kinds.add('dotnet')
    scripts.push(
      { name: 'build', command: 'dotnet build', detail: 'dotnet build', source: 'standard' },
      { name: 'test', command: 'dotnet test', detail: 'dotnet test', source: 'standard' }
    )
    if (proj) scripts.push({ name: 'run', command: 'dotnet run', detail: 'dotnet run', source: 'standard' })
  }

  // JVM
  if (has('pom.xml')) {
    kinds.add('java')
    tags.add('maven')
  }
  if (has('build.gradle') || has('build.gradle.kts') || has('settings.gradle') || has('settings.gradle.kts')) {
    kinds.add(has('build.gradle.kts') ? 'kotlin' : 'java')
    tags.add('gradle')
  }

  // Others
  const composer = has('composer.json') ? readJson(join(root, 'composer.json')) : null
  if (composer) {
    kinds.add('php')
    if (composer.scripts && typeof composer.scripts === 'object') {
      for (const [k, v] of Object.entries(composer.scripts)) scripts.push({ name: k, command: `composer run-script ${k}`, detail: Array.isArray(v) ? v.join(' && ') : String(v), source: 'composer.json' })
    }
  }
  if (has('Gemfile')) kinds.add('ruby')
  if (has('CMakeLists.txt') || (has('Makefile') && files.some((f) => /\.(c|cc|cpp|h|hpp)$/i.test(f)))) kinds.add('cpp')
  if (has('pubspec.yaml')) kinds.add('dart')

  // Makefile targets
  const makefile = files.find((f) => f === 'Makefile' || f === 'makefile' || f === 'GNUmakefile')
  if (makefile) {
    const mk = readText(join(root, makefile), 256 * 1024)
    if (mk) {
      const seen = new Set<string>()
      for (const m of mk.matchAll(/^([A-Za-z0-9][\w.-]*)\s*:(?!=)/gm)) {
        const t = m[1]
        if (seen.has(t) || t.startsWith('.') || seen.size >= 20) continue
        seen.add(t)
        scripts.push({ name: t, command: `make ${t}`, detail: `make ${t}`, source: 'Makefile' })
      }
    }
  }

  if (kinds.size === 0 && lower.includes('index.html')) kinds.add('static')
  if (existsSync(join(root, '.git'))) {
    if (kinds.size === 0) kinds.add('git')
  }
  if (kinds.size === 0) kinds.add('folder')

  return { name, kinds: [...kinds], tags: [...tags], description, packageManager, scripts }
}

const README_NAMES = ['readme.md', 'readme.markdown', 'readme.mdx', 'readme.rst', 'readme.txt', 'readme']

export function findReadme(root: string): { file: string; markdown: string; truncated: boolean } | null {
  const files = listRoot(root)
  for (const want of README_NAMES) {
    const f = files.find((x) => x.toLowerCase() === want)
    if (!f) continue
    const text = readText(join(root, f), 4 * 1024 * 1024)
    if (text === null) continue
    const limit = 24_000
    const truncated = text.length > limit
    let md = truncated ? text.slice(0, limit) : text
    if (!/\.(md|markdown|mdx)$/i.test(f)) md = '```text\n' + md.replace(/```/g, "'''") + '\n```'
    return { file: f, markdown: md, truncated }
  }
  return null
}
