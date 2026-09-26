// Tiny, dependency-free RSS 2.0 / RSS 1.0 (RDF) / Atom parser.
//
// Not a general XML parser: it is forgiving by design (feeds in the wild are
// often slightly malformed) and only builds the element tree the feed readers
// need. Pure — no Electron / Node imports — so it is unit-tested directly.

export interface XmlNode {
  /** Lower-cased qualified name, e.g. "item", "dc:creator", "atom:link". */
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  /** Concatenated direct text content (CDATA included, entities decoded). */
  text: string
}

export interface ParsedFeedItem {
  guid: string
  title: string
  link: string
  author: string | null
  summary: string
  published: number | null
}

export interface ParsedFeed {
  format: 'rss' | 'rdf' | 'atom'
  title: string
  siteUrl: string
  items: ParsedFeedItem[]
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  middot: '·',
  bull: '•',
  times: '×',
  deg: '°',
  shy: '',
  zwj: '',
  zwnj: ''
}

/** Decodes XML/HTML character references (numeric and a common named subset). */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return ''
      return String.fromCodePoint(code)
    }
    const v = NAMED[ref.toLowerCase()]
    return v ?? m
  })
}

/** Converts an HTML fragment to plain text (tags removed, whitespace collapsed). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|iframe|noscript)[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/?(br|p|div|li|ul|ol|h[1-6]|hr|tr|td|th|blockquote|section|article)\b[^>]*>/gi, ' ')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim()
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…'
}

const ATTR_RE = /([^\s=/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g

/** Parses XML into a forgiving element tree. Returns a synthetic root. */
export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  let i = 0
  const n = xml.length
  const top = () => stack[stack.length - 1]
  const addText = (t: string) => {
    if (!t) return
    const node = top()
    node.text += t
    // Ordered text children keep mixed content (inline XHTML) in document order.
    node.children.push({ name: '#text', attrs: {}, children: [], text: t })
  }
  while (i < n) {
    const lt = xml.indexOf('<', i)
    if (lt < 0) {
      addText(decodeEntities(xml.slice(i)))
      break
    }
    if (lt > i) addText(decodeEntities(xml.slice(i, lt)))
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9)
      const stop = end < 0 ? n : end
      addText(xml.slice(lt + 9, stop))
      i = end < 0 ? n : end + 3
      continue
    }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4)
      i = end < 0 ? n : end + 3
      continue
    }
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2)
      i = end < 0 ? n : end + 2
      continue
    }
    if (xml.startsWith('<!', lt)) {
      // DOCTYPE (possibly with an internal subset in [...]).
      let j = lt + 2
      let depth = 0
      while (j < n) {
        const c = xml[j]
        if (c === '[') depth++
        else if (c === ']') depth--
        else if (c === '>' && depth <= 0) break
        j++
      }
      i = j + 1
      continue
    }
    // Find the end of the tag, respecting quoted attribute values.
    let j = lt + 1
    let quote = ''
    while (j < n) {
      const c = xml[j]
      if (quote) {
        if (c === quote) quote = ''
      } else if (c === '"' || c === "'") quote = c
      else if (c === '>') break
      j++
    }
    const raw = xml.slice(lt + 1, j)
    i = j + 1
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim().toLowerCase()
      // Pop to the matching element; ignore stray closing tags.
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k
          break
        }
      }
      continue
    }
    const selfClosing = raw.endsWith('/')
    const body = selfClosing ? raw.slice(0, -1) : raw
    const m = /^([^\s/>]+)/.exec(body)
    if (!m) continue
    const node: XmlNode = { name: m[1].toLowerCase(), attrs: {}, children: [], text: '' }
    const attrSrc = body.slice(m[1].length)
    ATTR_RE.lastIndex = 0
    let a: RegExpExecArray | null
    while ((a = ATTR_RE.exec(attrSrc))) {
      node.attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '')
    }
    top().children.push(node)
    if (!selfClosing) stack.push(node)
  }
  return root
}

// ---------------------------------------------------------------- tree helpers

/** Local part of a qualified name ("dc:creator" → "creator"). */
const local = (name: string) => name.slice(name.indexOf(':') + 1)

function child(node: XmlNode | undefined, ...names: string[]): XmlNode | undefined {
  if (!node) return undefined
  for (const nm of names) {
    const hit = node.children.find((c) => c.name === nm)
    if (hit) return hit
  }
  return undefined
}

function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => c.name === name || local(c.name) === name)
}

/** Full text of a node including descendants (for elements holding inline XHTML). */
function deepText(node: XmlNode | undefined): string {
  if (!node) return ''
  if (node.name === '#text') return node.text
  let s = ''
  for (const c of node.children) s += deepText(c)
  return s
}

function textOf(node: XmlNode | undefined): string {
  return deepText(node).trim()
}

export function parseDate(s: string | undefined | null): number | null {
  if (!s) return null
  const t = s.trim()
  if (!t) return null
  let ms = Date.parse(t)
  if (Number.isNaN(ms)) {
    // RFC 822 with a named zone Date.parse doesn't know ("… 2024 10:00:00 CEST") → drop the zone.
    ms = Date.parse(t.replace(/\s+[A-Z]{2,5}$/, ' GMT'))
  }
  return Number.isNaN(ms) ? null : ms
}

export function resolveUrl(href: string, base: string): string {
  const h = href.trim()
  if (!h) return ''
  try {
    const u = new URL(h, base || undefined)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : ''
  } catch {
    return ''
  }
}

function cleanTitle(s: string): string {
  const t = s.includes('<') || s.includes('&') ? htmlToText(s) : s.replace(/\s+/g, ' ').trim()
  return clip(t, 300)
}

const SUMMARY_MAX = 360

// ---------------------------------------------------------------- feed formats

/** Drops aggregator boilerplate (e.g. hnrss "Article URL: … Comments URL: … Points: 3") from summaries. */
export function tidySummary(s: string): string {
  return s
    .replace(/\b(Article URL|Comments URL):\s*\S+/gi, ' ')
    .replace(/\bPoints:\s*\d+/gi, ' ')
    .replace(/#\s*Comments:\s*\d+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseRssItem(item: XmlNode, base: string): ParsedFeedItem {
  const title = cleanTitle(textOf(child(item, 'title', 'dc:title')))
  let link = resolveUrl(textOf(child(item, 'link')), base)
  if (!link) {
    const al = item.children.find((c) => local(c.name) === 'link' && c.attrs.href)
    if (al) link = resolveUrl(al.attrs.href, base)
  }
  const guidNode = child(item, 'guid')
  const guid = textOf(guidNode) || item.attrs['rdf:about'] || link || title
  if (!link && guidNode && guidNode.attrs.ispermalink !== 'false') link = resolveUrl(textOf(guidNode), base)
  const desc = textOf(child(item, 'description', 'content:encoded', 'dc:description', 'summary'))
  const author = textOf(child(item, 'dc:creator', 'author', 'itunes:author')) || null
  const published = parseDate(textOf(child(item, 'pubdate', 'dc:date', 'published', 'updated', 'a10:updated')))
  return { guid, title: title || '(untitled)', link, author: author ? clip(htmlToText(author), 120) : null, summary: clip(tidySummary(htmlToText(desc)), SUMMARY_MAX), published }
}

function atomLink(node: XmlNode, base: string): string {
  const links = node.children.filter((c) => local(c.name) === 'link')
  const alt = links.find((l) => !l.attrs.rel || l.attrs.rel === 'alternate') ?? links.find((l) => l.attrs.rel !== 'self' && l.attrs.rel !== 'enclosure') ?? links[0]
  return alt ? resolveUrl(alt.attrs.href ?? textOf(alt), node.attrs['xml:base'] ? resolveUrl(node.attrs['xml:base'], base) || base : base) : ''
}

function parseAtomEntry(entry: XmlNode, base: string): ParsedFeedItem {
  const title = cleanTitle(textOf(child(entry, 'title', 'atom:title')))
  const link = atomLink(entry, base)
  const guid = textOf(child(entry, 'id', 'atom:id')) || link || title
  const contentNode = child(entry, 'summary', 'atom:summary', 'content', 'atom:content', 'media:group')
  const summary = clip(htmlToText(textOf(contentNode)), SUMMARY_MAX)
  const authors = childrenNamed(entry, 'author')
    .map((a) => textOf(child(a, 'name', 'atom:name')) || textOf(a))
    .filter(Boolean)
  const published = parseDate(textOf(child(entry, 'published', 'atom:published', 'updated', 'atom:updated', 'dc:date')))
  return { guid, title: title || '(untitled)', link, author: authors.length ? clip(authors.join(', '), 120) : null, summary, published }
}

/** Parses an RSS 2.0, RSS 1.0 (RDF) or Atom document. Throws if it is none of those. */
export function parseFeed(xml: string, feedUrl = ''): ParsedFeed {
  const root = parseXml(xml.replace(/^﻿/, ''))
  const doc = root.children.find((c) => ['rss', 'feed', 'rdf:rdf', 'atom:feed'].includes(c.name) || local(c.name) === 'rdf')
  if (!doc) throw new Error('Not an RSS or Atom feed')

  if (doc.name === 'feed' || doc.name === 'atom:feed') {
    const base = doc.attrs['xml:base'] ? resolveUrl(doc.attrs['xml:base'], feedUrl) || feedUrl : feedUrl
    const title = cleanTitle(textOf(child(doc, 'title', 'atom:title')))
    const siteUrl = atomLink(doc, base) || originOf(feedUrl)
    const items = childrenNamed(doc, 'entry').map((e) => parseAtomEntry(e, base))
    return { format: 'atom', title, siteUrl, items }
  }

  if (doc.name === 'rss') {
    const channel = child(doc, 'channel') ?? doc
    const title = cleanTitle(textOf(child(channel, 'title')))
    const siteUrl = resolveUrl(textOf(child(channel, 'link')), feedUrl) || originOf(feedUrl)
    // Some feeds put <item> outside <channel>; accept both.
    const items = [...childrenNamed(channel, 'item'), ...(channel !== doc ? childrenNamed(doc, 'item') : [])].map((it) => parseRssItem(it, siteUrl || feedUrl))
    return { format: 'rss', title, siteUrl, items }
  }

  // RSS 1.0 / RDF: <channel> and <item> are siblings under rdf:RDF.
  const channel = childrenNamed(doc, 'channel')[0]
  const title = cleanTitle(textOf(child(channel, 'title')))
  const siteUrl = resolveUrl(textOf(child(channel, 'link')), feedUrl) || originOf(feedUrl)
  const items = childrenNamed(doc, 'item').map((it) => parseRssItem(it, siteUrl || feedUrl))
  return { format: 'rdf', title, siteUrl, items }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/**
 * Finds feed URLs advertised by an HTML page
 * (<link rel="alternate" type="application/rss+xml|atom+xml" href="…">).
 */
export function discoverFeeds(html: string, pageUrl: string): string[] {
  const out: string[] = []
  const re = /<link\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const tag = m[0]
    const attrs: Record<string, string> = {}
    ATTR_RE.lastIndex = 0
    let a: RegExpExecArray | null
    const src = tag.slice(5, -1)
    while ((a = ATTR_RE.exec(src))) attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '')
    const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/)
    const type = (attrs.type ?? '').toLowerCase()
    if (rel.includes('alternate') && /(rss|atom)\+xml|application\/feed\+json/.test(type) && !type.includes('json') && attrs.href) {
      const u = resolveUrl(attrs.href, pageUrl)
      if (u && !out.includes(u)) out.push(u)
    }
  }
  return out
}
