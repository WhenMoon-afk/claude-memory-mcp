/**
 * Memory recall tool - Token-aware semantic search
 * v3.0: Dual-response pattern (index + details) for skill-like progressive loading
 */

import type Database from 'better-sqlite3';
import type {
  SearchOptions,
  SearchOptionsInternal,
  RecallResponse,
  Memory,
  MinimalMemory,
  FormattedMemory,
  Entity,
  Provenance,
} from '../types/index.js';
import { semanticSearch } from '../search/semantic-search.js';
import { getPluginManager } from '../core/plugin-manager.js';
import { formatMemory, formatMemoryList, getMemoryTokenCount } from './response-formatter.js';
import { now } from '../database/connection.js';
import { estimateTokens } from '../utils/token-estimator.js';

/**
 * Recall memories using semantic search with intelligent token budgeting
 * Returns: index (all matches as summaries) + details (top matches with full content)
 */
export async function memoryRecall(
  db: Database.Database,
  options: SearchOptions
): Promise<RecallResponse> {
  try {
    console.error('[memoryRecall] Starting recall with options:', JSON.stringify(options));

    // Execute before_recall hooks
    const pluginManager = getPluginManager();
    const processedOptions = (await pluginManager.executeHooks(
      'before_recall',
      options
    ));

    // Set defaults
    const limit = Math.min(processedOptions.limit || 20, 50); // Max 50
    const maxTokens = processedOptions.max_tokens || 1000; // Default 1k token budget

    console.error(`[memoryRecall] Processed options - limit: ${limit}, maxTokens: ${maxTokens}`);

    // Perform semantic search (get all matches up to limit)
    const searchOptions: SearchOptionsInternal = {
      query: processedOptions.query,
      limit,
      offset: 0,
      includeExpired: false,
    };
    if (processedOptions.type) searchOptions.type = processedOptions.type;
    if (processedOptions.entities) searchOptions.entities = processedOptions.entities;

    console.error('[memoryRecall] Calling semanticSearch...');
    const { results, totalCount } = semanticSearch(db, searchOptions);
    console.error(`[memoryRecall] Search returned ${results.length} results, total count: ${totalCount}`);

    // Track access for hot context scoring
    const currentTime = now();
    for (const result of results) {
      // Increment access_count and update last_accessed
      db.prepare(
        `UPDATE memories
         SET access_count = access_count + 1, last_accessed = ?
         WHERE id = ?`
      ).run(currentTime, result.id);
    }

    // Build options map for formatting (includes entities and provenance)
    const optionsMap = new Map<string, { entities?: Entity[]; provenance?: Provenance[] }>();
    for (const result of results) {
      optionsMap.set(result.id, {
        entities: result.entities,
        provenance: result.provenance,
      });
    }

    // Convert MemorySearchResult[] to Memory[] for formatting
    const memories: Memory[] = results.map((result) => ({
      id: result.id,
      content: result.content,
      summary: result.summary,
      type: result.type,
      importance: result.importance,
      created_at: result.created_at,
      last_accessed: result.last_accessed,
      access_count: result.access_count,
      expires_at: result.expires_at,
      metadata: result.metadata,
      is_deleted: result.is_deleted,
    }));

    // PHASE 1: Create index (all matches as minimal summaries)
    const index: MinimalMemory[] = formatMemoryList(memories, 'minimal') as MinimalMemory[];
    const indexTokens = estimateTokens(index);

    // PHASE 2: Fill remaining budget with detailed content
    const details: FormattedMemory[] = [];
    let tokensUsed = indexTokens;

    for (const memory of memories) {
      // Format with standard detail (content + entities + timestamps)
      const options = optionsMap.get(memory.id) || {};
      const formatted = formatMemory(memory, 'standard', options);
      const memoryTokens = getMemoryTokenCount(formatted);

      // Check if it fits in remaining budget
      if (tokensUsed + memoryTokens <= maxTokens) {
        details.push(formatted);
        tokensUsed += memoryTokens;
      } else {
        // Budget exhausted, stop adding details
        break;
      }
    }

    // Build response with dual structure
    const response: RecallResponse = {
      index,
      details,
      total_count: totalCount,
      has_more: totalCount > limit,
      tokens_used: tokensUsed,
      query: processedOptions.query,
    };

    console.error(`[memoryRecall] Built response - index: ${index.length} items, details: ${details.length} items, tokens: ${tokensUsed}`);

    // Execute after_recall hooks
    await pluginManager.executeHooks('after_recall', response);

    console.error('[memoryRecall] Recall completed successfully');
    return response;
  } catch (error) {
    console.error('[memoryRecall] ERROR:', error);
    if (error instanceof Error) {
      console.error('[memoryRecall] Error stack:', error.stack);
    }
    throw error;
  }
}
