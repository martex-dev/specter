// A small YAML parser covering the subset used by typical config files
// (docker-compose, GitHub Actions, Kubernetes manifests, OpenAPI…).
//
// Supported:
//   - block mappings and sequences (including "- key: value" compact items and
//     sequences at the same indentation as their parent key)
//   - plain, 'single' and "double" quoted scalars (multi-line folding, escapes)
//   - literal | and folded > block scalars with chomping (+/-) and indentation indicators
//   - flow collections [a, b] / {a: 1} (nested, may span lines)
//   - comments, multiple documents (---, ...), %directives (ignored)
//   - anchors &a, aliases *a and merge keys <<
//   - YAML 1.2 core schema: null/~, true/false, ints (dec, 0x, 0o), floats, .inf, .nan
//   - standard tags !!str !!int !!float !!bool !!null (other tags are ignored)
//
// Not supported: complex keys (? …), tabs as indentation, multi-line implicit
// keys, custom tag resolution, YAML 1.1 booleans (yes/no/on/off stay strings)
// and sexagesimal numbers.

export class YamlError extends Error {
  constructor(
    message: string,
    public line: number
  ) {
    super(`${message} (line ${line})`)
  }
}

interface Line {
  indent: number
  /** Text after the indentation (raw, may include a comment). */
  text: string
  num: number
  raw: string
}

/** Removes a trailing comment (`#` at start or after whitespace, outside quotes). */
function stripComment(s: string): string {
  let q: string | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '\\' && q === '"') i++
      else if (c === q) {
        if (q === "'" && s[i + 1] === "'") i++
        else q = null
      }
    } else if (c === '"' || c === "'") {
      // Quotes only open a quoted scalar at a token start.
      if (i === 0 || /[\s[{,:-]/.test(s[i - 1])) q = c
    } else if (c === '#' && (i === 0 || s[i - 1] === ' ' || s[i - 1] === '\t')) {
      return s.slice(0, i).trimEnd()
    }
  }
  return s.trimEnd()
}

const isBlank = (l: Line) => stripComment(l.text).trim() === ''

function resolvePlain(s: string): unknown {
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null
  if (s === 'true' || s === 'True' || s === 'TRUE') return true
  if (s === 'false' || s === 'False' || s === 'FALSE') return false
  if (/^[-+]?[0-9]+$/.test(s)) return Number(s)
  if (/^0x[0-9a-fA-F]+$/.test(s)) return parseInt(s.slice(2), 16)
  if (/^0o[0-7]+$/.test(s)) return parseInt(s.slice(2), 8)
  if (/^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/.test(s)) return Number(s)
  if (/^[-+]?\.(inf|Inf|INF)$/.test(s)) return s.startsWith('-') ? -Infinity : Infinity
  if (/^\.(nan|NaN|NAN)$/.test(s)) return NaN
  return s
}

function applyTag(tag: string | undefined, v: unknown, raw: string): unknown {
  if (!tag) return v
  switch (tag) {
    case '!!str':
      return v === null && raw === '' ? '' : typeof v === 'string' ? v : raw
    case '!!int': {
      // Keep hex / octal integers (0x10, 0o17) — parseInt(…, 10) would read "0x10" as 0.
      const r = resolvePlain(String(raw).trim())
      if (typeof r === 'number' && Number.isInteger(r)) return r
      const n = parseInt(String(raw), 10)
      return Number.isNaN(n) ? v : n
    }
    case '!!float': {
      const n = Number(raw)
      return Number.isNaN(n) ? v : n
    }
    case '!!bool':
      return /^(true|True|TRUE)$/.test(raw) ? true : /^(false|False|FALSE)$/.test(raw) ? false : v
    case '!!null':
      return null
    default:
      return v
  }
}

const DQ_ESCAPES: Record<string, string> = {
  '0': '\0',
  a: '\x07',
  b: '\b',
  t: '\t',
  '\t': '\t',
  n: '\n',
  v: '\v',
  f: '\f',
  r: '\r',
  e: '\x1b',
  ' ': ' ',
  '"': '"',
  '/': '/',
  '\\': '\\',
  N: '\u0085',
  _: ' ',
  L: ' ',
  P: ' '
}

/** Folds the line breaks of a multi-line flow scalar (quoted or plain). */
function foldLines(parts: string[]): string {
  let out = ''
  let pendingBreaks = 0
  parts.forEach((p, i) => {
    const t = i === 0 ? p.replace(/[ \t]+$/, '') : i === parts.length - 1 ? p.replace(/^[ \t]+/, '') : p.trim()
    if (i > 0 && t === '' && i < parts.length - 1) {
      pendingBreaks++
      return
    }
    if (i > 0) out += pendingBreaks ? '\n'.repeat(pendingBreaks) : ' '
    pendingBreaks = 0
    out += t
  })
  return out
}

function unescapeDouble(s: string, line: number): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c !== '\\') {
      out += c
      continue
    }
    const n = s[++i]
    if (n === undefined) throw new YamlError('Unterminated escape', line)
    if (n in DQ_ESCAPES) out += DQ_ESCAPES[n]
    else if (n === 'x' || n === 'u' || n === 'U') {
      const len = n === 'x' ? 2 : n === 'u' ? 4 : 8
      const hex = s.slice(i + 1, i + 1 + len)
      if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== len) throw new YamlError(`Invalid \\${n} escape`, line)
      out += String.fromCodePoint(parseInt(hex, 16))
      i += len
    } else throw new YamlError(`Unknown escape \\${n}`, line)
  }
  return out
}

// ---------------------------------------------------------------- flow parser

class FlowParser {
  i = 0
  constructor(
    private s: string,
    private line: number,
    private anchors: Map<string, unknown>
  ) {}

  private ws(): void {
    while (this.i < this.s.length) {
      const c = this.s[this.i]
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') this.i++
      else if (c === '#' && (this.i === 0 || /\s/.test(this.s[this.i - 1]))) {
        while (this.i < this.s.length && this.s[this.i] !== '\n') this.i++
      } else break
    }
  }

  private err(msg: string): never {
    throw new YamlError(msg, this.line + (this.s.slice(0, this.i).match(/\n/g)?.length ?? 0))
  }

  parseAll(): unknown {
    const v = this.value()
    this.ws()
    if (this.i < this.s.length) this.err(`Unexpected "${this.s[this.i]}" after flow collection`)
    return v
  }

  value(inKey = false): unknown {
    this.ws()
    let tag: string | undefined
    let anchor: string | undefined
    for (;;) {
      const c = this.s[this.i]
      if (c === '&' || c === '!') {
        const m = /^[&!][^\s,[\]{}]*/.exec(this.s.slice(this.i))!
        if (c === '&') anchor = m[0].slice(1)
        else tag = m[0]
        this.i += m[0].length
        this.ws()
      } else break
    }
    const c = this.s[this.i]
    let v: unknown
    let raw = ''
    if (c === '[') v = this.seq()
    else if (c === '{') v = this.map()
    else if (c === '*') {
      const m = /^\*([^\s,[\]{}]+)/.exec(this.s.slice(this.i))
      if (!m) this.err('Invalid alias')
      this.i += m[0].length
      if (!this.anchors.has(m[1])) this.err(`Unknown alias *${m[1]}`)
      return this.anchors.get(m[1])
    } else if (c === '"' || c === "'") {
      raw = this.quoted(c)
      v = raw
      if (tag && tag !== '!!str') v = applyTag(tag, raw, raw)
    } else {
      raw = this.plain(inKey)
      v = applyTag(tag, resolvePlain(raw), raw)
    }
    if (anchor) this.anchors.set(anchor, v)
    return v
  }

  private quoted(q: string): string {
    const start = ++this.i
    let j = start
    for (;;) {
      if (j >= this.s.length) this.err('Unterminated quoted string')
      const c = this.s[j]
      if (q === '"' && c === '\\') j += 2
      else if (c === q) {
        if (q === "'" && this.s[j + 1] === "'") j += 2
        else break
      } else j++
    }
    const body = this.s.slice(start, j)
    this.i = j + 1
    const folded = foldLines(body.split('\n'))
    return q === '"' ? unescapeDouble(folded, this.line) : folded.replace(/''/g, "'")
  }

  private plain(inKey: boolean): string {
    const start = this.i
    while (this.i < this.s.length) {
      const c = this.s[this.i]
      if (c === ',' || c === ']' || c === '}' || c === '[' || c === '{') break
      if (c === ':' && (this.i + 1 >= this.s.length || /[\s,\]}[{]/.test(this.s[this.i + 1]))) break
      if (c === '#' && /\s/.test(this.s[this.i - 1] ?? '')) break
      this.i++
    }
    void inKey
    return foldLines(this.s.slice(start, this.i).split('\n')).trim()
  }

  private seq(): unknown[] {
    this.i++ // [
    const out: unknown[] = []
    for (;;) {
      this.ws()
      if (this.s[this.i] === ']') {
        this.i++
        return out
      }
      if (this.i >= this.s.length) this.err('Unterminated flow sequence')
      const v = this.value()
      this.ws()
      // Single-pair implicit map inside a sequence: [a: 1]
      if (this.s[this.i] === ':') {
        this.i++
        const val = this.value()
        out.push({ [String(v)]: val })
        this.ws()
      } else out.push(v)
      if (this.s[this.i] === ',') this.i++
      else if (this.s[this.i] !== ']') this.err('Expected "," or "]" in flow sequence')
    }
  }

  private map(): Record<string, unknown> {
    this.i++ // {
    const out: Record<string, unknown> = {}
    for (;;) {
      this.ws()
      if (this.s[this.i] === '}') {
        this.i++
        return out
      }
      if (this.i >= this.s.length) this.err('Unterminated flow mapping')
      const k = this.value(true)
      this.ws()
      let v: unknown = null
      if (this.s[this.i] === ':') {
        this.i++
        this.ws()
        if (this.s[this.i] !== ',' && this.s[this.i] !== '}') v = this.value()
      }
      setKey(out, keyString(k), v)
      this.ws()
      if (this.s[this.i] === ',') this.i++
      else if (this.s[this.i] !== '}') this.err('Expected "," or "}" in flow mapping')
    }
  }
}

/** Sets an own property; a "__proto__" key must not replace the object's prototype (the key would vanish). */
function setKey(o: Record<string, unknown>, k: string, v: unknown): void {
  if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true })
  else o[k] = v
}

function keyString(k: unknown): string {
  if (k === null) return 'null'
  if (typeof k === 'object') return JSON.stringify(k)
  return String(k)
}

// ---------------------------------------------------------------- block parser

class BlockParser {
  pos = 0
  anchors = new Map<string, unknown>()
  constructor(private lines: Line[]) {}

  private skipBlank(): void {
    while (this.pos < this.lines.length && isBlank(this.lines[this.pos])) this.pos++
  }

  private cur(): Line | undefined {
    return this.lines[this.pos]
  }

  parseDocument(): unknown {
    this.skipBlank()
    if (this.pos >= this.lines.length) return null
    const v = this.parseNode(-1)
    this.skipBlank()
    const l = this.cur()
    if (l) throw new YamlError(l.indent > 0 ? 'Bad indentation' : 'Unexpected content', l.num)
    return v
  }

  /** Parses the node on the next non-blank line if it is indented deeper than `parent`. */
  private parseNode(parent: number): unknown {
    this.skipBlank()
    const l = this.cur()
    if (!l || l.indent <= parent) return null
    return this.parseBlockAt(l, parent)
  }

  private parseBlockAt(l: Line, parent: number): unknown {
    const content = stripComment(l.text)
    if (content === '-' || content.startsWith('- ') || content.startsWith('-\t')) return this.parseSeq(l.indent)
    if (content.startsWith('? ')) throw new YamlError('Complex mapping keys (?) are not supported', l.num)
    if (findKey(content)) return this.parseMap(l.indent)
    // Properties on their own line before a nested collection: "&a" / "!!map"
    const props = splitProps(content)
    if (props.rest === '' && (props.anchor || props.tag)) {
      this.pos++
      const v = this.parseNode(parent)
      if (props.anchor) this.anchors.set(props.anchor, v)
      return v
    }
    this.pos++
    return this.inlineValue(content, parent, l)
  }

  private parseSeq(indent: number): unknown[] {
    const out: unknown[] = []
    for (;;) {
      this.skipBlank()
      const l = this.cur()
      if (!l || l.indent < indent) break
      const content = stripComment(l.text)
      const isItem = content === '-' || content.startsWith('- ') || content.startsWith('-\t')
      if (l.indent > indent) throw new YamlError('Bad indentation of a sequence entry', l.num)
      if (!isItem) break
      const afterDash = l.text.slice(1)
      const rest = afterDash.trimStart()
      const restContent = stripComment(rest)
      if (restContent === '') {
        this.pos++
        out.push(this.parseNode(indent))
        continue
      }
      const offset = 1 + (afterDash.length - rest.length)
      const props = splitProps(restContent)
      const isNested = props.rest === '-' || props.rest.startsWith('- ') || (findKey(props.rest) && !props.rest.startsWith('[') && !props.rest.startsWith('{'))
      if (isNested && !props.anchor && !props.tag) {
        // Re-read the remainder of the line as a node at its own column.
        this.lines[this.pos] = { indent: indent + offset, text: rest, num: l.num, raw: l.raw }
        out.push(this.parseBlockAt(this.lines[this.pos], indent))
      } else if (props.rest === '' && (props.anchor || props.tag)) {
        this.pos++
        const v = this.parseNode(indent)
        if (props.anchor) this.anchors.set(props.anchor, v)
        out.push(v)
      } else if (isNested) {
        this.lines[this.pos] = { indent: indent + offset + (rest.length - props.rest.length), text: props.rest, num: l.num, raw: l.raw }
        const v = this.parseBlockAt(this.lines[this.pos], indent)
        if (props.anchor) this.anchors.set(props.anchor, v)
        out.push(v)
      } else {
        this.pos++
        out.push(this.inlineValue(restContent, indent, l))
      }
    }
    return out
  }

  private parseMap(indent: number): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    const merges: Record<string, unknown>[] = []
    for (;;) {
      this.skipBlank()
      const l = this.cur()
      if (!l || l.indent < indent) break
      if (l.indent > indent) throw new YamlError('Bad indentation of a mapping entry', l.num)
      const content = stripComment(l.text)
      if (content === '-' || content.startsWith('- ')) break
      const kv = findKey(content)
      if (!kv) throw new YamlError('Expected "key: value"', l.num)
      const key = kv.key
      const valueText = kv.value
      let value: unknown
      if (valueText === '') {
        this.pos++
        value = this.blockValue(indent)
      } else {
        const props = splitProps(valueText)
        if (props.rest === '' && (props.anchor || props.tag)) {
          this.pos++
          value = this.blockValue(indent)
          if (props.anchor) this.anchors.set(props.anchor, value)
        } else {
          this.pos++
          value = this.inlineValue(valueText, indent, l)
        }
      }
      if (key === '<<' && !kv.quoted) {
        const list = Array.isArray(value) ? value : [value]
        for (const m of list) {
          if (m && typeof m === 'object' && !Array.isArray(m)) merges.push(m as Record<string, unknown>)
          else throw new YamlError('Merge key << needs a mapping or list of mappings', l.num)
        }
        continue
      }
      setKey(out, key, value)
    }
    if (!merges.length) return out
    const merged: Record<string, unknown> = {}
    // Earlier merge sources take precedence over later ones; explicit keys over all.
    for (const m of [...[...merges].reverse(), out]) for (const k of Object.keys(m)) setKey(merged, k, m[k])
    return merged
  }

  /** Value of a key with nothing after the colon: nested block, same-indent sequence, or null. */
  private blockValue(indent: number): unknown {
    this.skipBlank()
    const n = this.cur()
    if (!n) return null
    if (n.indent > indent) return this.parseNode(indent)
    const c = stripComment(n.text)
    if (n.indent === indent && (c === '-' || c.startsWith('- '))) return this.parseSeq(indent)
    return null
  }

  private blockScalar(header: string, parent: number, lineNum: number): string {
    const m = /^([|>])([+-]?)([1-9]?)([+-]?)\s*$/.exec(header)
    if (!m) throw new YamlError(`Invalid block scalar header "${header}"`, lineNum)
    const folded = m[1] === '>'
    const chomp = m[2] || m[4] || ''
    const explicit = m[3] ? Number(m[3]) : 0
    // Collect raw lines.
    const raws: string[] = []
    let blockIndent = explicit ? Math.max(parent, 0) + explicit : -1
    if (explicit && parent < 0) blockIndent = explicit - 1
    while (this.pos < this.lines.length) {
      const l = this.lines[this.pos]
      const raw = l.raw
      const isEmpty = raw.trim() === ''
      if (!isEmpty) {
        const ind = raw.length - raw.trimStart().length
        if (blockIndent < 0) {
          if (ind <= parent) break
          blockIndent = ind
        }
        if (ind < blockIndent) break
      }
      raws.push(raw)
      this.pos++
    }
    if (blockIndent < 0) blockIndent = 0
    const lines = raws.map((r) => (r.trim() === '' ? '' : r.slice(blockIndent)))
    // Trailing empty lines are handled by chomping.
    let end = lines.length
    while (end > 0 && lines[end - 1] === '') end--
    const trailing = lines.length - end
    const body = lines.slice(0, end)
    let text: string
    if (!folded) text = body.join('\n')
    else {
      const more = (x: string) => x.startsWith(' ') || x.startsWith('\t')
      text = body[0]
      let lastNonEmpty = body[0] === '' ? -1 : 0
      for (let i = 1; i < body.length; i++) {
        const cur = body[i]
        const prev = body[i - 1]
        if (cur === '') {
          text += '\n'
          continue
        }
        if (prev === '') {
          // Empty lines already emitted one newline each; the break before
          // them is folded away between two normal lines.
          text += lastNonEmpty >= 0 && !more(body[lastNonEmpty]) && !more(cur) ? cur : '\n' + cur
        } else if (more(prev) || more(cur)) text += '\n' + cur
        else text += ' ' + cur
        lastNonEmpty = i
      }
    }
    if (body.length === 0) return chomp === '+' ? '\n'.repeat(trailing) : ''
    if (chomp === '-') return text
    if (chomp === '+') return text + '\n' + '\n'.repeat(trailing)
    return text + '\n'
  }

  /**
   * Parses a value that starts on the current (already consumed) line:
   * alias, flow collection, quoted or plain scalar — each possibly continuing
   * on following lines indented deeper than `parent`.
   */
  private inlineValue(text: string, parent: number, l: Line): unknown {
    const props = splitProps(text)
    let rest = props.rest
    if (rest.startsWith('*')) {
      const name = rest.slice(1).trim()
      if (!this.anchors.has(name)) throw new YamlError(`Unknown alias *${name}`, l.num)
      return this.anchors.get(name)
    }
    let v: unknown
    if (rest.startsWith('|') || rest.startsWith('>')) {
      const s = this.blockScalar(rest, parent, l.num)
      v = props.tag && props.tag !== '!!str' ? applyTag(props.tag, s, s) : s
    } else if (rest.startsWith('[') || rest.startsWith('{')) {
      // Gather lines until brackets balance.
      let src = rest
      while (!flowBalanced(src)) {
        const n = this.cur()
        if (!n) throw new YamlError('Unterminated flow collection', l.num)
        src += '\n' + n.raw
        this.pos++
      }
      v = new FlowParser(src, l.num, this.anchors).parseAll()
      v = applyTag(props.tag, v, '')
    } else if (rest.startsWith('"') || rest.startsWith("'")) {
      const q = rest[0]
      // stripComment never cuts inside quotes, so `rest` holds the whole first line.
      let src = rest
      while (!quoteClosed(src, q)) {
        const n = this.cur()
        if (!n) throw new YamlError('Unterminated quoted string', l.num)
        src += '\n' + n.raw
        this.pos++
      }
      const fp = new FlowParser(src, l.num, this.anchors)
      const s = fp.value() as string
      const after = stripComment(src.slice(fp.i)).trim()
      if (after) throw new YamlError(`Unexpected text after quoted string: "${after}"`, l.num)
      v = props.tag && props.tag !== '!!str' ? applyTag(props.tag, s, s) : s
    } else {
      // Plain scalar with possible continuation lines.
      const parts = [rest]
      for (;;) {
        const save = this.pos
        let blanks = 0
        while (this.pos < this.lines.length && isBlank(this.lines[this.pos])) {
          blanks++
          this.pos++
        }
        const n = this.cur()
        if (!n || n.indent <= parent) {
          this.pos = save
          break
        }
        const c = stripComment(n.text).trim()
        // A plain scalar can't contain ": " — a deeper "key: value" line here is mis-indented.
        if (findKey(c)) throw new YamlError('Unexpected mapping entry — check indentation', n.num)
        for (let i = 0; i < blanks; i++) parts.push('')
        parts.push(c)
        this.pos++
      }
      rest = foldLines(parts)
      v = applyTag(props.tag, resolvePlain(rest), rest)
    }
    if (props.anchor) this.anchors.set(props.anchor, v)
    return v
  }
}

function flowBalanced(s: string): boolean {
  let depth = 0
  let q: string | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (q === '"' && c === '\\') i++
      else if (c === q) q = null
    } else if (c === '"' || c === "'") q = c
    else if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') depth--
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      while (i < s.length && s[i] !== '\n') i++
    }
  }
  return depth <= 0 && !q
}

function quoteClosed(s: string, q: string): boolean {
  for (let i = 1; i < s.length; i++) {
    const c = s[i]
    if (q === '"' && c === '\\') i++
    else if (c === q) {
      if (q === "'" && s[i + 1] === "'") i++
      else return true
    }
  }
  return false
}

/** Leading anchor (&a) and tag (!t) properties of a value. */
function splitProps(s: string): { anchor?: string; tag?: string; rest: string } {
  let rest = s.trim()
  let anchor: string | undefined
  let tag: string | undefined
  for (;;) {
    const m = /^([&!])(\S*)(?:\s+|$)/.exec(rest)
    if (!m || (m[1] === '!' && rest.startsWith('!=')) || (m[1] === '&' && !m[2])) break
    if (m[1] === '&') anchor = m[2]
    else tag = m[1] + m[2]
    rest = rest.slice(m[0].length)
  }
  return { anchor, tag, rest }
}

/** Finds an implicit "key: value" split outside quotes and flow brackets. */
function findKey(content: string): { key: string; value: string; quoted: boolean } | null {
  if (!content || content.startsWith('[') || content.startsWith('{') || content.startsWith('#')) return null
  if (content.startsWith('"') || content.startsWith("'")) {
    const q = content[0]
    let j = 1
    for (; j < content.length; j++) {
      if (q === '"' && content[j] === '\\') j++
      else if (content[j] === q) {
        if (q === "'" && content[j + 1] === "'") j++
        else break
      }
    }
    if (j >= content.length) return null
    const after = content.slice(j + 1)
    const m = /^\s*:(\s|$)/.exec(after)
    if (!m) return null
    const inner = content.slice(1, j)
    const key = q === '"' ? unescapeDouble(inner, 0) : inner.replace(/''/g, "'")
    return { key, value: after.slice(m[0].length).trim(), quoted: true }
  }
  for (let i = 0; i < content.length; i++) {
    const c = content[i]
    if (c === ':' && (i + 1 === content.length || content[i + 1] === ' ' || content[i + 1] === '\t')) {
      const rawKey = content.slice(0, i).trim()
      if (!rawKey) return null
      return { key: rawKey, value: content.slice(i + 1).trim(), quoted: false }
    }
  }
  return null
}

function toLines(src: string, startNum: number): Line[] {
  return src.split('\n').map((raw, i) => {
    const m = /^[ ]*/.exec(raw)!
    const indent = m[0].length
    if (/^[ ]*\t/.test(raw) && raw.trim() !== '' && !raw.trim().startsWith('#')) {
      // Tabs are fine inside values, but not as indentation.
      if (raw.slice(indent).startsWith('\t')) throw new YamlError('Tabs are not allowed for indentation', startNum + i)
    }
    return { indent, text: raw.slice(indent), num: startNum + i, raw }
  })
}

/** Parses every document in the stream. */
export function parseYamlAll(src: string): unknown[] {
  const text = src.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const all = text.split('\n')
  const docs: { lines: string[]; start: number }[] = []
  let cur: { lines: string[]; start: number } = { lines: [], start: 1 }
  let explicit = false
  let sawContent = false
  all.forEach((line, i) => {
    if (/^%/.test(line) && !sawContent) return
    const m = /^---(?:\s+(.*))?$/.exec(line)
    if (m) {
      if (sawContent || explicit) docs.push(cur)
      cur = { lines: m[1] && !m[1].startsWith('#') ? [m[1]] : [], start: i + (m[1] ? 1 : 2) }
      explicit = true
      sawContent = false
      return
    }
    if (/^\.\.\.\s*$/.test(line)) {
      docs.push(cur)
      cur = { lines: [], start: i + 2 }
      explicit = false
      sawContent = false
      return
    }
    if (line.trim() && !line.trim().startsWith('#')) sawContent = true
    if (!cur.lines.length) cur.start = i + 1
    cur.lines.push(line)
  })
  if (sawContent || explicit || docs.length === 0) docs.push(cur)
  return docs.map((d) => new BlockParser(toLines(d.lines.join('\n'), d.start)).parseDocument())
}

/** Parses a single-document YAML string (the first document if several). */
export function parseYaml(src: string): unknown {
  return parseYamlAll(src)[0] ?? null
}
