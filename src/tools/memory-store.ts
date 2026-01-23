/**
 * Memory store tool - Store or update memories with auto-extraction
 * v2.0: Merged create + update functionality with summary generation
 */

import type { DbDriver } from '../database/db-driver.js';
import type { MemoryInput, Memory, Entity, StandardMemory } from '../types/index.js';
import {
  extractEntities,
  createEntityInput,
  deduplicateEntities,
} from '../extractors/entity-extractor.js';
import {
  classifyMemoryType,
  normalizeContent,
  validateContent,
} from '../extractors/fact-extractor.js';
import { calculateImportance } from '../scoring/importance.js';
import { calculateTTLDays, calculateExpiresAt } from '../scoring/ttl-manager.js';
import {
  generateId,
  now,
  serializeMetadata,
  deserializeMetadata,
} from '../database/connection.js';
import { ValidationError } from '../types/index.js';
import { generateSummary } from '../extractors/summary-generator.js';
import { formatMemory } from './response-formatter.js';
import { getMemoryCache } from '../cache/memory-cache.js';

// Database row types (raw, before deserialization)
interface EntityRow {
  id: string;
  name: string;
  type: string;
  metadata: string;
  created_at: number;
}

interface MemoryRowDB {
  id: string;
  content: string;
  summary: string;
  type: string;
  importance: number;
  created_at: number;
  last_accessed: number;
  access_count: number;
  expires_at: number | null;
  metadata: string;
  is_deleted: number;
}

/**
 * Store or update a memory
 * If input.id is provided, updates existing memory
 * If input.id is not provided, creates new memory
 */
export function memoryStore(
  db: DbDriver,
  input: MemoryInput
): StandardMemory {
  // Determine if this is an update or create
  const isUpdate = !!input.id;

  if (isUpdate) {
    return updateMemory(db, input);
  } else {
    return createMemory(db, input);
  }
}

/**
 * Create a new memory
 */
function createMemory(
  db: DbDriver,
  input: MemoryInput
): StandardMemory {
  // Validate content
  const validation = validateContent(input.content, input.type);
  if (!validation.valid) {
    throw new ValidationError(validation.errors.join(', '));
  }

  // Normalize content
  const normalizedContent = normalizeContent(input.content);

  // Generate summary
  const summary = generateSummary(normalizedContent);

  // Extract entities if not provided
  let entities = input.entities || [];
  if (entities.length === 0) {
    entities = extractEntities(normalizedContent);
    entities = deduplicateEntities(entities);
  }

  // Auto-classify type if needed
  const finalType = input.type || classifyMemoryType(normalizedContent, entities);

  // Calculate importance
  const importance =
    input.importance ??
    calculateImportance(
      normalizedContent,
      finalType,
      entities,
      input.metadata || {},
      input.provenance !== undefined
    );

  // Calculate TTL
  let expiresAt: number | null = null;
  if (input.expires_at) {
    expiresAt = new Date(input.expires_at).getTime();
  } else {
    const ttlDays =
      input.ttl_days !== undefined
        ? input.ttl_days
        : calculateTTLDays(importance);
    expiresAt = calculateExpiresAt(ttlDays, importance, now());
  }

  // Create memory
  const memoryId = generateId('mem');
  const createdAt = now();
  const metadata = input.metadata || {};

  // Merge tags into metadata if provided
  if (input.tags && input.tags.length > 0) {
    metadata.tags = input.tags;
  }

  db.prepare(
    `
    INSERT INTO memories (
      id, content, summary, type, importance, embedding,
      created_at, last_accessed, access_count, expires_at, metadata, is_deleted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `
  ).run(
    memoryId,
    normalizedContent,
    summary,
    finalType,
    importance,
    null, // No longer using embeddings
    createdAt,
    createdAt,
    0, // Initial access_count
    expiresAt,
    serializeMetadata(metadata)
  );

  // Create or link entities
  const entityObjects: Entity[] = [];
  for (const entityName of entities) {
    const entityId = createOrGetEntity(db, entityName, normalizedContent);

    // Fetch entity details
    const entityRow = db
      .prepare('SELECT * FROM entities WHERE id = ?')
      .get(entityId) as EntityRow | undefined;

    if (entityRow) {
      entityObjects.push({
        id: entityRow.id,
        name: entityRow.name,
        type: entityRow.type as Entity['type'],
        metadata: deserializeMetadata(entityRow.metadata),
        created_at: entityRow.created_at,
      });
    }

    // Link memory to entity
    db.prepare(
      `INSERT INTO memory_entities (memory_id, entity_id, created_at) VALUES (?, ?, ?)`
    ).run(memoryId, entityId, createdAt);
  }

  // Create provenance record
  const provenanceId = generateId('prov');
  const provenance = input.provenance || {
    source: 'user',
    timestamp: new Date().toISOString(),
  };

  db.prepare(
    `
    INSERT INTO provenance (
      id, memory_id, operation, timestamp, source, context, user_id, changes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    provenanceId,
    memoryId,
    'create',
    createdAt,
    provenance.source,
    provenance.context || null,
    provenance.user_id || null,
    null
  );

  // Build Memory object for formatting
  const memory: Memory = {
    id: memoryId,
    content: normalizedContent,
    summary,
    type: finalType,
    importance,
    created_at: createdAt,
    last_accessed: createdAt,
    access_count: 0,
    expires_at: expiresAt,
    metadata,
    is_deleted: false,
  };

  // Format response using standard detail level (NO embeddings)
  const formattedResponse = formatMemory(memory, 'standard', { entities: entityObjects }) as StandardMemory;

  // Cache the newly created memory
  const cache = getMemoryCache();
  cache.set(memoryId, memory, entityObjects);

  return formattedResponse;
}

/**
 * Update an existing memory
 */
function updateMemory(
  db: DbDriver,
  input: MemoryInput
): StandardMemory {
  // Check if memory exists
  const existing = db
    .prepare('SELECT * FROM memories WHERE id = ? AND is_deleted = 0')
    .get(input.id ?? '') as MemoryRowDB | undefined;

  if (!existing) {
    throw new ValidationError(`Memory ${input.id} not found or is deleted`);
  }

  const changes: Record<string, unknown> = {};
  const currentTime = now();

  let newContent = existing.content;
  let newSummary = existing.summary;

  // Update content if provided
  if (input.content !== undefined) {
    newContent = normalizeContent(input.content);
    newSummary = generateSummary(newContent);

    db.prepare('UPDATE memories SET content = ?, summary = ? WHERE id = ?').run(
      newContent,
      newSummary,
      input.id
    );

    changes['content'] = { from: existing.content, to: newContent };
    changes['summary'] = { from: existing.summary, to: newSummary };
  }

  // Update importance if provided
  if (input.importance !== undefined) {
    db.prepare('UPDATE memories SET importance = ? WHERE id = ?').run(
      input.importance,
      input.id
    );

    changes['importance'] = {
      from: existing.importance,
      to: input.importance,
    };
  }

  // Update metadata if provided
  let updatedMetadata = deserializeMetadata(existing.metadata);
  if (input.metadata !== undefined) {
    updatedMetadata = { ...updatedMetadata, ...input.metadata };

    db.prepare('UPDATE memories SET metadata = ? WHERE id = ?').run(
      serializeMetadata(updatedMetadata),
      input.id
    );

    changes['metadata'] = { merged: input.metadata };
  }

  // Update tags in metadata if provided
  if (input.tags !== undefined) {
    updatedMetadata.tags = input.tags;

    db.prepare('UPDATE memories SET metadata = ? WHERE id = ?').run(
      serializeMetadata(updatedMetadata),
      input.id
    );

    changes['tags'] = { to: input.tags };
  }

  // Update TTL if provided
  let newExpiresAt = existing.expires_at;
  if (input.ttl_days !== undefined || input.expires_at !== undefined) {
    if (input.expires_at) {
      newExpiresAt = new Date(input.expires_at).getTime();
    } else {
      const newImportance = input.importance ?? existing.importance;
      const ttlDays = input.ttl_days ?? calculateTTLDays(newImportance);
      newExpiresAt = calculateExpiresAt(ttlDays, newImportance, currentTime);
    }

    db.prepare('UPDATE memories SET expires_at = ? WHERE id = ?').run(
      newExpiresAt,
      input.id
    );

    changes['expires_at'] = {
      from: existing.expires_at,
      to: newExpiresAt,
    };
  }

  // Update entities if provided
  let entityObjects: Entity[] = [];
  if (input.entities !== undefined) {
    // Remove existing entity links
    db.prepare('DELETE FROM memory_entities WHERE memory_id = ?').run(input.id);

    // Create new entity links
    for (const entityName of input.entities) {
      const entityId = createOrGetEntity(db, entityName, newContent);

      // Fetch entity details
      const entityRow = db
        .prepare('SELECT * FROM entities WHERE id = ?')
        .get(entityId) as EntityRow | undefined;

      if (entityRow) {
        entityObjects.push({
          id: entityRow.id,
          name: entityRow.name,
          type: entityRow.type as Entity['type'],
          metadata: deserializeMetadata(entityRow.metadata),
          created_at: entityRow.created_at,
        });
      }

      db.prepare(
        `INSERT INTO memory_entities (memory_id, entity_id, created_at) VALUES (?, ?, ?)`
      ).run(input.id, entityId, currentTime);
    }

    changes['entities'] = { to: input.entities };
  } else {
    // Fetch existing entities
    const entityRows = db
      .prepare(
        `
      SELECT e.* FROM entities e
      JOIN memory_entities me ON e.id = me.entity_id
      WHERE me.memory_id = ?
    `
      )
      .all(input.id) as EntityRow[];

    entityObjects = entityRows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type as Entity['type'],
      metadata: deserializeMetadata(row.metadata),
      created_at: row.created_at,
    }));
  }

  // Create provenance record
  const provenanceId = generateId('prov');
  const provenance = input.provenance || {
    source: 'user',
  };

  db.prepare(
    `
    INSERT INTO provenance (
      id, memory_id, operation, timestamp, source, context, user_id, changes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    provenanceId,
    input.id,
    'update',
    currentTime,
    provenance.source,
    provenance.context || `Updated ${Object.keys(changes).length} field(s)`,
    provenance.user_id || null,
    serializeMetadata(changes)
  );

  // Build Memory object for formatting
  const memory: Memory = {
    id: input.id ?? existing.id,
    content: newContent,
    summary: newSummary,
    type: existing.type as Memory['type'],
    importance: input.importance ?? existing.importance,
    created_at: existing.created_at,
    last_accessed: existing.last_accessed,
    access_count: existing.access_count,
    expires_at: newExpiresAt,
    metadata: updatedMetadata,
    is_deleted: false,
  };

  // Format response using standard detail level (NO embeddings)
  const formattedResponse = formatMemory(memory, 'standard', { entities: entityObjects }) as StandardMemory;

  // Invalidate and re-cache updated memory
  const cache = getMemoryCache();
  cache.invalidate(input.id ?? existing.id);
  cache.set(input.id ?? existing.id, memory, entityObjects);

  return formattedResponse;
}

/**
 * Create or get existing entity
 */
function createOrGetEntity(
  db: DbDriver,
  name: string,
  context: string
): string {
  // Check if entity exists
  const existing = db
    .prepare('SELECT id FROM entities WHERE name = ?')
    .get(name) as { id: string } | undefined;

  if (existing) {
    return existing.id;
  }

  // Create new entity
  const entityInput = createEntityInput(name, context);
  const entityId = generateId('ent');

  db.prepare(
    `
    INSERT INTO entities (id, name, type, metadata, created_at)
    VALUES (?, ?, ?, ?, ?)
  `
  ).run(
    entityId,
    entityInput.name,
    entityInput.type || 'other',
    serializeMetadata(entityInput.metadata || {}),
    now()
  );

  return entityId;
}
