/**
 * Memory forget tool - Soft delete memories
 */

import type Database from 'better-sqlite3';
import type { ForgetResponse } from '../types/index.js';
import { now, generateId, serializeMetadata } from '../database/connection.js';
import { ValidationError } from '../types/index.js';
import { getPluginManager } from '../core/plugin-manager.js';

/**
 * Forget (soft delete) a memory
 */
export async function memoryForget(
  db: Database.Database,
  id: string,
  reason?: string
): Promise<ForgetResponse> {
  // Execute before_forget hooks
  const pluginManager = getPluginManager();
  const processedData = await pluginManager.executeHooks('before_forget', { id, reason });

  // Check if memory exists
  const existing = db
    .prepare('SELECT id FROM memories WHERE id = ? AND is_deleted = 0')
    .get(processedData.id) as { id: string } | undefined;

  if (!existing) {
    throw new ValidationError(`Memory ${processedData.id} not found or already deleted`);
  }

  // Soft delete (mark as deleted)
  const currentTime = now();
  db.prepare('UPDATE memories SET is_deleted = 1 WHERE id = ?').run(processedData.id);

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
    processedData.id,
    'delete',
    currentTime,
    'user',
    processedData.reason || 'User requested deletion',
    null,
    serializeMetadata({ soft_delete: true })
  );

  const response: ForgetResponse = {
    success: true,
    memory_id: processedData.id,
    message: `Memory soft-deleted successfully. Reason: ${processedData.reason || 'Not specified'}`,
  };

  // Execute after_forget hooks
  await pluginManager.executeHooks('after_forget', response);

  return response;
}
