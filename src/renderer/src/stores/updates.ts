// Mirror of the main-process update state (src/main/services/updates.ts).
import { create } from 'zustand'
import type { UpdateState } from '@shared/updates'
import { describeUpdateState, summarizeUpdateError } from '@shared/updates'
import { invoke, on } from '../lib/ipc'
import { flushAll } from './browser'
import { toast } from './ui'

export const useUpdates = create<{ s: UpdateState | null }>(() => ({ s: null }))

let toastedVersion: string | null = null

function apply(next: UpdateState): void {
  const prev = useUpdates.getState().s
  useUpdates.setState({ s: next })
  // Announce a finished download once per version per window (also on startup when
  // a previous session already downloaded it).
  if (next.phase === 'ready' && next.latest && toastedVersion !== next.latest && prev?.phase !== 'installing') {
    toastedVersion = next.latest
    toast({
      kind: 'ok',
      title: `SPECTER ${next.latest} is ready — Restart to update`,
      body: 'Tabs and workspaces are saved and restored after the restart.',
      action: { label: 'Restart to update', run: () => void installUpdate() },
      ttl: 0
    })
  }
}

on('updates:state', apply)
invoke('updates:state')
  .then(apply)
  .catch(() => undefined)

/** Flushes workspace state, then hands over to the installer (the app quits). */
export async function installUpdate(): Promise<void> {
  const s = useUpdates.getState().s
  if (s?.phase !== 'ready') {
    toast({ kind: 'info', title: 'No update is ready to install', body: s ? describeUpdateState(s) : undefined })
    return
  }
  flushAll()
  try {
    await invoke('updates:install')
  } catch (err) {
    toast({ kind: 'error', title: 'Could not start the update', body: String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
  }
}

/** Manual check with a toast describing the honest outcome. */
export async function checkForUpdatesNow(): Promise<void> {
  const cur = useUpdates.getState().s
  if (cur?.mode === 'dev') {
    toast({ kind: 'info', title: 'Updates are disabled in development builds' })
    return
  }
  if (cur?.phase === 'ready') {
    toast({ kind: 'ok', title: `SPECTER ${cur.latest} is ready`, action: { label: 'Restart to update', run: () => void installUpdate() } })
    return
  }
  try {
    const s = await invoke('updates:check')
    apply(s)
    if (s.phase === 'error') toast({ kind: 'error', title: summarizeUpdateError(s.error ?? ''), body: s.error })
    else if (s.phase !== 'ready') toast({ kind: s.phase === 'up-to-date' ? 'ok' : 'info', title: describeUpdateState(s) })
  } catch (err) {
    toast({ kind: 'error', title: 'Update check failed', body: String((err as Error)?.message ?? err) })
  }
}
