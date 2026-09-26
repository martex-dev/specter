// Markdown rendering (marked + DOMPurify) — loaded only with the note editor.
import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import { replaceWikiLinks } from '@shared/modules/knowledge'
import { openUrl } from './lib'

const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    // `- [ ]` / `- [x]` task items: <input> is sanitized away below, so draw a plain marker instead.
    checkbox({ checked }) {
      return `<span class="kn-task${checked ? ' done' : ''}" aria-hidden="true">${checked ? '☑' : '☐'}</span> `
    }
  }
})

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/**
 * Markdown → sanitized HTML. [[Wiki links]] become `#wiki:` anchors; `exists`
 * marks links whose target note is missing.
 */
export function renderMarkdown(src: string, exists?: (title: string) => boolean): string {
  const withLinks = replaceWikiLinks(src, (title, label) => {
    const missing = exists && !exists(title) ? ' missing' : ''
    return `<a href="#wiki:${encodeURIComponent(title)}" class="kn-wikilink${missing}">${escapeHtml(label)}</a>`
  })
  const html = md.parse(withLinks, { async: false }) as string
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'input', 'button'] })
}

/** Click handler for rendered markdown: wiki links open notes, web links open tabs. */
export function onMarkdownClick(e: React.MouseEvent, openWiki: (title: string) => void): void {
  const a = (e.target as HTMLElement).closest('a') as HTMLAnchorElement | null
  if (!a) return
  e.preventDefault()
  const href = a.getAttribute('href') ?? ''
  if (href.startsWith('#wiki:')) return openWiki(decodeURIComponent(href.slice(6)))
  if (/^https?:\/\//i.test(href)) openUrl(href, true)
}

