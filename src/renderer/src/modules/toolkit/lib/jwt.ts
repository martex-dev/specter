// JWT (JWS compact serialization) decoding. Decoding does NOT verify the
// signature; `verifyHmac` verifies HS256/384/512 with a user-supplied secret.
import { base64ToBytes, decodeBase64 } from './encoding'

export interface DecodedJwt {
  header: Record<string, unknown>
  payload: unknown
  /** Payload as text when it isn't JSON. */
  payloadText?: string
  signature: string
  signingInput: string
  alg?: string
  /** Standard time claims (seconds since epoch) converted to dates. */
  times: { claim: 'exp' | 'nbf' | 'iat'; label: string; seconds: number; date: Date }[]
  /** 'valid' | 'expired' | 'not-yet-valid' | 'no-exp' relative to `now`. */
  status: 'valid' | 'expired' | 'not-yet-valid' | 'no-exp'
}

export class JwtError extends Error {}

export function decodeJwt(token: string, now: Date = new Date()): DecodedJwt {
  const t = token.trim().replace(/^Bearer\s+/i, '')
  if (!t) throw new JwtError('Paste a token')
  const parts = t.split('.')
  if (parts.length === 5) throw new JwtError('This is an encrypted JWE (5 parts) — its payload cannot be decoded without the key')
  if (parts.length !== 3) throw new JwtError(`A JWT has 3 dot-separated parts; found ${parts.length}`)
  let header: Record<string, unknown>
  try {
    header = JSON.parse(decodeBase64(parts[0]))
  } catch {
    throw new JwtError('Header is not valid Base64URL-encoded JSON')
  }
  if (!header || typeof header !== 'object' || Array.isArray(header)) throw new JwtError('Header must be a JSON object')
  let payload: unknown
  let payloadText: string | undefined
  try {
    const txt = decodeBase64(parts[1])
    try {
      payload = JSON.parse(txt)
    } catch {
      payload = undefined
      payloadText = txt
    }
  } catch {
    throw new JwtError('Payload is not valid Base64URL')
  }
  const times: DecodedJwt['times'] = []
  const labels = { exp: 'Expires', nbf: 'Not before', iat: 'Issued at' } as const
  if (payload && typeof payload === 'object') {
    for (const claim of ['iat', 'nbf', 'exp'] as const) {
      const v = (payload as Record<string, unknown>)[claim]
      if (typeof v === 'number' && Number.isFinite(v)) times.push({ claim, label: labels[claim], seconds: v, date: new Date(v * 1000) })
    }
  }
  const exp = times.find((x) => x.claim === 'exp')
  const nbf = times.find((x) => x.claim === 'nbf')
  const nowS = now.getTime() / 1000
  const status: DecodedJwt['status'] = nbf && nowS < nbf.seconds ? 'not-yet-valid' : !exp ? 'no-exp' : nowS >= exp.seconds ? 'expired' : 'valid'
  return {
    header,
    payload,
    payloadText,
    signature: parts[2],
    signingInput: parts[0] + '.' + parts[1],
    alg: typeof header.alg === 'string' ? header.alg : undefined,
    times,
    status
  }
}

const HMAC_HASH: Record<string, string> = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' }

export function canVerifyHmac(alg: string | undefined): boolean {
  return !!alg && alg in HMAC_HASH
}

/**
 * Verifies an HMAC-signed JWT (HS256/384/512) with the given secret using
 * WebCrypto. `secretIsBase64` treats the secret as Base64/Base64URL bytes.
 */
export async function verifyHmac(token: string, secret: string, secretIsBase64 = false): Promise<boolean> {
  const d = decodeJwt(token)
  const hash = d.alg ? HMAC_HASH[d.alg] : undefined
  if (!hash) throw new JwtError(`Algorithm ${d.alg ?? '(none)'} is not HMAC — only HS256/HS384/HS512 can be verified with a shared secret`)
  const keyBytes = secretIsBase64 ? base64ToBytes(secret) : new TextEncoder().encode(secret)
  const subtle = globalThis.crypto.subtle
  const key = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash }, false, ['verify'])
  let sig: Uint8Array<ArrayBuffer>
  try {
    sig = base64ToBytes(d.signature)
  } catch {
    return false
  }
  return subtle.verify('HMAC', key, sig, new TextEncoder().encode(d.signingInput))
}
