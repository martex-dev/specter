import { describe, expect, it } from 'vitest'
import {
  appLetter,
  catalogApp,
  chromeMajor,
  clampZoom,
  cleanAppName,
  colorFor,
  desktopUserAgent,
  iconKey,
  isHexColor,
  sameAppHost,
  mobileUserAgent,
  nameFromUrl,
  normalizeAppUrl,
  originOfUrl,
  WEBAPP_CATALOG,
  WEBAPP_CATEGORIES
} from '@shared/modules/webapps'

describe('catalog', () => {
  it('has unique ids and valid https URLs', () => {
    const ids = new Set(WEBAPP_CATALOG.map((c) => c.id))
    expect(ids.size).toBe(WEBAPP_CATALOG.length)
    for (const c of WEBAPP_CATALOG) {
      expect(normalizeAppUrl(c.url)).toBe(c.url)
      expect(c.url.startsWith('https://')).toBe(true)
      expect(isHexColor(c.color)).toBe(true)
      expect(WEBAPP_CATEGORIES.some((k) => k.id === c.category)).toBe(true)
    }
  })
  it('includes the requested apps', () => {
    for (const id of ['whatsapp', 'telegram', 'discord', 'messenger', 'instagram', 'x', 'slack', 'spotify', 'ytmusic', 'applemusic', 'soundcloud', 'twitch', 'chatgpt', 'claude', 'gemini', 'gmail', 'gcalendar', 'notion', 'reddit', 'tiktok'])
      expect(catalogApp(id), id).toBeTruthy()
    expect(catalogApp('nope')).toBeUndefined()
    expect(catalogApp(null)).toBeUndefined()
  })
})

describe('normalizeAppUrl', () => {
  it('adds https and keeps paths', () => {
    expect(normalizeAppUrl('outlook.live.com/mail')).toBe('https://outlook.live.com/mail')
    expect(normalizeAppUrl('  https://web.whatsapp.com  ')).toBe('https://web.whatsapp.com/')
    expect(normalizeAppUrl('http://example.org/app?x=1#y')).toBe('http://example.org/app?x=1#y')
  })
  it('uses http for local hosts', () => {
    expect(normalizeAppUrl('localhost:3000')).toBe('http://localhost:3000/')
    expect(normalizeAppUrl('192.168.1.20:8123')).toBe('http://192.168.1.20:8123/')
  })
  it('rejects non-web and malformed input', () => {
    const bad = ['', '   ', 'javascript:alert(1)', 'file:///C:/x.html', 'specter://settings', 'data:text/html,hi', 'mailto:a@b.c', 'ftp://example.com', 'intranet', 'https://user:pw@example.com', 'exa mple.com', 'https://-bad.com', null, undefined]
    for (const b of bad) expect(normalizeAppUrl(b), String(b)).toBeNull()
  })
})

describe('names, colours, zoom', () => {
  it('derives names', () => {
    expect(nameFromUrl('https://www.notion.so/')).toBe('Notion')
    expect(nameFromUrl('https://web.whatsapp.com/')).toBe('Whatsapp')
    expect(cleanAppName('  My   Mail ', 'https://x.com')).toBe('My Mail')
    expect(cleanAppName('', 'https://app.slack.com/client')).toBe('Slack')
    expect(cleanAppName('x'.repeat(80)).length).toBe(40)
  })
  it('letters and colours', () => {
    expect(appLetter('whatsapp')).toBe('W')
    expect(appLetter('  #general')).toBe('G')
    expect(appLetter('')).toBe('?')
    expect(isHexColor(colorFor('example.com'))).toBe(true)
    expect(colorFor('a.com')).toBe(colorFor('a.com'))
  })
  it('clamps zoom', () => {
    expect(clampZoom(1.254)).toBe(1.25)
    expect(clampZoom(10)).toBe(3)
    expect(clampZoom(0)).toBe(0.25)
    expect(clampZoom('x')).toBe(1)
  })
  it('icon keys and host matching', () => {
    expect(iconKey('http://localhost:47123/a')).toBe('localhost:47123')
    expect(iconKey('https://discord.com/app')).toBe('discord.com')
    expect(sameAppHost('https://discord.com/channels/@me', 'https://discord.com/app')).toBe(true)
    expect(sameAppHost('https://web.telegram.org/a/', 'https://telegram.org/')).toBe(true)
    expect(sameAppHost('https://consent.youtube.com/m', 'https://music.youtube.com/')).toBe(false)
    expect(sameAppHost('http://localhost:1/', 'http://localhost:2/')).toBe(false)
    expect(sameAppHost('about:blank', 'https://a.com')).toBe(false)
  })
  it('origins', () => {
    expect(originOfUrl('https://discord.com/channels/@me')).toBe('https://discord.com')
    expect(originOfUrl('about:blank')).toBe('')
  })
})

describe('user agents', () => {
  const electronUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) specter/0.9.0 Chrome/152.0.7512.4 Electron/44.0.0 Safari/537.36'
  it('strips Electron and app tokens for desktop', () => {
    expect(desktopUserAgent(electronUa)).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7512.4 Safari/537.36')
  })
  it('builds a Chrome-on-Android UA', () => {
    expect(chromeMajor(electronUa)).toBe('152')
    const m = mobileUserAgent(electronUa)
    expect(m).toContain('Android')
    expect(m).toContain('Chrome/152.0.0.0 Mobile Safari/537.36')
    expect(m).not.toContain('Electron')
  })
})
