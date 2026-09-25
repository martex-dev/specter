// A small, user-edited local entity graph.
import { ENTITY_TYPES, RELATION_TYPES, type EntityType, type KgEntity, type KgGraph, type KgRelation, type RelationType } from '@shared/modules/knowledge'
import { all, get, run, uid } from '../../db'
import { broadcast } from '../../ipc'
import { activeProfileId } from '../../services/profiles'

export function getGraph(): KgGraph {
  const p = activeProfileId()
  const entities = all<any>('SELECT * FROM kg_entities WHERE profile_id = ? ORDER BY name COLLATE NOCASE', p).map(
    (e): KgEntity => ({ id: e.id, name: e.name, type: e.type, description: e.description, url: e.url, createdAt: Number(e.created_at) })
  )
  const relations = all<any>('SELECT r.* FROM kg_relations r JOIN kg_entities e ON e.id = r.from_id WHERE e.profile_id = ? ORDER BY r.created_at', p).map(
    (r): KgRelation => ({ id: r.id, fromId: r.from_id, toId: r.to_id, type: r.type, createdAt: Number(r.created_at) })
  )
  return { entities, relations }
}

export function saveEntity(e: { id?: string; name: string; type: EntityType; description?: string; url?: string }): KgEntity {
  const name = e.name.trim().slice(0, 200)
  if (!name) throw new Error('Entity name is required')
  const type: EntityType = ENTITY_TYPES.includes(e.type) ? e.type : 'Concept'
  const p = activeProfileId()
  let id = e.id
  if (id && get('SELECT 1 FROM kg_entities WHERE id = ? AND profile_id = ?', id, p)) {
    run('UPDATE kg_entities SET name = ?, type = ?, description = ?, url = ? WHERE id = ?', name, type, e.description ?? '', e.url ?? '', id)
  } else {
    const dup = get<{ id: string }>('SELECT id FROM kg_entities WHERE profile_id = ? AND lower(name) = lower(?) AND type = ?', p, name, type)
    if (dup) id = dup.id
    else run('INSERT INTO kg_entities(id, profile_id, name, type, description, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', (id = uid('kg_')), p, name, type, e.description ?? '', e.url ?? '', Date.now())
  }
  broadcast('knowledge:changed', {})
  const r = get<any>('SELECT * FROM kg_entities WHERE id = ?', id)
  return { id: r.id, name: r.name, type: r.type, description: r.description, url: r.url, createdAt: Number(r.created_at) }
}

export function deleteEntity(id: string): void {
  run('DELETE FROM kg_entities WHERE id = ? AND profile_id = ?', id, activeProfileId())
  broadcast('knowledge:changed', {})
}

export function saveRelation(r: { fromId: string; toId: string; type: RelationType }): KgRelation {
  if (r.fromId === r.toId) throw new Error('A relation needs two different entities')
  const type: RelationType = RELATION_TYPES.includes(r.type) ? r.type : 'RELATED_TO'
  const p = activeProfileId()
  const ok = get<{ n: number }>('SELECT COUNT(*) AS n FROM kg_entities WHERE profile_id = ? AND id IN (?, ?)', p, r.fromId, r.toId)
  if (Number(ok?.n) !== 2) throw new Error('Entity not found')
  const existing = get<any>('SELECT * FROM kg_relations WHERE from_id = ? AND to_id = ? AND type = ?', r.fromId, r.toId, type)
  const id = existing?.id ?? uid('kr_')
  const createdAt = existing ? Number(existing.created_at) : Date.now()
  if (!existing) run('INSERT INTO kg_relations(id, from_id, to_id, type, created_at) VALUES (?, ?, ?, ?, ?)', id, r.fromId, r.toId, type, createdAt)
  broadcast('knowledge:changed', {})
  return { id, fromId: r.fromId, toId: r.toId, type, createdAt }
}

export function deleteRelation(id: string): void {
  run('DELETE FROM kg_relations WHERE id = ? AND from_id IN (SELECT id FROM kg_entities WHERE profile_id = ?)', id, activeProfileId())
  broadcast('knowledge:changed', {})
}
