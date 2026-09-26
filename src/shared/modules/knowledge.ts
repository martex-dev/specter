// Notes, Research & Knowledge — shared types, IPC contract augmentation and
// pure helpers (chunking, wiki-links, citations, ranking). Everything here is
// side-effect free so it can run in main, renderer and unit tests.

// ----------------------------------------------------------------- types

export interface NoteSummary {
  id: string
  title: string
  excerpt: string
  tags: string[]
  workspaceId: string | null
  missionId: string | null
  sourceUrl: string | null
  pinned: boolean
  createdAt: number
  updatedAt: number
}

export interface NoteFull extends NoteSummary {
  body: string
  /** Notes that link here with [[Title]]. */
  backlinks: { id: string; title: string; context: string }[]
  /** Outgoing wiki-links; id is null when the target note doesn't exist yet. */
  links: { title: string; id: string | null }[]
}

export interface NoteInput {
  title?: string
  body?: string
  tags?: string[]
  workspaceId?: string | null
  missionId?: string | null
  sourceUrl?: string | null
  pinned?: boolean
}

export interface NoteQuery {
  workspaceId?: string
  pinned?: boolean
  tag?: string
  missionId?: string
  sourceUrl?: string
  limit?: number
}

export interface NoteHit {
  id: string
  title: string
  snippet: string
  updatedAt: number
  pinned: boolean
}

export type StepState = 'todo' | 'doing' | 'done'
export interface MissionStep {
  id: string
  title: string
  state: StepState
}

export interface MissionSummary {
  id: string
  title: string
  description: string
  status: 'active' | 'archived'
  steps: MissionStep[]
  workspaceId: string | null
  createdAt: number
  updatedAt: number
  sourceCount: number
  claimCount: number
}

export interface ResearchSource {
  id: string
  missionId: string
  url: string
  title: string
  siteName: string
  author: string
  published: string
  excerpt: string
  /** Readable text captured at save time (empty when only the link was saved). */
  text: string
  tags: string[]
  addedAt: number
  accessedAt: number
}

export type ClaimStatus = 'unverified' | 'supported' | 'disputed'
export interface ResearchClaim {
  id: string
  missionId: string
  text: string
  status: ClaimStatus
  createdAt: number
}

export interface ResearchEvidence {
  id: string
  missionId: string
  claimId: string | null
  sourceId: string | null
  quote: string
  note: string
  createdAt: number
}

export interface ResearchQuestion {
  id: string
  missionId: string
  text: string
  answer: string
  state: 'open' | 'answered'
  createdAt: number
}

export interface ResearchSummary {
  id: string
  missionId: string
  /** 'ai' summaries are machine-generated and must be labelled as unverified. */
  kind: 'user' | 'ai'
  text: string
  model: string
  createdAt: number
}

export interface MissionFull extends MissionSummary {
  sources: ResearchSource[]
  claims: ResearchClaim[]
  evidence: ResearchEvidence[]
  questions: ResearchQuestion[]
  summaries: ResearchSummary[]
  notes: NoteSummary[]
}

export type ResearchItemInput =
  | { kind: 'source'; id?: string; missionId: string; url?: string; title?: string; siteName?: string; author?: string; published?: string; excerpt?: string; text?: string; tags?: string[] }
  | { kind: 'claim'; id?: string; missionId: string; text?: string; status?: ClaimStatus }
  | { kind: 'evidence'; id?: string; missionId: string; claimId?: string | null; sourceId?: string | null; quote?: string; note?: string }
  | { kind: 'question'; id?: string; missionId: string; text?: string; answer?: string; state?: 'open' | 'answered' }
  | { kind: 'summary'; id?: string; missionId: string; summaryKind?: 'user' | 'ai'; text?: string; model?: string }

export type ResearchItemKind = ResearchItemInput['kind']

export interface ResearchHit {
  kind: 'mission' | 'source'
  id: string
  missionId: string
  title: string
  subtitle: string
  url?: string
}

export type KbDocKind = 'page' | 'selection' | 'note' | 'snippet' | 'ai-summary' | 'source'

export interface KbDoc {
  id: string
  kind: KbDocKind
  title: string
  url: string
  workspaceId: string | null
  refId: string | null
  chars: number
  chunks: number
  embedded: number
  createdAt: number
  updatedAt: number
}

export interface KbDocFull extends KbDoc {
  text: string
}

export interface KbDocInput {
  kind: KbDocKind
  title: string
  text: string
  url?: string
  workspaceId?: string | null
  refId?: string | null
}

export interface ExtractedPage {
  url: string
  title: string
  text: string
  siteName: string
  author: string
  excerpt: string
  /** True when Readability found an article; false = raw visible text fallback. */
  readable: boolean
}

export interface KbHit {
  docId: string
  chunkId: number
  kind: KbDocKind
  title: string
  url: string
  refId: string | null
  /** Snippet; keyword matches are wrapped in \u0001…\u0002 markers. */
  snippet: string
  score: number
  keyword: number
  semantic: number
  matchedBy: 'keyword' | 'semantic' | 'both'
}

export interface KbSearchResult {
  mode: 'keyword' | 'hybrid'
  /** Why semantic search was not used (when mode = keyword). */
  reason?: string
  hits: KbHit[]
  tookMs: number
}

export interface SemanticStatus {
  enabled: boolean
  available: boolean
  model: string
  url: string
  reason: string
}

export interface KbStatus {
  notes: number
  missions: number
  sources: number
  docs: number
  chunks: number
  embedded: number
  pending: number
  semantic: SemanticStatus
  embedding: boolean
}

export type EntityType = 'Concept' | 'Company' | 'Project' | 'Technology' | 'Asset' | 'Document' | 'Person'
export type RelationType = 'RELATED_TO' | 'DEPENDS_ON' | 'MENTIONED_IN' | 'PART_OF'
export const ENTITY_TYPES: EntityType[] = ['Concept', 'Company', 'Project', 'Technology', 'Asset', 'Document', 'Person']
export const RELATION_TYPES: RelationType[] = ['RELATED_TO', 'DEPENDS_ON', 'MENTIONED_IN', 'PART_OF']

export interface KgEntity {
  id: string
  name: string
  type: EntityType
  description: string
  url: string
  createdAt: number
}

export interface KgRelation {
  id: string
  fromId: string
  toId: string
  type: RelationType
  createdAt: number
}

export interface KgGraph {
  entities: KgEntity[]
  relations: KgRelation[]
}

// ----------------------------------------------------------------- IPC contract

declare module '../ipc' {
  interface IpcContract {
    'notes:list': (q: NoteQuery) => NoteSummary[]
    'notes:get': (id: string) => NoteFull | null
    'notes:create': (input: NoteInput) => NoteFull
    'notes:update': (id: string, patch: NoteInput) => NoteFull | null
    'notes:delete': (id: string) => void
    'notes:search': (text: string, limit?: number) => NoteHit[]
    'notes:tags': () => { tag: string; count: number }[]
    'notes:titles': () => { id: string; title: string }[]
    'notes:findByTitle': (title: string) => string | null
    'notes:exportAll': (folder: string) => { count: number; folder: string }

    'research:missions': (includeArchived?: boolean) => MissionSummary[]
    'research:get': (id: string) => MissionFull | null
    'research:create': (input: { title: string; description?: string; steps?: string[]; workspaceId?: string | null }) => MissionSummary
    'research:update': (id: string, patch: { title?: string; description?: string; status?: 'active' | 'archived'; steps?: MissionStep[] }) => MissionSummary | null
    'research:delete': (id: string) => void
    'research:current': () => string | null
    'research:setCurrent': (id: string | null) => void
    'research:upsert': (item: ResearchItemInput) => { id: string }
    'research:remove': (kind: ResearchItemKind, id: string) => void
    'research:search': (text: string, limit?: number) => ResearchHit[]

    'knowledge:extract': (wcId: number) => ExtractedPage | null
    'knowledge:savePage': (wcId: number, workspaceId: string | null) => KbDoc
    'knowledge:saveDoc': (input: KbDocInput) => KbDoc
    'knowledge:docs': (q: { kind?: KbDocKind; limit?: number }) => KbDoc[]
    'knowledge:doc': (id: string) => KbDocFull | null
    'knowledge:deleteDoc': (id: string) => void
    'knowledge:search': (q: { text: string; limit?: number; mode?: 'auto' | 'keyword' }) => KbSearchResult
    'knowledge:status': () => KbStatus
    'knowledge:embedAll': () => { started: boolean; reason?: string }
    'knowledge:graph': () => KgGraph
    'knowledge:saveEntity': (e: { id?: string; name: string; type: EntityType; description?: string; url?: string }) => KgEntity
    'knowledge:deleteEntity': (id: string) => void
    'knowledge:saveRelation': (r: { fromId: string; toId: string; type: RelationType }) => KgRelation
    'knowledge:deleteRelation': (id: string) => void
  }
  interface IpcEvents {
    'notes:changed': { id?: string }
    'research:changed': { missionId?: string }
    'knowledge:changed': { docId?: string }
    'knowledge:progress': { pending: number; done: number; running: boolean; error?: string }
  }
}

// ----------------------------------------------------------------- constants

export const DEFAULT_MISSION_STEPS = ['Overview', 'Recent developments', 'Financials', 'Competitors', 'Risks', 'Technology', 'Final report']

// ----------------------------------------------------------------- text helpers

/** Normalizes extracted page text: trims lines, collapses runs of blank lines and spaces. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v  ]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Splits text into ~size-character chunks with `overlap` characters shared
 * between neighbours. Breaks prefer paragraph, then sentence, then word
 * boundaries so chunks stay readable.
 */
export function chunkText(input: string, size = 800, overlap = 150): string[] {
  const text = normalizeText(input)
  if (!text) return []
  if (text.length <= size) return [text]
  overlap = Math.max(0, Math.min(overlap, Math.floor(size / 2)))
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(text.length, start + size)
    if (end < text.length) {
      const window = text.slice(start, end)
      const min = Math.floor(size * 0.5)
      const para = window.lastIndexOf('\n\n')
      const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '), window.lastIndexOf('.\n'))
      const line = window.lastIndexOf('\n')
      const space = window.lastIndexOf(' ')
      const cut = para >= min ? para : sentence >= min ? sentence + 1 : line >= min ? line : space >= min ? space : -1
      if (cut > 0) end = start + cut
    }
    const piece = text.slice(start, end).trim()
    if (piece) chunks.push(piece)
    if (end >= text.length) break
    let next = end - overlap
    if (next <= start) next = end
    // Start the overlap on a word boundary.
    const sp = text.indexOf(' ', next)
    if (sp !== -1 && sp < end) next = sp + 1
    start = next
  }
  return chunks
}

// ----------------------------------------------------------------- wiki links

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase()
}

const WIKI_RE = /\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]+?))?\]\]/g
const CODE_RE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g

/** Runs `fn` on the parts of markdown outside fenced/inline code. */
function mapOutsideCode(md: string, fn: (s: string) => string): string {
  let out = ''
  let last = 0
  for (const m of md.matchAll(CODE_RE)) {
    out += fn(md.slice(last, m.index)) + m[0]
    last = (m.index ?? 0) + m[0].length
  }
  return out + fn(md.slice(last))
}

/** Extracts [[Note title]] / [[Note title|alias]] targets (unique, in order). Ignores code. */
export function parseWikiLinks(md: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  mapOutsideCode(md, (s) => {
    for (const m of s.matchAll(WIKI_RE)) {
      const title = m[1].trim().replace(/\s+/g, ' ')
      const key = normalizeTitle(title)
      if (title && !seen.has(key)) {
        seen.add(key)
        out.push(title)
      }
    }
    return s
  })
  return out
}

/** Replaces wiki-links outside code using `render(title, label)`. */
export function replaceWikiLinks(md: string, render: (title: string, label: string) => string): string {
  return mapOutsideCode(md, (s) => s.replace(WIKI_RE, (_m, t: string, alias?: string) => render(t.trim().replace(/\s+/g, ' '), (alias ?? t).trim())))
}

/** A short line of context around the first link to `title` (for "Linked from"). */
export function linkContext(md: string, title: string, max = 140): string {
  const key = normalizeTitle(title)
  for (const line of md.split('\n')) {
    for (const m of line.matchAll(WIKI_RE)) {
      if (normalizeTitle(m[1]) === key) {
        const plain = line
          .replace(WIKI_RE, (_x, t: string, a?: string) => (a ?? t).trim())
          .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
          .replace(/(\*\*|__|~~|`)/g, '')
          .replace(/^[#>*\-+\s]+|^\d+\.\s+/g, '')
          .trim()
        return plain.length > max ? plain.slice(0, max - 1) + '…' : plain
      }
    }
  }
  return ''
}

/** Plain-text excerpt of markdown (for lists). */
export function excerptOf(md: string, max = 160): string {
  const plain = replaceWikiLinks(md, (_t, label) => label)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > max ? plain.slice(0, max - 1) + '…' : plain
}

/** Parses "a, b #c" into unique lowercase-trimmed tags. */
export function parseTags(input: string): string[] {
  const seen = new Set<string>()
  return input
    .split(/[,\s]+/)
    .map((t) => t.replace(/^#/, '').trim().toLowerCase())
    .filter((t) => t && t.length <= 48 && !seen.has(t) && (seen.add(t), true))
}

/**
 * A file name (without extension) that is valid on Windows, macOS and Linux:
 * illegal characters replaced, no trailing dots/spaces and no reserved device
 * names (CON, NUL, COM1…), which Windows refuses even with an extension.
 */
export function safeFileName(name: string, max = 120): string {
  const base =
    (name || 'Untitled')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
      .replace(/[. ]+$/, '') || 'Untitled'
  return /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i.test(base) ? '_' + base : base
}

/** Markdown with YAML front matter (used for export). */
export function noteToMarkdown(n: { title: string; body: string; tags: string[]; createdAt: number; updatedAt: number; sourceUrl: string | null }): string {
  const fm = ['---', `title: ${JSON.stringify(n.title || 'Untitled')}`]
  if (n.tags.length) fm.push(`tags: [${n.tags.map((t) => JSON.stringify(t)).join(', ')}]`)
  if (n.sourceUrl) fm.push(`source: ${JSON.stringify(n.sourceUrl)}`)
  fm.push(`created: ${new Date(n.createdAt).toISOString()}`, `updated: ${new Date(n.updatedAt).toISOString()}`, '---', '')
  return fm.join('\n') + n.body.replace(/\s+$/, '') + '\n'
}

// ----------------------------------------------------------------- citations

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function fmtDate(ts: number): string {
  const d = new Date(ts)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

/** "2024-03-05" / ISO strings → "2024, March 5"; year-only stays; unparsable → as given. */
export function formatPublished(published: string): string {
  const p = published.trim()
  if (!p) return 'n.d.'
  if (/^\d{4}$/.test(p)) return p
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(p)
  if (m) {
    const month = MONTHS[Number(m[2]) - 1]
    if (!month) return m[1]
    return m[3] ? `${m[1]}, ${month} ${Number(m[3])}` : `${m[1]}, ${month}`
  }
  return p
}

export interface CitationSource {
  url: string
  title: string
  siteName?: string
  author?: string
  published?: string
  accessedAt: number
}

function siteFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function endDot(s: string): string {
  return /[.?!]$/.test(s) ? s : s + '.'
}

/**
 * APA-style web citation:
 *   Author. (Published). Title. Site. Retrieved Month D, YYYY, from URL
 * Without an author the title moves to the author position (APA 7).
 */
export function formatCitation(s: CitationSource): string {
  const title = (s.title || s.url).trim()
  const site = (s.siteName || siteFromUrl(s.url)).trim()
  const author = (s.author ?? '').trim().replace(/^by\s+/i, '')
  const date = `(${formatPublished(s.published ?? '')}).`
  const parts: string[] = []
  if (author) parts.push(endDot(author), date, endDot(title))
  else parts.push(endDot(title), date)
  if (site && site.toLowerCase() !== author.toLowerCase() && site.toLowerCase() !== title.toLowerCase()) parts.push(endDot(site))
  parts.push(`Retrieved ${fmtDate(s.accessedAt)}, from ${s.url}`)
  return parts.join(' ')
}

/** Citation list sorted alphabetically (APA reference list order). */
export function formatCitationList(sources: CitationSource[]): string[] {
  return sources
    .filter((s) => s.url)
    .map(formatCitation)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

// ----------------------------------------------------------------- ranking

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length)
  if (!n) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export interface RankInput {
  /** FTS5 bm25() values (lower = better; typically negative). */
  keyword: { id: number; bm25: number }[]
  /** Cosine similarities. */
  semantic: { id: number; cos: number }[]
}

export interface Ranked {
  id: number
  score: number
  keyword: number
  semantic: number
}

/**
 * Hybrid ranking: keyword bm25 is min-max normalised into [0,1] (best = 1),
 * cosine similarity is rescaled from [minCos,1] into [0,1]; the final score is
 * a weighted sum (alpha = semantic weight). Semantic-only hits below minCos
 * are dropped. With no semantic input this is pure keyword ranking.
 */
export function hybridRank(input: RankInput, alpha = 0.5, minCos = 0.4): Ranked[] {
  const out = new Map<number, Ranked>()
  const kws = input.keyword.map((k) => -k.bm25)
  const kmax = kws.length ? Math.max(...kws) : 0
  const kmin = kws.length ? Math.min(...kws) : 0
  const useSemantic = input.semantic.length > 0
  const wk = useSemantic ? 1 - alpha : 1
  input.keyword.forEach((k, i) => {
    const norm = kmax === kmin ? 1 : (kws[i] - kmin) / (kmax - kmin)
    // Keep every keyword hit above zero so it outranks nothing-matches.
    const kn = 0.2 + 0.8 * norm
    out.set(k.id, { id: k.id, keyword: kn, semantic: 0, score: wk * kn })
  })
  if (useSemantic) {
    for (const s of input.semantic) {
      const sn = s.cos <= minCos ? 0 : (s.cos - minCos) / (1 - minCos)
      const cur = out.get(s.id)
      if (cur) {
        cur.semantic = sn
        cur.score += alpha * sn
      } else if (sn > 0) {
        out.set(s.id, { id: s.id, keyword: 0, semantic: sn, score: alpha * sn })
      }
    }
  }
  return [...out.values()].sort((a, b) => b.score - a.score)
}

/** Top-k by cosine similarity (brute force). */
export function topKCosine(query: ArrayLike<number>, vectors: { id: number; vec: ArrayLike<number> }[], k: number): { id: number; cos: number }[] {
  return vectors
    .map((v) => ({ id: v.id, cos: cosine(query, v.vec) }))
    .sort((a, b) => b.cos - a.cos)
    .slice(0, k)
}

const STOP_WORDS = new Set(
  'the and for are but not you all any can had her was one our out has him his how its may new now old see two who did get let say she too use what when where which why with this that from they them then than there these those into about your have been will would could should does just like some more most much very also only other over such each both were'.split(' ')
)

/**
 * Safe FTS5 query from free text. `any` joins terms with OR (last term is a
 * prefix) and drops short / stop words so they don't dominate loose matches.
 */
export function ftsMatch(text: string, any = false): string {
  const tokens = text
    .replace(/["'`]/g, ' ')
    .split(/[\s\p{P}]+/u)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12)
  if (!tokens.length) return ''
  const useful = any ? tokens.filter((t) => t.length > 2 && !STOP_WORDS.has(t.toLowerCase())) : tokens
  const list = useful.length ? useful : tokens
  return list.map((t, i) => `"${t}"${i === list.length - 1 ? '*' : ''}`).join(any ? ' OR ' : ' ')
}
