/**
 * Response Formatter - Format memories with tiered detail levels
 *
 * Critical: NEVER include embedding or vector fields in responses
 * Token targets: minimal=30, standard=200, full=500
 */

import type {
  Memory,
  DetailLevel,
  MinimalMemory,
  StandardMemory,
  FullMemory,
  FormattedMemory,
  Entity,
  Provenance,
} from '../types/index.js';
import { estimateTokens } from '../utils/token-estimator.js';

/**
 * Format options for memory formatting
 */
export interface FormatOptions {
  entities?: Entity[];
  provenance?: Provenance[];
  tags?: string[];
}

/**
 * Format a single memory according to detail level
 *
 * @param memory - The memory to format
 * @param detailLevel - Level of detail to include
 * @param options - Optional entities, provenance, and tags
 * @returns Formatted memory (NO embeddings)
 */
export function formatMemory(
  memory: Memory,
  detailLevel: DetailLevel,
  options: FormatOptions = {}
): FormattedMemory {
  switch (detailLevel) {
    case 'minimal':
      return formatMinimal(memory);
    case 'standard':
      return formatStandard(memory, options);
    case 'full':
      return formatFull(memory, options);
    default:
      return formatStandard(memory, options);
  }
}

/**
 * Format minimal memory (~30 tokens)
 * Only essential fields: id, type, summary, importance
 */
function formatMinimal(memory: Memory): MinimalMemory {
  return {
    id: memory.id,
    type: memory.type,
    summary: memory.summary,
    importance: memory.importance,
  };
}

/**
 * Format standard memory (~200 tokens)
 * Includes: minimal fields + content + optional entities + timestamps
 */
function formatStandard(memory: Memory, options: FormatOptions): StandardMemory {
  const formatted: StandardMemory = {
    id: memory.id,
    type: memory.type,
    summary: memory.summary,
    content: memory.content,
    importance: memory.importance,
    created_at: new Date(memory.created_at).toISOString(),
    last_accessed: new Date(memory.last_accessed).toISOString(),
  };

  // Only include entities if present
  if (options.entities && options.entities.length > 0) {
    formatted.entities = options.entities.map((e) => e.name);
  }

  return formatted;
}

/**
 * Format full memory (~500 tokens)
 * Includes: all standard fields + entities + tags + access_count + expires_at + provenance
 */
function formatFull(memory: Memory, options: FormatOptions): FullMemory {
  const formatted: FullMemory = {
    id: memory.id,
    type: memory.type,
    summary: memory.summary,
    content: memory.content,
    entities: options.entities ? options.entities.map((e) => e.name) : [],
    tags: options.tags || extractTagsFromMetadata(memory.metadata),
    importance: memory.importance,
    access_count: memory.access_count,
    created_at: new Date(memory.created_at).toISOString(),
    last_accessed: new Date(memory.last_accessed).toISOString(),
    expires_at: memory.expires_at ? new Date(memory.expires_at).toISOString() : null,
    provenance: extractProvenanceInfo(options.provenance),
  };

  return formatted;
}

/**
 * Extract tags from metadata
 */
function extractTagsFromMetadata(metadata: Record<string, unknown>): string[] {
  if (metadata.tags && Array.isArray(metadata.tags)) {
    return metadata.tags.filter((tag): tag is string => typeof tag === 'string');
  }
  return [];
}

/**
 * Extract provenance information (only most recent)
 */
function extractProvenanceInfo(
  provenance?: Provenance[]
): { source: string; timestamp: string } | null {
  if (!provenance || provenance.length === 0) {
    return null;
  }

  // Get most recent provenance record
  const mostRecent = provenance.reduce((latest, current) =>
    current.timestamp > latest.timestamp ? current : latest
  );

  return {
    source: mostRecent.source,
    timestamp: new Date(mostRecent.timestamp).toISOString(),
  };
}

/**
 * Format a list of memories
 *
 * @param memories - Array of memories to format
 * @param detailLevel - Level of detail to include
 * @param optionsMap - Map of memory IDs to format options
 * @returns Array of formatted memories
 */
export function formatMemoryList(
  memories: Memory[],
  detailLevel: DetailLevel,
  optionsMap?: Map<string, FormatOptions>
): FormattedMemory[] {
  return memories.map((memory) => {
    const options = optionsMap?.get(memory.id) || {};
    return formatMemory(memory, detailLevel, options);
  });
}

/**
 * Get estimated token count for a formatted memory
 *
 * @param memory - Formatted memory to estimate
 * @returns Estimated token count
 */
export function getMemoryTokenCount(memory: FormattedMemory): number {
  return estimateTokens(memory);
}

/**
 * Validate that a memory list fits within token budget
 *
 * @param memories - Array of formatted memories
 * @param maxTokens - Maximum allowed tokens
 * @returns Validation result
 */
export function validateMemoryBudget(
  memories: FormattedMemory[],
  maxTokens: number
): { fits: boolean; estimated: number; count: number } {
  const estimated = estimateTokens(memories);
  return {
    fits: estimated <= maxTokens,
    estimated,
    count: memories.length,
  };
}

/**
 * Truncate memory list to fit within token budget
 *
 * @param memories - Array of formatted memories
 * @param maxTokens - Maximum token budget
 * @returns Truncated array that fits within budget
 */
export function truncateToTokenBudget(
  memories: FormattedMemory[],
  maxTokens: number
): FormattedMemory[] {
  const result: FormattedMemory[] = [];
  let currentTokens = 0;

  for (const memory of memories) {
    const memoryTokens = getMemoryTokenCount(memory);
    if (currentTokens + memoryTokens <= maxTokens) {
      result.push(memory);
      currentTokens += memoryTokens;
    } else {
      break;
    }
  }

  return result;
}

/**
 * Debug: Get token statistics for a memory
 *
 * @param memory - Formatted memory to analyze
 * @returns Token statistics
 */
export function getMemoryTokenStats(memory: FormattedMemory): {
  total: number;
  byField: Record<string, number>;
} {
  const byField: Record<string, number> = {};
  let total = 0;

  for (const [key, value] of Object.entries(memory)) {
    const fieldTokens = estimateTokens(JSON.stringify(value));
    byField[key] = fieldTokens;
    total += fieldTokens;
  }

  return { total, byField };
}
