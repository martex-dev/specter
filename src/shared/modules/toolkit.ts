// Toolkit module — shared IPC contract.
//
// The only main-process piece is the HTTP request tester: the renderer has no
// network access of its own, so requests the user explicitly sends from
// specter://toolkit/http are performed by `tools:http` in the main process.

export interface HttpToolRequest {
  method: string
  url: string
  headers: [string, string][]
  body?: string
  /** Milliseconds before the request is aborted (clamped to 1s…120s). */
  timeoutMs?: number
  /** Follow redirects (default true). */
  followRedirects?: boolean
}

export interface HttpToolResponse {
  ok: boolean
  status: number
  statusText: string
  url: string
  redirected: boolean
  headers: [string, string][]
  /** Response body decoded as UTF-8 (truncated to maxBodyBytes). */
  body: string
  /** True when the body looked binary; `body` then holds a short notice. */
  binary: boolean
  truncated: boolean
  bytes: number
  /** Time until response headers arrived, ms. */
  ttfbMs: number
  /** Total time including body download, ms. */
  totalMs: number
  error?: string
}

declare module '../ipc' {
  interface IpcContract {
    'tools:http': (req: HttpToolRequest) => HttpToolResponse
  }
}
