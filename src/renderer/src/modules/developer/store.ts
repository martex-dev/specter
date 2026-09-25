// Renderer state for the developer module: project list, environment, and
// user actions that need confirmation (add, clone, run script…).
import { create } from 'zustand'
import type { DevEnvironment, IndexProgress, ProjectInfo, ProjectScript } from '@shared/modules/developer'
import { invoke, on } from '../../lib/ipc'
import { newTab } from '../../stores/browser'
import { openOverlay, openSidePanel, toast } from '../../stores/ui'
import { confirmAction } from '../../components/prompt'

interface DevState {
  projects: ProjectInfo[]
  loaded: boolean
  progress: Record<string, IndexProgress>
  env: DevEnvironment | null
  /** Project the Git / terminal panels follow. */
  currentId: string | null
}

export const useDev = create<DevState>(() => ({ projects: [], loaded: false, progress: {}, env: null, currentId: null }))

let subscribed = false
let reloadTimer: number | null = null
let envPromise: Promise<DevEnvironment | null> | null = null

/** Tool availability (git, VS Code, shells); detected once per window. */
export function loadEnv(): Promise<DevEnvironment | null> {
  if (!envPromise)
    envPromise = invoke('projects:env')
      .then((env) => {
        useDev.setState({ env })
        return env
      })
      .catch(() => null)
  return envPromise
}

export function reloadProjects(): Promise<void> {
  return invoke('projects:list')
    .then((projects) => {
      const cur = useDev.getState().currentId
      useDev.setState({
        projects,
        loaded: true,
        currentId: cur && projects.some((p) => p.id === cur) ? cur : (projects[0]?.id ?? null)
      })
    })
    .catch(() => useDev.setState({ loaded: true }))
}

/** Starts listening to project events (idempotent) and loads the list. */
export function ensureDevData(): void {
  if (subscribed) return
  subscribed = true
  void reloadProjects()
  void loadEnv()
  on('projects:changed', () => {
    if (reloadTimer) window.clearTimeout(reloadTimer)
    reloadTimer = window.setTimeout(() => void reloadProjects(), 80)
  })
  on('projects:indexProgress', (p) => {
    useDev.setState((s) => ({ progress: { ...s.progress, [p.projectId]: p } }))
    if (p.phase === 'done') void reloadProjects()
  })
  on('settings:changed', ({ key }) => {
    if (key === 'developer.projectRoots' || key === 'developer.shell') {
      void reloadProjects()
      invoke('projects:env')
        .then((env) => useDev.setState({ env }))
        .catch(() => undefined)
    }
  })
}

export function useProject(id: string | null | undefined): ProjectInfo | undefined {
  return useDev((s) => (id ? s.projects.find((p) => p.id === id) : undefined))
}

export function setCurrentProject(id: string | null): void {
  useDev.setState({ currentId: id })
}

export const errMsg = (err: unknown) => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))

// Actions ------------------------------------------------------------------------------------

export async function addProjectFlow(): Promise<string | null> {
  const path = await invoke('app:pickFolder', 'Add a project folder')
  if (!path) return null
  try {
    const p = await invoke('projects:add', path)
    await reloadProjects()
    setCurrentProject(p.id)
    toast({ kind: 'ok', title: 'Project added', body: `${p.name} — indexing file names locally` })
    return p.id
  } catch (err) {
    toast({ kind: 'error', title: 'Could not add project', body: errMsg(err) })
    return null
  }
}

export function openProjectPage(id?: string | null): void {
  newTab(id ? `specter://projects/${id}` : 'specter://projects')
}

export function cloneRepoFlow(url?: string): void {
  openOverlay('developer.clone', { url: typeof url === 'string' ? url : '' })
}

/** Opens a terminal in the project folder (side panel) and returns the session id. */
export async function openTerminalFor(projectId: string | null, opts: { page?: boolean } = {}): Promise<string | null> {
  const { createTerminal } = await import('./termStore')
  const id = await createTerminal(projectId)
  if (!id) return null
  if (opts.page) newTab('specter://terminal')
  else openSidePanel('terminal')
  return id
}

export async function runScriptFlow(project: ProjectInfo, script: ProjectScript): Promise<void> {
  const ok = await confirmAction(
    `Run “${script.name}” in the terminal?`,
    `This executes “${script.command}”${script.detail && script.detail !== script.command ? ` (${script.detail})` : ''} on your computer, in a new terminal session in ${project.path}.`,
    'Run',
    false
  )
  if (!ok) return
  const { createTerminal, submitLine } = await import('./termStore')
  const id = await createTerminal(project.id)
  if (!id) return
  openSidePanel('terminal')
  await submitLine(id, script.command)
}

export function glyphFor(p: Pick<ProjectInfo, 'kinds'>): string {
  const k = p.kinds[0] ?? 'folder'
  const map: Record<string, string> = {
    node: p.kinds.includes('typescript') ? 'TS' : 'JS',
    typescript: 'TS',
    deno: 'DN',
    python: 'PY',
    rust: 'RS',
    go: 'GO',
    dotnet: '.N',
    java: 'JV',
    kotlin: 'KT',
    php: 'PHP',
    ruby: 'RB',
    cpp: 'C++',
    dart: 'DT',
    static: 'WWW',
    git: 'GIT',
    folder: '—'
  }
  return map[k] ?? k.slice(0, 2).toUpperCase()
}

export const KIND_LABEL: Record<string, string> = {
  node: 'Node.js',
  typescript: 'TypeScript',
  deno: 'Deno',
  python: 'Python',
  rust: 'Rust',
  go: 'Go',
  dotnet: '.NET',
  java: 'Java',
  kotlin: 'Kotlin',
  php: 'PHP',
  ruby: 'Ruby',
  cpp: 'C/C++',
  dart: 'Dart',
  static: 'Static site',
  git: 'Git repository',
  folder: 'Folder'
}
