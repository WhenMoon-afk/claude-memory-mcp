# Memory MCP v3.0 - Extraction Context

> **v3.0 Note**: Extraction happens automatically in memory_store. Entity extraction is pattern-based (lightweight), summary generation creates 20-word summaries for all memories.

## Fact Extraction Patterns

### What Qualifies as a Fact?
- Statements about the world: "Python is a programming language"
- User preferences: "User prefers dark mode"
- Project context: "Building MCPB bundle for v2.0"
- Domain knowledge: "JWT tokens expire after 24 hours"
- Decisions: "Team decided to use TypeScript"
- Constraints: "API rate limit is 100 requests/minute"

### What Does NOT Qualify?
- Questions: "What is the capital of France?"
- Commands: "Install the package"
- Greetings: "Hello, how are you?"
- Temporary dialogue: "Let me think about that"

### Extraction Rules
1. **Be specific**: "User prefers TypeScript" not "User likes things"
2. **Include context**: "For web projects, use React" not "Use React"
3. **Atomic facts**: One fact per memory, not compound statements
4. **Timeless when possible**: "User prefers X" not "User said they prefer X yesterday"
5. **Include provenance**: Always track source and timestamp

## Entity Extraction

### Entity Types
- **person**: Individuals, users, team members
- **organization**: Companies, teams, departments
- **project**: Software projects, initiatives, features
- **technology**: Languages, frameworks, tools, libraries
- **location**: Physical or virtual locations
- **concept**: Abstract ideas, methodologies, patterns
- **document**: Files, specifications, documentation

### Entity Extraction Rules
1. **Proper nouns**: "Sarah Chen", "Google", "Project Phoenix"
2. **Role + context**: "Senior Developer on Platform team"
3. **Disambiguate**: "Python (language)" not just "Python"
4. **Canonical names**: Use consistent naming across memories

### Entity Metadata Examples
```json
{
  "person": {
    "role": "senior_developer",
    "team": "platform",
    "contact": "sarah@example.com"
  },
  "project": {
    "status": "active",
    "priority": "high",
    "deadline": "2024-12-31"
  },
  "technology": {
    "version": "3.11",
    "category": "language",
    "ecosystem": "data_science"
  }
}
```

## Relationship Extraction

### Relationship Types
- **hierarchical**: "Alice reports to Bob"
- **dependency**: "Project X depends on Service Y"
- **association**: "User works on Team Z"
- **temporal**: "Event A occurred before Event B"
- **causal**: "Change X caused Issue Y"
- **semantic**: "Concept A is related to Concept B"

### Relationship Extraction Rules
1. **Bidirectional**: Store both directions if needed
2. **Explicit type**: Use metadata to specify relationship type
3. **Include entities**: Always link to specific entities
4. **Strength/weight**: Use importance to indicate relationship strength

### Relationship Patterns
```typescript
// Hierarchical
{
  content: "Alice reports to Bob in Engineering",
  type: "relationship",
  entities: ["Alice", "Bob", "Engineering"],
  metadata: { relationship_type: "reports_to", direction: "alice_to_bob" }
}

// Dependency
{
  content: "Frontend service depends on Auth API v2.0",
  type: "relationship",
  entities: ["Frontend service", "Auth API"],
  metadata: {
    relationship_type: "depends_on",
    version: "v2.0",
    criticality: "high"
  }
}

// Association
{
  content: "Sarah Chen contributes to React and TypeScript projects",
  type: "relationship",
  entities: ["Sarah Chen", "React", "TypeScript"],
  metadata: { relationship_type: "contributes_to" }
}
```

## Auto-Extraction Process

### Step 1: Identify Candidates
- Scan content for proper nouns, quoted text, technical terms
- Look for subject-verb-object patterns
- Detect enumeration and lists

### Step 2: Classify Type
- **fact**: Statement without entities or simple entity reference
- **entity**: Description of person, place, thing
- **relationship**: Connection between multiple entities

### Step 3: Extract Entities
- Named entity recognition (NER)
- Resolve pronouns and references
- Build entity list for memory

### Step 4: Calculate Importance
- Based on content analysis (see scoring context)
- User-provided importance overrides auto-calculation
- Consider context and provenance

### Step 5: Generate Metadata
- Extract relevant attributes
- Add tags and categories
- Include source context

## Best Practices

### DO:
✅ Extract atomic facts: "User prefers TypeScript"
✅ Include full context: "For backend services, use FastAPI"
✅ Link entities explicitly: entities: ["User", "TypeScript"]
✅ Add rich metadata: { category: "preferences", scope: "backend" }
✅ Track provenance: source, timestamp, context

### DON'T:
❌ Extract questions or commands
❌ Store compound facts: "User likes X and Y and prefers Z"
❌ Omit context: "Use FastAPI" (for what?)
❌ Forget entities: relationship without entity links
❌ Skip provenance: unknown origin is untrusted

## Validation Checklist

Before storing a memory:
- [ ] Content is clear and specific
- [ ] Type is correctly classified (fact/entity/relationship)
- [ ] Entities are extracted and linked
- [ ] Metadata adds useful context
- [ ] Provenance is complete (source, timestamp, context)
- [ ] Importance is appropriate (manual or auto)
- [ ] TTL is set correctly for information lifespan

## Error Handling

### Ambiguous Content
- Default to `fact` type if unclear
- Include original phrasing in metadata
- Mark with `{ ambiguous: true }` flag

### Missing Entities
- Store as fact without entity links
- Add `{ entities_detected: false }` flag
- Allow manual entity addition later

### Conflicting Information
- Check for existing similar memories
- If conflict, create new memory with higher importance
- Link to previous memory in metadata: `{ supersedes: "mem_id" }`
