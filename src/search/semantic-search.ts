/**
 * Full-text search implementation using SQLite FTS5
 * Replaces vector embeddings with lightweight keyword/phrase matching
 */

import type { DbDriver } from '../database/db-driver.js';
import type {
  Memory,
  MemorySearchResult,
  SearchOptionsInternal,
  SearchFilters,
  MemoryRow,
  Entity,
  Provenance,
} from '../types/index.js';
import { deserializeMetadata } from '../database/connection.js';

// Database row types (before deserialization)
interface EntityRow {
  id: string;
  name: string;
  type: string;
  metadata: string;
  created_at: number;
}

interface ProvenanceRow {
  id: string;
  memory_id: string;
  operation: string;
  timestamp: number;
  source: string;
  context: string | null;
  user_id: string | null;
  changes: string | null;
}

interface EntityJoinRow extends EntityRow {
  memory_id: string;
}

/**
 * Perform full-text search on memories using FTS5
 * Returns: { results: MemorySearchResult[], totalCount: number }
 */
export function semanticSearch(
  db: DbDriver,
  options: SearchOptionsInternal
): { results: MemorySearchResult[]; totalCount: number } {
  const {
    query,
    type,
    entities,
    limit = 10,
    offset = 0,
    minImportance,
    includeExpired = false,
  } = options;

  // Sanitize query for FTS5 (special chars and operators cause parse errors)
  const ftsQuery = sanitizeFtsQuery(query);

  // Empty query after sanitization = no results
  if (!ftsQuery) {
    return { results: [], totalCount: 0 };
  }

  // Pre-filter candidates using FTS5
  const filters: SearchFilters = { includeExpired };
  if (type !== undefined) filters.type = type;
  if (entities !== undefined) filters.entities = entities;
  if (minImportance !== undefined) filters.minImportance = minImportance;

  const candidates = getFilteredCandidates(db, ftsQuery, filters);

  // Calculate hybrid scores (FTS rank + importance + recency)
  const scoredResults = candidates.map((memory) => {
    const hybridScore = calculateHybridScore(memory);

    return {
      ...memory,
      score: hybridScore,
      entities: [], // Will be populated later
      provenance: [], // Will be populated later
    };
  });

  // Sort by score
  scoredResults.sort((a, b) => b.score - a.score);

  // Total count before pagination
  const totalCount = scoredResults.length;

  // Apply pagination
  const paginatedResults = scoredResults.slice(offset, offset + limit);

  // Enrich with entities and provenance
  const enrichedResults = enrichResults(db, paginatedResults);

  return {
    results: enrichedResults,
    totalCount,
  };
}

/**
 * Sanitize user query for FTS5 to prevent parse errors.
 * Quotes each word for literal matching, stripping FTS5 special characters.
 */
function sanitizeFtsQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return '';

  // Split into words, quote each for literal matching.
  // This prevents FTS5 operators (AND, OR, NOT, NEAR) from being interpreted.
  const words = trimmed.split(/\s+/);

  return words
    .map((word) => {
      // Strip double quotes (FTS5 phrase delimiter) and asterisks (prefix operator)
      const cleaned = word.replace(/["*]/g, '');
      return cleaned ? `"${cleaned}"` : '';
    })
    .filter((w) => w.length > 0)
    .join(' ');
}

/**
 * Get filtered candidate memories using FTS5
 */
function getFilteredCandidates(
  db: DbDriver,
  ftsQuery: string,
  filters: SearchFilters
): Memory[] {
  const { type, entities, minImportance, includeExpired } = filters;

  // Use FTS5 for keyword search
  let query = `
    SELECT m.*
    FROM memories m
    JOIN memories_fts fts ON m.id = fts.memory_id
    WHERE fts.memories_fts MATCH ?
      AND m.is_deleted = 0
  `;

  const params: (string | number)[] = [ftsQuery];

  // Type filter
  if (type) {
    query += ` AND m.type = ?`;
    params.push(type);
  }

  // Importance filter
  if (minImportance !== undefined) {
    query += ` AND m.importance >= ?`;
    params.push(minImportance);
  }

  // Expiration filter
  if (!includeExpired) {
    query += ` AND (m.expires_at IS NULL OR m.expires_at > ?)`;
    params.push(Date.now());
  }

  // Entity filter (if specified)
  if (entities && entities.length > 0) {
    query += `
      AND m.id IN (
        SELECT memory_id FROM memory_entities
        WHERE entity_id IN (
          SELECT id FROM entities WHERE name IN (${entities.map(() => '?').join(',')})
        )
      )
    `;
    params.push(...entities);
  }

  // Order by importance and recency (FTS match is implicit by MATCH clause)
  // Actual ranking happens in calculateHybridScore()
  query += ` ORDER BY m.importance DESC, m.last_accessed DESC`;

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as MemoryRow[];

  return rows.map(rowToMemory);
}

/**
 * Calculate hybrid score (FTS rank + importance + recency)
 */
function calculateHybridScore(memory: Memory): number {
  const now = Date.now();

  // Importance component (0-1)
  const importanceScore = memory.importance / 10;

  // Recency component (0-1)
  const recencyScore = calculateRecencyScore(memory.last_accessed, now);

  // Frequency component (0-1)
  const frequencyScore = Math.min(memory.access_count / 100, 1.0);

  // Weighted combination
  return (
    importanceScore * 0.4 +   // 40% importance
    recencyScore * 0.3 +      // 30% recency
    frequencyScore * 0.2 +    // 20% frequency
    0.1                        // 10% base score
  );
}

/**
 * Calculate recency score (0-1)
 */
function calculateRecencyScore(lastAccessed: number, now: number): number {
  const hoursAgo = (now - lastAccessed) / (1000 * 60 * 60);

  if (hoursAgo < 1) return 1.0;
  if (hoursAgo < 6) return 0.8;
  if (hoursAgo < 24) return 0.6;
  if (hoursAgo < 168) return 0.4;
  if (hoursAgo < 720) return 0.2;
  return 0.0;
}

/**
 * Enrich results with entities and provenance
 */
function enrichResults(
  db: DbDriver,
  results: MemorySearchResult[]
): MemorySearchResult[] {
  if (results.length === 0) {
    return results;
  }

  // Batch fetch entities
  const memoryIds = results.map((r) => r.id);
  const entitiesMap = batchFetchEntities(db, memoryIds);

  // Batch fetch provenance (last 3 records per memory)
  const provenanceMap = batchFetchProvenance(db, memoryIds);

  return results.map((result) => ({
    ...result,
    entities: entitiesMap.get(result.id) || [],
    provenance: provenanceMap.get(result.id) || [],
  }));
}

/**
 * Batch fetch entities for memories
 */
function batchFetchEntities(
  db: DbDriver,
  memoryIds: string[]
): Map<string, Entity[]> {
  const entitiesMap = new Map<string, Entity[]>();

  if (memoryIds.length === 0) {
    return entitiesMap;
  }

  const placeholders = memoryIds.map(() => '?').join(',');
  const query = `
    SELECT me.memory_id, e.*
    FROM memory_entities me
    JOIN entities e ON me.entity_id = e.id
    WHERE me.memory_id IN (${placeholders})
    ORDER BY e.name
  `;

  const rows = db.prepare(query).all(...memoryIds) as unknown as EntityJoinRow[];

  for (const row of rows) {
    const memoryId = row.memory_id;
    if (!entitiesMap.has(memoryId)) {
      entitiesMap.set(memoryId, []);
    }
    entitiesMap.get(memoryId)?.push({
      id: row.id,
      name: row.name,
      type: row.type as Entity['type'],
      metadata: deserializeMetadata(row.metadata),
      created_at: row.created_at,
    });
  }

  return entitiesMap;
}

/**
 * Batch fetch provenance for memories
 */
function batchFetchProvenance(
  db: DbDriver,
  memoryIds: string[]
): Map<string, Provenance[]> {
  const provenanceMap = new Map<string, Provenance[]>();

  if (memoryIds.length === 0) {
    return provenanceMap;
  }

  const placeholders = memoryIds.map(() => '?').join(',');
  const query = `
    SELECT *
    FROM provenance
    WHERE memory_id IN (${placeholders})
    ORDER BY memory_id, timestamp DESC
  `;

  const rows = db.prepare(query).all(...memoryIds) as unknown as ProvenanceRow[];

  for (const row of rows) {
    const memoryId = row.memory_id;
    if (!provenanceMap.has(memoryId)) {
      provenanceMap.set(memoryId, []);
    }

    const provenance = provenanceMap.get(memoryId);
    if (provenance && provenance.length < 3) {
      // Only keep last 3 provenance records
      provenance.push({
        id: row.id,
        memory_id: row.memory_id,
        operation: row.operation as Provenance['operation'],
        timestamp: row.timestamp,
        source: row.source,
        context: row.context,
        user_id: row.user_id,
        changes: row.changes ? deserializeMetadata(row.changes) : null,
      });
    }
  }

  return provenanceMap;
}

/**
 * Convert database row to Memory object
 */
function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    content: row.content,
    summary: row.summary,
    type: row.type as 'fact' | 'entity' | 'relationship' | 'self',
    importance: row.importance,
    created_at: row.created_at,
    last_accessed: row.last_accessed,
    access_count: row.access_count,
    expires_at: row.expires_at,
    metadata: deserializeMetadata(row.metadata),
    is_deleted: row.is_deleted === 1,
  };
}
