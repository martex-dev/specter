// SQLite schema for notes, research missions and the local knowledge base.
// Append new steps only — never edit an existing one.
import { registerMigrations } from '../../db'

export function registerKnowledgeSchema(): void {
  registerMigrations('knowledge', [
    `
    CREATE TABLE kn_notes (
      rid INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, profile_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]', workspace_id TEXT, mission_id TEXT, source_url TEXT,
      pinned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_kn_notes_profile ON kn_notes(profile_id, updated_at);
    CREATE INDEX idx_kn_notes_mission ON kn_notes(mission_id);
    CREATE VIRTUAL TABLE kn_notes_fts USING fts5(title, body, tags, content='kn_notes', content_rowid='rid', tokenize='unicode61 remove_diacritics 2');
    CREATE TRIGGER kn_notes_ai AFTER INSERT ON kn_notes BEGIN
      INSERT INTO kn_notes_fts(rowid, title, body, tags) VALUES (new.rid, new.title, new.body, new.tags);
    END;
    CREATE TRIGGER kn_notes_ad AFTER DELETE ON kn_notes BEGIN
      INSERT INTO kn_notes_fts(kn_notes_fts, rowid, title, body, tags) VALUES ('delete', old.rid, old.title, old.body, old.tags);
    END;
    CREATE TRIGGER kn_notes_au AFTER UPDATE ON kn_notes BEGIN
      INSERT INTO kn_notes_fts(kn_notes_fts, rowid, title, body, tags) VALUES ('delete', old.rid, old.title, old.body, old.tags);
      INSERT INTO kn_notes_fts(rowid, title, body, tags) VALUES (new.rid, new.title, new.body, new.tags);
    END;

    CREATE TABLE kn_note_links (
      from_id TEXT NOT NULL REFERENCES kn_notes(id) ON DELETE CASCADE, target_key TEXT NOT NULL, target_title TEXT NOT NULL,
      PRIMARY KEY (from_id, target_key)
    );
    CREATE INDEX idx_kn_note_links_target ON kn_note_links(target_key);

    CREATE TABLE rs_missions (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active', steps TEXT NOT NULL DEFAULT '[]', workspace_id TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE rs_sources (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES rs_missions(id) ON DELETE CASCADE,
      url TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', site_name TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '',
      published TEXT NOT NULL DEFAULT '', excerpt TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
      added_at INTEGER NOT NULL, accessed_at INTEGER NOT NULL
    );
    CREATE INDEX idx_rs_sources_mission ON rs_sources(mission_id);
    CREATE TABLE rs_claims (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES rs_missions(id) ON DELETE CASCADE,
      text TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'unverified', created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_rs_claims_mission ON rs_claims(mission_id);
    CREATE TABLE rs_evidence (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES rs_missions(id) ON DELETE CASCADE,
      claim_id TEXT REFERENCES rs_claims(id) ON DELETE SET NULL, source_id TEXT REFERENCES rs_sources(id) ON DELETE SET NULL,
      quote TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_rs_evidence_mission ON rs_evidence(mission_id);
    CREATE TABLE rs_questions (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES rs_missions(id) ON DELETE CASCADE,
      text TEXT NOT NULL DEFAULT '', answer TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL
    );
    CREATE TABLE rs_summaries (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES rs_missions(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'user', text TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    );

    CREATE TABLE kb_docs (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '', workspace_id TEXT, ref_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_kb_docs_profile ON kb_docs(profile_id, updated_at);
    CREATE INDEX idx_kb_docs_ref ON kb_docs(ref_id);
    CREATE INDEX idx_kb_docs_url ON kb_docs(url);
    CREATE TABLE kb_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT NOT NULL REFERENCES kb_docs(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '', text TEXT NOT NULL, embedding BLOB, model TEXT
    );
    CREATE INDEX idx_kb_chunks_doc ON kb_chunks(doc_id, idx);
    CREATE VIRTUAL TABLE kb_chunks_fts USING fts5(title, text, content='kb_chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
    CREATE TRIGGER kb_chunks_ai AFTER INSERT ON kb_chunks BEGIN
      INSERT INTO kb_chunks_fts(rowid, title, text) VALUES (new.id, new.title, new.text);
    END;
    CREATE TRIGGER kb_chunks_ad AFTER DELETE ON kb_chunks BEGIN
      INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, title, text) VALUES ('delete', old.id, old.title, old.text);
    END;
    CREATE TRIGGER kb_chunks_au AFTER UPDATE OF title, text ON kb_chunks BEGIN
      INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, title, text) VALUES ('delete', old.id, old.title, old.text);
      INSERT INTO kb_chunks_fts(rowid, title, text) VALUES (new.id, new.title, new.text);
    END;

    CREATE TABLE kg_entities (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    );
    CREATE TABLE kg_relations (
      id TEXT PRIMARY KEY, from_id TEXT NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
      to_id TEXT NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE, type TEXT NOT NULL, created_at INTEGER NOT NULL,
      UNIQUE (from_id, to_id, type)
    );
    `
  ])
}
