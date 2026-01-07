#!/usr/bin/env node

/**
 * Memory Database Consolidation Tool
 *
 * Merges multiple memory database files into one, deduplicating by content hash.
 *
 * Usage:
 *   node scripts/consolidate-memories.js <target.db> <source1.db> [source2.db] ...
 *
 * Example:
 *   node scripts/consolidate-memories.js ~/.memory-mcp/memory.db ~/old-memories/*.db
 */

import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { existsSync, statSync } from 'fs';
import { basename, resolve } from 'path';

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(msg) {
  console.log(msg);
}

function success(msg) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function warn(msg) {
  console.log(`${colors.yellow}⚠${colors.reset} ${msg}`);
}

function error(msg) {
  console.error(`${colors.red}✗${colors.reset} ${msg}`);
}

function header(msg) {
  console.log(`\n${colors.bright}${colors.cyan}${msg}${colors.reset}`);
}

/**
 * Generate content hash for deduplication
 */
function getContentHash(content, type) {
  return createHash('sha256').update(`${type}:${content}`).digest('hex');
}

/**
 * Checkpoint WAL to ensure all data is in main DB file
 */
function checkpointWal(dbPath) {
  try {
    const db = new Database(dbPath);
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    return true;
  } catch (err) {
    warn(`Could not checkpoint WAL for ${basename(dbPath)}: ${err.message}`);
    return false;
  }
}

/**
 * Get schema version from a database
 */
function getSchemaVersion(db) {
  try {
    const version = db.prepare('SELECT MAX(version) FROM schema_version').pluck().get();
    return version || 0;
  } catch {
    return 0;
  }
}

/**
 * Read all data from a source database
 */
function readSourceDatabase(dbPath) {
  const db = new Database(dbPath, { readonly: true });

  const schemaVersion = getSchemaVersion(db);

  // Read memories
  let memories = [];
  try {
    if (schemaVersion >= 2) {
      memories = db.prepare(`
        SELECT id, content, type, importance, embedding, created_at, last_accessed,
               expires_at, metadata, is_deleted, summary, access_count
        FROM memories
      `).all();
    } else {
      // Schema v1 doesn't have summary and access_count
      memories = db.prepare(`
        SELECT id, content, type, importance, embedding, created_at, last_accessed,
               expires_at, metadata, is_deleted,
               NULL as summary, 0 as access_count
        FROM memories
      `).all();
    }
  } catch (err) {
    warn(`Could not read memories from ${basename(dbPath)}: ${err.message}`);
  }

  // Read entities
  let entities = [];
  try {
    entities = db.prepare('SELECT id, name, type, metadata, created_at FROM entities').all();
  } catch (err) {
    warn(`Could not read entities from ${basename(dbPath)}: ${err.message}`);
  }

  // Read memory_entities links
  let memoryEntities = [];
  try {
    memoryEntities = db.prepare('SELECT memory_id, entity_id, created_at FROM memory_entities').all();
  } catch (err) {
    warn(`Could not read memory_entities from ${basename(dbPath)}: ${err.message}`);
  }

  // Read provenance
  let provenance = [];
  try {
    provenance = db.prepare(`
      SELECT id, memory_id, operation, timestamp, source, context, user_id, changes
      FROM provenance
    `).all();
  } catch (err) {
    warn(`Could not read provenance from ${basename(dbPath)}: ${err.message}`);
  }

  db.close();

  return {
    schemaVersion,
    memories,
    entities,
    memoryEntities,
    provenance,
  };
}

/**
 * Merge memories with deduplication
 */
function mergeMemories(allMemories) {
  const byHash = new Map();
  let duplicatesFound = 0;

  for (const memory of allMemories) {
    const hash = getContentHash(memory.content, memory.type);

    if (byHash.has(hash)) {
      duplicatesFound++;
      const existing = byHash.get(hash);

      // Keep the most recent one
      if (memory.last_accessed > existing.last_accessed) {
        // Merge access_count
        memory.access_count = (memory.access_count || 0) + (existing.access_count || 0);
        // Keep all provenance records (handled separately)
        byHash.set(hash, { ...memory, _originalIds: [...(existing._originalIds || [existing.id]), existing.id] });
      } else {
        // Add to existing's access_count
        existing.access_count = (existing.access_count || 0) + (memory.access_count || 0);
        existing._originalIds = [...(existing._originalIds || []), memory.id];
      }
    } else {
      byHash.set(hash, { ...memory, _originalIds: [memory.id] });
    }
  }

  return {
    memories: Array.from(byHash.values()),
    duplicatesFound,
  };
}

/**
 * Merge entities (unique by name)
 */
function mergeEntities(allEntities) {
  const byName = new Map();
  let duplicatesFound = 0;

  for (const entity of allEntities) {
    if (byName.has(entity.name)) {
      duplicatesFound++;
      // Keep the first one seen (or could merge metadata)
    } else {
      byName.set(entity.name, entity);
    }
  }

  return {
    entities: Array.from(byName.values()),
    duplicatesFound,
  };
}

/**
 * Initialize target database with schema
 */
function initializeTargetDatabase(db) {
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );

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
      is_deleted INTEGER NOT NULL DEFAULT 0 CHECK(is_deleted IN (0, 1)),
      summary TEXT,
      access_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);
    CREATE INDEX IF NOT EXISTS idx_memories_last_accessed ON memories(last_accessed);
    CREATE INDEX IF NOT EXISTS idx_memories_expires_at ON memories(expires_at);
    CREATE INDEX IF NOT EXISTS idx_memories_is_deleted ON memories(is_deleted);

    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);

    CREATE TABLE IF NOT EXISTS memory_entities (
      memory_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (memory_id, entity_id),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_memory_entities_memory_id ON memory_entities(memory_id);
    CREATE INDEX IF NOT EXISTS idx_memory_entities_entity_id ON memory_entities(entity_id);

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

    CREATE INDEX IF NOT EXISTS idx_provenance_memory_id ON provenance(memory_id);
    CREATE INDEX IF NOT EXISTS idx_provenance_timestamp ON provenance(timestamp);
    CREATE INDEX IF NOT EXISTS idx_provenance_operation ON provenance(operation);

    INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (3, ${Date.now()});
  `);
}

/**
 * Build FTS index
 */
function buildFtsIndex(db) {
  db.exec(`
    DROP TABLE IF EXISTS memories_fts;

    CREATE VIRTUAL TABLE memories_fts USING fts5(
      memory_id UNINDEXED,
      content,
      summary,
      tokenize = 'porter unicode61'
    );

    INSERT INTO memories_fts (memory_id, content, summary)
    SELECT id, content, summary FROM memories WHERE is_deleted = 0;

    -- Triggers for FTS sync
    CREATE TRIGGER IF NOT EXISTS memories_fts_insert
    AFTER INSERT ON memories WHEN NEW.is_deleted = 0
    BEGIN
      INSERT INTO memories_fts (memory_id, content, summary)
      VALUES (NEW.id, NEW.content, NEW.summary);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_fts_update
    AFTER UPDATE OF content, summary ON memories WHEN NEW.is_deleted = 0
    BEGIN
      DELETE FROM memories_fts WHERE memory_id = NEW.id;
      INSERT INTO memories_fts (memory_id, content, summary)
      VALUES (NEW.id, NEW.content, NEW.summary);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_fts_delete
    AFTER UPDATE OF is_deleted ON memories WHEN NEW.is_deleted = 1
    BEGIN
      DELETE FROM memories_fts WHERE memory_id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS memories_fts_restore
    AFTER UPDATE OF is_deleted ON memories
    WHEN NEW.is_deleted = 0 AND OLD.is_deleted = 1
    BEGIN
      INSERT INTO memories_fts (memory_id, content, summary)
      VALUES (NEW.id, NEW.content, NEW.summary);
    END;
  `);
}

/**
 * Main consolidation function
 */
function consolidate(targetPath, sourcePaths) {
  header('Memory Database Consolidation Tool');
  log(`Target: ${targetPath}`);
  log(`Sources: ${sourcePaths.length} database(s)\n`);

  // Verify source files exist
  for (const sourcePath of sourcePaths) {
    if (!existsSync(sourcePath)) {
      error(`Source file not found: ${sourcePath}`);
      process.exit(1);
    }
  }

  // Checkpoint WAL files
  header('Step 1: Checkpoint WAL files');
  for (const sourcePath of sourcePaths) {
    checkpointWal(sourcePath);
    success(`Checkpointed ${basename(sourcePath)}`);
  }

  // Read all source databases
  header('Step 2: Read source databases');
  const allMemories = [];
  const allEntities = [];
  const allMemoryEntities = [];
  const allProvenance = [];

  for (const sourcePath of sourcePaths) {
    const data = readSourceDatabase(sourcePath);
    const size = statSync(sourcePath).size;

    log(`  ${basename(sourcePath)} (${(size / 1024).toFixed(1)} KB)`);
    log(`    Schema v${data.schemaVersion}, ${data.memories.length} memories, ${data.entities.length} entities`);

    allMemories.push(...data.memories);
    allEntities.push(...data.entities);
    allMemoryEntities.push(...data.memoryEntities);
    allProvenance.push(...data.provenance);
  }

  log(`\n  Total: ${allMemories.length} memories, ${allEntities.length} entities, ${allProvenance.length} provenance records`);

  // Merge and deduplicate
  header('Step 3: Deduplicate memories');
  const mergedMemories = mergeMemories(allMemories);
  success(`${mergedMemories.memories.length} unique memories (${mergedMemories.duplicatesFound} duplicates removed)`);

  header('Step 4: Deduplicate entities');
  const mergedEntities = mergeEntities(allEntities);
  success(`${mergedEntities.entities.length} unique entities (${mergedEntities.duplicatesFound} duplicates removed)`);

  // Build ID mapping for memory_entities and provenance
  const memoryIdMap = new Map(); // old ID -> new ID
  for (const memory of mergedMemories.memories) {
    const newId = memory.id;
    for (const oldId of memory._originalIds || [memory.id]) {
      memoryIdMap.set(oldId, newId);
    }
  }

  const entityIdMap = new Map(); // entity name -> entity ID
  for (const entity of mergedEntities.entities) {
    entityIdMap.set(entity.name, entity.id);
  }

  // Create target database
  header('Step 5: Create consolidated database');

  if (existsSync(targetPath)) {
    warn(`Target file exists, will be overwritten: ${targetPath}`);
  }

  const targetDb = new Database(targetPath);
  initializeTargetDatabase(targetDb);

  // Insert memories
  const insertMemory = targetDb.prepare(`
    INSERT OR REPLACE INTO memories
    (id, content, type, importance, embedding, created_at, last_accessed, expires_at, metadata, is_deleted, summary, access_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMemories = targetDb.transaction((memories) => {
    for (const m of memories) {
      // Generate summary if missing
      let summary = m.summary;
      if (!summary) {
        const firstSentence = m.content.match(/^[^.!?]+[.!?]/);
        if (firstSentence && firstSentence[0].length <= 100) {
          summary = firstSentence[0].trim();
        } else if (m.content.length > 100) {
          summary = m.content.substring(0, 97) + '...';
        } else {
          summary = m.content;
        }
      }

      insertMemory.run(
        m.id, m.content, m.type, m.importance, m.embedding,
        m.created_at, m.last_accessed, m.expires_at, m.metadata,
        m.is_deleted, summary, m.access_count || 0
      );
    }
  });

  insertMemories(mergedMemories.memories);
  success(`Inserted ${mergedMemories.memories.length} memories`);

  // Insert entities
  const insertEntity = targetDb.prepare(`
    INSERT OR REPLACE INTO entities (id, name, type, metadata, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertEntities = targetDb.transaction((entities) => {
    for (const e of entities) {
      insertEntity.run(e.id, e.name, e.type, e.metadata, e.created_at);
    }
  });

  insertEntities(mergedEntities.entities);
  success(`Inserted ${mergedEntities.entities.length} entities`);

  // Insert memory_entities (rebuild with mapped IDs)
  const insertMemoryEntity = targetDb.prepare(`
    INSERT OR IGNORE INTO memory_entities (memory_id, entity_id, created_at)
    VALUES (?, ?, ?)
  `);

  let memoryEntityCount = 0;
  const insertMemoryEntities = targetDb.transaction((links) => {
    for (const link of links) {
      const newMemoryId = memoryIdMap.get(link.memory_id);
      if (newMemoryId) {
        insertMemoryEntity.run(newMemoryId, link.entity_id, link.created_at);
        memoryEntityCount++;
      }
    }
  });

  insertMemoryEntities(allMemoryEntities);
  success(`Inserted ${memoryEntityCount} memory-entity links`);

  // Insert provenance (with mapped memory IDs)
  const insertProvenance = targetDb.prepare(`
    INSERT OR IGNORE INTO provenance (id, memory_id, operation, timestamp, source, context, user_id, changes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let provenanceCount = 0;
  const insertProvenanceRecords = targetDb.transaction((records) => {
    for (const p of records) {
      const newMemoryId = memoryIdMap.get(p.memory_id);
      if (newMemoryId) {
        insertProvenance.run(p.id, newMemoryId, p.operation, p.timestamp, p.source, p.context, p.user_id, p.changes);
        provenanceCount++;
      }
    }
  });

  insertProvenanceRecords(allProvenance);
  success(`Inserted ${provenanceCount} provenance records`);

  // Build FTS index
  header('Step 6: Build FTS index');
  buildFtsIndex(targetDb);
  success('FTS index built');

  // Optimize
  targetDb.pragma('optimize');
  targetDb.exec('ANALYZE');

  targetDb.close();

  // Summary
  header('Consolidation Complete!');
  const targetSize = statSync(targetPath).size;
  log(`  Target: ${targetPath} (${(targetSize / 1024).toFixed(1)} KB)`);
  log(`  Memories: ${mergedMemories.memories.length} (${mergedMemories.duplicatesFound} duplicates removed)`);
  log(`  Entities: ${mergedEntities.entities.length}`);
  log(`  Provenance: ${provenanceCount}`);
  log('');
  success('Source databases were NOT modified (kept as-is)');
  log('\nYou can now update your config to use the consolidated database.');
}

// CLI
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log(`
${colors.bright}Memory Database Consolidation Tool${colors.reset}

Merges multiple memory database files into one, deduplicating by content hash.

${colors.cyan}Usage:${colors.reset}
  node scripts/consolidate-memories.js <target.db> <source1.db> [source2.db] ...

${colors.cyan}Example:${colors.reset}
  node scripts/consolidate-memories.js ~/.memory-mcp/consolidated.db ~/old-db1.db ~/old-db2.db

${colors.cyan}Options:${colors.reset}
  - Duplicates are identified by content hash (same content + type)
  - When duplicates found, keeps the most recently accessed version
  - Merges access_count from all duplicates
  - Preserves all provenance records
  - Source databases are NOT modified

${colors.yellow}Note:${colors.reset} Run this from the claude-memory-mcp directory after building.
`);
  process.exit(1);
}

const [targetPath, ...sourcePaths] = args.map(p => resolve(p));

try {
  consolidate(targetPath, sourcePaths);
} catch (err) {
  error(`Consolidation failed: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
}
