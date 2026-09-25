// Safe arithmetic expression evaluator (no eval / Function).
//
// Grammar (lowest → highest precedence):
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/' | '%' | 'mod' | implicit-multiplication) unary)*
//   unary   := ('+' | '-') unary | power
//   power   := postfix ('^' unary)?            right-associative, -2^2 = -4
//   postfix := primary ('!' | percent-%)*
//   primary := number | constant | variable | func '(' args ')' | '(' expr ')'
//
// `%` is a percentage when nothing that could start an operand follows it
// (`200*15%` = 30), otherwise it is the modulo operator (`7 % 3` = 1).

export class CalcError extends Error {
  constructor(
    message: string,
    public pos = -1
  ) {
    super(message)
  }
}

type Tok =
  | { t: 'num'; v: number; pos: number }
  | { t: 'id'; v: string; pos: number }
  | { t: 'op'; v: string; pos: number }
  | { t: 'end'; pos: number }

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  π: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  τ: Math.PI * 2,
  phi: (1 + Math.sqrt(5)) / 2,
  φ: (1 + Math.sqrt(5)) / 2,
  inf: Infinity,
  infinity: Infinity,
  deg: Math.PI / 180,
  '°': Math.PI / 180
}

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new CalcError('Factorial needs a non-negative integer')
  if (n > 170) return Infinity
  let r = 1
  for (let i = 2; i <= n; i++) r *= i
  return r
}

const FUNCS: Record<string, { min: number; max: number; fn: (...a: number[]) => number }> = {
  sqrt: { min: 1, max: 1, fn: Math.sqrt },
  cbrt: { min: 1, max: 1, fn: Math.cbrt },
  abs: { min: 1, max: 1, fn: Math.abs },
  sin: { min: 1, max: 1, fn: Math.sin },
  cos: { min: 1, max: 1, fn: Math.cos },
  tan: { min: 1, max: 1, fn: Math.tan },
  asin: { min: 1, max: 1, fn: Math.asin },
  acos: { min: 1, max: 1, fn: Math.acos },
  atan: { min: 1, max: 1, fn: Math.atan },
  atan2: { min: 2, max: 2, fn: Math.atan2 },
  sinh: { min: 1, max: 1, fn: Math.sinh },
  cosh: { min: 1, max: 1, fn: Math.cosh },
  tanh: { min: 1, max: 1, fn: Math.tanh },
  ln: { min: 1, max: 1, fn: Math.log },
  log: { min: 1, max: 2, fn: (x, b) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b)) },
  log10: { min: 1, max: 1, fn: Math.log10 },
  log2: { min: 1, max: 1, fn: Math.log2 },
  exp: { min: 1, max: 1, fn: Math.exp },
  floor: { min: 1, max: 1, fn: Math.floor },
  ceil: { min: 1, max: 1, fn: Math.ceil },
  round: { min: 1, max: 2, fn: (x, d) => (d === undefined ? Math.round(x) : Math.round(x * 10 ** d) / 10 ** d) },
  trunc: { min: 1, max: 1, fn: Math.trunc },
  sign: { min: 1, max: 1, fn: Math.sign },
  min: { min: 1, max: 99, fn: Math.min },
  max: { min: 1, max: 99, fn: Math.max },
  pow: { min: 2, max: 2, fn: Math.pow },
  hypot: { min: 1, max: 99, fn: Math.hypot },
  fact: { min: 1, max: 1, fn: factorial },
  rad: { min: 1, max: 1, fn: (d) => (d * Math.PI) / 180 },
  degrees: { min: 1, max: 1, fn: (r) => (r * 180) / Math.PI },
  avg: { min: 1, max: 99, fn: (...a) => a.reduce((s, x) => s + x, 0) / a.length },
  sum: { min: 1, max: 99, fn: (...a) => a.reduce((s, x) => s + x, 0) }
}

export const CALC_FUNCTIONS = Object.keys(FUNCS)
export const CALC_CONSTANTS = Object.keys(CONSTANTS)

const OP_CHARS = new Map<string, string>([
  ['+', '+'],
  ['-', '-'],
  ['−', '-'],
  ['*', '*'],
  ['×', '*'],
  ['·', '*'],
  ['/', '/'],
  ['÷', '/'],
  ['%', '%'],
  ['^', '^'],
  ['(', '('],
  [')', ')'],
  [',', ','],
  ['!', '!']
])

export function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    // Numbers: 12, 1.5, .5, 1e-3, 1_000, 0x1f, 0b101, 0o17
    if (/[0-9.]/.test(c)) {
      const start = i
      const radix = /^0[xX][0-9a-fA-F]/.test(src.slice(i, i + 3)) ? 16 : /^0[bB][01]/.test(src.slice(i, i + 3)) ? 2 : /^0[oO][0-7]/.test(src.slice(i, i + 3)) ? 8 : 10
      if (radix !== 10) {
        i += 2
        const digits = radix === 16 ? /[0-9a-fA-F_]/ : radix === 2 ? /[01_]/ : /[0-7_]/
        let s = ''
        while (i < src.length && digits.test(src[i])) s += src[i++]
        out.push({ t: 'num', v: parseInt(s.replace(/_/g, ''), radix), pos: start })
        continue
      }
      let s = ''
      while (i < src.length && /[0-9_]/.test(src[i])) s += src[i++]
      if (src[i] === '.') {
        s += src[i++]
        while (i < src.length && /[0-9_]/.test(src[i])) s += src[i++]
      }
      if (/[eE]/.test(src[i] ?? '') && /^[eE][+-]?[0-9]/.test(src.slice(i, i + 3))) {
        s += src[i++]
        if (src[i] === '+' || src[i] === '-') s += src[i++]
        while (i < src.length && /[0-9]/.test(src[i])) s += src[i++]
      }
      const clean = s.replace(/_/g, '')
      if (clean === '.' || clean === '') throw new CalcError('Unexpected "."', start)
      const v = Number(clean)
      if (Number.isNaN(v)) throw new CalcError(`Invalid number "${s}"`, start)
      out.push({ t: 'num', v, pos: start })
      continue
    }
    if (c === '*' && src[i + 1] === '*') {
      out.push({ t: 'op', v: '^', pos: i })
      i += 2
      continue
    }
    const op = OP_CHARS.get(c)
    if (op) {
      out.push({ t: 'op', v: op, pos: i })
      i++
      continue
    }
    if (/[\p{L}_°]/u.test(c)) {
      const start = i
      let s = ''
      while (i < src.length && /[\p{L}\p{N}_°]/u.test(src[i])) s += src[i++]
      out.push({ t: 'id', v: s.toLowerCase(), pos: start })
      continue
    }
    throw new CalcError(`Unexpected character "${c}"`, i)
  }
  out.push({ t: 'end', pos: src.length })
  return out
}

export interface CalcOptions {
  /** Extra variables such as `ans`. */
  vars?: Record<string, number>
}

class Parser {
  private i = 0
  constructor(
    private toks: Tok[],
    private vars: Record<string, number>
  ) {}

  private peek(): Tok {
    return this.toks[this.i]
  }
  private next(): Tok {
    return this.toks[this.i++]
  }
  private isOp(v: string, tok = this.peek()): boolean {
    return tok.t === 'op' && tok.v === v
  }
  private expect(v: string): void {
    const t = this.next()
    if (!(t.t === 'op' && t.v === v)) throw new CalcError(t.t === 'end' ? `Missing "${v}"` : `Expected "${v}"`, t.pos)
  }

  parse(): number {
    if (this.peek().t === 'end') throw new CalcError('Empty expression', 0)
    const v = this.expr()
    const t = this.peek()
    if (t.t !== 'end') throw new CalcError(t.t === 'op' && t.v === ')' ? 'Unbalanced ")"' : 'Unexpected input', t.pos)
    return v
  }

  private expr(): number {
    let v = this.term()
    for (;;) {
      if (this.isOp('+')) {
        this.next()
        v = v + this.term()
      } else if (this.isOp('-')) {
        this.next()
        v = v - this.term()
      } else return v
    }
  }

  /** Can the token start an operand (used for implicit multiplication and percent detection)? */
  private startsOperand(t: Tok): boolean {
    return t.t === 'num' || (t.t === 'id' && t.v !== 'mod') || (t.t === 'op' && t.v === '(')
  }

  private term(): number {
    let v = this.unary()
    for (;;) {
      const t = this.peek()
      if (this.isOp('*')) {
        this.next()
        v = v * this.unary()
      } else if (this.isOp('/')) {
        this.next()
        const d = this.unary()
        v = v / d
      } else if ((t.t === 'op' && t.v === '%') || (t.t === 'id' && t.v === 'mod')) {
        this.next()
        v = v % this.unary()
      } else if (this.startsOperand(t)) {
        // Implicit multiplication: 2pi, 3(4+5), (1+2)(3+4)
        v = v * this.unary()
      } else return v
    }
  }

  private unary(): number {
    if (this.isOp('-')) {
      this.next()
      return -this.unary()
    }
    if (this.isOp('+')) {
      this.next()
      return this.unary()
    }
    return this.power()
  }

  private power(): number {
    const base = this.postfix()
    if (this.isOp('^')) {
      this.next()
      return Math.pow(base, this.unary())
    }
    return base
  }

  private postfix(): number {
    let v = this.primary()
    for (;;) {
      if (this.isOp('!')) {
        this.next()
        v = factorial(v)
      } else if (this.isOp('%') && !this.startsOperand(this.toks[this.i + 1])) {
        this.next()
        v = v / 100
      } else return v
    }
  }

  private primary(): number {
    const t = this.next()
    if (t.t === 'num') return t.v
    if (t.t === 'op' && t.v === '(') {
      const v = this.expr()
      this.expect(')')
      return v
    }
    if (t.t === 'id') {
      const fn = Object.hasOwn(FUNCS, t.v) ? FUNCS[t.v] : undefined
      if (fn && this.isOp('(')) {
        this.next()
        const args: number[] = []
        if (!this.isOp(')')) {
          args.push(this.expr())
          while (this.isOp(',')) {
            this.next()
            args.push(this.expr())
          }
        }
        this.expect(')')
        if (args.length < fn.min || args.length > fn.max) throw new CalcError(`${t.v}() takes ${fn.min === fn.max ? fn.min : `${fn.min}–${fn.max}`} argument${fn.max === 1 ? '' : 's'}`, t.pos)
        return fn.fn(...args)
      }
      if (Object.hasOwn(this.vars, t.v)) return this.vars[t.v]
      if (Object.hasOwn(CONSTANTS, t.v)) return CONSTANTS[t.v]
      if (fn) throw new CalcError(`${t.v} needs parentheses`, t.pos)
      throw new CalcError(`Unknown name "${t.v}"`, t.pos)
    }
    if (t.t === 'end') throw new CalcError('Unexpected end of expression', t.pos)
    throw new CalcError(`Unexpected "${t.v}"`, t.pos)
  }
}

/** Evaluates an arithmetic expression. Throws CalcError on invalid input. */
export function evaluate(src: string, opts: CalcOptions = {}): number {
  const vars: Record<string, number> = {}
  for (const [k, v] of Object.entries(opts.vars ?? {})) vars[k.toLowerCase()] = v
  return new Parser(tokenize(src), vars).parse()
}

/** Human-friendly result formatting (hides binary floating-point noise). */
export function formatResult(n: number): string {
  if (Number.isNaN(n)) return 'NaN'
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞'
  if (n === 0) return '0'
  const abs = Math.abs(n)
  if (abs >= 1e21 || abs < 1e-9) return n.toPrecision(12).replace(/\.?0+e/, 'e')
  if (Number.isInteger(n)) return String(n)
  const r = Number.parseFloat(n.toPrecision(14))
  return String(r)
}

/**
 * True when `text` looks like a math expression worth evaluating in the
 * omnibox: it tokenizes, contains at least one operator or function call and
 * is not just a single number, a date or a version string.
 */
export function looksLikeMath(text: string): boolean {
  const s = text.trim()
  if (s.length < 2 || s.length > 200) return false
  if (!/[0-9πτφ]/.test(s)) return false
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s) || /^\d+\.\d+\.\d+/.test(s)) return false // dates, versions/IPs
  if (/^\+?\d[\d\s-]{6,}$/.test(s) && !/[*/^+()]/.test(s.slice(1))) return false // phone-ish numbers
  let toks: Tok[]
  try {
    toks = tokenize(s)
  } catch {
    return false
  }
  const hasOp = toks.some((t) => (t.t === 'op' && t.v !== '(' && t.v !== ')' && t.v !== ',') || (t.t === 'id' && (Object.hasOwn(FUNCS, t.v) || t.v === 'mod')))
  if (!hasOp) return false
  // Every identifier must be a known function/constant (no free words).
  return toks.every((t) => t.t !== 'id' || Object.hasOwn(FUNCS, t.v) || Object.hasOwn(CONSTANTS, t.v) || t.v === 'mod')
}
