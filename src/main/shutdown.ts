// Shutdown cleanup shared by the normal quit path (before-quit) and the
// updater's "restart to update" path, which must run it *before* the
// installer is spawned (the installer force-closes SPECTER shortly after it starts).
import { metaSet } from './db'
import { chromeContexts } from './windows'
import { clearOnExitIfEnabled } from './services/privacy'
import { createLogger } from './logger'

const log = createLogger('shutdown')
let cleanup: Promise<void> | null = null

/** Flushes renderer state, runs clear-on-exit and marks a clean exit. Idempotent. */
export function runShutdownCleanup(): Promise<void> {
  if (!cleanup) {
    cleanup = (async () => {
      try {
        // Give renderers a moment to flush workspace state.
        for (const c of chromeContexts()) if (!c.win.isDestroyed()) c.win.webContents.send('evt:command:run', { id: 'internal.flush' })
        await new Promise((r) => setTimeout(r, 150))
        await clearOnExitIfEnabled()
        metaSet('session:cleanExit', '1')
      } catch (err) {
        log.error('shutdown cleanup failed', err)
      }
    })()
  }
  return cleanup
}

/** The app is not quitting after all (e.g. the installer failed to start): allow cleanup to run again later. */
export function cancelShutdownCleanup(): void {
  cleanup = null
  try {
    metaSet('session:cleanExit', '0')
  } catch {
    /* db closed */
  }
}
