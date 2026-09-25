import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import { Seg } from '../../../components/ui'
import { CopyBtn, ErrorNote, OpenFileBtn, Pane, useDebounced, useToolState } from '../ui'

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:dc="http://purl.org/dc/elements/1.1/">
  <book id="bk101" lang="en">
    <dc:title>XML Developer's Guide</dc:title>
    <price currency="USD">44.95</price>
  </book>
  <book id="bk102">
    <dc:title>Midnight Rain</dc:title>
    <price currency="EUR">5.95</price>
    <!-- out of print -->
  </book>
</catalog>`

type Parsed = { ok: true; doc: Document; elements: number; depth: number } | { ok: false; error: string }

function parseXml(src: string): Parsed {
  const doc = new DOMParser().parseFromString(src, 'application/xml')
  const err = doc.getElementsByTagName('parsererror')[0]
  if (err) {
    const text = (err.textContent ?? 'Invalid XML').replace(/^This page contains the following errors:/, '').replace(/Below is a rendering of the page up to the first error\.?/, '').trim()
    return { ok: false, error: text }
  }
  let elements = 0
  let depth = 0
  const walk = (el: Element, d: number) => {
    elements++
    depth = Math.max(depth, d)
    for (const c of Array.from(el.children)) walk(c, d + 1)
  }
  if (doc.documentElement) walk(doc.documentElement, 1)
  return { ok: true, doc, elements, depth }
}

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s: string) => escText(s).replace(/"/g, '&quot;')

/** Pretty-prints a DOM tree; text-only elements stay on one line. */
function pretty(doc: Document, indent: string): string {
  const out: string[] = []
  const decl = /^<\?xml[^>]*\?>/.exec((doc as unknown as { __src?: string }).__src ?? '')
  if (decl) out.push(decl[0])
  const node = (n: Node, lvl: number) => {
    const pad = indent.repeat(lvl)
    if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as Element
      const attrs = Array.from(el.attributes)
        .map((a) => ` ${a.name}="${escAttr(a.value)}"`)
        .join('')
      const kids = Array.from(el.childNodes).filter((c) => !(c.nodeType === Node.TEXT_NODE && !c.textContent?.trim()))
      if (!kids.length) out.push(`${pad}<${el.tagName}${attrs}/>`)
      else if (kids.length === 1 && kids[0].nodeType === Node.TEXT_NODE) out.push(`${pad}<${el.tagName}${attrs}>${escText(kids[0].textContent!.trim())}</${el.tagName}>`)
      else {
        out.push(`${pad}<${el.tagName}${attrs}>`)
        kids.forEach((k) => node(k, lvl + 1))
        out.push(`${pad}</${el.tagName}>`)
      }
    } else if (n.nodeType === Node.TEXT_NODE) out.push(pad + escText(n.textContent!.trim()))
    else if (n.nodeType === Node.CDATA_SECTION_NODE) out.push(`${pad}<![CDATA[${n.textContent}]]>`)
    else if (n.nodeType === Node.COMMENT_NODE) out.push(`${pad}<!--${n.textContent}-->`)
    else if (n.nodeType === Node.PROCESSING_INSTRUCTION_NODE) out.push(`${pad}<?${(n as ProcessingInstruction).target} ${(n as ProcessingInstruction).data}?>`)
  }
  Array.from(doc.childNodes).forEach((c) => (c.nodeType === Node.DOCUMENT_TYPE_NODE ? out.push(new XMLSerializer().serializeToString(c)) : node(c, 0)))
  return out.join('\n')
}

function XNode({ n, depth, openDepth }: { n: Node; depth: number; openDepth: number }) {
  const [open, setOpen] = useState(depth < openDepth)
  useEffect(() => setOpen(depth < openDepth), [openDepth, depth])
  const pad = { paddingLeft: depth * 14 }
  if (n.nodeType === Node.TEXT_NODE || n.nodeType === Node.CDATA_SECTION_NODE) {
    const t = n.textContent?.trim()
    if (!t) return null
    return (
      <div className="tk-j-row" style={{ ...pad, paddingLeft: depth * 14 + 16, whiteSpace: 'pre-wrap' }}>
        <span className="tk-x-text">{t}</span>
      </div>
    )
  }
  if (n.nodeType === Node.COMMENT_NODE)
    return (
      <div className="tk-j-row" style={{ paddingLeft: depth * 14 + 16 }}>
        <span className="dim">&lt;!--{n.textContent}--&gt;</span>
      </div>
    )
  if (n.nodeType !== Node.ELEMENT_NODE) return null
  const el = n as Element
  const kids = Array.from(el.childNodes).filter((c) => !(c.nodeType === Node.TEXT_NODE && !c.textContent?.trim()))
  const inlineText = kids.length === 1 && kids[0].nodeType === Node.TEXT_NODE ? kids[0].textContent!.trim() : null
  const attrs = Array.from(el.attributes).map((a) => (
    <span key={a.name}>
      {' '}
      <span className="tk-x-attr">{a.name}</span>
      <span className="dim">=</span>
      <span className="tk-x-val">"{a.value}"</span>
    </span>
  ))
  if (!kids.length || inlineText !== null)
    return (
      <div className="tk-j-row" style={{ paddingLeft: depth * 14 + 16, whiteSpace: 'pre-wrap' }}>
        <span className="tk-x-tag">&lt;{el.tagName}</span>
        {attrs}
        <span className="tk-x-tag">{inlineText === null ? '/>' : '>'}</span>
        {inlineText !== null && (
          <>
            <span className="tk-x-text">{inlineText}</span>
            <span className="tk-x-tag">&lt;/{el.tagName}&gt;</span>
          </>
        )}
      </div>
    )
  return (
    <>
      <div className="tk-j-row tk-j-branch" style={pad} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="tk-x-tag">&lt;{el.tagName}</span>
        {attrs}
        <span className="tk-x-tag">&gt;</span>
        {!open && <span className="tk-j-count">{el.children.length} children</span>}
      </div>
      {open && kids.map((k, i) => <XNode key={i} n={k} depth={depth + 1} openDepth={openDepth} />)}
      {open && (
        <div className="tk-j-row" style={{ paddingLeft: depth * 14 + 16 }}>
          <span className="tk-x-tag">&lt;/{el.tagName}&gt;</span>
        </div>
      )}
    </>
  )
}

export default function XmlTool() {
  const [src, setSrc] = useToolState('xml.src', SAMPLE)
  const [view, setView] = useToolState<'tree' | 'pretty'>('xml.view', 'tree')
  const [xpath, setXpath] = useToolState('xml.xpath', '')
  const [depth, setDepth] = useState(3)
  const deb = useDebounced(src, 100)
  const parsed = useMemo(() => {
    if (!deb.trim()) return null
    const p = parseXml(deb)
    if (p.ok) (p.doc as unknown as { __src?: string }).__src = deb.trimStart()
    return p
  }, [deb])
  const prettyText = useMemo(() => (parsed?.ok ? pretty(parsed.doc, '  ') : ''), [parsed])

  const xpathResult = useMemo(() => {
    if (!xpath.trim() || !parsed?.ok) return null
    try {
      const doc = parsed.doc
      const ns = (prefix: string | null) => doc.documentElement.lookupNamespaceURI(prefix)
      const r = doc.evaluate(xpath, doc, ns, XPathResult.ANY_TYPE, null)
      if (r.resultType === XPathResult.NUMBER_TYPE) return { values: [String(r.numberValue)] }
      if (r.resultType === XPathResult.STRING_TYPE) return { values: [r.stringValue] }
      if (r.resultType === XPathResult.BOOLEAN_TYPE) return { values: [String(r.booleanValue)] }
      const values: string[] = []
      let n = r.iterateNext()
      while (n && values.length < 200) {
        values.push(n.nodeType === Node.ELEMENT_NODE ? new XMLSerializer().serializeToString(n) : (n.textContent ?? ''))
        n = r.iterateNext()
      }
      return { values }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }, [xpath, parsed])

  return (
    <div className="tk-body fill">
      <div className="tk-bar">
        <OpenFileBtn onText={(t) => setSrc(t)} filters={[{ name: 'XML', extensions: ['xml', 'svg', 'rss', 'atom', 'xsd', 'xsl', 'plist', 'config', 'csproj'] }, { name: 'All files', extensions: ['*'] }]} />
        <button className="btn sm" disabled={!parsed?.ok} onClick={() => setSrc(prettyText)}>
          Format input
        </button>
        <button className="btn sm ghost" onClick={() => setSrc('')}>
          Clear
        </button>
        <span className="tk-sep" />
        <input className="input mono" style={{ width: 280 }} placeholder="XPath, e.g. //book/@id" value={xpath} onChange={(e) => setXpath(e.target.value)} aria-label="XPath query" />
      </div>
      <div className="tk-split">
        <Pane label="XML">
          <textarea className="tk-editor" value={src} onChange={(e) => setSrc(e.target.value)} spellCheck={false} placeholder="Paste XML…" aria-label="XML input" />
          {parsed && !parsed.ok && (
            <ErrorNote>
              <AlertCircle size={12} style={{ verticalAlign: -2, marginRight: 6 }} />
              {parsed.error}
            </ErrorNote>
          )}
          {parsed?.ok && (
            <div className="tk-ok">
              <span className="ok row" style={{ gap: 4 }}>
                <CheckCircle2 size={12} /> Well-formed
              </span>
              <span>root &lt;{parsed.doc.documentElement.tagName}&gt;</span>
              <span>{parsed.elements} elements</span>
              <span>depth {parsed.depth}</span>
            </div>
          )}
        </Pane>
        <Pane
          label={<Seg value={view} onChange={setView} options={[{ value: 'tree', label: 'Tree' }, { value: 'pretty', label: 'Formatted' }]} />}
          actions={
            <>
              {view === 'tree' && (
                <>
                  <button className="btn sm ghost" onClick={() => setDepth(99)}>
                    Expand all
                  </button>
                  <button className="btn sm ghost" onClick={() => setDepth(1)}>
                    Collapse
                  </button>
                </>
              )}
              <CopyBtn text={prettyText} disabled={!prettyText} label="Copy" />
            </>
          }
        >
          {xpathResult && (
            <div style={{ borderBottom: '1px solid var(--line)', maxHeight: '40%', overflow: 'auto', flex: 'none' }}>
              {'error' in xpathResult ? (
                <ErrorNote>{xpathResult.error}</ErrorNote>
              ) : (
                <div className="mono selectable" style={{ fontSize: 12, padding: '6px 12px' }}>
                  <div className="label" style={{ marginBottom: 4 }}>
                    {xpathResult.values!.length} result{xpathResult.values!.length === 1 ? '' : 's'}
                  </div>
                  {xpathResult.values!.map((v, i) => (
                    <div key={i} style={{ whiteSpace: 'pre-wrap', padding: '2px 0', borderTop: i ? '1px solid var(--line)' : undefined }}>
                      {v}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {!parsed ? (
            <div className="empty">Paste or open an XML file.</div>
          ) : !parsed.ok ? (
            <div className="empty">Fix the error to see the tree.</div>
          ) : view === 'tree' ? (
            <div className="tk-json-tree mono selectable">
              <XNode n={parsed.doc.documentElement} depth={0} openDepth={depth} />
            </div>
          ) : (
            <textarea className="tk-editor" readOnly value={prettyText} aria-label="Formatted XML" />
          )}
        </Pane>
      </div>
    </div>
  )
}
