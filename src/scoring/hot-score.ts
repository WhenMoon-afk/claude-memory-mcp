/**
 * Hot Score Calculator - Calculate context relevance scores for memories
 *
 * Formula: hot_score = (importance * 0.4) + (recency * 0.3) + (frequency * 0.3)
 *
 * Components:
 * - Importance: User-set 0-10 scale, normalized to 0-1
 * - Recency: Exponential decay over 30 days
 * - Frequency: Logarithmic scaling of access_count
 */

import type { Memory } from '../types/index.js';

/**
 * Frozen entities that should always have maximum hot score
 * These memories never rotate out of hot context
 */
const FROZEN_ENTITIES = ['User', 'Claude', 'current project'];

/**
 * Hot score configuration
 */
const HOT_SCORE_CONFIG = {
  IMPORTANCE_WEIGHT: 0.4,
  RECENCY_WEIGHT: 0.3,
  FREQUENCY_WEIGHT: 0.3,
  RECENCY_DECAY_DAYS: 30, // 30-day half-life for recency
  FREQUENCY_MAX_ACCESS: 1000, // Normalize frequency to this maximum
};

/**
 * Calculate hot score for a memory
 *
 * @param memory - The memory to score
 * @param currentTime - Current timestamp (defaults to now)
 * @returns Hot score between 0 and 1
 */
export function calculateHotScore(memory: Memory, currentTime?: number): number {
  // Check if this is a frozen entity
  if (isFrozenEntity(memory)) {
    return 1.0; // Maximum score, never rotates out
  }

  const now = currentTime || Date.now();

  // Calculate component scores (all normalized to 0-1)
  const recencyScore = calculateRecencyScore(memory.last_accessed, now);
  const frequencyScore = calculateFrequencyScore(memory.access_count);
  const importanceScore = memory.importance / 10; // Normalize 0-10 to 0-1

  // Weighted combination
  const hotScore =
    importanceScore * HOT_SCORE_CONFIG.IMPORTANCE_WEIGHT +
    recencyScore * HOT_SCORE_CONFIG.RECENCY_WEIGHT +
    frequencyScore * HOT_SCORE_CONFIG.FREQUENCY_WEIGHT;

  return hotScore;
}

/**
 * Calculate recency score with exponential decay
 *
 * @param lastAccessed - Timestamp of last access
 * @param now - Current timestamp
 * @returns Recency score between 0 and 1
 */
export function calculateRecencyScore(lastAccessed: number, now: number): number {
  const millisSince = now - lastAccessed;
  const daysSince = millisSince / (1000 * 60 * 60 * 24);

  // Exponential decay with 30-day half-life
  // Math.exp(-daysSince / 30) gives us exponential decay
  // At 30 days: e^(-30/30) = e^(-1) ≈ 0.37
  // At 60 days: e^(-60/30) = e^(-2) ≈ 0.14
  // At 90 days: e^(-90/30) = e^(-3) ≈ 0.05
  const recencyScore = Math.exp(-daysSince / HOT_SCORE_CONFIG.RECENCY_DECAY_DAYS);

  // Clamp to 0-1 range
  return Math.max(0, Math.min(1, recencyScore));
}

/**
 * Calculate frequency score with logarithmic scaling
 *
 * @param accessCount - Number of times the memory has been accessed
 * @returns Frequency score between 0 and 1
 */
export function calculateFrequencyScore(accessCount: number): number {
  // Logarithmic scaling to prevent very high access counts from dominating
  // log10(access_count + 1) / log10(1000)
  // Examples:
  // - 0 accesses: log10(1) / log10(1000) = 0 / 3 = 0
  // - 10 accesses: log10(11) / log10(1000) ≈ 1.04 / 3 ≈ 0.35
  // - 100 accesses: log10(101) / log10(1000) ≈ 2.00 / 3 ≈ 0.67
  // - 1000 accesses: log10(1001) / log10(1000) ≈ 3.00 / 3 = 1.0

  const frequencyScore =
    Math.log10(accessCount + 1) / Math.log10(HOT_SCORE_CONFIG.FREQUENCY_MAX_ACCESS);

  // Clamp to 0-1 range
  return Math.max(0, Math.min(1, frequencyScore));
}

/**
 * Check if a memory represents a frozen entity
 *
 * @param memory - The memory to check
 * @returns True if this is a frozen entity
 */
export function isFrozenEntity(memory: Memory): boolean {
  // Check if memory type is entity and name matches frozen list
  if (memory.type !== 'entity') {
    return false;
  }

  // Check content for frozen entity names (case-insensitive)
  const contentLower = memory.content.toLowerCase();
  return FROZEN_ENTITIES.some((entity) => contentLower.includes(entity.toLowerCase()));
}

/**
 * Batch calculate hot scores for multiple memories
 *
 * @param memories - Array of memories to score
 * @param currentTime - Current timestamp (defaults to now)
 * @returns Array of { memory, hotScore } objects sorted by score descending
 */
export function calculateHotScores(
  memories: Memory[],
  currentTime?: number
): Array<{ memory: Memory; hotScore: number }> {
  const now = currentTime || Date.now();

  const scored = memories.map((memory) => ({
    memory,
    hotScore: calculateHotScore(memory, now),
  }));

  // Sort by hot score descending
  scored.sort((a, b) => b.hotScore - a.hotScore);

  return scored;
}

/**
 * Get component scores breakdown for debugging
 *
 * @param memory - The memory to analyze
 * @param currentTime - Current timestamp (defaults to now)
 * @returns Breakdown of score components
 */
export function getHotScoreBreakdown(
  memory: Memory,
  currentTime?: number
): {
  total: number;
  importance: number;
  recency: number;
  frequency: number;
  isFrozen: boolean;
} {
  const now = currentTime || Date.now();
  const frozen = isFrozenEntity(memory);

  if (frozen) {
    return {
      total: 1.0,
      importance: 1.0,
      recency: 1.0,
      frequency: 1.0,
      isFrozen: true,
    };
  }

  const recencyScore = calculateRecencyScore(memory.last_accessed, now);
  const frequencyScore = calculateFrequencyScore(memory.access_count);
  const importanceScore = memory.importance / 10;

  return {
    total: calculateHotScore(memory, now),
    importance: importanceScore,
    recency: recencyScore,
    frequency: frequencyScore,
    isFrozen: false,
  };
}
