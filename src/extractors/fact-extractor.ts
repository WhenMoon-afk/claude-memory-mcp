/**
 * Fact extraction from content
 */

import type { MemoryType } from '../types/index.js';

/**
 * Check if content qualifies as a fact
 */
export function isFact(content: string): boolean {
  const trimmed = content.trim();

  // Too short
  if (trimmed.length < 5) {
    return false;
  }

  // Questions
  if (/^\s*\w+\s+(is|are|do|does|can|could|would|should|will|has|have)\s+.*\?/i.test(trimmed)) {
    return false;
  }

  // Commands
  if (/^(please|kindly|can you|could you|would you)\s+/i.test(trimmed)) {
    return false;
  }

  // Greetings
  if (/^(hello|hi|hey|goodbye|bye|thanks|thank you)/i.test(trimmed)) {
    return false;
  }

  // Temporary dialogue
  if (/^(let me|i think|maybe|perhaps|possibly)/i.test(trimmed)) {
    return false;
  }

  // Seems like a fact
  return true;
}

/**
 * Classify memory type based on content
 */
export function classifyMemoryType(content: string, entities: string[]): MemoryType {
  const trimmed = content.toLowerCase();

  // Relationship indicators
  const relationshipPatterns = [
    /\b(depends on|requires|needs|uses|extends|implements)\b/i,
    /\b(reports to|works with|manages|leads|owns)\b/i,
    /\b(caused by|results in|leads to|triggers)\b/i,
    /\b(related to|associated with|connected to|linked to)\b/i,
    /\b(is a|is an|part of|member of|belongs to)\b/i,
  ];

  const hasRelationship = relationshipPatterns.some((pattern) => pattern.test(trimmed));

  if (hasRelationship && entities.length >= 2) {
    return 'relationship';
  }

  // Entity indicators (description of a single thing)
  const entityPatterns = [
    /^([A-Z][a-zA-Z\s]+)\s+-\s+/,  // "Name - description"
    /^([A-Z][a-zA-Z\s]+)\s+is\s+(a|an)\s+/i, // "Name is a..."
    /\b(person|organization|company|team|project|tool|library|framework)\b/i,
  ];

  const hasEntityIndicator = entityPatterns.some((pattern) => pattern.test(trimmed));

  if (hasEntityIndicator && entities.length === 1) {
    return 'entity';
  }

  // Default to fact
  return 'fact';
}

/**
 * Detect user preferences in content
 */
export function isUserPreference(content: string): boolean {
  const preferencePatterns = [
    /\b(prefer|prefers|like|likes|want|wants|choose|chooses|favor|favors)\b/i,
    /\b(my preference|my choice|i use|i usually|i typically)\b/i,
    /\b(always|never|usually|typically|generally)\s+(use|uses|do|does)\b/i,
  ];

  return preferencePatterns.some((pattern) => pattern.test(content));
}

/**
 * Detect explicit vs implicit facts
 */
export function isExplicit(content: string): boolean {
  // Explicit facts use definite language
  const explicitPatterns = [
    /\b(is|are|was|were|will be|has|have|must|shall)\b/i,
    /\b(definitely|certainly|absolutely|clearly|obviously)\b/i,
    /\b(always|never|every|all|none)\b/i,
  ];

  // Implicit facts use hedging language
  const implicitPatterns = [
    /\b(might|may|could|possibly|perhaps|maybe|probably)\b/i,
    /\b(seems|appears|looks like|suggests|indicates)\b/i,
    /\b(i think|i believe|i guess|in my opinion)\b/i,
  ];

  const hasExplicit = explicitPatterns.some((pattern) => pattern.test(content));
  const hasImplicit = implicitPatterns.some((pattern) => pattern.test(content));

  // Explicit if has explicit patterns and no implicit patterns
  return hasExplicit && !hasImplicit;
}

/**
 * Calculate content complexity (0-1)
 */
export function calculateComplexity(content: string): number {
  let complexity = 0;

  // Length factor (longer = more complex)
  const length = content.length;
  if (length > 100) complexity += 0.3;
  else if (length > 50) complexity += 0.2;
  else if (length > 20) complexity += 0.1;

  // Word count factor
  const words = content.split(/\s+/).length;
  if (words > 20) complexity += 0.2;
  else if (words > 10) complexity += 0.1;

  // Technical terms (capitalized words, acronyms, technical patterns)
  const technicalTerms = content.match(/\b[A-Z][a-z]+|[A-Z]{2,}|[a-z]+\.[a-z]+\(\)/g) || [];
  if (technicalTerms.length > 5) complexity += 0.3;
  else if (technicalTerms.length > 2) complexity += 0.2;
  else if (technicalTerms.length > 0) complexity += 0.1;

  // Numbers, dates, specific details
  const specifics = content.match(/\b\d+|v\d+\.\d+|\d{4}-\d{2}-\d{2}\b/g) || [];
  if (specifics.length > 0) complexity += 0.2;

  return Math.min(complexity, 1.0);
}

/**
 * Normalize content for storage
 */
export function normalizeContent(content: string): string {
  return content
    .trim()
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/\n+/g, ' ') // Remove newlines
    .replace(/[""]/g, '"') // Normalize quotes
    .replace(/['']/g, "'"); // Normalize apostrophes
}

/**
 * Validate content before storage
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateContent(content: string, type: MemoryType): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check length
  if (content.length < 5) {
    errors.push('Content too short (minimum 5 characters)');
  }

  if (content.length > 10000) {
    errors.push('Content too long (maximum 10,000 characters)');
  }

  // Check if it's actually a fact
  if (!isFact(content)) {
    warnings.push('Content may not be a factual statement');
  }

  // Type-specific validation
  if (type === 'entity') {
    // Entities should have a clear name
    if (!/^[A-Z]/.test(content)) {
      warnings.push('Entity content should start with a capital letter');
    }
  }

  if (type === 'relationship') {
    // Relationships should mention connection
    const hasConnection = /\b(depend|require|need|use|extend|implement|report|work|manage|lead|own|cause|result|lead|trigger|relate|associate|connect|link|is|part|member|belong)\w*\b/i.test(content);
    if (!hasConnection) {
      warnings.push('Relationship content should describe a connection');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
