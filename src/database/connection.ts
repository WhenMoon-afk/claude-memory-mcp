/**
 * Database connection management and utilities
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import {
  initializeSchema,
  createViews,
  optimizeDatabase,
  getDatabaseStats,
  type DatabaseStats,
} from './schema.js';
import { DatabaseError } from '../types/index.js';

let dbInstance: Database.Database | null = null;

/**
 * Get or create database connection
 */
export function getDatabase(path: string): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  try {
    // Ensure directory exists
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Open database
    dbInstance = new Database(path, {
      verbose: process.env['NODE_ENV'] === 'development' ? () => {} : undefined,
    });

    // Initialize schema
    initializeSchema(dbInstance);

    // Create views
    createViews(dbInstance);

    // Optimize
    optimizeDatabase(dbInstance);

    return dbInstance;
  } catch (error) {
    throw new DatabaseError('Failed to initialize database', {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Execute a transaction
 */
export function transaction<T>(db: Database.Database, fn: () => T): T {
  const txn = db.transaction(fn);
  return txn();
}

/**
 * Serialize metadata to JSON string
 */
export function serializeMetadata(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata);
}

/**
 * Deserialize metadata from JSON string
 */
export function deserializeMetadata(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Generate unique ID
 */
export function generateId(prefix: string = 'mem'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  return `${prefix}_${timestamp}${random}`;
}

/**
 * Get current timestamp in milliseconds
 */
export function now(): number {
  return Date.now();
}

/**
 * Calculate expiration timestamp
 */
export function calculateExpiresAt(ttlDays: number | null, importance: number): number | null {
  if (ttlDays === null) {
    return null; // Permanent
  }

  const baseTTL = ttlDays * 24 * 60 * 60 * 1000;
  const importanceBonus = (importance / 10) * 7 * 24 * 60 * 60 * 1000; // Up to 7 extra days

  return now() + baseTTL + importanceBonus;
}

/**
 * Check if memory is expired
 */
export function isExpired(expiresAt: number | null): boolean {
  if (expiresAt === null) {
    return false;
  }
  return expiresAt <= now();
}

/**
 * Refresh TTL on access
 */
export function refreshTTL(
  lastAccessed: number,
  importance: number,
  originalTTL: number | null
): number | null {
  if (originalTTL === null) {
    return null; // Permanent, no refresh
  }

  const daysSinceAccess = (now() - lastAccessed) / (1000 * 60 * 60 * 24);
  const accessBonus = (importance / 10) * 30 * 24 * 60 * 60 * 1000; // Up to 30 days

  if (importance >= 6 && daysSinceAccess > 7) {
    // Important memories: refresh TTL
    return now() + originalTTL + accessBonus;
  } else if (importance >= 4 && daysSinceAccess > 30) {
    // Moderately important: refresh after longer gap
    return now() + originalTTL + accessBonus / 2;
  }

  // Low importance: no refresh, let it expire
  return null;
}

/**
 * Prune expired and deleted memories
 */
export interface PruneResult {
  expired_count: number;
  deleted_count: number;
  total_pruned: number;
}

export function pruneMemories(
  db: Database.Database,
  olderThanDays: number = 0,
  dryRun: boolean = false
): PruneResult {
  const threshold = now() - olderThanDays * 24 * 60 * 60 * 1000;

  // Count expired memories
  const expiredCount = db
    .prepare(
      `
    SELECT COUNT(*) FROM memories
    WHERE is_deleted = 0
      AND expires_at IS NOT NULL
      AND expires_at <= ?
  `
    )
    .pluck()
    .get(threshold) as number;

  // Count soft-deleted memories
  const deletedCount = db
    .prepare(
      `
    SELECT COUNT(*) FROM memories
    WHERE is_deleted = 1
      AND created_at <= ?
  `
    )
    .pluck()
    .get(threshold) as number;

  if (dryRun) {
    return {
      expired_count: expiredCount,
      deleted_count: deletedCount,
      total_pruned: 0,
    };
  }

  // Permanently delete expired memories
  const expiredDeleted = db
    .prepare(
      `
    DELETE FROM memories
    WHERE is_deleted = 0
      AND expires_at IS NOT NULL
      AND expires_at <= ?
  `
    )
    .run(threshold);

  // Permanently delete soft-deleted memories
  const softDeleted = db
    .prepare(
      `
    DELETE FROM memories
    WHERE is_deleted = 1
      AND created_at <= ?
  `
    )
    .run(threshold);

  // Clean up orphaned entities (not linked to any memory)
  db.prepare(
    `
    DELETE FROM entities
    WHERE id NOT IN (SELECT DISTINCT entity_id FROM memory_entities)
  `
  ).run();

  return {
    expired_count: expiredCount,
    deleted_count: deletedCount,
    total_pruned: expiredDeleted.changes + softDeleted.changes,
  };
}

/**
 * Get database statistics
 */
export function getStats(db: Database.Database): DatabaseStats {
  return getDatabaseStats(db);
}

/**
 * Backup database to file
 */
export function backupDatabase(db: Database.Database, backupPath: string): void {
  try {
    const dir = dirname(backupPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    void db.backup(backupPath);
  } catch (error) {
    throw new DatabaseError('Failed to backup database', {
      backupPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Restore database from backup
 */
export function restoreDatabase(sourcePath: string, targetPath: string): void {
  try {
    if (!existsSync(sourcePath)) {
      throw new Error('Backup file does not exist');
    }

    const sourceDb = new Database(sourcePath, { readonly: true });
    const targetDb = new Database(targetPath);

    void sourceDb.backup(targetPath);

    sourceDb.close();
    targetDb.close();
  } catch (error) {
    throw new DatabaseError('Failed to restore database', {
      sourcePath,
      targetPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Test database connection
 */
export function testConnection(db: Database.Database): boolean {
  try {
    db.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}
