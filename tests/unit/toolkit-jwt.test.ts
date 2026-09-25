import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
// @ts-ignore -- pure renderer lib; tsconfig.node.json does not include src/renderer (TS6307)
import { decodeBase64, encodeBase64 } from '../../src/renderer/src/modules/toolkit/lib/encoding'
// @ts-ignore -- pure renderer lib; tsconfig.node.json does not include src/renderer (TS6307)
import { decodeJwt, verifyHmac, canVerifyHmac, JwtError } from '../../src/renderer/src/modules/toolkit/lib/jwt'

const b64url = (o: unknown) => encodeBase64(typeof o === 'string' ? o : JSON.stringify(o), true)

function sign(header: object, payload: object, secret: string, alg = 'sha256'): string {
  const input = b64url(header) + '.' + b64url(payload)
  const sig = createHmac(alg, secret).update(input).digest('base64url')
  return input + '.' + sig
}

// The canonical jwt.io example token (HS256, secret "your-256-bit-secret").
const JWT_IO = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

describe('toolkit JWT decoder', () => {
  it('decodes header, payload and time claims', () => {
    const d = decodeJwt(JWT_IO, new Date('2025-01-01T00:00:00Z'))
    expect(d.header).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(d.payload).toEqual({ sub: '1234567890', name: 'John Doe', iat: 1516239022 })
    expect(d.alg).toBe('HS256')
    expect(d.times.map((t) => t.claim)).toEqual(['iat'])
    expect(d.times[0].date.toISOString()).toBe('2018-01-18T01:30:22.000Z')
    expect(d.status).toBe('no-exp')
  })

  it('reports expiry status relative to now', () => {
    const tok = sign({ alg: 'HS256', typ: 'JWT' }, { exp: 1700000000, nbf: 1600000000 }, 's')
    expect(decodeJwt(tok, new Date(1650000000 * 1000)).status).toBe('valid')
    expect(decodeJwt(tok, new Date(1800000000 * 1000)).status).toBe('expired')
    expect(decodeJwt(tok, new Date(1500000000 * 1000)).status).toBe('not-yet-valid')
    expect(decodeJwt('Bearer ' + tok).header.alg).toBe('HS256')
  })

  it('rejects malformed tokens with helpful errors', () => {
    expect(() => decodeJwt('abc')).toThrow(/3 dot-separated parts/)
    expect(() => decodeJwt('a.b.c.d.e')).toThrow(/JWE/)
    expect(() => decodeJwt('!!!.e30.x')).toThrow(JwtError)
    expect(() => decodeJwt(b64url('[1]') + '.e30.x')).toThrow(/JSON object/)
  })

  it('keeps non-JSON payloads as text', () => {
    const d = decodeJwt(b64url({ alg: 'none' }) + '.' + b64url('plain text payload') + '.')
    expect(d.payload).toBeUndefined()
    expect(d.payloadText).toBe('plain text payload')
  })

  it('verifies HS256/384/512 signatures with WebCrypto', async () => {
    expect(await verifyHmac(JWT_IO, 'your-256-bit-secret')).toBe(true)
    expect(await verifyHmac(JWT_IO, 'wrong-secret')).toBe(false)
    const t384 = sign({ alg: 'HS384' }, { a: 1 }, 'k', 'sha384')
    const t512 = sign({ alg: 'HS512' }, { a: 1 }, 'k', 'sha512')
    expect(await verifyHmac(t384, 'k')).toBe(true)
    expect(await verifyHmac(t512, 'k')).toBe(true)
    const tampered = t512.replace(/\.[^.]+\./, '.' + b64url({ a: 2 }) + '.')
    expect(await verifyHmac(tampered, 'k')).toBe(false)
    const b64secret = Buffer.from('binary-secret').toString('base64')
    expect(await verifyHmac(sign({ alg: 'HS256' }, {}, 'binary-secret'), b64secret, true)).toBe(true)
    await expect(verifyHmac(b64url({ alg: 'RS256' }) + '.e30.sig', 'x')).rejects.toThrow(/not HMAC/)
    expect(canVerifyHmac('RS256')).toBe(false)
  })

  it('round-trips UTF-8 through Base64URL', () => {
    expect(decodeBase64(encodeBase64('ünïcødé ✓', true))).toBe('ünïcødé ✓')
  })
})
