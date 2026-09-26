PRAGMA busy_timeout=5000;
  PRAGMA journal_mode=DELETE;
  CREATE TABLE IF NOT EXISTS evidence (
    evidence_id TEXT PRIMARY KEY,
    evidence_uri TEXT NOT NULL,
    text TEXT NOT NULL,
    project TEXT NOT NULL,
    session_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    role TEXT NOT NULL,
    source_origin TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    event_timestamp TEXT,
    source_path TEXT NOT NULL,
    line INTEGER NOT NULL,
    byte_start INTEGER NOT NULL,
    byte_end INTEGER NOT NULL,
    record_digest TEXT NOT NULL,
    prefix_digest TEXT NOT NULL,
    parent_id TEXT,
    branch_state TEXT NOT NULL,
    compaction_state TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS evidence_uri_lookup ON evidence(evidence_uri);
  CREATE INDEX IF NOT EXISTS evidence_project_lookup ON evidence(project);
  CREATE INDEX IF NOT EXISTS evidence_entry_lookup ON evidence(entry_id);
  CREATE INDEX IF NOT EXISTS evidence_session_lookup ON evidence(source_origin, session_id, source_path);
  CREATE INDEX IF NOT EXISTS evidence_source_position ON evidence(source_path, byte_start, evidence_id);
  CREATE INDEX IF NOT EXISTS evidence_timestamp_lookup ON evidence(event_timestamp);
  CREATE VIRTUAL TABLE IF NOT EXISTS evidence_fts USING fts5(
    text,
    content='evidence',
    content_rowid='rowid',
    tokenize='porter unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER IF NOT EXISTS evidence_fts_insert AFTER INSERT ON evidence BEGIN
    INSERT INTO evidence_fts(rowid, text) VALUES (new.rowid, new.text);
  END;
  CREATE TRIGGER IF NOT EXISTS evidence_fts_delete AFTER DELETE ON evidence BEGIN
    INSERT INTO evidence_fts(evidence_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  END;
  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS source_files (
    source_path TEXT PRIMARY KEY,
    source_origin TEXT NOT NULL,
    source_root_digest TEXT NOT NULL,
    session_id TEXT NOT NULL,
    project TEXT NOT NULL,
    dev TEXT NOT NULL,
    ino TEXT NOT NULL,
    observed_size INTEGER NOT NULL,
    admitted_bytes INTEGER NOT NULL,
    mtime_ns TEXT NOT NULL,
    ctime_ns TEXT NOT NULL,
    physical_lines INTEGER NOT NULL,
    records INTEGER NOT NULL,
    eligible_records INTEGER NOT NULL,
    evidence_spans INTEGER NOT NULL,
    skipped INTEGER NOT NULL,
    malformed INTEGER NOT NULL,
    oversized INTEGER NOT NULL,
    errors INTEGER NOT NULL,
    fatal_errors INTEGER NOT NULL,
    leaf_entry_id TEXT,
    latest_compaction_line INTEGER,
    prefix_digest TEXT NOT NULL,
    source_generation TEXT NOT NULL,
    trust_state TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS source_records (
    source_path TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    parent_id TEXT,
    line INTEGER NOT NULL,
    source_kind TEXT NOT NULL,
    PRIMARY KEY (source_path, entry_id)
  );
  CREATE INDEX IF NOT EXISTS source_records_parent ON source_records(source_path, parent_id);
