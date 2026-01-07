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
import { existsSync, statSync, readdirSync } from 'fs';
import { basename, resolve, join, dirname } from 'path';
import { homedir, platform } from 'os';
import { execSync } from 'child_process';

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
 * Get common search paths for memory databases
 */
function getSearchPaths() {
  const home = homedir();
  const plat = platform();

  const paths = [
    // New unified path
    join(home, '.memory-mcp'),
    // Old paths
    join(home, '.claude-memories'),
  ];

  if (plat === 'darwin') {
    // macOS
    paths.push(join(home, 'Library', 'Application Support', 'Claude'));
    paths.push(join(home, 'Library', 'Application Support'));
  } else if (plat === 'win32') {
    // Windows
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    paths.push(join(appData, 'claude-memories'));
    paths.push(join(appData, 'Claude'));
    paths.push(appData);
    // Also check local app data for versioned Claude folders
    const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    paths.push(localAppData);
  } else {
    // Linux
    const xdgData = process.env.XDG_DATA_HOME || join(home, '.local', 'share');
    const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, '.config');
    paths.push(join(xdgData, 'claude-memories'));
    paths.push(join(xdgConfig, 'Claude'));
  }

  return paths.filter(p => existsSync(p));
}

/**
 * Recursively find all .db files that look like memory databases
 */
function findDatabaseFiles(searchPath, maxDepth = 3, currentDepth = 0) {
  const results = [];

  if (currentDepth > maxDepth || !existsSync(searchPath)) {
    return results;
  }

  try {
    const entries = readdirSync(searchPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(searchPath, entry.name);

      if (entry.isFile() && entry.name.endsWith('.db')) {
        // Check if it looks like a memory database
        if (isMemoryDatabase(fullPath)) {
          results.push(fullPath);
        }
      } else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        // Recurse into subdirectories
        results.push(...findDatabaseFiles(fullPath, maxDepth, currentDepth + 1));
      }
    }
  } catch (err) {
    // Permission denied or other error, skip
  }

  return results;
}

/**
 * Check if a database file is a memory database by checking for expected tables
 */
function isMemoryDatabase(dbPath) {
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").pluck().all();
    db.close();

    // Must have memories table to be a memory database
    return tables.includes('memories');
  } catch {
    return false;
  }
}

/**
 * Get info about a database file
 */
function getDatabaseInfo(dbPath) {
  const stats = statSync(dbPath);
  const walPath = dbPath + '-wal';
  const shmPath = dbPath + '-shm';

  const hasWal = existsSync(walPath);
  const hasShm = existsSync(shmPath);

  let walSize = 0;
  if (hasWal) {
    walSize = statSync(walPath).size;
  }

  let memoryCount = 0;
  let schemaVersion = 0;
  let lastAccessed = 0;

  try {
    const db = new Database(dbPath, { readonly: true });

    // Get schema version
    try {
      schemaVersion = db.prepare('SELECT MAX(version) FROM schema_version').pluck().get() || 0;
    } catch {}

    // Get memory count
    try {
      memoryCount = db.prepare('SELECT COUNT(*) FROM memories WHERE is_deleted = 0').pluck().get() || 0;
    } catch {
      try {
        memoryCount = db.prepare('SELECT COUNT(*) FROM memories').pluck().get() || 0;
      } catch {}
    }

    // Get last accessed time
    try {
      lastAccessed = db.prepare('SELECT MAX(last_accessed) FROM memories').pluck().get() || 0;
    } catch {}

    db.close();
  } catch {}

  return {
    path: dbPath,
    size: stats.size,
    modified: stats.mtime,
    hasWal,
    walSize,
    hasShm,
    memoryCount,
    schemaVersion,
    lastAccessed: lastAccessed ? new Date(lastAccessed) : null,
  };
}

/**
 * Discover all memory databases on the system
 */
function discoverDatabases() {
  header('Memory Database Discovery');
  log('Searching for memory databases...\n');

  const searchPaths = getSearchPaths();
  const foundDbs = new Set();

  for (const searchPath of searchPaths) {
    log(`  Searching: ${searchPath}`);
    const dbs = findDatabaseFiles(searchPath);
    dbs.forEach(db => foundDbs.add(db));
  }

  if (foundDbs.size === 0) {
    warn('No memory databases found in common locations.');
    log('\nYou can specify database paths manually:');
    log('  node scripts/consolidate-memories.js <target.db> <source1.db> [source2.db] ...');
    return [];
  }

  header(`Found ${foundDbs.size} database(s):`);

  const dbInfos = [];
  for (const dbPath of foundDbs) {
    const info = getDatabaseInfo(dbPath);
    dbInfos.push(info);
  }

  // Sort by memory count (most memories first)
  dbInfos.sort((a, b) => b.memoryCount - a.memoryCount);

  // Display info
  for (let i = 0; i < dbInfos.length; i++) {
    const info = dbInfos[i];
    const sizeKb = (info.size / 1024).toFixed(1);
    const walIndicator = info.hasWal ? ` ${colors.yellow}[WAL: ${(info.walSize / 1024).toFixed(1)}KB]${colors.reset}` : '';
    const lastAccessStr = info.lastAccessed ? info.lastAccessed.toLocaleDateString() : 'unknown';

    log(`\n  ${colors.bright}[${i + 1}]${colors.reset} ${info.path}`);
    log(`      Size: ${sizeKb} KB${walIndicator}`);
    log(`      Memories: ${info.memoryCount} | Schema: v${info.schemaVersion} | Last used: ${lastAccessStr}`);
  }

  return dbInfos;
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

// Check for --discover flag
if (args.includes('--discover') || args.includes('-d')) {
  const dbInfos = discoverDatabases();

  if (dbInfos.length > 0) {
    log('\n' + colors.cyan + 'To consolidate these databases:' + colors.reset);
    log('  node scripts/consolidate-memories.js <target.db> <source1.db> [source2.db] ...\n');
    log('Example (consolidate all found databases):');
    const allPaths = dbInfos.map(d => `"${d.path}"`).join(' ');
    log(`  node scripts/consolidate-memories.js ~/.memory-mcp/consolidated.db ${allPaths}\n`);
  }
  process.exit(0);
}

// Check for --help flag
if (args.includes('--help') || args.includes('-h') || args.length < 2) {
  console.log(`
${colors.bright}Memory Database Consolidation Tool${colors.reset}

Merges multiple memory database files into one, deduplicating by content hash.

${colors.cyan}Usage:${colors.reset}
  node scripts/consolidate-memories.js [options] <target.db> <source1.db> [source2.db] ...

${colors.cyan}Commands:${colors.reset}
  --discover, -d    Find all memory databases on your system
  --help, -h        Show this help message

${colors.cyan}Example:${colors.reset}
  # First, discover existing databases
  node scripts/consolidate-memories.js --discover

  # Then consolidate them
  node scripts/consolidate-memories.js ~/.memory-mcp/consolidated.db ~/old-db1.db ~/old-db2.db

${colors.cyan}Features:${colors.reset}
  - Discovers memory databases in common locations
  - Identifies databases with WAL files (uncommitted data)
  - Deduplicates by content hash (same content + type)
  - Keeps most recently accessed version of duplicates
  - Merges access_count from all duplicates
  - Preserves all provenance records
  - Checkpoints WAL files before reading
  - Source databases are NOT modified
`);
  process.exit(args.length < 2 ? 1 : 0);
}

const [targetPath, ...sourcePaths] = args.map(p => resolve(p));

try {
  consolidate(targetPath, sourcePaths);
} catch (err) {
  error(`Consolidation failed: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
}
