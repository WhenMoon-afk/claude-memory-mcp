/**
 * Database schema definitions and migrations for Memory MCP
 */

import type Database from 'better-sqlite3';

export const SCHEMA_VERSION = 3;

/**
 * Initialize database schema
 */
export function initializeSchema(db: Database.Database): void {
  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Create schema version table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  // Check current version
  const currentVersion = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .pluck()
    .get() as number | undefined;

  if (!currentVersion || currentVersion < SCHEMA_VERSION) {
    applyMigrations(db, currentVersion || 0);
  }
}

/**
 * Apply migrations from current version to latest
 */
function applyMigrations(db: Database.Database, fromVersion: number): void {
  const migrations = [
    // Migration 1: Initial schema
    (db: Database.Database) => {
      db.exec(`
        -- Memories table: Core memory storage
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('fact', 'entity', 'relationship', 'self')),
          importance REAL NOT NULL CHECK(importance >= 0 AND importance <= 10),
          embedding BLOB,
          created_at INTEGER NOT NULL,
          last_accessed INTEGER NOT NULL,
          expires_at INTEGER,
          metadata TEXT NOT NULL DEFAULT '{}',
          is_deleted INTEGER NOT NULL DEFAULT 0 CHECK(is_deleted IN (0, 1))
        );

        -- Indexes for memories
        CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
        CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);
        CREATE INDEX IF NOT EXISTS idx_memories_last_accessed ON memories(last_accessed);
        CREATE INDEX IF NOT EXISTS idx_memories_expires_at ON memories(expires_at);
        CREATE INDEX IF NOT EXISTS idx_memories_is_deleted ON memories(is_deleted);
        CREATE INDEX IF NOT EXISTS idx_memories_hot_context ON memories(last_accessed DESC, importance DESC) WHERE is_deleted = 0;

        -- Entities table: Named entities
        CREATE TABLE IF NOT EXISTS entities (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL,
          metadata TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL
        );

        -- Index for entities
        CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
        CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);

        -- Memory-Entity link table
        CREATE TABLE IF NOT EXISTS memory_entities (
          memory_id TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (memory_id, entity_id),
          FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
          FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
        );

        -- Indexes for memory_entities
        CREATE INDEX IF NOT EXISTS idx_memory_entities_memory_id ON memory_entities(memory_id);
        CREATE INDEX IF NOT EXISTS idx_memory_entities_entity_id ON memory_entities(entity_id);

        -- Provenance table: Audit trail
        CREATE TABLE IF NOT EXISTS provenance (
          id TEXT PRIMARY KEY,
          memory_id TEXT NOT NULL,
          operation TEXT NOT NULL CHECK(operation IN ('create', 'update', 'delete', 'access', 'restore')),
          timestamp INTEGER NOT NULL,
          source TEXT NOT NULL,
          context TEXT,
          user_id TEXT,
          changes TEXT,
          FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
        );

        -- Indexes for provenance
        CREATE INDEX IF NOT EXISTS idx_provenance_memory_id ON provenance(memory_id);
        CREATE INDEX IF NOT EXISTS idx_provenance_timestamp ON provenance(timestamp);
        CREATE INDEX IF NOT EXISTS idx_provenance_operation ON provenance(operation);
      `);

      // Record migration
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        1,
        Date.now()
      );
    },

    // Migration 2: Add summary and access_count fields for v2.0 optimization
    (db: Database.Database) => {
      // Add summary column (TEXT, will be NOT NULL after backfill)
      db.exec(`
        ALTER TABLE memories ADD COLUMN summary TEXT;
      `);

      // Add access_count column for frequency tracking
      db.exec(`
        ALTER TABLE memories ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;
      `);

      // Generate summaries for existing memories (first 100 characters as fallback)
      const memories = db.prepare('SELECT id, content FROM memories').all() as Array<{
        id: string;
        content: string;
      }>;

      const updateSummary = db.prepare('UPDATE memories SET summary = ? WHERE id = ?');

      for (const memory of memories) {
        // Simple summary: first 100 characters or first sentence
        let summary = memory.content;
        const firstSentence = memory.content.match(/^[^.!?]+[.!?]/);
        if (firstSentence && firstSentence[0].length <= 100) {
          summary = firstSentence[0].trim();
        } else if (memory.content.length > 100) {
          summary = memory.content.substring(0, 97) + '...';
        }
        updateSummary.run(summary, memory.id);
      }

      // Now make summary NOT NULL (SQLite doesn't support ALTER COLUMN, so we verify all are filled)
      const nullSummaries = db
        .prepare('SELECT COUNT(*) FROM memories WHERE summary IS NULL')
        .pluck()
        .get() as number;

      if (nullSummaries > 0) {
        throw new Error(
          `Migration 2 failed: ${nullSummaries} memories still have NULL summaries`
        );
      }

      // Add index on access_count for hot context queries
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_memories_access_count ON memories(access_count DESC);
      `);

      // Record migration
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        2,
        Date.now()
      );
    },

    // Migration 3: Add FTS5 for keyword search (replaces vector embeddings)
    (db: Database.Database) => {
      // Create FTS5 virtual table for full-text search on memory content
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          memory_id UNINDEXED,
          content,
          summary,
          tokenize = 'porter unicode61'
        );
      `);

      // Populate FTS table with existing memories
      db.exec(`
        INSERT INTO memories_fts (memory_id, content, summary)
        SELECT id, content, summary FROM memories WHERE is_deleted = 0;
      `);

      // Create triggers to keep FTS index synchronized
      db.exec(`
        -- Trigger: Insert into FTS when memory created
        CREATE TRIGGER IF NOT EXISTS memories_fts_insert
        AFTER INSERT ON memories
        WHEN NEW.is_deleted = 0
        BEGIN
          INSERT INTO memories_fts (memory_id, content, summary)
          VALUES (NEW.id, NEW.content, NEW.summary);
        END;

        -- Trigger: Update FTS when memory content/summary updated
        CREATE TRIGGER IF NOT EXISTS memories_fts_update
        AFTER UPDATE OF content, summary ON memories
        WHEN NEW.is_deleted = 0
        BEGIN
          DELETE FROM memories_fts WHERE memory_id = NEW.id;
          INSERT INTO memories_fts (memory_id, content, summary)
          VALUES (NEW.id, NEW.content, NEW.summary);
        END;

        -- Trigger: Delete from FTS when memory soft-deleted
        CREATE TRIGGER IF NOT EXISTS memories_fts_delete
        AFTER UPDATE OF is_deleted ON memories
        WHEN NEW.is_deleted = 1
        BEGIN
          DELETE FROM memories_fts WHERE memory_id = NEW.id;
        END;

        -- Trigger: Add back to FTS if memory restored (is_deleted changed to 0)
        CREATE TRIGGER IF NOT EXISTS memories_fts_restore
        AFTER UPDATE OF is_deleted ON memories
        WHEN NEW.is_deleted = 0 AND OLD.is_deleted = 1
        BEGIN
          INSERT INTO memories_fts (memory_id, content, summary)
          VALUES (NEW.id, NEW.content, NEW.summary);
        END;
      `);

      // Make embedding column nullable (no longer required)
      // Note: SQLite doesn't support DROP COLUMN or ALTER COLUMN,
      // so we just make it optional going forward

      // Record migration
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        3,
        Date.now()
      );
    },
  ];

  // Apply each migration in sequence
  for (let i = fromVersion; i < migrations.length; i++) {
    const migration = migrations[i];
    if (migration) {
      db.transaction(() => {
        migration(db);
      })();
    }
  }
}

/**
 * Create optimized views for common queries
 */
export function createViews(db: Database.Database): void {
  // View: Active memories with entity counts
  db.exec(`
    CREATE VIEW IF NOT EXISTS v_active_memories AS
    SELECT
      m.*,
      COUNT(me.entity_id) as entity_count
    FROM memories m
    LEFT JOIN memory_entities me ON m.id = me.memory_id
    WHERE m.is_deleted = 0
      AND (m.expires_at IS NULL OR m.expires_at > unixepoch() * 1000)
    GROUP BY m.id;
  `);

  // View: Hot context candidates
  db.exec(`
    CREATE VIEW IF NOT EXISTS v_hot_context AS
    SELECT
      m.*,
      (m.importance * 0.6 +
       CASE
         WHEN (unixepoch() * 1000 - m.last_accessed) < 3600000 THEN 5
         WHEN (unixepoch() * 1000 - m.last_accessed) < 21600000 THEN 4
         WHEN (unixepoch() * 1000 - m.last_accessed) < 86400000 THEN 3
         WHEN (unixepoch() * 1000 - m.last_accessed) < 604800000 THEN 2
         WHEN (unixepoch() * 1000 - m.last_accessed) < 2592000000 THEN 1
         ELSE 0
       END * 0.4) as hot_score
    FROM memories m
    WHERE m.is_deleted = 0
      AND (m.expires_at IS NULL OR m.expires_at > unixepoch() * 1000)
    ORDER BY hot_score DESC;
  `);

  // View: Memory provenance chain
  db.exec(`
    CREATE VIEW IF NOT EXISTS v_memory_provenance AS
    SELECT
      m.id,
      m.content,
      m.type,
      p.operation,
      p.timestamp,
      p.source,
      p.context,
      p.user_id
    FROM memories m
    LEFT JOIN provenance p ON m.id = p.memory_id
    ORDER BY m.id, p.timestamp DESC;
  `);
}

/**
 * Optimize database for performance
 */
export function optimizeDatabase(db: Database.Database): void {
  // Analyze tables for query optimization
  db.exec('ANALYZE;');

  // Set performance pragmas
  db.pragma('journal_mode = WAL'); // Write-Ahead Logging for better concurrency
  db.pragma('synchronous = NORMAL'); // Balance safety and speed
  db.pragma('cache_size = -64000'); // 64MB cache
  db.pragma('temp_store = MEMORY'); // Temp tables in memory
  db.pragma('mmap_size = 30000000000'); // 30GB memory-mapped I/O
}

/**
 * Get database statistics
 */
export interface DatabaseStats {
  total_memories: number;
  active_memories: number;
  deleted_memories: number;
  expired_memories: number;
  total_entities: number;
  total_provenance_records: number;
  database_size_bytes: number;
  memory_avg_importance: number;
  oldest_memory_age_days: number;
}

export function getDatabaseStats(db: Database.Database): DatabaseStats {
  const now = Date.now();

  const stats = {
    total_memories: db.prepare('SELECT COUNT(*) FROM memories').pluck().get() as number,
    active_memories: db
      .prepare('SELECT COUNT(*) FROM memories WHERE is_deleted = 0 AND (expires_at IS NULL OR expires_at > ?)')
      .pluck()
      .get(now) as number,
    deleted_memories: db
      .prepare('SELECT COUNT(*) FROM memories WHERE is_deleted = 1')
      .pluck()
      .get() as number,
    expired_memories: db
      .prepare('SELECT COUNT(*) FROM memories WHERE is_deleted = 0 AND expires_at IS NOT NULL AND expires_at <= ?')
      .pluck()
      .get(now) as number,
    total_entities: db.prepare('SELECT COUNT(*) FROM entities').pluck().get() as number,
    total_provenance_records: db.prepare('SELECT COUNT(*) FROM provenance').pluck().get() as number,
    database_size_bytes: db
      .prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()")
      .pluck()
      .get() as number,
    memory_avg_importance:
      (db
        .prepare('SELECT AVG(importance) FROM memories WHERE is_deleted = 0')
        .pluck()
        .get() as number) || 0,
    oldest_memory_age_days: (() => {
      const oldest = db
        .prepare('SELECT MIN(created_at) FROM memories WHERE is_deleted = 0')
        .pluck()
        .get() as number | null;
      return oldest ? Math.floor((now - oldest) / (1000 * 60 * 60 * 24)) : 0;
    })(),
  };

  return stats;
}
