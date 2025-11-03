/**
 * Token Estimation Utilities
 *
 * Simple heuristic-based token counting for response formatting
 * Uses the rule of thumb: ~4 characters per token
 */

/**
 * Estimate token count for text or JSON object
 *
 * @param input - Text string or object to estimate
 * @returns Estimated token count
 */
export function estimateTokens(input: string | object): number {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  // Rule of thumb: ~4 characters per token
  return Math.ceil(text.length / 4);
}

/**
 * Validate that memories fit within a token budget
 *
 * @param memories - Array of formatted memories
 * @param maxTokens - Maximum token budget
 * @returns Validation result with estimated token count
 */
export function validateTokenBudget(
  memories: unknown[],
  maxTokens: number
): { fits: boolean; estimated: number } {
  const estimated = estimateTokens(memories);
  return {
    fits: estimated <= maxTokens,
    estimated,
  };
}

/**
 * Filter memories to fit within a token budget
 *
 * @param memories - Array of memories (any format)
 * @param maxTokens - Maximum token budget
 * @returns Filtered array that fits within budget
 */
export function fitWithinBudget<T extends object>(memories: T[], maxTokens: number): T[] {
  const result: T[] = [];
  let currentTokens = 0;

  for (const memory of memories) {
    const memoryTokens = estimateTokens(memory);
    if (currentTokens + memoryTokens <= maxTokens) {
      result.push(memory);
      currentTokens += memoryTokens;
    } else {
      break;
    }
  }

  return result;
}
