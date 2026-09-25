// Omnibox providers: `@notes query` and low-score notes / research / knowledge
// suggestions for unscoped typing (≥ 3 characters).
import { FlaskConical, Library, NotebookPen, Plus } from 'lucide-react'
import { registerOmniboxProvider, type OmniItem } from '../../lib/omnibox'
import { invoke } from '../../lib/ipc'
import { newTab } from '../../stores/browser'
import { currentWorkspaceId, openInternal } from './lib'

const plain = (s: string) =>
  s
    .replace(/[\u0001\u0002]/g, '')
    .replace(/\*\*|__|\[\[|\]\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

function openInternalFrom(url: string, nt: boolean): void {
  if (nt) newTab(url)
  else openInternal(url)
}

export function registerKnowledgeOmnibox(): void {
  registerOmniboxProvider({
    id: 'knowledge.notes',
    scopes: ['notes', 'default'],
    async provide(text, scope) {
      const q = text.trim()
      const scoped = scope === 'notes'
      if (!scoped && q.length < 3) return []
      const out: OmniItem[] = []
      if (scoped && !q) {
        const recent = await invoke('notes:list', { limit: 8 }).catch(() => [])
        return recent.map((n, i) => ({
          id: 'note:' + n.id,
          kind: 'note',
          title: n.title || 'Untitled',
          subtitle: n.excerpt,
          icon: <NotebookPen size={15} />,
          score: 200 - i,
          run: ({ newTab: nt }) => openInternalFrom('specter://notes/' + n.id, nt)
        }))
      }
      const hits = await invoke('notes:search', q, scoped ? 12 : 2).catch(() => [])
      hits.forEach((h, i) =>
        out.push({
          id: 'note:' + h.id,
          kind: 'note',
          title: h.title,
          subtitle: plain(h.snippet),
          icon: <NotebookPen size={15} />,
          score: (scoped ? 200 : 26) - i,
          run: ({ newTab: nt }) => openInternalFrom('specter://notes/' + h.id, nt)
        })
      )
      if (scoped) {
        // Knowledge-base documents (pages, snippets, sources) — keyword only for speed.
        const kb = await invoke('knowledge:search', { text: q, limit: 6, mode: 'keyword' }).catch(() => null)
        kb?.hits
          .filter((h) => h.kind !== 'note')
          .forEach((h, i) =>
            out.push({
              id: 'kb:' + h.docId,
              kind: 'other',
              title: h.title,
              subtitle: 'Knowledge · ' + plain(h.snippet),
              icon: <Library size={15} />,
              score: 150 - i,
              run: ({ newTab: nt }) => openInternalFrom('specter://knowledge?doc=' + h.docId, nt)
            })
          )
        out.push({
          id: 'note:new',
          kind: 'command',
          title: `New note “${q}”`,
          icon: <Plus size={15} />,
          score: 10,
          run: async ({ newTab: nt }) => {
            const n = await invoke('notes:create', { title: q, body: '', workspaceId: currentWorkspaceId() })
            openInternalFrom('specter://notes/' + n.id, nt)
          }
        })
      }
      return out
    }
  })

  registerOmniboxProvider({
    id: 'knowledge.research',
    scopes: ['default'],
    async provide(text) {
      const q = text.trim()
      if (q.length < 3) return []
      const [research, kb] = await Promise.all([
        invoke('research:search', q, 2).catch(() => []),
        invoke('knowledge:search', { text: q, limit: 3, mode: 'keyword' }).catch(() => null)
      ])
      const out: OmniItem[] = research.map((r, i) => ({
        id: 'research:' + r.id,
        kind: 'other',
        title: r.title,
        subtitle: r.subtitle,
        icon: <FlaskConical size={15} />,
        score: 22 - i,
        run: ({ newTab: nt }) => (r.kind === 'source' && r.url ? (nt ? newTab(r.url) : openInternal('specter://research/' + r.missionId)) : openInternalFrom('specter://research/' + r.missionId, nt))
      }))
      kb?.hits
        .filter((h) => h.kind !== 'note')
        .slice(0, 1)
        .forEach((h) =>
          out.push({
            id: 'kb:' + h.docId,
            kind: 'other',
            title: h.title,
            subtitle: 'Knowledge base',
            icon: <Library size={15} />,
            score: 21,
            run: ({ newTab: nt }) => openInternalFrom('specter://knowledge?doc=' + h.docId, nt)
          })
        )
      return out
    }
  })
}
