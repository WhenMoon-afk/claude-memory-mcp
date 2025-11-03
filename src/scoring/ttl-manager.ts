/**
 * TTL (Time-To-Live) management for memories
 */

import type { TTLConfig } from '../types/index.js';
import { getRecommendedTTL } from './importance.js';

/**
 * Default TTL configuration
 */
export const DEFAULT_TTL_CONFIG: TTLConfig = {
  defaultDays: 90,
  importanceMultiplier: 0.7, // Multiply base TTL by this factor based on importance
  accessBonusDays: 30, // Bonus days added on access for important memories
  refreshThresholdDays: 7, // Minimum days since last access before refresh
};

/**
 * Calculate TTL in days based on importance
 */
export function calculateTTLDays(importance: number, config: TTLConfig = DEFAULT_TTL_CONFIG): number | null {
  // Use recommended TTL from importance tier
  const recommended = getRecommendedTTL(importance);

  if (recommended === null) {
    return null; // Permanent
  }

  // Apply importance multiplier to base TTL
  const importanceFactor = (importance / 10) * config.importanceMultiplier;
  const adjusted = Math.round(recommended * (1 + importanceFactor));

  return Math.max(1, adjusted);
}

/**
 * Calculate expiration timestamp
 */
export function calculateExpiresAt(
  ttlDays: number | null,
  importance: number,
  createdAt: number = Date.now()
): number | null {
  if (ttlDays === null) {
    return null; // Permanent memory
  }

  const baseTTL = ttlDays * 24 * 60 * 60 * 1000;

  // Add importance bonus (up to 7 extra days for importance 10)
  const importanceBonus = (importance / 10) * 7 * 24 * 60 * 60 * 1000;

  return createdAt + baseTTL + importanceBonus;
}

/**
 * Check if memory should be refreshed on access
 */
export function shouldRefreshTTL(
  importance: number,
  lastAccessed: number,
  now: number = Date.now(),
  config: TTLConfig = DEFAULT_TTL_CONFIG
): boolean {
  const daysSinceAccess = (now - lastAccessed) / (1000 * 60 * 60 * 24);

  // Important memories (>=6): refresh if accessed after 7+ days
  if (importance >= 6 && daysSinceAccess > config.refreshThresholdDays) {
    return true;
  }

  // Moderately important (4-5): refresh if accessed after 30+ days
  if (importance >= 4 && daysSinceAccess > 30) {
    return true;
  }

  // Low importance (1-3): don't refresh, let it expire
  return false;
}

/**
 * Calculate new TTL on access (refresh)
 */
export function refreshTTL(
  originalTTLDays: number | null,
  importance: number,
  lastAccessed: number,
  now: number = Date.now(),
  config: TTLConfig = DEFAULT_TTL_CONFIG
): number | null {
  if (originalTTLDays === null) {
    return null; // Permanent memory, no refresh needed
  }

  if (!shouldRefreshTTL(importance, lastAccessed, now, config)) {
    return null; // No refresh
  }

  // Calculate access bonus
  const accessBonus = (importance / 10) * config.accessBonusDays * 24 * 60 * 60 * 1000;

  // Base TTL + access bonus
  const baseTTL = originalTTLDays * 24 * 60 * 60 * 1000;

  if (importance >= 6) {
    // Important memories: full refresh + bonus
    return now + baseTTL + accessBonus;
  } else if (importance >= 4) {
    // Moderately important: refresh + half bonus
    return now + baseTTL + accessBonus / 2;
  }

  return null;
}

/**
 * Check if memory is expired
 */
export function isExpired(expiresAt: number | null, now: number = Date.now()): boolean {
  if (expiresAt === null) {
    return false; // Permanent memory never expires
  }

  return expiresAt <= now;
}

/**
 * Calculate time until expiration
 */
export function getTimeUntilExpiration(expiresAt: number | null, now: number = Date.now()): number | null {
  if (expiresAt === null) {
    return null; // Permanent memory
  }

  const timeLeft = expiresAt - now;
  return Math.max(0, timeLeft);
}

/**
 * Format time until expiration as human-readable string
 */
export function formatTimeUntilExpiration(expiresAt: number | null, now: number = Date.now()): string {
  if (expiresAt === null) {
    return 'Permanent';
  }

  const timeLeft = getTimeUntilExpiration(expiresAt, now);

  if (timeLeft === null || timeLeft === 0) {
    return 'Expired';
  }

  const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
  const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 365) {
    const years = Math.floor(days / 365);
    return `${years} year${years > 1 ? 's' : ''}`;
  }

  if (days > 30) {
    const months = Math.floor(days / 30);
    return `${months} month${months > 1 ? 's' : ''}`;
  }

  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''}`;
  }

  return `${hours} hour${hours > 1 ? 's' : ''}`;
}

/**
 * Get expiration warning level
 */
export type ExpirationWarning = 'none' | 'soon' | 'imminent' | 'expired';

export function getExpirationWarning(expiresAt: number | null, now: number = Date.now()): ExpirationWarning {
  if (expiresAt === null) {
    return 'none'; // Permanent memory
  }

  if (isExpired(expiresAt, now)) {
    return 'expired';
  }

  const timeLeft = getTimeUntilExpiration(expiresAt, now);

  if (timeLeft === null) {
    return 'none';
  }

  const daysLeft = timeLeft / (1000 * 60 * 60 * 24);

  if (daysLeft < 1) {
    return 'imminent'; // Expires in <1 day
  }

  if (daysLeft < 7) {
    return 'soon'; // Expires in <7 days
  }

  return 'none';
}

/**
 * Extend TTL for a memory
 */
export function extendTTL(
  currentExpiresAt: number | null,
  extensionDays: number,
  now: number = Date.now()
): number | null {
  if (currentExpiresAt === null) {
    return null; // Permanent memory, can't extend
  }

  const extension = extensionDays * 24 * 60 * 60 * 1000;

  // If already expired, extend from now
  if (isExpired(currentExpiresAt, now)) {
    return now + extension;
  }

  // Otherwise, extend from current expiration
  return currentExpiresAt + extension;
}

/**
 * Make memory permanent (remove TTL)
 */
export function makePermanent(): null {
  return null;
}

/**
 * Calculate optimal TTL for memory type and content
 */
export interface TTLRecommendation {
  days: number | null;
  reason: string;
  confidence: number; // 0-1
}

export function recommendTTL(
  content: string,
  importance: number,
  _type: 'fact' | 'entity' | 'relationship',
  metadata: Record<string, unknown>
): TTLRecommendation {
  // Security-sensitive: permanent
  if (
    metadata['security'] === true ||
    metadata['is_secret'] === true ||
    content.toLowerCase().includes('password') ||
    content.toLowerCase().includes('api key')
  ) {
    return {
      days: null,
      reason: 'Security-sensitive information should be permanent',
      confidence: 0.9,
    };
  }

  // User identity: permanent
  if (
    metadata['category'] === 'identity' ||
    metadata['is_identity'] === true ||
    content.toLowerCase().includes('my name is') ||
    content.toLowerCase().includes('i am')
  ) {
    return {
      days: null,
      reason: 'User identity information should be permanent',
      confidence: 0.95,
    };
  }

  // Temporary/exploratory: short TTL
  if (
    metadata['temporary'] === true ||
    metadata['exploratory'] === true ||
    importance <= 3
  ) {
    return {
      days: 7,
      reason: 'Temporary or low-importance content should expire quickly',
      confidence: 0.8,
    };
  }

  // Project context: medium-long TTL
  if (metadata['project'] || metadata['category'] === 'project') {
    return {
      days: 180,
      reason: 'Project context should last for the project duration (~6 months)',
      confidence: 0.7,
    };
  }

  // Use importance-based recommendation
  const recommended = getRecommendedTTL(importance);
  return {
    days: recommended,
    reason: `Based on importance level ${importance}`,
    confidence: 0.6,
  };
}

/**
 * Batch update TTLs for multiple memories
 */
export interface TTLUpdateResult {
  memory_id: string;
  old_expires_at: number | null;
  new_expires_at: number | null;
  refreshed: boolean;
}

export function batchRefreshTTLs(
  memories: Array<{
    id: string;
    importance: number;
    last_accessed: number;
    expires_at: number | null;
    original_ttl_days: number | null;
  }>,
  now: number = Date.now(),
  config: TTLConfig = DEFAULT_TTL_CONFIG
): TTLUpdateResult[] {
  return memories.map((memory) => {
    const newExpiresAt = refreshTTL(
      memory.original_ttl_days,
      memory.importance,
      memory.last_accessed,
      now,
      config
    );

    return {
      memory_id: memory.id,
      old_expires_at: memory.expires_at,
      new_expires_at: newExpiresAt || memory.expires_at,
      refreshed: newExpiresAt !== null,
    };
  });
}

/**
 * Find memories that need TTL refresh
 */
export function findMemoriesNeedingRefresh(
  memories: Array<{
    id: string;
    importance: number;
    last_accessed: number;
    expires_at: number | null;
  }>,
  now: number = Date.now(),
  config: TTLConfig = DEFAULT_TTL_CONFIG
): string[] {
  return memories
    .filter((memory) => {
      // Skip permanent memories
      if (memory.expires_at === null) {
        return false;
      }

      // Check if should refresh
      return shouldRefreshTTL(memory.importance, memory.last_accessed, now, config);
    })
    .map((memory) => memory.id);
}
