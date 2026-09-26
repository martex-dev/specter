// Research graph: Source → Claim → Evidence, drawn as a clean layered SVG.
import { useMemo, useState } from 'react'
import type { MissionFull } from '@shared/modules/knowledge'
import { citationsFor } from './report'

const COL_W = 250
const GAP = 110
const ROW_H = 44
const NODE_H = 32
const PAD = 16

function trunc(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

type Node = { id: string; col: 0 | 1 | 2; y: number; label: string; full: string; kind: 'source' | 'claim' | 'evidence'; status?: string }

export function ResearchGraph({ mission, onSelect }: { mission: MissionFull; onSelect?: (kind: Node['kind'], id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null)
  const { nodes, edges, height } = useMemo(() => {
    // Same S-numbers as the Sources tab and citations (oldest source = S1).
    const srcIndex = new Map(citationsFor(mission).map((c) => [c.id, c.n]))
    // Order evidence by claim so edges don't cross much.
    const claimOrder = new Map(mission.claims.map((c, i) => [c.id, i]))
    const evidence = [...mission.evidence].sort((a, b) => (claimOrder.get(a.claimId ?? '') ?? 1e9) - (claimOrder.get(b.claimId ?? '') ?? 1e9))
    // Order sources by the first claim they support.
    const firstClaim = new Map<string, number>()
    for (const e of evidence) if (e.sourceId && e.claimId && !firstClaim.has(e.sourceId)) firstClaim.set(e.sourceId, claimOrder.get(e.claimId) ?? 1e9)
    const sources = [...mission.sources].sort((a, b) => (firstClaim.get(a.id) ?? 1e9) - (firstClaim.get(b.id) ?? 1e9))
    const rows = Math.max(sources.length, mission.claims.length, evidence.length, 1)
    const h = PAD * 2 + 28 + rows * ROW_H
    const place = (count: number, i: number) => PAD + 28 + (rows - count) * (ROW_H / 2) + i * ROW_H
    const nodes: Node[] = [
      ...sources.map((s, i): Node => ({ id: s.id, col: 0, y: place(sources.length, i), label: `S${srcIndex.get(s.id)} · ${trunc(s.title || s.url, 36)}`, full: `${s.title}\n${s.url}`, kind: 'source' })),
      ...mission.claims.map((c, i): Node => ({ id: c.id, col: 1, y: place(mission.claims.length, i), label: trunc(c.text, 40), full: `${c.text}\n(${c.status})`, kind: 'claim', status: c.status })),
      ...evidence.map((e, i): Node => ({
        id: e.id,
        col: 2,
        y: place(evidence.length, i),
        label: `“${trunc(e.quote, 34)}”${e.sourceId && srcIndex.has(e.sourceId) ? ` S${srcIndex.get(e.sourceId)}` : ''}`,
        full: e.quote + (e.note ? `\n— ${e.note}` : ''),
        kind: 'evidence'
      }))
    ]
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const edges: { from: Node; to: Node; dashed?: boolean; key: string }[] = []
    const seen = new Set<string>()
    for (const e of evidence) {
      const ev = byId.get(e.id)!
      const claim = e.claimId ? byId.get(e.claimId) : undefined
      const src = e.sourceId ? byId.get(e.sourceId) : undefined
      if (claim) edges.push({ from: claim, to: ev, key: 'ce' + e.id })
      if (src && claim) {
        const k = src.id + claim.id
        if (!seen.has(k)) {
          seen.add(k)
          edges.push({ from: src, to: claim, key: 'sc' + k })
        }
      }
      // Evidence not yet attached to a claim: link straight to its source.
      if (src && !claim) edges.push({ from: src, to: ev, dashed: true, key: 'se' + e.id })
    }
    return { nodes, edges, height: h }
  }, [mission])

  const width = PAD * 2 + COL_W * 3 + GAP * 2
  const x = (col: number) => PAD + col * (COL_W + GAP)
  const related = useMemo(() => {
    if (!hover) return null
    const s = new Set<string>([hover])
    for (const e of edges) {
      if (e.from.id === hover) s.add(e.to.id)
      if (e.to.id === hover) s.add(e.from.id)
    }
    return s
  }, [hover, edges])

  if (!mission.sources.length && !mission.claims.length && !mission.evidence.length) {
    return <div className="empty">Add sources, claims and evidence to see how they connect.</div>
  }

  return (
    <div className="kn-graph-wrap">
      <svg className="kn-graph" viewBox={`0 0 ${width} ${height}`} width="100%" style={{ minWidth: 760, maxHeight: Math.max(240, height) }} role="img" aria-label="Research graph">
        {(['Sources', 'Claims', 'Evidence'] as const).map((t, i) => (
          <text key={t} x={x(i)} y={PAD + 10} className="kn-g-col">
            {t.toUpperCase()}
          </text>
        ))}
        {edges.map((e) => {
          const x1 = x(e.from.col) + COL_W
          const y1 = e.from.y + NODE_H / 2
          const x2 = x(e.to.col)
          const y2 = e.to.y + NODE_H / 2
          const mx = (x1 + x2) / 2
          const dim = related && !(related.has(e.from.id) && related.has(e.to.id))
          return <path key={e.key} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} className={'kn-g-edge' + (e.dashed ? ' dashed' : '') + (dim ? ' dim' : '')} />
        })}
        {nodes.map((n) => {
          const dim = related && !related.has(n.id)
          return (
            <g
              key={n.id}
              transform={`translate(${x(n.col)},${n.y})`}
              className={`kn-g-node ${n.kind}${n.status ? ' ' + n.status : ''}${dim ? ' dim' : ''}`}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(n.kind, n.id)}
            >
              <title>{n.full}</title>
              <rect width={COL_W} height={NODE_H} rx={6} />
              {n.kind === 'claim' && <circle cx={12} cy={NODE_H / 2} r={3.5} className="kn-g-dot" />}
              <text x={n.kind === 'claim' ? 22 : 10} y={NODE_H / 2 + 4}>
                {n.label}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="kn-graph-legend">
        <span>
          <i className="lg supported" /> supported
        </span>
        <span>
          <i className="lg disputed" /> disputed
        </span>
        <span>
          <i className="lg unverified" /> unverified
        </span>
        <span>
          <i className="lg dashed" /> evidence not yet assigned to a claim
        </span>
      </div>
    </div>
  )
}
