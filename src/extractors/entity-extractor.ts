/**
 * Entity extraction with NER-like patterns
 */

import type { EntityType, EntityInput } from '../types/index.js';

/**
 * Extract named entities from content
 */
export function extractEntities(content: string): string[] {
  const entities = new Set<string>();

  // Pattern 1: Proper nouns (capitalized words/phrases)
  const properNouns = content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
  properNouns.forEach((noun) => entities.add(noun));

  // Pattern 2: Quoted entities
  const quoted = content.match(/"([^"]+)"|'([^']+)'/g) || [];
  quoted.forEach((q) => {
    const cleaned = q.replace(/["']/g, '');
    if (cleaned.length > 2) {
      entities.add(cleaned);
    }
  });

  // Pattern 3: Technical names (camelCase, PascalCase, kebab-case)
  const technical = content.match(/\b[a-z]+[A-Z][a-zA-Z]*|[A-Z][a-z]+(?:[A-Z][a-z]+)+|[a-z]+-[a-z]+(?:-[a-z]+)*\b/g) || [];
  technical.forEach((tech) => entities.add(tech));

  // Pattern 4: Acronyms (2+ capital letters)
  const acronyms = content.match(/\b[A-Z]{2,}\b/g) || [];
  acronyms.forEach((acronym) => entities.add(acronym));

  // Pattern 5: Project/product names (often have version numbers)
  const versioned = content.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+v?\d+\.\d+/gi) || [];
  versioned.forEach((v) => {
    const name = v.replace(/\s+v?\d+\.\d+/gi, '').trim();
    if (name) entities.add(name);
  });

  // Pattern 6: @mentions and #tags
  const mentions = content.match(/@([a-zA-Z0-9_]+)|#([a-zA-Z0-9_]+)/g) || [];
  mentions.forEach((mention) => {
    const cleaned = mention.substring(1);
    if (cleaned.length > 2) {
      entities.add(cleaned);
    }
  });

  // Filter out common words that might be capitalized
  const commonWords = new Set([
    'I',
    'The',
    'A',
    'An',
    'This',
    'That',
    'These',
    'Those',
    'It',
    'He',
    'She',
    'They',
    'We',
    'You',
    'My',
    'Our',
    'Your',
  ]);

  return Array.from(entities).filter((entity) => {
    // Remove single letters and common words
    if (entity.length === 1 || commonWords.has(entity)) {
      return false;
    }
    // Keep everything else
    return true;
  });
}

/**
 * Classify entity type
 */
export function classifyEntityType(name: string, context: string = ''): EntityType {
  const lowerContext = context.toLowerCase();

  // Person indicators
  const personPatterns = [
    /\b(mr|mrs|ms|dr|prof|sr|jr)\b/,
    /\b(person|user|developer|engineer|manager|designer|analyst|architect)\b/,
    /\b(reports to|works with|team member|colleague)\b/,
  ];
  if (personPatterns.some((p) => p.test(lowerContext))) {
    return 'person';
  }

  // Organization indicators
  const orgPatterns = [
    /\b(company|corporation|corp|inc|ltd|llc|org)\b/,
    /\b(team|department|division|group|squad|tribe)\b/,
    /\b(organization|startup|enterprise)\b/,
  ];
  if (orgPatterns.some((p) => p.test(lowerContext)) || /\b(Inc|Corp|LLC|Ltd)\b/.test(name)) {
    return 'organization';
  }

  // Project indicators
  const projectPatterns = [
    /\b(project|initiative|program|feature|module|component)\b/,
    /\b(v\d+\.\d+|version|release|sprint)\b/,
    /\b(building|developing|implementing|working on)\b/,
  ];
  if (projectPatterns.some((p) => p.test(lowerContext))) {
    return 'project';
  }

  // Technology indicators
  const techPatterns = [
    /\b(language|framework|library|tool|api|sdk|cli|ide)\b/,
    /\b(typescript|javascript|python|java|rust|go)\b/,
    /\b(react|vue|angular|node|express|django|rails)\b/,
    /\.(js|ts|py|java|rs|go|rb|php|c|cpp|cs)\b/,
  ];
  if (
    techPatterns.some((p) => p.test(lowerContext)) ||
    /[A-Z][a-z]+(?:[A-Z][a-z]+)+/.test(name) // PascalCase
  ) {
    return 'technology';
  }

  // Location indicators
  const locationPatterns = [
    /\b(city|country|state|region|office|headquarters|located|based in)\b/,
    /\b(street|avenue|road|building|floor)\b/,
  ];
  if (locationPatterns.some((p) => p.test(lowerContext))) {
    return 'location';
  }

  // Document indicators
  const documentPatterns = [
    /\b(document|file|spec|specification|readme|guide|manual|documentation)\b/,
    /\.(pdf|doc|docx|txt|md|html|json|xml|yaml|yml)\b/,
  ];
  if (documentPatterns.some((p) => p.test(lowerContext))) {
    return 'document';
  }

  // Concept indicators
  const conceptPatterns = [
    /\b(pattern|principle|methodology|paradigm|concept|idea|approach)\b/,
    /\b(architecture|design|model|strategy|technique)\b/,
  ];
  if (conceptPatterns.some((p) => p.test(lowerContext))) {
    return 'concept';
  }

  // Default to 'other' if can't determine
  return 'other';
}

/**
 * Create entity input from name and context
 */
export function createEntityInput(name: string, context: string = ''): EntityInput {
  const type = classifyEntityType(name, context);
  const metadata: Record<string, unknown> = {};

  // Extract version if present
  const versionMatch = context.match(/v?(\d+\.\d+(?:\.\d+)?)/);
  if (versionMatch) {
    metadata['version'] = versionMatch[1];
  }

  // Extract role for persons
  if (type === 'person') {
    const roleMatch = context.match(/\b(developer|engineer|manager|designer|analyst|architect|lead|senior|junior)\b/i);
    if (roleMatch) {
      metadata['role'] = roleMatch[1]?.toLowerCase();
    }
  }

  // Extract status for projects
  if (type === 'project') {
    const statusMatch = context.match(/\b(active|inactive|completed|in-progress|planning|archived)\b/i);
    if (statusMatch) {
      metadata['status'] = statusMatch[1]?.toLowerCase();
    }
  }

  return {
    name,
    type,
    metadata,
  };
}

/**
 * Normalize entity name
 */
export function normalizeEntityName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/^(the|a|an)\s+/i, ''); // Remove articles
}

/**
 * Deduplicate entities (handle variations)
 */
export function deduplicateEntities(entities: string[]): string[] {
  const normalized = new Map<string, string>();

  for (const entity of entities) {
    const norm = normalizeEntityName(entity).toLowerCase();

    // If we haven't seen this normalized form, or current is longer (more complete)
    if (!normalized.has(norm) || entity.length > (normalized.get(norm)?.length ?? 0)) {
      normalized.set(norm, entity);
    }
  }

  return Array.from(normalized.values());
}
