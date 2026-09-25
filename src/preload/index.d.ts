export interface SpecterBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(event: string, fn: (payload: unknown) => void): () => void
  flushWorkspace(id: string, state: unknown): void
  pathForFile(file: File): string
  platform: string
}

declare global {
  interface Window {
    specter: SpecterBridge
  }
}
