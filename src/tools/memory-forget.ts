/**
 * Memory forget tool - Soft delete memories
 */

import type { DbDriver } from '../database/db-driver.js';
import type { ForgetResponse } from '../types/index.js';
import { now, generateId, serializeMetadata } from '../database/connection.js';
import { ValidationError } from '../types/index.js';

/**
 * Forget (soft delete) a memory
 */
export function memoryForget(
  db: DbDriver,
  id: string,
  reason?: string
): ForgetResponse {
  // Check if memory exists
  const existing = db
    .prepare('SELECT id FROM memories WHERE id = ? AND is_deleted = 0')
    .get(id) as { id: string } | undefined;

  if (!existing) {
    throw new ValidationError(`Memory ${id} not found or already deleted`);
  }

  // Soft delete (mark as deleted)
  const currentTime = now();
  db.prepare('UPDATE memories SET is_deleted = 1 WHERE id = ?').run(id);

  // Create provenance record
  const provenanceId = generateId('prov');
  db.prepare(
    `
    INSERT INTO provenance (
      id, memory_id, operation, timestamp, source, context, user_id, changes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    provenanceId,
    id,
    'delete',
    currentTime,
    'user',
    reason || 'User requested deletion',
    null,
    serializeMetadata({ soft_delete: true })
  );

  const response: ForgetResponse = {
    success: true,
    memory_id: id,
    message: `Memory soft-deleted successfully. Reason: ${reason || 'Not specified'}`,
  };

  return response;
}
