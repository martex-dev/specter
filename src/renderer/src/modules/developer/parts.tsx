import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileDiff } from 'lucide-react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { DiffFile, DiffResult } from '@shared/modules/developer'
import { newTab } from '../../stores/browser'

// Diff viewer --------------------------------------------------------------------------------

const STATUS_BADGE: Record<DiffFile['status'], string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  mode: 'M'
}

const MAX_LINES_PER_FILE = 4000

function DiffFileView({ f, collapsible }: { f: DiffFile; collapsible: boolean }) {
  const [open, setOpen] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const total = f.hunks.reduce((n, h) => n + h.lines.length + 1, 0)
  let budget = showAll ? Infinity : MAX_LINES_PER_FILE
  const name = f.status === 'renamed' || f.status === 'copied' ? `${f.oldPath} → ${f.newPath}` : f.newPath
  return (
    <div className="diff-file">
      <div className="diff-file-h" onClick={() => collapsible && setOpen(!open)} style={{ cursor: collapsible ? 'default' : undefined }}>
        {collapsible && (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
        <span className={'gc-' + STATUS_BADGE[f.status]} style={{ fontWeight: 700 }}>
          {STATUS_BADGE[f.status]}
        </span>
        <span className="ellipsis grow" title={name}>
          {name}
        </span>
        {f.binary ? <span className="badge">binary</span> : null}
        <span className="up">+{f.additions}</span>
        <span className="down">−{f.deletions}</span>
      </div>
      {open && (
        <div className="diff-body">
          {f.binary ? (
            <div className="empty" style={{ padding: 16 }}>
              Binary file — no text diff
            </div>
          ) : f.hunks.length === 0 ? (
            <div className="empty" style={{ padding: 16 }}>
              {f.headers.find((h) => !h.startsWith('diff --git') && !h.startsWith('index ')) ?? (f.status === 'mode' ? 'File mode changed' : 'No textual changes')}
            </div>
          ) : (
            <table>
              <tbody>
                {f.hunks.map((h, hi) => {
                  if (budget <= 0) return null
                  const rows = h.lines.slice(0, Math.max(0, budget))
                  budget -= h.lines.length + 1
                  return [
                    <tr className="hunk" key={'h' + hi}>
                      <td className="no" />
                      <td className="no" />
                      <td className="sign" />
                      <td>{h.header}</td>
                    </tr>,
                    ...rows.map((l, li) => (
                      <tr key={hi + ':' + li} className={l.type}>
                        <td className="no">{l.oldNo ?? ''}</td>
                        <td className="no">{l.newNo ?? ''}</td>
                        <td className="sign">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ''}</td>
                        <td>{l.text || ' '}</td>
                      </tr>
                    ))
                  ]
                })}
              </tbody>
            </table>
          )}
          {!showAll && total > MAX_LINES_PER_FILE && (
            <div className="row" style={{ padding: 8, justifyContent: 'center' }}>
              <button className="btn sm" onClick={() => setShowAll(true)}>
                Show all {total.toLocaleString()} lines
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function DiffView({ diff, empty = 'No changes' }: { diff: DiffResult | null; empty?: string }) {
  if (!diff) return <div className="empty">Loading diff…</div>
  if (!diff.files.length)
    return (
      <div className="empty">
        <FileDiff size={22} />
        <div>{empty}</div>
      </div>
    )
  return (
    <div className="diff">
      {diff.truncated && <div className="badge warn" style={{ marginBottom: 8 }}>Diff truncated (larger than 3 MB)</div>}
      {diff.files.map((f, i) => (
        <DiffFileView key={i + f.newPath} f={f} collapsible={diff.files.length > 1} />
      ))}
    </div>
  )
}

// Markdown (sanitized) --------------------------------------------------------------------------

export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(source, { async: false, gfm: true }) as string
    const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe'], FORBID_ATTR: ['style'] })
    // Images are never fetched: local ones can't load from an internal page and
    // remote ones (badges…) would be network requests the user didn't ask for.
    const doc = new DOMParser().parseFromString(clean, 'text/html')
    doc.querySelectorAll('img').forEach((img) => {
      const alt = img.getAttribute('alt')?.trim()
      if (alt) {
        const span = doc.createElement('span')
        span.className = 'badge'
        span.textContent = alt
        img.replaceWith(span)
      } else img.remove()
    })
    doc.querySelectorAll('picture, source, video, audio').forEach((el) => el.remove())
    return doc.body.innerHTML
  }, [source])
  return (
    <div
      className="md"
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a')
        if (!a) return
        e.preventDefault()
        const href = a.getAttribute('href') ?? ''
        if (/^https?:\/\//i.test(href)) newTab(href)
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/** Renders a snippet with \u0001…\u0002 match markers. */
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0001[^\u0002]*\u0002)/)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('\u0001') ? (
          <mark key={i} className="dev-mark">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  )
}

export const LANG_COLORS = ['var(--accent)', 'var(--ok)', 'var(--warn)', 'var(--info)', 'var(--bad)', 'var(--ansi-5)', 'var(--ansi-6)', 'var(--fg-2)']
