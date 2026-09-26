import { describe, expect, it } from 'vitest'
// @ts-ignore -- pure renderer lib; tsconfig.node.json does not include src/renderer (TS6307)
import { jsonErrorOffset, parseJson, sortKeysDeep } from '../../src/renderer/src/modules/toolkit/lib/json'

describe('toolkit JSON helpers', () => {
  it('locates "Unexpected token" errors that carry no position', () => {
    const src = '{\n  "alpha": 1,\n  "gamma": x,\n  "delta": 4\n}'
    const r = parseJson(src)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.offset).toBe(src.indexOf('x'))
    expect([r.error.line, r.error.column]).toEqual([3, 12])
  })

  it('finds the first syntax error offset', () => {
    expect(jsonErrorOffset('abc')).toBe(0)
    expect(jsonErrorOffset('[1, 2, tru]')).toBe(7)
    expect(jsonErrorOffset('[1,]')).toBe(3)
    expect(jsonErrorOffset('{"a" 1}')).toBe(5)
    expect(jsonErrorOffset('{"a": 1,}')).toBe(8)
    expect(jsonErrorOffset('{"a": "b\\x"}')).toBe(8)
    expect(jsonErrorOffset('{"a": [1, {"b": null}] ]')).toBe(23)
    expect(jsonErrorOffset('[1, 2')).toBe(5)
    expect(jsonErrorOffset('"unterminated')).toBe(13)
    expect(jsonErrorOffset('{"k": "é \\u00e9", "n": -1.5e3} x')).toBe(31)
  })

  it('keeps a "__proto__" key when sorting keys', () => {
    const v = parseJson('{"b": 1, "__proto__": {"x": 1}, "a": 2}')
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(JSON.stringify(sortKeysDeep(v.value))).toBe('{"__proto__":{"x":1},"a":2,"b":1}')
  })
})
