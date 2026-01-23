/**
 * In-memory LRU cache for hot memories
 *
 * Design decisions:
 * - LRU eviction for predictable memory usage
 * - Short TTL (60s) since data changes frequently
 * - Cache invalidation on store/update/delete
 * - Thread-safe for single-threaded Node.js
 */

import type { Memory, Entity } from '../types/index.js';

interface CachedMemory {
  memory: Memory;
  entities: Entity[];
  cachedAt: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  evictions: number;
}

class MemoryCache {
  private cache = new Map<string, CachedMemory>();
  private maxSize: number;
  private ttlMs: number;
  private stats: CacheStats = { hits: 0, misses: 0, size: 0, evictions: 0 };

  constructor(maxSize = 200, ttlMs = 60000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * Get a memory from cache if fresh
   */
  get(id: string): CachedMemory | undefined {
    const entry = this.cache.get(id);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check TTL
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(id);
      this.stats.misses++;
      this.stats.size = this.cache.size;
      return undefined;
    }

    // Move to end for LRU (delete and re-add)
    this.cache.delete(id);
    this.cache.set(id, entry);

    this.stats.hits++;
    return entry;
  }

  /**
   * Cache a memory with its entities
   */
  set(id: string, memory: Memory, entities: Entity[] = []): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(id)) {
      const oldest = this.cache.keys().next().value;
      if (oldest) {
        this.cache.delete(oldest);
        this.stats.evictions++;
      }
    }

    this.cache.set(id, {
      memory,
      entities,
      cachedAt: Date.now(),
    });

    this.stats.size = this.cache.size;
  }

  /**
   * Invalidate a specific memory (on update/delete)
   */
  invalidate(id: string): void {
    this.cache.delete(id);
    this.stats.size = this.cache.size;
  }

  /**
   * Batch get multiple memories
   */
  getMany(ids: string[]): Map<string, CachedMemory> {
    const results = new Map<string, CachedMemory>();
    for (const id of ids) {
      const cached = this.get(id);
      if (cached) {
        results.set(id, cached);
      }
    }
    return results;
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
    this.stats.size = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats & { hitRate: number } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }
}

// Singleton instance
let instance: MemoryCache | null = null;

export function getMemoryCache(): MemoryCache {
  if (!instance) {
    instance = new MemoryCache();
  }
  return instance;
}

export function resetMemoryCache(): void {
  if (instance) {
    instance.clear();
  }
  instance = null;
}

export { MemoryCache };
export type { CachedMemory, CacheStats };
