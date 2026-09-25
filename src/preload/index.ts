// Preload for SPECTER's own UI (never loaded into web pages).
// Exposes a minimal, typed bridge: invoke(channel) for whitelisted domains and
// on(event) subscriptions.
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_DOMAINS } from '@shared/ipc'

const domains = new Set<string>(IPC_DOMAINS)
const CHANNEL = /^([a-z]+):[a-zA-Z0-9.-]+$/

function allowed(channel: string): boolean {
  const m = CHANNEL.exec(channel)
  return !!m && domains.has(m[1])
}

const api = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (!allowed(channel)) return Promise.reject(new Error('Blocked IPC channel: ' + channel))
    return ipcRenderer.invoke(channel, ...args)
  },
  on(event: string, fn: (payload: unknown) => void): () => void {
    if (!allowed(event)) throw new Error('Blocked IPC event: ' + event)
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) => fn(payload)
    ipcRenderer.on('evt:' + event, listener)
    return () => ipcRenderer.removeListener('evt:' + event, listener)
  },
  flushWorkspace(id: string, state: unknown): void {
    ipcRenderer.send('flush:workspace', id, state)
  },
  pathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('specter', api)

export type SpecterBridge = typeof api
