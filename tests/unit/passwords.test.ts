import { describe, expect, it } from 'vitest'
import { generatePassword, loginOrigin, loginsFromCsv, loginsToCsv, matchOrigin, parseCsv } from '@shared/passwords'

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, embedded newlines, CRLF and a BOM', () => {
    const text = '﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n1,,3\n'
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'line1\nline2'],
      ['1', '', '3']
    ])
  })
  it('keeps a last row without a trailing newline and skips blank lines', () => {
    expect(parseCsv('a,b\n\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })
})

describe('loginsFromCsv', () => {
  it('reads Chrome / Google Password Manager exports', () => {
    const csv = 'name,url,username,password,note\r\nexample.com,https://example.com/login,me@example.com,"p,a""ss",\r\n'
    expect(loginsFromCsv(csv)).toEqual({ logins: [{ url: 'https://example.com/login', username: 'me@example.com', password: 'p,a"ss', note: '' }], skipped: 0 })
  })
  it('reads Firefox and Bitwarden column names', () => {
    const ff = '"url","username","password","httpRealm"\n"https://a.test","u","p",""\n'
    expect(loginsFromCsv(ff).logins[0]).toMatchObject({ url: 'https://a.test', username: 'u', password: 'p' })
    const bw = 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,A,hello,,0,https://b.test,bob,secret,\n'
    expect(loginsFromCsv(bw).logins[0]).toEqual({ url: 'https://b.test', username: 'bob', password: 'secret', note: 'hello' })
  })
  it('skips Android app entries and rows without a password', () => {
    const csv = 'name,url,username,password,note\nx,android://abc@com.example/,u,p,\ny,https://c.test,u,,\nz,https://d.test,,pw,\n'
    const r = loginsFromCsv(csv)
    expect(r.logins.map((l) => l.url)).toEqual(['https://d.test'])
    expect(r.skipped).toBe(2)
  })
  it('rejects files that are not password exports', () => {
    expect(() => loginsFromCsv('title,author\na,b\n')).toThrow(/password export/)
  })
  it('round-trips through the export format', () => {
    const rows = [{ name: 'e.test', url: 'https://e.test/', username: 'a,b', password: ' "q" ', note: 'multi\nline' }]
    const back = loginsFromCsv(loginsToCsv(rows)).logins
    expect(back).toEqual([{ url: 'https://e.test/', username: 'a,b', password: ' "q" ', note: 'multi\nline' }])
  })
})

describe('loginOrigin', () => {
  it('normalises web URLs to their origin', () => {
    expect(loginOrigin('https://accounts.google.com/signin/v2?x=1')).toBe('https://accounts.google.com')
    expect(loginOrigin('http://localhost:5173/login')).toBe('http://localhost:5173')
    expect(loginOrigin('example.com/login')).toBe('https://example.com')
  })
  it('refuses non-web schemes', () => {
    expect(loginOrigin('android://hash@com.app/')).toBeNull()
    expect(loginOrigin('chrome://settings')).toBeNull()
    expect(loginOrigin('')).toBeNull()
  })
})

describe('matchOrigin', () => {
  it('matches the same origin and http logins on the https site', () => {
    expect(matchOrigin('https://github.com', 'https://github.com')).toBe('exact')
    expect(matchOrigin('http://example.com', 'https://example.com')).toBe('exact')
  })
  it('never offers an https login on an http page', () => {
    expect(matchOrigin('https://example.com', 'http://example.com')).toBeNull()
  })
  it('offers other hosts of the same site as non-exact', () => {
    expect(matchOrigin('https://accounts.example.com', 'https://www.example.com')).toBe('site')
    expect(matchOrigin('https://a.example.co.uk', 'https://b.example.co.uk')).toBe('site')
  })
  it('keeps different sites, ports and hosting tenants apart', () => {
    expect(matchOrigin('https://example.com', 'https://example.org')).toBeNull()
    expect(matchOrigin('https://alice.github.io', 'https://bob.github.io')).toBeNull()
    expect(matchOrigin('http://localhost:3000', 'http://localhost:4000')).toBeNull()
    expect(matchOrigin('https://10.0.0.1', 'https://10.0.0.2')).toBeNull()
  })
})

describe('generatePassword', () => {
  const rnd = (n: number) => Math.floor(Math.random() * n)
  it('makes 15-character passwords with every character class', () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePassword(rnd)
      expect(p).toHaveLength(15)
      expect(p).toMatch(/[a-z]/)
      expect(p).toMatch(/[A-Z]/)
      expect(p).toMatch(/[0-9]/)
      expect(p).toMatch(/[-_.!?@#$%]/)
      expect(p).not.toMatch(/[lIO01]/)
    }
  })
  it("fits a field's maxlength but never goes below 8", () => {
    expect(generatePassword(rnd, 10)).toHaveLength(10)
    expect(generatePassword(rnd, 4)).toHaveLength(8)
    expect(generatePassword(rnd, 64)).toHaveLength(15)
  })
  it('always has the four classes, even from a degenerate source', () => {
    expect(generatePassword(() => 0)).toMatch(/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[-_.!?@#$%]).{15}$/)
  })
})
