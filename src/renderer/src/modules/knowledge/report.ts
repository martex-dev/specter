// Markdown report + citation helpers for research missions.
import { formatCitation, type MissionFull } from '@shared/modules/knowledge'

export function citationsFor(m: MissionFull): { id: string; n: number; text: string }[] {
  // Numbered in the order sources were added (oldest first) so numbers stay stable.
  return [...m.sources]
    .sort((a, b) => a.addedAt - b.addedAt)
    .map((s, i) => ({ id: s.id, n: i + 1, text: formatCitation({ url: s.url, title: s.title, siteName: s.siteName, author: s.author, published: s.published, accessedAt: s.accessedAt }) }))
}

export function missionReport(m: MissionFull): string {
  const cites = citationsFor(m)
  const num = new Map(cites.map((c) => [c.id, c.n]))
  const out: string[] = [`# ${m.title}`, '']
  if (m.description.trim()) out.push(m.description.trim(), '')
  out.push(`_Research report exported from SPECTER on ${new Date().toLocaleString()}. Quotes are taken verbatim from the saved sources. Sections marked “AI-generated” were produced by a local model and are unverified._`, '')

  out.push('## Progress', '')
  for (const s of m.steps) out.push(`- [${s.state === 'done' ? 'x' : ' '}] ${s.title}${s.state === 'doing' ? ' _(in progress)_' : ''}`)
  out.push('')

  const user = m.summaries.filter((s) => s.kind === 'user')
  const ai = m.summaries.filter((s) => s.kind === 'ai')
  if (user.length || ai.length) {
    out.push('## Summary', '')
    for (const s of user) out.push(s.text.trim(), '')
    for (const s of ai) out.push(`> **AI-generated (unverified${s.model ? `, ${s.model}` : ''})**`, ...s.text.trim().split('\n').map((l) => '> ' + l), '')
  }

  if (m.claims.length) {
    out.push('## Claims & evidence', '')
    for (const c of m.claims) {
      out.push(`### ${c.text} — _${c.status}_`, '')
      const ev = m.evidence.filter((e) => e.claimId === c.id)
      if (!ev.length) out.push('_No evidence recorded yet._', '')
      for (const e of ev) {
        const ref = e.sourceId && num.has(e.sourceId) ? ` [${num.get(e.sourceId)}]` : ''
        out.push(`> ${e.quote.replace(/\n/g, ' ')}${ref}`, '')
        if (e.note) out.push(`${e.note}`, '')
      }
    }
  }

  const loose = m.evidence.filter((e) => !e.claimId)
  if (loose.length) {
    out.push('## Unassigned evidence', '')
    for (const e of loose) out.push(`> ${e.quote.replace(/\n/g, ' ')}${e.sourceId && num.has(e.sourceId) ? ` [${num.get(e.sourceId)}]` : ''}`, '')
  }

  if (m.questions.length) {
    out.push('## Questions', '')
    for (const q of m.questions) out.push(`- ${q.state === 'answered' ? '✔' : '?'} **${q.text}**${q.answer ? ` — ${q.answer}` : ''}`)
    out.push('')
  }

  if (cites.length) {
    out.push('## References', '')
    for (const c of cites) out.push(`${c.n}. ${c.text}`)
    out.push('')
  }
  return out.join('\n')
}

/** Text handed to the AI module for an optional summary (bounded size). */
export function aiContext(m: MissionFull, max = 12000): string {
  const parts: string[] = [`Research topic: ${m.title}`, m.description]
  for (const c of m.claims) parts.push(`Claim (${c.status}): ${c.text}`)
  for (const s of m.sources) {
    const body = (s.text || s.excerpt || '').slice(0, 1800)
    parts.push(`Source: ${s.title} (${s.url})\n${body}`)
  }
  const text = parts.filter(Boolean).join('\n\n')
  return text.length > max ? text.slice(0, max) : text
}
