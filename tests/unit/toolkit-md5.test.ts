import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
// @ts-ignore -- pure renderer lib; tsconfig.node.json does not include src/renderer (TS6307)
import { Md5, md5Hex } from '../../src/renderer/src/modules/toolkit/lib/md5'

describe('toolkit MD5', () => {
  it('matches RFC 1321 test vectors', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(md5Hex('a')).toBe('0cc175b9c0f1b6a831c399e269772661')
    expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(md5Hex('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0')
    expect(md5Hex('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b')
    expect(md5Hex('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')).toBe('d174ab98d277d9f5a5611c2c9f419d9f')
    expect(md5Hex('12345678901234567890123456789012345678901234567890123456789012345678901234567890')).toBe('57edf4a22be3c955ac49da2e2107b67a')
  })

  it('hashes UTF-8 text and matches node:crypto on many lengths', () => {
    expect(md5Hex('héllo wörld ✓')).toBe(createHash('md5').update('héllo wörld ✓').digest('hex'))
    for (let n = 0; n < 300; n += 7) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 31 + n) & 0xff)
      expect(md5Hex(bytes)).toBe(createHash('md5').update(bytes).digest('hex'))
    }
  })

  it('supports incremental updates with arbitrary chunking', () => {
    const data = new Uint8Array(10000).map((_, i) => (i * 7) & 0xff)
    const h = new Md5()
    for (let i = 0; i < data.length; ) {
      const step = 1 + ((i * 13) % 97)
      h.update(data.subarray(i, i + step))
      i += step
    }
    const hex = [...h.digest()].map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(hex).toBe(createHash('md5').update(data).digest('hex'))
  })
})
