// Small user-edited entity graph with a deterministic force layout (SVG).
import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { ENTITY_TYPES, RELATION_TYPES, type EntityType, type KgGraph, type RelationType } from '@shared/modules/knowledge'
import { invoke } from '../../lib/ipc'
import { toast } from '../../stores/ui'
import { confirmAction } from '../../components/prompt'

const TYPE_HUE: Record<EntityType, string> = {
  Concept: 'var(--accent)',
  Company: 'var(--info)',
  Project: 'var(--ok)',
  Technology: '#c5a3ff',
  Asset: 'var(--warn)',
  Document: 'var(--fg-1)',
  Person: '#ff9f7a'
}

const W = 900
const H = 520

/** Deterministic Fruchterman–Reingold style layout (fixed iterations, seeded start). */
function layout(ids: string[], edges: [string, string][]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>()
  const n = ids.length
  ids.forEach((id, i) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2
    const r = Math.min(W, H) * 0.35
    pos.set(id, { x: W / 2 + r * Math.cos(a), y: H / 2 + r * Math.sin(a) })
  })
  if (n < 2) return pos
  const k = Math.sqrt((W * H) / n) * 0.55
  let temp = W / 10
  for (let it = 0; it < 220; it++) {
    const disp = new Map(ids.map((id) => [id, { x: 0, y: 0 }]))
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos.get(ids[i])!
        const b = pos.get(ids[j])!
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d = Math.hypot(dx, dy)
        if (d < 0.01) (dx = 0.1), (dy = 0.1), (d = 0.14)
        const f = (k * k) / d
        const da = disp.get(ids[i])!
        const db = disp.get(ids[j])!
        da.x += (dx / d) * f
        da.y += (dy / d) * f
        db.x -= (dx / d) * f
        db.y -= (dy / d) * f
      }
    }
    for (const [s, t] of edges) {
      const a = pos.get(s)
      const b = pos.get(t)
      if (!a || !b) continue
      const dx = a.x - b.x
      const dy = a.y - b.y
      const d = Math.max(0.01, Math.hypot(dx, dy))
      const f = (d * d) / k
      const da = disp.get(s)!
      const db = disp.get(t)!
      da.x -= (dx / d) * f
      da.y -= (dy / d) * f
      db.x += (dx / d) * f
      db.y += (dy / d) * f
    }
    for (const id of ids) {
      const p = pos.get(id)!
      const d = disp.get(id)!
      // gentle pull to centre keeps disconnected parts on screen
      d.x += (W / 2 - p.x) * 0.02
      d.y += (H / 2 - p.y) * 0.02
      const len = Math.max(0.01, Math.hypot(d.x, d.y))
      p.x = Math.min(W - 70, Math.max(70, p.x + (d.x / len) * Math.min(len, temp)))
      p.y = Math.min(H - 30, Math.max(30, p.y + (d.y / len) * Math.min(len, temp)))
    }
    temp *= 0.975
  }
  return pos
}

export function KnowledgeGraph({ graph }: { graph: KgGraph }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<EntityType>('Concept')
  const [desc, setDesc] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [rel, setRel] = useState<RelationType>('RELATED_TO')
  const [sel, setSel] = useState<string | null>(null)

  const pos = useMemo(
    () =>
      layout(
        graph.entities.map((e) => e.id),
        graph.relations.map((r) => [r.fromId, r.toId])
      ),
    [graph]
  )

  const addEntity = async () => {
    if (!name.trim()) return
    try {
      await invoke('knowledge:saveEntity', { name: name.trim(), type, description: desc.trim() })
      setName('')
      setDesc('')
    } catch (err: any) {
      toast({ kind: 'error', title: 'Could not add entity', body: String(err?.message ?? err) })
    }
  }

  const addRelation = async () => {
    if (!from || !to) return
    try {
      await invoke('knowledge:saveRelation', { fromId: from, toId: to, type: rel })
    } catch (err: any) {
      toast({ kind: 'error', title: 'Could not add relation', body: String(err?.message ?? err) })
    }
  }

  const byId = new Map(graph.entities.map((e) => [e.id, e]))
  const selected = sel ? byId.get(sel) : undefined
  const neighbours = sel ? new Set(graph.relations.flatMap((r) => (r.fromId === sel ? [r.toId] : r.toId === sel ? [r.fromId] : []))) : null

  return (
    <div className="kn-kg">
      <div className="kn-kg-forms">
        <div className="kn-section">
          <div className="kn-sec-h">
            <span className="label">Add entity</span>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addEntity()} placeholder="Name" />
            <select className="select" value={type} onChange={(e) => setType(e.target.value as EntityType)} aria-label="Entity type">
              {ENTITY_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <input className="input" style={{ width: '100%', marginTop: 6 }} value={desc} onChange={(e) => setDesc(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addEntity()} placeholder="Description (optional)" />
          <button className="btn primary sm" style={{ marginTop: 6 }} onClick={addEntity} disabled={!name.trim()}>
            <Plus size={12} /> Add entity
          </button>
        </div>
        <div className="kn-section">
          <div className="kn-sec-h">
            <span className="label">Add relation</span>
          </div>
          <select className="select" style={{ width: '100%' }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From">
            <option value="">From…</option>
            {graph.entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.type})
              </option>
            ))}
          </select>
          <select className="select" style={{ width: '100%', marginTop: 6 }} value={rel} onChange={(e) => setRel(e.target.value as RelationType)} aria-label="Relation">
            {RELATION_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select className="select" style={{ width: '100%', marginTop: 6 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To">
            <option value="">To…</option>
            {graph.entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.type})
              </option>
            ))}
          </select>
          <button className="btn primary sm" style={{ marginTop: 6 }} onClick={addRelation} disabled={!from || !to || from === to}>
            <Plus size={12} /> Add relation
          </button>
        </div>
        {selected && (
          <div className="kn-section">
            <div className="kn-sec-h">
              <span className="label" style={{ color: TYPE_HUE[selected.type] }}>
                {selected.type}
              </span>
              <span className="spacer" />
              <button
                className="icon-btn sm"
                onClick={async () => {
                  if (await confirmAction('Delete entity?', `“${selected.name}” and its relations will be removed.`, 'Delete', true)) {
                    await invoke('knowledge:deleteEntity', selected.id)
                    setSel(null)
                  }
                }}
                aria-label="Delete entity"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <div style={{ fontWeight: 600 }}>{selected.name}</div>
            {selected.description && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{selected.description}</div>}
            <div style={{ marginTop: 8 }}>
              {graph.relations
                .filter((r) => r.fromId === selected.id || r.toId === selected.id)
                .map((r) => (
                  <div key={r.id} className="kn-rel-row">
                    <span className="mono" style={{ fontSize: 11 }}>
                      {byId.get(r.fromId)?.name} <span className="accent">{r.type}</span> {byId.get(r.toId)?.name}
                    </span>
                    <span className="spacer" />
                    <button className="icon-btn sm" onClick={() => invoke('knowledge:deleteRelation', r.id)} aria-label="Delete relation">
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
      <div className="kn-kg-canvas card">
        {graph.entities.length === 0 ? (
          <div className="empty">No entities yet. Add concepts, companies, technologies or people and connect them.</div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, margin: '0 auto' }} className="kn-graph" role="img" aria-label="Knowledge graph" onClick={(e) => e.target === e.currentTarget && setSel(null)}>
            <defs>
              <marker id="kn-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--fg-3)" />
              </marker>
            </defs>
            {graph.relations.map((r) => {
              const a = pos.get(r.fromId)
              const b = pos.get(r.toId)
              if (!a || !b) return null
              const dim = sel && r.fromId !== sel && r.toId !== sel
              const d = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
              const ex = b.x - ((b.x - a.x) / d) * 15
              const ey = b.y - ((b.y - a.y) / d) * 12
              return (
                <g key={r.id} className={'kn-kg-edge' + (dim ? ' dim' : '')}>
                  <line x1={a.x} y1={a.y} x2={ex} y2={ey} markerEnd="url(#kn-arrow)" />
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4}>
                    {r.type}
                  </text>
                </g>
              )
            })}
            {graph.entities.map((e) => {
              const p = pos.get(e.id)!
              const dim = sel && sel !== e.id && !neighbours?.has(e.id)
              return (
                <g key={e.id} transform={`translate(${p.x},${p.y})`} className={'kn-kg-node' + (sel === e.id ? ' sel' : '') + (dim ? ' dim' : '')} onClick={() => setSel(e.id === sel ? null : e.id)}>
                  <title>{`${e.name} (${e.type})${e.description ? '\n' + e.description : ''}`}</title>
                  <circle r={11} style={{ fill: TYPE_HUE[e.type] }} />
                  <text y={30} textAnchor="middle">
                    {e.name.length > 22 ? e.name.slice(0, 21) + '…' : e.name}
                  </text>
                </g>
              )
            })}
          </svg>
        )}
        <div className="kn-graph-legend">
          {ENTITY_TYPES.map((t) => (
            <span key={t}>
              <i className="lg" style={{ background: TYPE_HUE[t], borderRadius: 99 }} /> {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
