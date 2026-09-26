import { describe, expect, it } from 'vitest'
import { badgeLabel, parseUnread, pickFavicon, UNREAD_DOT } from '@shared/modules/webapps'

describe('parseUnread', () => {
  it('reads leading counts', () => {
    expect(parseUnread('(3) WhatsApp')).toBe(3)
    expect(parseUnread('(12) Inbox')).toBe(12)
    expect(parseUnread('[7] Telegram')).toBe(7)
    expect(parseUnread('(99+) Discord | #general | Server')).toBe(99)
    expect(parseUnread('  (1) Instagram')).toBe(1)
    expect(parseUnread('(5) Home / X')).toBe(5)
  })
  it('reads "N unread" / "N new" counts', () => {
    expect(parseUnread('Discord | 5 unread')).toBe(5)
    expect(parseUnread('Slack | 3 new messages | Acme')).toBe(3)
    expect(parseUnread('Telegram: 14 unread')).toBe(14)
    expect(parseUnread('Chat - 2 unread messages')).toBe(2)
    expect(parseUnread('Posteingang – 4 ungelesen')).toBe(4)
  })
  it('reads Gmail-style inbox titles', () => {
    expect(parseUnread('Inbox (12) - me@example.com - Gmail')).toBe(12)
    expect(parseUnread('Posteingang (2) - me@example.com - Gmail')).toBe(2)
  })
  it('reads counts with thousands separators', () => {
    expect(parseUnread('Inbox (1,234) - me@example.com - Gmail')).toBe(1234)
    expect(parseUnread('Posteingang (12.345) - me@example.com - Gmail')).toBe(12345)
    expect(parseUnread('(1 234) WhatsApp')).toBe(1234)
    expect(parseUnread('(2,500+) Discord')).toBe(2500)
    expect(parseUnread('Mail | 1,024 unread')).toBe(1024)
    expect(parseUnread('(1) 234 photos')).toBe(1)
  })
  it('flags unread without a count', () => {
    expect(parseUnread('• Discord | #general')).toBe(UNREAD_DOT)
    expect(parseUnread('* Slack | general | Acme')).toBe(UNREAD_DOT)
    expect(parseUnread('! Slack | general | Acme')).toBe(UNREAD_DOT)
  })
  it('ignores titles without unread state', () => {
    expect(parseUnread('WhatsApp')).toBe(0)
    expect(parseUnread('Inbox - me@example.com - Gmail')).toBe(0)
    expect(parseUnread('Song (Live) - YouTube Music')).toBe(0)
    expect(parseUnread('Top 10 songs of 2024 - SoundCloud')).toBe(0)
    expect(parseUnread('Remix (2019) - SoundCloud')).toBe(0)
    expect(parseUnread('3 new features in the release - Blog')).toBe(0)
    expect(parseUnread('Discord | Friends')).toBe(0)
    expect(parseUnread('(0) WhatsApp')).toBe(0)
    expect(parseUnread('')).toBe(0)
    expect(parseUnread(null)).toBe(0)
  })
  it('formats badge labels', () => {
    expect(badgeLabel(0)).toBe('')
    expect(badgeLabel(UNREAD_DOT)).toBe('')
    expect(badgeLabel(7)).toBe('7')
    expect(badgeLabel(100)).toBe('99+')
  })
})

describe('pickFavicon', () => {
  it('prefers svg, then png, and skips junk', () => {
    expect(pickFavicon(['https://a.com/f.ico', 'https://a.com/f.png', 'https://a.com/f.svg'])).toBe('https://a.com/f.svg')
    expect(pickFavicon(['https://a.com/f.ico', 'https://a.com/f.png?v=2'])).toBe('https://a.com/f.png?v=2')
    expect(pickFavicon(['javascript:alert(1)', 'https://a.com/f.ico'])).toBe('https://a.com/f.ico')
    expect(pickFavicon([])).toBeNull()
    expect(pickFavicon(undefined)).toBeNull()
  })
})
