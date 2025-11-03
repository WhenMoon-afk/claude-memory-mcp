/**
 * Memory store tool - Store or update memories with auto-extraction
 * v2.0: Merged create + update functionality with summary generation
 */

import type Database from 'better-sqlite3';
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
import { getPluginManager } from '../core/plugin-manager.js';
import { generateSummary } from '../extractors/summary-generator.js';
import { formatMemory } from './response-formatter.js';

/**
 * Store or update a memory
 * If input.id is provided, updates existing memory
 * If input.id is not provided, creates new memory
 */
export async function memoryStore(
  db: Database.Database,
  input: MemoryInput
): Promise<StandardMemory> {
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
async function createMemory(
  db: Database.Database,
  input: MemoryInput
): Promise<StandardMemory> {
  // Execute before_store hooks
  const pluginManager = getPluginManager();
  const processedInput = (await pluginManager.executeHooks('before_store', input)) as MemoryInput;

  // Validate content
  const validation = validateContent(processedInput.content, processedInput.type);
  if (!validation.valid) {
    throw new ValidationError(validation.errors.join(', '));
  }

  // Normalize content
  const normalizedContent = normalizeContent(processedInput.content);

  // Generate summary
  const summary = generateSummary(normalizedContent);

  // Extract entities if not provided
  let entities = processedInput.entities || [];
  if (entities.length === 0) {
    entities = extractEntities(normalizedContent);
    entities = deduplicateEntities(entities);
  }

  // Auto-classify type if needed
  const finalType = processedInput.type || classifyMemoryType(normalizedContent, entities);

  // Calculate importance
  const importance =
    processedInput.importance ??
    calculateImportance(
      normalizedContent,
      finalType,
      entities,
      processedInput.metadata || {},
      processedInput.provenance !== undefined
    );

  // Calculate TTL
  let expiresAt: number | null = null;
  if (processedInput.expires_at) {
    expiresAt = new Date(processedInput.expires_at).getTime();
  } else {
    const ttlDays =
      processedInput.ttl_days !== undefined
        ? processedInput.ttl_days
        : calculateTTLDays(importance);
    expiresAt = calculateExpiresAt(ttlDays, importance, now());
  }

  // Create memory
  const memoryId = generateId('mem');
  const createdAt = now();
  const metadata = processedInput.metadata || {};

  // Merge tags into metadata if provided
  if (processedInput.tags && processedInput.tags.length > 0) {
    metadata.tags = processedInput.tags;
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
    const entityId = await createOrGetEntity(db, entityName, normalizedContent);

    // Fetch entity details
    const entityRow = db
      .prepare('SELECT * FROM entities WHERE id = ?')
      .get(entityId) as any;

    if (entityRow) {
      entityObjects.push({
        id: entityRow.id,
        name: entityRow.name,
        type: entityRow.type,
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
  const provenance = processedInput.provenance || {
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

  // Execute after_store hooks
  await pluginManager.executeHooks('after_store', formattedResponse);

  return formattedResponse;
}

/**
 * Update an existing memory
 */
async function updateMemory(
  db: Database.Database,
  input: MemoryInput
): Promise<StandardMemory> {
  const pluginManager = getPluginManager();
  const processedInput = (await pluginManager.executeHooks('before_update', input)) as MemoryInput;

  // Check if memory exists
  const existing = db
    .prepare('SELECT * FROM memories WHERE id = ? AND is_deleted = 0')
    .get(processedInput.id!) as any;

  if (!existing) {
    throw new ValidationError(`Memory ${processedInput.id} not found or is deleted`);
  }

  const changes: Record<string, unknown> = {};
  const currentTime = now();

  let newContent = existing.content;
  let newSummary = existing.summary;

  // Update content if provided
  if (processedInput.content !== undefined) {
    newContent = normalizeContent(processedInput.content);
    newSummary = generateSummary(newContent);

    db.prepare('UPDATE memories SET content = ?, summary = ? WHERE id = ?').run(
      newContent,
      newSummary,
      processedInput.id
    );

    changes['content'] = { from: existing.content, to: newContent };
    changes['summary'] = { from: existing.summary, to: newSummary };
  }

  // Update importance if provided
  if (processedInput.importance !== undefined) {
    db.prepare('UPDATE memories SET importance = ? WHERE id = ?').run(
      processedInput.importance,
      processedInput.id
    );

    changes['importance'] = {
      from: existing.importance,
      to: processedInput.importance,
    };
  }

  // Update metadata if provided
  let updatedMetadata = deserializeMetadata(existing.metadata);
  if (processedInput.metadata !== undefined) {
    updatedMetadata = { ...updatedMetadata, ...processedInput.metadata };

    db.prepare('UPDATE memories SET metadata = ? WHERE id = ?').run(
      serializeMetadata(updatedMetadata),
      processedInput.id
    );

    changes['metadata'] = { merged: processedInput.metadata };
  }

  // Update tags in metadata if provided
  if (processedInput.tags !== undefined) {
    updatedMetadata.tags = processedInput.tags;

    db.prepare('UPDATE memories SET metadata = ? WHERE id = ?').run(
      serializeMetadata(updatedMetadata),
      processedInput.id
    );

    changes['tags'] = { to: processedInput.tags };
  }

  // Update TTL if provided
  let newExpiresAt = existing.expires_at;
  if (processedInput.ttl_days !== undefined || processedInput.expires_at !== undefined) {
    if (processedInput.expires_at) {
      newExpiresAt = new Date(processedInput.expires_at).getTime();
    } else {
      const newImportance = processedInput.importance ?? existing.importance;
      newExpiresAt = calculateExpiresAt(processedInput.ttl_days!, newImportance, currentTime);
    }

    db.prepare('UPDATE memories SET expires_at = ? WHERE id = ?').run(
      newExpiresAt,
      processedInput.id
    );

    changes['expires_at'] = {
      from: existing.expires_at,
      to: newExpiresAt,
    };
  }

  // Update entities if provided
  let entityObjects: Entity[] = [];
  if (processedInput.entities !== undefined) {
    // Remove existing entity links
    db.prepare('DELETE FROM memory_entities WHERE memory_id = ?').run(processedInput.id);

    // Create new entity links
    for (const entityName of processedInput.entities) {
      const entityId = await createOrGetEntity(db, entityName, newContent);

      // Fetch entity details
      const entityRow = db
        .prepare('SELECT * FROM entities WHERE id = ?')
        .get(entityId) as any;

      if (entityRow) {
        entityObjects.push({
          id: entityRow.id,
          name: entityRow.name,
          type: entityRow.type,
          metadata: deserializeMetadata(entityRow.metadata),
          created_at: entityRow.created_at,
        });
      }

      db.prepare(
        `INSERT INTO memory_entities (memory_id, entity_id, created_at) VALUES (?, ?, ?)`
      ).run(processedInput.id, entityId, currentTime);
    }

    changes['entities'] = { to: processedInput.entities };
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
      .all(processedInput.id) as any[];

    entityObjects = entityRows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      metadata: deserializeMetadata(row.metadata),
      created_at: row.created_at,
    }));
  }

  // Create provenance record
  const provenanceId = generateId('prov');
  const provenance = processedInput.provenance || {
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
    processedInput.id,
    'update',
    currentTime,
    provenance.source,
    provenance.context || `Updated ${Object.keys(changes).length} field(s)`,
    provenance.user_id || null,
    serializeMetadata(changes)
  );

  // Build Memory object for formatting
  const memory: Memory = {
    id: processedInput.id!,
    content: newContent,
    summary: newSummary,
    type: existing.type,
    importance: processedInput.importance ?? existing.importance,
    created_at: existing.created_at,
    last_accessed: existing.last_accessed,
    access_count: existing.access_count,
    expires_at: newExpiresAt,
    metadata: updatedMetadata,
    is_deleted: false,
  };

  // Format response using standard detail level (NO embeddings)
  const formattedResponse = formatMemory(memory, 'standard', { entities: entityObjects }) as StandardMemory;

  // Execute after_update hooks
  await pluginManager.executeHooks('after_update', formattedResponse);

  return formattedResponse;
}

/**
 * Create or get existing entity
 */
async function createOrGetEntity(
  db: Database.Database,
  name: string,
  context: string
): Promise<string> {
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
