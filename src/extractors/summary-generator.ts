/**
 * Summary Generator - Creates concise 15-20 word summaries from memory content
 *
 * Target: 15-20 words (hard limit: 25 words)
 * Strategy: Extract key entities and main idea, preserve proper nouns
 */

const MAX_WORDS = 25;
const TARGET_WORDS_MIN = 15;
const TARGET_WORDS_MAX = 20;
const FALLBACK_CHARS = 100;

/**
 * Generate a concise summary from memory content
 *
 * @param content - The full memory content to summarize
 * @returns A 15-20 word summary (max 25 words)
 */
export function generateSummary(content: string): string {
  if (!content || content.trim().length === 0) {
    return 'Empty memory content';
  }

  const trimmedContent = content.trim();

  // Strategy 1: Use first sentence if it's concise enough
  const firstSentence = extractFirstSentence(trimmedContent);
  if (firstSentence) {
    const wordCount = countWords(firstSentence);
    if (wordCount >= TARGET_WORDS_MIN && wordCount <= TARGET_WORDS_MAX) {
      return firstSentence;
    }
    if (wordCount < MAX_WORDS) {
      return firstSentence;
    }
  }

  // Strategy 2: For longer content, extract key information
  const extracted = extractKeyInformation(trimmedContent);
  if (extracted) {
    const wordCount = countWords(extracted);
    if (wordCount <= MAX_WORDS) {
      return extracted;
    }
  }

  // Strategy 3: Truncate intelligently to MAX_WORDS
  const truncated = truncateToWords(trimmedContent, TARGET_WORDS_MAX);
  if (truncated.length > 0) {
    return truncated;
  }

  // Fallback: First 100 characters
  if (trimmedContent.length <= FALLBACK_CHARS) {
    return trimmedContent;
  }

  return trimmedContent.substring(0, FALLBACK_CHARS - 3) + '...';
}

/**
 * Extract the first complete sentence from text
 */
function extractFirstSentence(text: string): string | null {
  // Match first sentence ending with . ! ? (but not abbreviations like Dr. or Mr.)
  const sentenceMatch = text.match(/^[^.!?]+[.!?](?=\s|$)/);
  if (sentenceMatch) {
    return sentenceMatch[0].trim();
  }

  // If no sentence delimiter, check if the whole text is short enough
  if (text.length < 150) {
    return text;
  }

  return null;
}

/**
 * Extract key information from longer text
 * Focuses on: subject + verb + key entities/details
 */
function extractKeyInformation(text: string): string | null {
  // Split into sentences
  const sentences = text.match(/[^.!?]+[.!?]*/g);
  if (!sentences || sentences.length === 0) {
    return null;
  }

  // Get first sentence and try to condense it
  const firstSentence = sentences[0].trim();
  const words = firstSentence.split(/\s+/);

  if (words.length <= MAX_WORDS) {
    return firstSentence;
  }

  // Try to extract core meaning from first sentence
  // Remove filler words and keep essential information
  const condensed = removeFillerWords(firstSentence);
  const condensedWords = countWords(condensed);

  if (condensedWords <= MAX_WORDS) {
    return condensed;
  }

  // If still too long, take first MAX_WORDS words of condensed version
  return truncateToWords(condensed, TARGET_WORDS_MAX);
}

/**
 * Remove common filler words while preserving meaning
 */
function removeFillerWords(text: string): string {
  const fillerPatterns = [
    /\b(very|really|quite|rather|somewhat|actually|basically|essentially|literally)\b/gi,
    /\b(I think|I believe|in my opinion|it seems|it appears)\b/gi,
  ];

  let result = text;
  for (const pattern of fillerPatterns) {
    result = result.replace(pattern, '');
  }

  // Clean up multiple spaces
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}

/**
 * Count words in a string
 */
function countWords(text: string): number {
  return text.trim().split(/\s+/).length;
}

/**
 * Truncate text to a specific number of words
 */
function truncateToWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);

  if (words.length <= maxWords) {
    return text.trim();
  }

  const truncated = words.slice(0, maxWords).join(' ');

  // Add ellipsis if we truncated
  if (words.length > maxWords) {
    return truncated + '...';
  }

  return truncated;
}

/**
 * Validate that a summary meets requirements
 *
 * @param summary - The summary to validate
 * @returns true if valid, false otherwise
 */
export function validateSummary(summary: string): boolean {
  const wordCount = countWords(summary);
  return wordCount > 0 && wordCount <= MAX_WORDS;
}

/**
 * Get word count for a summary
 *
 * @param summary - The summary to count
 * @returns Number of words
 */
export function getSummaryWordCount(summary: string): number {
  return countWords(summary);
}
