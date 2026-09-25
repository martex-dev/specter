// Conversation persistence (SQLite). Messages store the user's prompt, the
// answer and *metadata* about the context used (labels, URLs, sizes) — never
// the gathered page text itself.
import type { AiContextMeta, AiConversation, AiConversationSummary, AiMessage } from '@shared/modules/ai'
import { all, get, json, registerMigrations, run, tx, uid } from '../../db'
import { activeProfileId } from '../../services/profiles'

export function registerAiMigrations(): void {
  registerMigrations('ai', [
    `
    CREATE TABLE ai_conversations (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, title TEXT NOT NULL, model TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_ai_conv_profile ON ai_conversations(profile_id, updated_at);
    CREATE TABLE ai_messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL, content TEXT NOT NULL, context TEXT NOT NULL DEFAULT '[]', model TEXT,
      status TEXT NOT NULL DEFAULT 'done', error TEXT, created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_ai_msg_conv ON ai_messages(conversation_id, created_at);
    `
  ])
}

interface ConvRow {
  id: string
  title: string
  model: string
  created_at: number
  updated_at: number
  messages: number
}

interface MsgRow {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  context: string
  model: string | null
  status: AiMessage['status']
  error: string | null
  created_at: number
}

function toSummary(r: ConvRow): AiConversationSummary {
  return { id: r.id, title: r.title, model: r.model, createdAt: r.created_at, updatedAt: r.updated_at, messages: r.messages }
}

function toMessage(r: MsgRow): AiMessage {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role,
    content: r.content,
    context: json<AiContextMeta[]>(r.context, []),
    model: r.model ?? undefined,
    status: r.status,
    error: r.error ?? undefined,
    createdAt: r.created_at
  }
}

export function listConversations(limit = 100): AiConversationSummary[] {
  return all<ConvRow>(
    `SELECT c.id, c.title, c.model, c.created_at, c.updated_at, (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id = c.id) AS messages
     FROM ai_conversations c WHERE c.profile_id = ? ORDER BY c.updated_at DESC LIMIT ?`,
    activeProfileId(),
    Math.max(1, Math.min(500, limit))
  ).map(toSummary)
}

export function conversationExists(id: string): boolean {
  return !!get<{ id: string }>('SELECT id FROM ai_conversations WHERE id = ? AND profile_id = ?', id, activeProfileId())
}

export function loadConversation(id: string): AiConversation | null {
  const c = get<ConvRow>(
    `SELECT c.id, c.title, c.model, c.created_at, c.updated_at, (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id = c.id) AS messages
     FROM ai_conversations c WHERE c.id = ? AND c.profile_id = ?`,
    id,
    activeProfileId()
  )
  if (!c) return null
  const items = all<MsgRow>('SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at, rowid', id).map(toMessage)
  return { ...toSummary(c), items }
}

export function createConversation(title: string, model: string): string {
  const id = uid('aic_')
  const now = Date.now()
  run('INSERT INTO ai_conversations(id, profile_id, title, model, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)', id, activeProfileId(), title.slice(0, 200), model, now, now)
  return id
}

export function addMessage(m: Omit<AiMessage, 'id' | 'createdAt'> & { createdAt?: number }): string {
  const id = uid('aim_')
  const ts = m.createdAt ?? Date.now()
  tx(() => {
    run(
      'INSERT INTO ai_messages(id, conversation_id, role, content, context, model, status, error, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      m.conversationId,
      m.role,
      m.content,
      JSON.stringify(m.context ?? []),
      m.model ?? null,
      m.status,
      m.error ?? null,
      ts
    )
    run('UPDATE ai_conversations SET updated_at = ?, model = COALESCE(?, model) WHERE id = ?', ts, m.model ?? null, m.conversationId)
  })
  return id
}

export function finishMessage(id: string, content: string, status: AiMessage['status'], error?: string): void {
  run('UPDATE ai_messages SET content = ?, status = ?, error = ? WHERE id = ?', content, status, error ?? null, id)
}

/** History for the model: completed turns only, oldest first. */
export function historyFor(conversationId: string, excludeIds: string[] = []): { role: 'user' | 'assistant'; content: string }[] {
  return all<MsgRow>('SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at, rowid', conversationId)
    .filter((r) => !excludeIds.includes(r.id) && (r.role === 'user' || r.status === 'done' || (r.status === 'stopped' && r.content)))
    .map((r) => ({ role: r.role, content: r.content }))
}

export function renameConversation(id: string, title: string): void {
  const t = title.replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!t) return
  run('UPDATE ai_conversations SET title = ? WHERE id = ? AND profile_id = ?', t, id, activeProfileId())
}

export function deleteConversation(id: string): void {
  tx(() => {
    run('DELETE FROM ai_messages WHERE conversation_id IN (SELECT id FROM ai_conversations WHERE id = ? AND profile_id = ?)', id, activeProfileId())
    run('DELETE FROM ai_conversations WHERE id = ? AND profile_id = ?', id, activeProfileId())
  })
}

export function clearConversations(): number {
  return tx(() => {
    run('DELETE FROM ai_messages WHERE conversation_id IN (SELECT id FROM ai_conversations WHERE profile_id = ?)', activeProfileId())
    return run('DELETE FROM ai_conversations WHERE profile_id = ?', activeProfileId()).changes
  })
}

/** Messages left "streaming" by a crash are marked as interrupted on startup. */
export function repairInterrupted(): void {
  run(`UPDATE ai_messages SET status = 'error', error = 'Interrupted (SPECTER was closed while generating)' WHERE status = 'streaming'`)
}
