import { BrowserWindow, ipcMain, webContents, type IpcMainInvokeEvent } from 'electron'
import type { IpcChannel, IpcContract, IpcEvent, IpcEvents } from '@shared/ipc'
import { createLogger } from './logger'

const log = createLogger('ipc')
const chromeWebContents = new Set<number>()

/** Registers a renderer as trusted SPECTER chrome (only these may invoke IPC). */
export function trustWebContents(id: number): void {
  chromeWebContents.add(id)
}
export function untrustWebContents(id: number): void {
  chromeWebContents.delete(id)
}

type Handler<C extends IpcChannel> = (
  event: IpcMainInvokeEvent,
  ...args: Parameters<IpcContract[C]>
) => ReturnType<IpcContract[C]> | Promise<Awaited<ReturnType<IpcContract[C]>>>

export function handle<C extends IpcChannel>(channel: C, fn: Handler<C>): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!chromeWebContents.has(event.sender.id)) {
      log.warn(`rejected IPC ${channel} from untrusted sender ${event.sender.id}`)
      throw new Error('Untrusted sender')
    }
    try {
      return await fn(event, ...(args as Parameters<IpcContract[C]>))
    } catch (err) {
      // Rejections are returned to the UI, which reports them; keep the log at warn
      // so expected failures (e.g. an optional service being offline) aren't "errors".
      log.warn(`handler ${channel} rejected: ${err instanceof Error ? err.message : String(err)}`)
      throw err
    }
  })
}

/** Handle an untyped channel (for modules that augment the contract dynamically). */
export function handleRaw(channel: string, fn: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!chromeWebContents.has(event.sender.id)) throw new Error('Untrusted sender')
    return fn(event, ...args)
  })
}

export function sendTo<E extends IpcEvent>(wcId: number, event: E, payload: IpcEvents[E]): void {
  const wc = webContents.fromId(wcId)
  if (wc && !wc.isDestroyed()) wc.send('evt:' + event, payload)
}

export function broadcast<E extends IpcEvent>(event: E, payload: IpcEvents[E]): void {
  for (const id of chromeWebContents) sendTo(id, event, payload)
}

export function broadcastRaw(event: string, payload: unknown): void {
  for (const id of chromeWebContents) {
    const wc = webContents.fromId(id)
    if (wc && !wc.isDestroyed()) wc.send('evt:' + event, payload)
  }
}

export function windowOf(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}
