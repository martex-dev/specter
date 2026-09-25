import { describe, expect, it } from 'vitest'
// @ts-ignore -- pure renderer lib; tsconfig.node.json does not include src/renderer (TS6307)
import { parseYaml, parseYamlAll, YamlError } from '../../src/renderer/src/modules/toolkit/lib/yaml'

describe('toolkit YAML subset parser', () => {
  it('parses scalars with core-schema typing', () => {
    expect(parseYaml('a: 1\nb: 1.5\nc: true\nd: null\ne: ~\nf: hello world\ng: "quoted: yes"\nh: \'it\'\'s\'\ni: 0x1F\nj: .inf\nk: -3\nl: 1e3\nm: 007\nn: yes')).toEqual({
      a: 1,
      b: 1.5,
      c: true,
      d: null,
      e: null,
      f: 'hello world',
      g: 'quoted: yes',
      h: "it's",
      i: 31,
      j: Infinity,
      k: -3,
      l: 1000,
      m: 7,
      n: 'yes'
    })
  })

  it('parses nested mappings and sequences', () => {
    const src = `
# comment
server:
  host: localhost   # trailing comment
  ports:
    - 80
    - 443
  tls:
    enabled: false
list:
- a
- b
users:
  - name: ann
    roles: [admin, dev]
  - name: bob
    roles: []
    meta: {age: 30, tags: [x, "y z"]}
empty:
`
    expect(parseYaml(src)).toEqual({
      server: { host: 'localhost', ports: [80, 443], tls: { enabled: false } },
      list: ['a', 'b'],
      users: [
        { name: 'ann', roles: ['admin', 'dev'] },
        { name: 'bob', roles: [], meta: { age: 30, tags: ['x', 'y z'] } }
      ],
      empty: null
    })
  })

  it('parses nested sequences and top-level sequences', () => {
    expect(parseYaml('- - 1\n  - 2\n- - 3\n- x: 1\n  y: 2')).toEqual([[1, 2], [3], { x: 1, y: 2 }])
  })

  it('handles block scalars with chomping', () => {
    const src = 'lit: |\n  line 1\n  line 2\n\nfold: >\n  a\n  b\n\n  c\nstrip: |-\n  x\nkeep: |+\n  y\n\nlast: 1'
    expect(parseYaml(src)).toEqual({ lit: 'line 1\nline 2\n', fold: 'a b\nc\n', strip: 'x', keep: 'y\n\n', last: 1 })
    expect(parseYaml('script: |\n  echo "hi"\n    indented\n  done\n')).toEqual({ script: 'echo "hi"\n  indented\ndone\n' })
    expect(parseYaml('- |\n  a\n  b\n- c')).toEqual(['a\nb\n', 'c'])
  })

  it('handles quoted strings with escapes and multi-line plain scalars', () => {
    expect(parseYaml('a: "tab\\there \\u00e9 \\"q\\""\nb: \'# not a comment\'\nc: plain # comment')).toEqual({ a: 'tab\there é "q"', b: '# not a comment', c: 'plain' })
    expect(parseYaml('desc: this is\n  a long\n  sentence\nnext: 1')).toEqual({ desc: 'this is a long sentence', next: 1 })
    expect(parseYaml('url: http://example.com:8080/x\nwin: C:\\path')).toEqual({ url: 'http://example.com:8080/x', win: 'C:\\path' })
  })

  it('supports anchors, aliases, merge keys and tags', () => {
    const src = 'base: &b\n  a: 1\n  b: 2\nderived:\n  <<: *b\n  b: 3\nref: *b\nnum: !!str 123\nint: !!int "42"'
    expect(parseYaml(src)).toEqual({ base: { a: 1, b: 2 }, derived: { a: 1, b: 3 }, ref: { a: 1, b: 2 }, num: '123', int: 42 })
  })

  it('supports multi-line flow collections', () => {
    expect(parseYaml('arr: [\n  1, 2,\n  3\n]\nobj: {\n  a: 1,\n  b: [x, y]\n}')).toEqual({ arr: [1, 2, 3], obj: { a: 1, b: ['x', 'y'] } })
  })

  it('splits multiple documents', () => {
    expect(parseYamlAll('a: 1\n---\nb: 2\n...\n---\n- x\n')).toEqual([{ a: 1 }, { b: 2 }, ['x']])
    expect(parseYamlAll('%YAML 1.2\n---\nfoo: bar')).toEqual([{ foo: 'bar' }])
    expect(parseYaml('')).toBeNull()
  })

  it('parses a GitHub Actions style workflow', () => {
    const src = `name: CI
on:
  push:
    branches: [ main ]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Test
        run: |
          npm ci
          npm test
        env:
          CI: "true"
`
    expect(parseYaml(src)).toEqual({
      name: 'CI',
      on: { push: { branches: ['main'] } },
      jobs: { build: { 'runs-on': 'ubuntu-latest', steps: [{ uses: 'actions/checkout@v4' }, { name: 'Test', run: 'npm ci\nnpm test\n', env: { CI: 'true' } }] } }
    })
  })

  it('reports errors with line numbers', () => {
    expect(() => parseYaml('a: 1\n  b: 2')).toThrow(YamlError)
    expect(() => parseYaml('a:\n\t- x')).toThrow(/Tabs/)
    expect(() => parseYaml('a: [1, 2')).toThrow(/Unterminated/)
    expect(() => parseYaml('a: *missing')).toThrow(/Unknown alias/)
    try {
      parseYaml('ok: 1\nbad: "unterminated')
    } catch (e) {
      expect((e as YamlError).line).toBe(2)
    }
  })
})
