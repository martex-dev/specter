import { describe, expect, it } from 'vitest'
import { decodeEntities, discoverFeeds, htmlToText, parseDate, parseFeed, parseXml } from '../../src/main/modules/widgets/feed'

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE rss>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title><![CDATA[Example & Co]]></title>
    <link>https://example.com/</link>
    <atom:link href="https://example.com/feed" rel="self" type="application/rss+xml"/>
    <!-- a comment <item> that must be ignored -->
    <item>
      <title><![CDATA[Show HN: A thing]]></title>
      <description><![CDATA[<p>Hello <b>world</b> &amp; friends</p><script>alert(1)</script>]]></description>
      <pubDate>Sat, 26 Sep 2026 00:11:33 +0000</pubDate>
      <link>https://unspin.app/</link>
      <dc:creator>azermite</dc:creator>
      <guid isPermaLink="false">https://news.ycombinator.com/item?id=1</guid>
    </item>
    <item>
      <title>Escaped &lt;i&gt;markup&lt;/i&gt; &amp;amp; entities &#8217; &#x2014;</title>
      <description>&lt;p&gt;Paragraph one.&lt;/p&gt;&lt;p&gt;Two&lt;/p&gt;</description>
      <guid>https://example.com/p/2</guid>
      <dc:date>2026-09-25T10:00:00Z</dc:date>
    </item>
    <item>
      <title>Relative link</title>
      <link>/posts/3</link>
    </item>
  </channel>
</rss>`

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-US">
  <title type="text">The Verge</title>
  <link rel="alternate" type="text/html" href="https://www.theverge.com" />
  <link rel="self" type="application/atom+xml" href="https://www.theverge.com/rss/index.xml" />
  <id>https://www.theverge.com/rss/index.xml</id>
  <entry>
    <author><name>Brad</name></author>
    <author><name>Cameron</name></author>
    <title type="html"><![CDATA[Roku&#8217;s first OLED TVs]]></title>
    <link rel="alternate" type="text/html" href="https://www.theverge.com/gadgets/1" />
    <id>https://www.theverge.com/?p=1</id>
    <updated>2026-09-25T19:09:57+00:00</updated>
    <published>2026-09-25T18:00:00+00:00</published>
    <summary type="html"><![CDATA[Up to $400 off.]]></summary>
  </entry>
  <entry>
    <title>XHTML content</title>
    <link href="entries/2"/>
    <id>tag:x,2</id>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Inline <em>xhtml</em> body</p></div></content>
  </entry>
</feed>`

const RDF = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://slashdot.example/">
    <title>RDF Feed</title>
    <link>https://slashdot.example/</link>
  </channel>
  <item rdf:about="https://slashdot.example/story/1">
    <title>Story one</title>
    <link>https://slashdot.example/story/1</link>
    <dc:date>2026-09-01T12:00:00+00:00</dc:date>
  </item>
</rdf:RDF>`

describe('widgets feed parser', () => {
  it('parses RSS 2.0 with CDATA, namespaces, comments and escaped HTML', () => {
    const f = parseFeed(RSS, 'https://example.com/feed')
    expect(f.format).toBe('rss')
    expect(f.title).toBe('Example & Co')
    expect(f.siteUrl).toBe('https://example.com/')
    expect(f.items).toHaveLength(3)
    const [a, b, c] = f.items
    expect(a.title).toBe('Show HN: A thing')
    expect(a.link).toBe('https://unspin.app/')
    expect(a.guid).toBe('https://news.ycombinator.com/item?id=1')
    expect(a.author).toBe('azermite')
    expect(a.summary).toBe('Hello world & friends')
    expect(a.published).toBe(Date.UTC(2026, 8, 26, 0, 11, 33))
    expect(b.title).toBe('Escaped markup & entities ’ —')
    expect(b.summary).toBe('Paragraph one. Two')
    expect(b.link).toBe('https://example.com/p/2') // permalink guid used as link
    expect(b.published).toBe(Date.UTC(2026, 8, 25, 10))
    expect(c.link).toBe('https://example.com/posts/3')
    expect(c.published).toBeNull()
  })

  it('parses Atom (alternate links, multiple authors, html titles, xhtml content)', () => {
    const f = parseFeed(ATOM, 'https://www.theverge.com/rss/index.xml')
    expect(f.format).toBe('atom')
    expect(f.title).toBe('The Verge')
    expect(f.siteUrl).toBe('https://www.theverge.com/')
    const [a, b] = f.items
    expect(a.title).toBe('Roku’s first OLED TVs')
    expect(a.link).toBe('https://www.theverge.com/gadgets/1')
    expect(a.author).toBe('Brad, Cameron')
    expect(a.published).toBe(Date.UTC(2026, 8, 25, 18))
    expect(a.summary).toBe('Up to $400 off.')
    expect(b.link).toBe('https://www.theverge.com/rss/entries/2')
    expect(b.summary).toBe('Inline xhtml body')
    expect(b.guid).toBe('tag:x,2')
  })

  it('parses RSS 1.0 (RDF)', () => {
    const f = parseFeed(RDF, 'https://slashdot.example/rss')
    expect(f.format).toBe('rdf')
    expect(f.title).toBe('RDF Feed')
    expect(f.items).toHaveLength(1)
    expect(f.items[0].guid).toBe('https://slashdot.example/story/1')
  })

  it('rejects non-feeds and survives malformed markup', () => {
    expect(() => parseFeed('<html><body>hi</body></html>')).toThrow(/Not an RSS or Atom feed/)
    const broken = '<rss><channel><title>T</title><item><title>A</item><item><title>B</title></item></channel>'
    const f = parseFeed(broken, 'https://x.test/')
    expect(f.items.map((i) => i.title)).toEqual(['A', 'B'])
  })

  it('strips aggregator boilerplate from summaries', () => {
    const xml = '<rss><channel><item><title>x</title><description><![CDATA[<p>Real text.</p><hr><p>Article URL: <a href="https://a.test">https://a.test</a></p><p>Comments URL: <a href="https://b.test">https://b.test</a></p><p>Points: 6</p><p># Comments: 1</p>]]></description></item></channel></rss>'
    expect(parseFeed(xml, 'https://x.test/').items[0].summary).toBe('Real text.')
  })

  it('rejects javascript: links', () => {
    const f = parseFeed('<rss><channel><item><title>x</title><link>javascript:alert(1)</link></item></channel></rss>', 'https://x.test/')
    expect(f.items[0].link).toBe('')
  })

  it('decodes entities and strips HTML', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &#39;d&#x27; &hellip; &unknown;')).toBe("a & b <c> 'd' … &unknown;")
    expect(htmlToText('<p>One<br/>Two</p><style>p{}</style>&nbsp;Three')).toBe('One Two  Three'.replace(/\s+/g, ' '))
    expect(parseXml('<a x="1" y=\'2\' z=3 />').children[0].attrs).toEqual({ x: '1', y: '2', z: '3' })
  })

  it('parses RFC 822 dates with named zones', () => {
    expect(parseDate('Fri, 25 Sep 2026 19:34:42 +0000')).toBe(Date.UTC(2026, 8, 25, 19, 34, 42))
    expect(parseDate('Fri, 25 Sep 2026 19:34:42 GMT')).toBe(Date.UTC(2026, 8, 25, 19, 34, 42))
    expect(parseDate('not a date')).toBeNull()
  })

  it('discovers feeds advertised by HTML pages', () => {
    const html = '<head><link rel="alternate" type="application/rss+xml" href="/feed.xml"><link rel="stylesheet" href="x.css"><link rel="alternate" type="application/atom+xml" href="https://b.test/atom"></head>'
    expect(discoverFeeds(html, 'https://a.test/blog/')).toEqual(['https://a.test/feed.xml', 'https://b.test/atom'])
  })
})
