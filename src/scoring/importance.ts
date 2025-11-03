/**
 * Importance scoring system for memories
 */

import type { ImportanceFactors, MemoryType } from '../types/index.js';
import { calculateComplexity, isUserPreference, isExplicit } from '../extractors/fact-extractor.js';

/**
 * Calculate importance score automatically (0-10)
 */
export function calculateImportance(
  content: string,
  type: MemoryType,
  entities: string[],
  metadata: Record<string, unknown>,
  hasProvenance: boolean
): number {
  const factors = analyzeImportanceFactors(content, type, entities, metadata, hasProvenance);
  return calculateImportanceFromFactors(factors);
}

/**
 * Analyze factors that contribute to importance
 */
export function analyzeImportanceFactors(
  content: string,
  type: MemoryType,
  entities: string[],
  metadata: Record<string, unknown>,
  hasProvenance: boolean
): ImportanceFactors {
  return {
    contentComplexity: calculateComplexity(content),
    entityCount: entities.length,
    isUserPreference: isUserPreference(content),
    hasProvenance,
    hasMetadata: Object.keys(metadata).length > 0,
    isExplicit: isExplicit(content),
    typeBonus: calculateTypeBonus(type),
  };
}

/**
 * Calculate importance from analyzed factors
 */
export function calculateImportanceFromFactors(factors: ImportanceFactors): number {
  // Start with baseline
  let score = 3.0;

  // Content complexity (0-3 points)
  score += factors.contentComplexity * 3;

  // Entity connections (0-2 points, max out at 4 entities)
  score += Math.min(factors.entityCount * 0.5, 2.0);

  // User preference boost (0 or 2 points)
  if (factors.isUserPreference) {
    score += 2.0;
  }

  // Provenance tracking (0 or 0.5 points)
  if (factors.hasProvenance) {
    score += 0.5;
  }

  // Rich metadata (0 or 0.5 points)
  if (factors.hasMetadata) {
    score += 0.5;
  }

  // Explicit facts are more trustworthy (0 or 1 point)
  if (factors.isExplicit) {
    score += 1.0;
  }

  // Type-specific bonus
  score += factors.typeBonus;

  // Clamp to 0-10 range
  return Math.max(0, Math.min(10, Math.round(score * 10) / 10));
}

/**
 * Calculate type-specific importance bonus
 */
function calculateTypeBonus(type: MemoryType): number {
  switch (type) {
    case 'relationship':
      return 1.0; // Relationships connect knowledge
    case 'entity':
      return 0.5; // Entities are moderately important
    case 'fact':
      return 0.0; // Facts use default importance
    default:
      return 0.0;
  }
}

/**
 * Adjust importance based on context signals
 */
export function adjustImportanceForContext(
  baseImportance: number,
  signals: {
    isSecuritySensitive?: boolean;
    isUserIdentity?: boolean;
    isProjectRequirement?: boolean;
    isDeprecated?: boolean;
    userExplicitlyMarked?: boolean;
  }
): number {
  let adjusted = baseImportance;

  // Security-sensitive: max importance
  if (signals.isSecuritySensitive) {
    adjusted = Math.max(adjusted, 10);
  }

  // User identity: very high importance
  if (signals.isUserIdentity) {
    adjusted = Math.max(adjusted, 9);
  }

  // Project requirement: high importance
  if (signals.isProjectRequirement) {
    adjusted = Math.max(adjusted, 7);
  }

  // Deprecated: low importance
  if (signals.isDeprecated) {
    adjusted = Math.min(adjusted, 2);
  }

  // User explicitly marked: boost by 2 points
  if (signals.userExplicitlyMarked) {
    adjusted += 2;
  }

  return Math.max(0, Math.min(10, adjusted));
}

/**
 * Get recommended TTL for importance level
 */
export function getRecommendedTTL(importance: number): number | null {
  if (importance >= 10) return null; // Permanent
  if (importance >= 8) return 365; // 1 year
  if (importance >= 6) return 180; // 6 months
  if (importance >= 4) return 90; // 3 months
  if (importance >= 2) return 30; // 1 month
  return 7; // 1 week
}

/**
 * Calculate effective importance (with decay over time)
 */
export function calculateEffectiveImportance(
  baseImportance: number,
  lastAccessed: number,
  now: number
): number {
  const daysSinceAccess = (now - lastAccessed) / (1000 * 60 * 60 * 24);

  if (baseImportance < 6) {
    // Low-importance memories decay faster (1% per day)
    const decayRate = 0.01;
    const decayFactor = 1 - daysSinceAccess * decayRate * 2;
    return baseImportance * Math.max(decayFactor, 0.5);
  } else {
    // High-importance memories resist decay (0.5% per day)
    const decayRate = 0.005;
    const decayFactor = 1 - daysSinceAccess * decayRate;
    return baseImportance * Math.max(decayFactor, 0.8);
  }
}

/**
 * Boost importance on repeated access
 */
export function boostImportanceOnAccess(
  currentImportance: number,
  accessCount: number,
  daysSinceCreated: number
): number {
  // If accessed multiple times in short period, boost importance
  const accessRate = accessCount / Math.max(daysSinceCreated, 1);

  if (accessRate > 0.1) {
    // Accessed frequently (>10% of days)
    return Math.min(currentImportance + 1, 10);
  } else if (accessRate > 0.05) {
    // Accessed moderately (>5% of days)
    return Math.min(currentImportance + 0.5, 10);
  }

  // No boost
  return currentImportance;
}

/**
 * Calculate hot score (for hot context)
 */
export function calculateHotScore(
  importance: number,
  lastAccessed: number,
  now: number
): number {
  // Recency score (0-5)
  const recencyScore = calculateRecencyScore(lastAccessed, now);

  // Importance score (0-5)
  const importanceScore = importance / 2;

  // Weighted combination (importance weighs more)
  return recencyScore * 0.4 + importanceScore * 0.6;
}

/**
 * Calculate recency score (0-5)
 */
function calculateRecencyScore(lastAccessed: number, now: number): number {
  const hoursAgo = (now - lastAccessed) / (1000 * 60 * 60);

  if (hoursAgo < 1) return 5; // Very recent
  if (hoursAgo < 6) return 4; // Recent
  if (hoursAgo < 24) return 3; // Today
  if (hoursAgo < 168) return 2; // This week
  if (hoursAgo < 720) return 1; // This month
  return 0; // Older
}
