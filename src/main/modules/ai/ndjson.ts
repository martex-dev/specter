// Incremental NDJSON (newline-delimited JSON) parser for streaming responses.
// Chunks can split lines — and multi-byte characters — anywhere; the parser
// buffers partial lines and only emits complete JSON objects. Pure (no Electron).

export class NdjsonParser<T = unknown> {
  private buf = ''
  private decoder = new TextDecoder('utf-8')
  /** Lines that could not be parsed (kept short for logging). */
  readonly errors: string[] = []

  /** Feed a text or byte chunk; returns every complete object it finished. */
  push(chunk: string | Uint8Array): T[] {
    this.buf += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true })
    const out: T[] = []
    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl)
      this.buf = this.buf.slice(nl + 1)
      this.parseLine(line, out)
    }
    return out
  }

  /** Call at end of stream to parse a final line without a trailing newline. */
  flush(): T[] {
    const out: T[] = []
    const rest = this.buf + this.decoder.decode()
    this.buf = ''
    this.parseLine(rest, out)
    return out
  }

  private parseLine(line: string, out: T[]): void {
    const t = line.trim()
    if (!t) return
    try {
      out.push(JSON.parse(t) as T)
    } catch {
      if (this.errors.length < 20) this.errors.push(t.slice(0, 200))
    }
  }
}
