/**
 * Background Cloud Sync Manager
 *
 * Manages a queue of memories that need syncing to Substratia Cloud.
 * Runs periodic background sync without blocking MCP tool responses.
 *
 * Features:
 * - Offline queue: memories enqueued immediately, synced when possible
 * - Exponential backoff: failed syncs retry with increasing delay
 * - Batch processing: syncs up to 20 memories per interval
 * - Non-blocking: all sync operations run asynchronously
 * - Status reporting: queue depth, success/failure counts
 */

import type { DbDriver } from './database/db-driver.js';
import type { Memory } from './types/index.js';
import { syncMemory, getCloudConfig, isCloudEnabled } from './cloud.js';

// Sync interval: 5 minutes
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

// Max memories to sync per batch
const BATCH_SIZE = 20;

// Max retry attempts before marking permanently failed
const MAX_ATTEMPTS = 5;

// Base backoff delay (doubles each attempt): 30s, 60s, 120s, 240s, 480s
const BASE_BACKOFF_MS = 30_000;

interface SyncStats {
  pending: number;
  synced: number;
  failed: number;
  syncing: number;
  lastSyncAt: number | null;
  lastError: string | null;
}

interface QueueRow {
  memory_id: string;
  status: string;
  attempts: number;
  last_attempt_at: number | null;
  last_error: string | null;
  created_at: number;
  synced_at: number | null;
}

interface SyncQueueJoinedRow extends QueueRow {
  content: string;
  summary: string;
  type: string;
  importance: number;
  mem_created_at: number;
  last_accessed: number;
  access_count: number;
  expires_at: number | null;
  metadata: string;
}

class SyncManager {
  private db: DbDriver;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isSyncing = false;

  constructor(db: DbDriver) {
    this.db = db;
  }

  /**
   * Start periodic background sync
   */
  start(): void {
    if (this.intervalId) {
      return; // Already running
    }

    console.error('[memory-mcp] Background sync started (interval: 5m)');

    // Run initial sync after 30 seconds (give server time to stabilize)
    setTimeout(() => {
      this.processQueue().catch(err => {
        console.error('[memory-mcp] Initial sync failed:', err);
      });
    }, 30_000);

    // Set up periodic sync
    this.intervalId = setInterval(() => {
      this.processQueue().catch(err => {
        console.error('[memory-mcp] Periodic sync failed:', err);
      });
    }, SYNC_INTERVAL_MS);
  }

  /**
   * Stop background sync
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.error('[memory-mcp] Background sync stopped');
    }
  }

  /**
   * Enqueue a memory for cloud sync (non-blocking)
   */
  enqueue(memoryId: string): void {
    try {
      this.db.prepare(`
        INSERT INTO cloud_sync_queue (memory_id, status, created_at)
        VALUES (?, 'pending', ?)
        ON CONFLICT(memory_id) DO UPDATE SET
          status = 'pending',
          attempts = 0,
          last_error = NULL
      `).run(memoryId, Date.now());
    } catch (err) {
      console.error('[memory-mcp] Failed to enqueue sync:', err);
    }
  }

  /**
   * Process the sync queue: pick pending/failed items and sync them
   */
  async processQueue(): Promise<void> {
    if (this.isSyncing) {
      return; // Prevent concurrent processing
    }

    if (!isCloudEnabled()) {
      return; // Cloud not configured
    }

    this.isSyncing = true;

    try {
      const config = getCloudConfig();
      const now = Date.now();

      // Get pending items + failed items eligible for retry
      const items = this.db.prepare(`
        SELECT q.*, m.content, m.summary, m.type, m.importance,
               m.created_at as mem_created_at, m.last_accessed,
               m.access_count, m.expires_at, m.metadata
        FROM cloud_sync_queue q
        JOIN memories m ON q.memory_id = m.id
        WHERE m.is_deleted = 0
          AND (
            q.status = 'pending'
            OR (q.status = 'failed' AND q.attempts < ? AND (
              q.last_attempt_at IS NULL
              OR q.last_attempt_at < ?
            ))
          )
        ORDER BY q.created_at ASC
        LIMIT ?
      `).all(
        MAX_ATTEMPTS,
        now - BASE_BACKOFF_MS, // Simple backoff: wait at least BASE_BACKOFF_MS
        BATCH_SIZE
      ) as SyncQueueJoinedRow[];

      if (items.length === 0) {
        return;
      }

      console.error(`[memory-mcp] Syncing ${items.length} memories to cloud...`);

      let successCount = 0;
      let failCount = 0;

      for (const item of items) {
        // Check backoff for failed items
        if (item.attempts > 0 && item.last_attempt_at) {
          const backoffMs = BASE_BACKOFF_MS * Math.pow(2, item.attempts - 1);
          if (now - item.last_attempt_at < backoffMs) {
            continue; // Not yet time to retry
          }
        }

        // Mark as syncing
        this.db.prepare(`
          UPDATE cloud_sync_queue
          SET status = 'syncing', last_attempt_at = ?, attempts = attempts + 1
          WHERE memory_id = ?
        `).run(now, item.memory_id);

        // Build Memory object
        let metadata: Record<string, unknown> = {};
        try {
          metadata = JSON.parse(item.metadata) as Record<string, unknown>;
        } catch {
          // ignore parse errors
        }

        const memory: Memory = {
          id: item.memory_id,
          content: item.content,
          summary: item.summary,
          type: item.type as Memory['type'],
          importance: item.importance,
          created_at: item.mem_created_at,
          last_accessed: item.last_accessed,
          access_count: item.access_count,
          expires_at: item.expires_at,
          metadata,
          is_deleted: false,
        };

        try {
          const result = await syncMemory(memory, config);

          if (result.success) {
            this.db.prepare(`
              UPDATE cloud_sync_queue
              SET status = 'synced', synced_at = ?, last_error = NULL
              WHERE memory_id = ?
            `).run(Date.now(), item.memory_id);
            successCount++;
          } else {
            this.db.prepare(`
              UPDATE cloud_sync_queue
              SET status = 'failed', last_error = ?
              WHERE memory_id = ?
            `).run(result.error || 'Unknown error', item.memory_id);
            failCount++;
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Network error';
          this.db.prepare(`
            UPDATE cloud_sync_queue
            SET status = 'failed', last_error = ?
            WHERE memory_id = ?
          `).run(errorMsg, item.memory_id);
          failCount++;
        }
      }

      if (successCount > 0 || failCount > 0) {
        console.error(`[memory-mcp] Sync complete: ${successCount} synced, ${failCount} failed`);
      }
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Get sync queue statistics
   */
  getStats(): SyncStats {
    const pending = this.db.prepare(
      "SELECT COUNT(*) FROM cloud_sync_queue WHERE status = 'pending'"
    ).pluck().get() as number;

    const synced = this.db.prepare(
      "SELECT COUNT(*) FROM cloud_sync_queue WHERE status = 'synced'"
    ).pluck().get() as number;

    const failed = this.db.prepare(
      "SELECT COUNT(*) FROM cloud_sync_queue WHERE status = 'failed'"
    ).pluck().get() as number;

    const syncing = this.db.prepare(
      "SELECT COUNT(*) FROM cloud_sync_queue WHERE status = 'syncing'"
    ).pluck().get() as number;

    const lastSyncAt = this.db.prepare(
      "SELECT MAX(synced_at) FROM cloud_sync_queue WHERE status = 'synced'"
    ).pluck().get() as number | null;

    const lastError = this.db.prepare(
      "SELECT last_error FROM cloud_sync_queue WHERE status = 'failed' ORDER BY last_attempt_at DESC LIMIT 1"
    ).pluck().get() as string | null;

    return { pending, synced, failed, syncing, lastSyncAt, lastError };
  }
}

// Singleton instance
let instance: SyncManager | null = null;

export function getSyncManager(db: DbDriver): SyncManager {
  if (!instance) {
    instance = new SyncManager(db);
  }
  return instance;
}

export function stopSyncManager(): void {
  if (instance) {
    instance.stop();
    instance = null;
  }
}

export { SyncManager };
export type { SyncStats };
