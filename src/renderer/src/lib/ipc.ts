import type { IpcArgs, IpcChannel, IpcEvent, IpcEvents, IpcResult } from '@shared/ipc'

/** Typed invoke for the SPECTER IPC contract. */
export function invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> {
  return window.specter.invoke(channel, ...args) as Promise<IpcResult<C>>
}

/** Untyped invoke for module channels not in the core contract. */
export function invokeRaw<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  return window.specter.invoke(channel, ...args) as Promise<T>
}

export function on<E extends IpcEvent>(event: E, fn: (payload: IpcEvents[E]) => void): () => void {
  return window.specter.on(event, fn as (p: unknown) => void)
}

export function onRaw<T = unknown>(event: string, fn: (payload: T) => void): () => void {
  return window.specter.on(event, fn as (p: unknown) => void)
}

/** Invoke that never throws — returns fallback on error (for optional features). */
export async function safeInvoke<C extends IpcChannel>(fallback: IpcResult<C>, channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> {
  try {
    return await invoke(channel, ...args)
  } catch {
    return fallback
  }
}

// Commands main sends while the window is still booting (e.g. a link opened by a
// second launch) arrive before App subscribes; hold them for it instead of dropping them.
let early: IpcEvents['command:run'][] | null = []
const stopEarly = on('command:run', (m) => early?.push(m))
setTimeout(() => takeEarlyCommands(), 30_000)

/** Hands over (once) the commands received before the UI subscribed. */
export function takeEarlyCommands(): IpcEvents['command:run'][] {
  const out = early ?? []
  early = null
  stopEarly()
  return out
}
