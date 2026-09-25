// UTF-8 safe Base64 / Base64URL helpers (no Buffer, works in browser and Node).

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}

/** Decodes standard or URL-safe Base64, tolerating whitespace and missing padding. */
export function base64ToBytes(input: string): Uint8Array<ArrayBuffer> {
  let s = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (/[^A-Za-z0-9+/=]/.test(s)) throw new Error('Input contains characters that are not valid Base64')
  s = s.replace(/=+$/, '')
  if (s.length % 4 === 1) throw new Error('Invalid Base64 length')
  s += '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function encodeBase64(text: string, urlSafe = false): string {
  const b64 = bytesToBase64(new TextEncoder().encode(text))
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64
}

/** Decodes Base64 to text; throws if the bytes are not valid UTF-8. */
export function decodeBase64(b64: string): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(base64ToBytes(b64))
}

export function base64UrlDecodeText(s: string): string {
  return decodeBase64(s)
}

/** Heuristic: do these bytes look like text rather than binary? */
export function isProbablyText(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, 4096))
  } catch {
    return false
  }
  const n = Math.min(bytes.length, 4096)
  let ctrl = 0
  for (let i = 0; i < n; i++) {
    const b = bytes[i]
    if (b === 0) return false
    if (b < 9 || (b > 13 && b < 32)) ctrl++
  }
  return n === 0 || ctrl / n < 0.05
}

export function hexDump(bytes: Uint8Array, max = 256): string {
  const lines: string[] = []
  const n = Math.min(bytes.length, max)
  for (let i = 0; i < n; i += 16) {
    const row = bytes.subarray(i, Math.min(i + 16, n))
    const hex = [...row].map((b) => b.toString(16).padStart(2, '0')).join(' ')
    const asc = [...row].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')
    lines.push(i.toString(16).padStart(8, '0') + '  ' + hex.padEnd(47) + '  ' + asc)
  }
  if (bytes.length > max) lines.push(`… ${bytes.length - max} more bytes`)
  return lines.join('\n')
}
