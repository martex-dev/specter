import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { ImageOff } from 'lucide-react'
import { Seg } from '../../../components/ui'
import { newTab } from '../../../stores/browser'
import { CopyBtn, OpenFileBtn, Pane, useDebounced, useToolState } from '../ui'
import { textStats } from '../lib/text'

const SAMPLE = `# Markdown preview

Write **Markdown** on the left and see a *sanitized* preview on the right.

- [x] GitHub-flavoured task lists
- [ ] Tables, code and quotes

| Tool | Local |
| --- | --- |
| JSON | yes |
| Diff | yes |

\`\`\`js
const answer = 6 * 7
\`\`\`

> Scripts and event handlers are stripped. Remote images are blocked unless you allow them.

[SPECTER toolkit](specter://toolkit)
`

/** Renders Markdown to sanitized HTML. Remote images are replaced unless allowed. */
export function renderMarkdown(src: string, allowRemoteImages: boolean): { html: string; blocked: number } {
  const raw = marked.parse(src, { gfm: true, breaks: false, async: false }) as string
  let blocked = 0
  const hook = (node: Element) => {
    if (node.tagName === 'IMG') {
      const s = node.getAttribute('src') ?? ''
      if (!allowRemoteImages && !/^data:image\//i.test(s)) {
        blocked++
        const alt = node.getAttribute('alt') || 'image'
        node.removeAttribute('src')
        node.setAttribute('alt', `[${alt} — remote image blocked]`)
        node.setAttribute('data-blocked', s)
      }
    }
    if (node.tagName === 'A') node.setAttribute('rel', 'noopener noreferrer')
  }
  DOMPurify.addHook('afterSanitizeAttributes', hook)
  try {
    const html = DOMPurify.sanitize(raw, { FORBID_TAGS: ['style', 'form', 'button', 'iframe', 'object', 'embed', 'textarea', 'select'], FORBID_ATTR: ['style'], ADD_TAGS: [], ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|specter|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i })
    return { html, blocked }
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes')
  }
}

export default function MarkdownTool() {
  const [src, setSrc] = useToolState('md.src', SAMPLE)
  const [name, setName] = useToolState('md.name', '')
  const [mode, setMode] = useToolState<'split' | 'preview' | 'source'>('md.mode', 'split')
  const [remote, setRemote] = useToolState('md.remote', false)
  const deb = useDebounced(src, 60)
  const { html, blocked } = useMemo(() => renderMarkdown(deb, remote), [deb, remote])
  const stats = useMemo(() => textStats(deb), [deb])

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute('href') ?? ''
    if (href.startsWith('#')) {
      document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView()
      return
    }
    if (/^(https?|specter):/i.test(href)) newTab(href)
  }

  return (
    <div className="tk-body fill">
      <div className="tk-bar">
        <Seg value={mode} onChange={setMode} options={[{ value: 'split', label: 'Split' }, { value: 'source', label: 'Source' }, { value: 'preview', label: 'Preview' }]} />
        <OpenFileBtn
          onText={(t, n) => {
            setSrc(t)
            setName(n)
          }}
          filters={[{ name: 'Markdown', extensions: ['md', 'markdown', 'mdx', 'txt'] }, { name: 'All files', extensions: ['*'] }]}
        />
        <label className="row" style={{ gap: 6, fontSize: 12 }} data-tip="Remote images are fetched from their servers when allowed">
          <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} /> Load remote images
        </label>
        {blocked > 0 && (
          <span className="tk-note warn">
            <ImageOff size={12} /> {blocked} remote image{blocked > 1 ? 's' : ''} blocked
          </span>
        )}
        <span className="spacer" />
        <span className="tk-note mono">
          {name && `${name} · `}
          {stats.words.toLocaleString()} words · {Math.max(1, Math.round(stats.readingMinutes))} min read
        </span>
        <CopyBtn text={html} label="Copy HTML" />
      </div>
      <div className="tk-split" style={mode !== 'split' ? { gridTemplateColumns: 'minmax(0,1fr)' } : undefined}>
        {mode !== 'preview' && (
          <Pane label="Markdown">
            <textarea className="tk-editor wrap" value={src} onChange={(e) => setSrc(e.target.value)} spellCheck={false} placeholder="# Write Markdown…" aria-label="Markdown input" />
          </Pane>
        )}
        {mode !== 'source' && (
          <Pane label="Preview">
            <div className="md" style={{ padding: '4px 18px 18px' }} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
          </Pane>
        )}
      </div>
    </div>
  )
}
