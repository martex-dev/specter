// Sanitised markdown for AI answers. Model output is untrusted: no images,
// media, forms or styles (they could leak context through remote URLs), and
// links only open in a new tab after an explicit click.
import { memo, useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { AiContextMeta } from '@shared/modules/ai'

const FORBID_TAGS = ['img', 'picture', 'source', 'video', 'audio', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'style', 'link', 'meta', 'svg', 'math', 'base']

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function renderMarkdown(src: string, cites: AiContextMeta[] = []): string {
  let html: string
  try {
    html = marked.parse(src, { async: false, gfm: true, breaks: false }) as string
  } catch {
    html = '<p>' + escapeHtml(src) + '</p>'
  }
  const clean = DOMPurify.sanitize(html, { FORBID_TAGS, FORBID_ATTR: ['style', 'srcset', 'src', 'action', 'formaction', 'ping'], ALLOW_DATA_ATTR: false })
  const byId = new Map(cites.map((c) => [c.id, c]))
  // Citation badges ([C1], [A2]) outside tags and code. Our own markup, built from escaped values.
  let inCode = 0
  const withCites = clean.replace(/(<\/?(?:code|pre)\b[^>]*>)|(<[^>]+>)|\[((?:C|A)\d{1,2}(?:\s*,\s*(?:C|A)\d{1,2})*)\]/g, (m, codeTag: string, tag: string, ids: string) => {
    if (codeTag) {
      inCode += codeTag.startsWith('</') ? -1 : 1
      return m
    }
    if (tag || inCode > 0) return m
    return ids
      .split(/\s*,\s*/)
      .map((id) => {
        const c = byId.get(id)
        const tip = c ? `${c.label}${c.url ? ' — ' + c.url : ''}` : id
        return `<span class="ai-cite" data-tip="${escapeHtml(tip)}">${escapeHtml(id)}</span>`
      })
      .join('')
  })
  // Copy buttons for code blocks.
  return withCites.replace(/<pre>/g, '<pre class="ai-pre"><span class="ai-copy" role="button" title="Copy code">Copy</span>')
}

export const Markdown = memo(function Markdown({ text, cites, streaming }: { text: string; cites?: AiContextMeta[]; streaming?: boolean }) {
  const html = useMemo(() => renderMarkdown(text, cites), [text, cites])
  return <div className={'md ai-md' + (streaming ? ' streaming' : '')} dangerouslySetInnerHTML={{ __html: html }} />
})
