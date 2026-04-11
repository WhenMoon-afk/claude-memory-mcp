import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export const CONTINUITY_SCHEMA_VERSION = 1;

export function openContinuityDb(path: string): InstanceType<typeof Database> {
  mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS artifacts (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      label TEXT NOT NULL,
      preview TEXT NOT NULL,
      summary TEXT NOT NULL,
      body_json TEXT NOT NULL DEFAULT '{}',
      project_id TEXT,
      subject_kind TEXT,
      subject_id TEXT,
      next_steps_json TEXT NOT NULL DEFAULT '[]',
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      preview TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS artifact_artifact_edges (
      from_artifact_id TEXT NOT NULL,
      to_artifact_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      PRIMARY KEY (from_artifact_id, to_artifact_id, relation_type)
    );

    CREATE TABLE IF NOT EXISTS artifact_node_edges (
      artifact_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      PRIMARY KEY (artifact_id, node_id, relation_type)
    );

    CREATE TABLE IF NOT EXISTS artifact_renders (
      artifact_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      content TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      PRIMARY KEY (artifact_id, mode)
    );

    CREATE TABLE IF NOT EXISTS store_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_fts USING fts5(
      id,
      type,
      title,
      label,
      preview,
      summary,
      project_id,
      content='artifacts',
      content_rowid='seq'
    );

    CREATE TRIGGER IF NOT EXISTS artifacts_ai AFTER INSERT ON artifacts BEGIN
      INSERT INTO artifacts_fts(rowid, id, type, title, label, preview, summary, project_id)
      VALUES (
        new.seq,
        new.id,
        new.type,
        new.title,
        new.label,
        new.preview,
        new.summary,
        COALESCE(new.project_id, '')
      );
    END;

    CREATE TRIGGER IF NOT EXISTS artifacts_ad AFTER DELETE ON artifacts BEGIN
      INSERT INTO artifacts_fts(artifacts_fts, rowid, id, type, title, label, preview, summary, project_id)
      VALUES (
        'delete',
        old.seq,
        old.id,
        old.type,
        old.title,
        old.label,
        old.preview,
        old.summary,
        COALESCE(old.project_id, '')
      );
    END;

    CREATE TRIGGER IF NOT EXISTS artifacts_au AFTER UPDATE ON artifacts BEGIN
      INSERT INTO artifacts_fts(artifacts_fts, rowid, id, type, title, label, preview, summary, project_id)
      VALUES (
        'delete',
        old.seq,
        old.id,
        old.type,
        old.title,
        old.label,
        old.preview,
        old.summary,
        COALESCE(old.project_id, '')
      );

      INSERT INTO artifacts_fts(rowid, id, type, title, label, preview, summary, project_id)
      VALUES (
        new.seq,
        new.id,
        new.type,
        new.title,
        new.label,
        new.preview,
        new.summary,
        COALESCE(new.project_id, '')
      );
    END;
  `);

  db.prepare(
    `INSERT OR IGNORE INTO store_metadata (key, value) VALUES ('schema_version', ?)`,
  ).run(String(CONTINUITY_SCHEMA_VERSION));

  return db;
}
