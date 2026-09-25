import { describe, expect, it } from 'vitest'
import { AnsiTerminal, applySgr, paletteColor, parseAnsi, stripAnsi } from '../../src/shared/modules/developer'

const text = (t: AnsiTerminal) => t.lines.map((l) => l.spans.map((s) => s.text).join(''))

describe('ANSI SGR', () => {
  it('parses basic colors and attributes', () => {
    const [line] = parseAnsi('a\x1b[1;31mred\x1b[0m b')
    expect(line.spans).toEqual([
      { text: 'a', style: {} },
      { text: 'red', style: { bold: true, fg: 'var(--ansi-1)' } },
      { text: ' b', style: {} }
    ])
  })

  it('handles bright, 256 and truecolor (semicolon and colon forms)', () => {
    expect(applySgr('92', {}).fg).toBe('var(--ansi-10)')
    expect(applySgr('38;5;208', {}).fg).toBe(paletteColor(208))
    expect(applySgr('48;5;240', {}).bg).toBe('rgb(88,88,88)')
    expect(applySgr('38;2;255;128;0', {}).fg).toBe('rgb(255,128,0)')
    expect(applySgr('38:2::10:20:30', {}).fg).toBe('rgb(10,20,30)')
    expect(applySgr('38:5:196', {}).fg).toBe('rgb(255,0,0)')
  })

  it('resets individual attributes', () => {
    let s = applySgr('1;3;4;7;31;42', {})
    expect(s).toMatchObject({ bold: true, italic: true, underline: true, inverse: true })
    s = applySgr('22;23;24;27;39;49', s)
    expect(s).toEqual({})
    expect(applySgr('', { bold: true })).toEqual({})
  })

  it('keeps an escape split across chunks', () => {
    const t = new AnsiTerminal()
    t.write('x\x1b[3')
    t.write('2mgreen\x1b[')
    t.write('0m!')
    expect(t.lines[0].spans).toEqual([
      { text: 'x', style: {} },
      { text: 'green', style: { fg: 'var(--ansi-2)' } },
      { text: '!', style: {} }
    ])
  })
})

describe('ANSI terminal model', () => {
  it('splits lines on LF and treats CRLF as a newline', () => {
    const t = new AnsiTerminal()
    t.write('one\r\ntwo\nthree')
    expect(text(t)).toEqual(['one', 'two', 'three'])
  })

  it('overwrites on bare carriage return (progress bars)', () => {
    const t = new AnsiTerminal()
    t.write('Receiving objects:  10%\rReceiving objects:  55%\rReceiving objects: 100%, done.\n')
    expect(text(t)).toEqual(['Receiving objects: 100%, done.', ''])
  })

  it('partial overwrite keeps the tail and styles', () => {
    const t = new AnsiTerminal()
    t.write('\x1b[31mabcdef\x1b[0m\rXY')
    expect(t.lines[0].spans).toEqual([
      { text: 'XY', style: {} },
      { text: 'cdef', style: { fg: 'var(--ansi-1)' } }
    ])
  })

  it('handles erase in line, backspace, tabs, cursor column', () => {
    const t = new AnsiTerminal()
    t.write('hello world\r\x1b[Kbye\n')
    t.write('ab\bc\n')
    t.write('a\tb\n')
    t.write('abc\x1b[1Gz\n')
    expect(text(t)).toEqual(['bye', 'ac', 'a       b', 'zbc', ''])
  })

  it('clears the screen on ESC[2J and form feed', () => {
    const t = new AnsiTerminal()
    t.write('old\nstuff\n\x1b[2J\x1b[Hnew')
    expect(text(t)).toEqual(['new'])
    t.write('\x0cfresh')
    expect(text(t)).toEqual(['fresh'])
  })

  it('ignores OSC titles and unknown CSI sequences', () => {
    expect(stripAnsi('\x1b]0;title\x07ok\x1b[?25l\x1b[2A!')).toBe('ok!')
    expect(stripAnsi('a\x1b]8;;http://x\x1b\\link\x1b]8;;\x1b\\b')).toBe('alinkb')
  })

  it('caps scrollback', () => {
    const t = new AnsiTerminal(10)
    for (let i = 0; i < 50; i++) t.write(`line ${i}\n`)
    expect(t.lines.length).toBe(10)
    expect(text(t)[8]).toBe('line 49')
  })

  it('gives modified lines a new identity but keeps line ids stable', () => {
    const t = new AnsiTerminal()
    t.write('a\nb')
    const [first, second] = t.lines
    t.write('c')
    expect(t.lines[0]).toBe(first)
    expect(t.lines[1]).not.toBe(second)
    expect(t.lines[1].id).toBe(second.id)
    expect(t.plainText()).toBe('a\nbc')
  })
})
