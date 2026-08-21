import { chmod, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { MoonciteEngine, type EvidenceAnchorSnapshot } from "../src/engine.js";
import {
  LearnedMemoryStore,
  type LearnedMemoryLifecycleResult,
  type LearnedMemoryStoredResult,
  type LearnedMemoryWriteResult,
  type LearnedSkillCandidateWriteResult,
  learnedMemoryDatabaseRetained,
  loadLearnedMemoryMode,
  resolveLearnedMemoryConfigPath,
  setLearnedMemoryEnabled,
} from "../src/learned-memory.js";
import { createFixture, digest, type Fixture } from "./fixture.js";

const fixtures: Fixture[] = [];
afterEach(async () => {
  while (fixtures.length) await fixtures.pop()!.cleanup();
});

async function fixture(): Promise<Fixture> {
  const value = await createFixture();
  fixtures.push(value);
  return value;
}

function storedMemory(result: LearnedMemoryWriteResult): LearnedMemoryStoredResult {
  if (result.kind !== "derived_memory_write") throw new Error("Expected a learned-memory revision result.");
  return result;
}

function lifecycleResult(result: LearnedMemoryWriteResult): LearnedMemoryLifecycleResult {
  if (result.kind !== "derived_memory_lifecycle") throw new Error("Expected a learned-memory lifecycle result.");
  return result;
}

function skillCandidateResult(result: LearnedMemoryWriteResult): LearnedSkillCandidateWriteResult {
  if (result.kind !== "skill_candidate_write") throw new Error("Expected a skill-candidate result.");
  return result;
}

function recallMemory(
  store: LearnedMemoryStore,
  query: string,
  options: {
    includeInvalid?: boolean;
    includeArchived?: boolean;
    relatedLimit?: number;
    project?: string | null;
  } = {},
) {
  return store.recall({
    query,
    limit: 5,
    project: options.project ?? null,
    includeInvalid: options.includeInvalid ?? false,
    includeArchived: options.includeArchived ?? false,
    relatedLimit: options.relatedLimit ?? 0,
  });
}

const MEMORY_SCHEMA_V1 = `
  CREATE TABLE memory_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE learned_memories (
    memory_id TEXT PRIMARY KEY,
    current_revision INTEGER NOT NULL CHECK (current_revision >= 1),
    created_at TEXT NOT NULL
  );
  CREATE TABLE learned_memory_revisions (
    memory_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    interpretation TEXT NOT NULL,
    scope_project TEXT,
    derived_at TEXT NOT NULL,
    derivation_kind TEXT NOT NULL CHECK (derivation_kind = 'explicit_agent'),
    mooncite_version TEXT NOT NULL,
    PRIMARY KEY (memory_id, revision),
    FOREIGN KEY (memory_id) REFERENCES learned_memories(memory_id) ON DELETE CASCADE
  );
  CREATE TABLE learned_memory_evidence (
    memory_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    evidence_id TEXT NOT NULL,
    evidence_uri TEXT NOT NULL,
    source_origin TEXT NOT NULL,
    source_root_digest TEXT NOT NULL,
    source_project TEXT NOT NULL,
    source_session_id TEXT NOT NULL,
    expected_record_digest TEXT NOT NULL,
    expected_span_digest TEXT NOT NULL,
    expected_context_digest TEXT NOT NULL,
    expected_role TEXT NOT NULL,
    expected_source_kind TEXT NOT NULL,
    expected_parent_id TEXT,
    expected_branch_state TEXT NOT NULL,
    expected_compaction_state TEXT NOT NULL,
    PRIMARY KEY (memory_id, revision, position),
    UNIQUE (memory_id, revision, evidence_id),
    FOREIGN KEY (memory_id, revision)
      REFERENCES learned_memory_revisions(memory_id, revision) ON DELETE CASCADE
  );
  CREATE INDEX learned_memory_evidence_locator
    ON learned_memory_evidence(evidence_id);
  CREATE VIRTUAL TABLE learned_memory_fts USING fts5(
    memory_id UNINDEXED,
    revision UNINDEXED,
    interpretation,
    tokenize='porter unicode61 remove_diacritics 2'
  );
`;

async function seedVersionOneMemory(
  stateDir: string,
  anchor: EvidenceAnchorSnapshot,
): Promise<{ memoryId: string; interpretation: string }> {
  const memoryId = "mooncite-memory:00000000-0000-4000-8000-000000000001";
  const interpretation = "Migrated silver cedar interpretation.";
  const timestamp = "2025-01-02T03:04:05.000Z";
  const path = join(stateDir, "learned-memory.sqlite");
  const database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA foreign_keys=ON;");
    database.exec(MEMORY_SCHEMA_V1);
    database.prepare("INSERT INTO memory_metadata(key, value) VALUES ('schema_version', '1')").run();
    database.prepare(`
      INSERT INTO learned_memories(memory_id, current_revision, created_at)
      VALUES (?, 1, ?)
    `).run(memoryId, timestamp);
    database.prepare(`
      INSERT INTO learned_memory_revisions(
        memory_id, revision, interpretation, scope_project,
        derived_at, derivation_kind, mooncite_version
      ) VALUES (?, 1, ?, ?, ?, 'explicit_agent', '0.1.0')
    `).run(memoryId, interpretation, anchor.project, timestamp);
    database.prepare(`
      INSERT INTO learned_memory_evidence(
        memory_id, revision, position, evidence_id, evidence_uri,
        source_origin, source_root_digest, source_project, source_session_id,
        expected_record_digest, expected_span_digest, expected_context_digest,
        expected_role, expected_source_kind, expected_parent_id,
        expected_branch_state, expected_compaction_state
      ) VALUES (?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      memoryId,
      anchor.evidenceId,
      anchor.evidenceUri,
      anchor.sourceOrigin,
      anchor.sourceRootDigest,
      anchor.project,
      anchor.sessionId,
      anchor.recordDigest,
      anchor.spanDigest,
      anchor.contextDigest,
      anchor.role,
      anchor.sourceKind,
      anchor.parentId,
      anchor.branchState,
      anchor.compactionState,
    );
    database.prepare(`
      INSERT INTO learned_memory_fts(memory_id, revision, interpretation)
      VALUES (?, 1, ?)
    `).run(memoryId, interpretation);
  } finally {
    database.close();
  }
  await chmod(path, 0o600);
  return { memoryId, interpretation };
}

describe("optional learned-memory vertical", () => {
  it("is strictly default-off and creates no learned database", async () => {
    const f = await fixture();
    const configPath = join(f.home, ".config", "mooncite", "learned-memory.json");
    expect(resolveLearnedMemoryConfigPath({
      HOME: f.home,
      XDG_CONFIG_HOME: join(f.home, "private-config"),
    })).toBe(join(f.home, "private-config", "mooncite", "learned-memory.json"));
    expect(loadLearnedMemoryMode(configPath)).toEqual({ version: 1, enabled: false, configured: false });

    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    try {
      expect(engine.recall({ query: "silver-cedar-17" }).outcome).toBe("matches");
    } finally {
      engine.close();
    }
    expect(await readdir(f.stateDir)).not.toContain("learned-memory.sqlite");
    expect(learnedMemoryDatabaseRetained(f.stateDir)).toBe(false);

    expect(setLearnedMemoryEnabled(configPath, true)).toEqual({ version: 1, enabled: true, configured: true });
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({ version: 1, enabled: true });
    expect(setLearnedMemoryEnabled(configPath, false)).toEqual({ version: 1, enabled: false, configured: true });
    expect(learnedMemoryDatabaseRetained(f.stateDir)).toBe(false);

    await writeFile(configPath, JSON.stringify({ version: 1, enabled: false, unexpected: true }), { mode: 0o600 });
    expect(() => loadLearnedMemoryMode(configPath)).toThrow(/configuration is invalid/u);
  });

  it("stores all four explicit provenance forms and preserves immutable revisions", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    const store = new LearnedMemoryStore(engine, { stateDir: f.stateDir });
    try {
      const source = engine.recall({ query: "silver-cedar-17" }).candidates[0]!;
      const verified = storedMemory(store.write({
        operation: "create",
        interpretation: "The project launch marker is silver cedar.",
        provenance: { kind: "verified", evidenceIds: [source.evidenceUri] },
        scope: null,
      }));
      expect(verified).toMatchObject({
        outcome: "created",
        revision: 1,
        provenance: { kind: "verified" },
        provenanceOutcome: "verified",
        scope: { kind: "project" },
        evidenceIds: [source.evidenceId],
      });

      const currentContext = storedMemory(store.write({
        operation: "create",
        interpretation: "The owner currently prefers the compact form.",
        provenance: {
          kind: "current_context",
          contextNote: "Explicitly stated in the current task.",
          evidenceIds: [],
        },
        scope: { kind: "global" },
      }));
      const unanchored = storedMemory(store.write({
        operation: "create",
        interpretation: "This is a provisional working assumption.",
        provenance: { kind: "unanchored", basisNote: "Needed as an explicit hypothesis for this run." },
        scope: { kind: "global" },
      }));
      const derived = storedMemory(store.write({
        operation: "create",
        interpretation: "The retained launch convention follows the verified marker.",
        provenance: {
          kind: "derived",
          parents: [{
            memoryId: verified.memoryId,
            revision: 1,
            relation: "supports",
            reason: "The verified marker directly supports the retained convention.",
          }],
          evidenceIds: [],
        },
        scope: null,
      }));

      expect(recallMemory(store, currentContext.memoryId).candidates[0]).toMatchObject({
        provenance: { kind: "current_context", contextNote: "Explicitly stated in the current task." },
        provenanceState: "not_evidence_backed",
        anchors: [],
      });
      expect(recallMemory(store, unanchored.memoryId).candidates[0]).toMatchObject({
        provenance: { kind: "unanchored" },
        provenanceState: "not_evidence_backed",
      });
      expect(recallMemory(store, derived.memoryId, { relatedLimit: 1 }).candidates[0]).toMatchObject({
        provenance: { kind: "derived", parents: [{ memoryId: verified.memoryId, revision: 1 }] },
        related: [{ direction: "outgoing", memoryId: verified.memoryId, revision: 1 }],
      });

      expect(() => store.write({
        operation: "revise",
        memoryId: verified.memoryId,
        expectedRevision: 2,
        interpretation: "This stale correction must not commit.",
        provenance: { kind: "current_context", contextNote: "Stale.", evidenceIds: [] },
        scope: null,
      })).toThrow(/expected revision 2, current revision 1/u);
      const revised = storedMemory(store.write({
        operation: "revise",
        memoryId: verified.memoryId,
        expectedRevision: 1,
        interpretation: "The current task retains the silver cedar launch marker.",
        provenance: {
          kind: "current_context",
          contextNote: "The current task explicitly retains the convention.",
          evidenceIds: [],
        },
        scope: null,
      }));
      expect(revised).toMatchObject({ outcome: "revised", memoryId: verified.memoryId, revision: 2 });
      expect(store.inspect({
        kind: "revision",
        memoryId: verified.memoryId,
        revision: 1,
        window: 0,
      })).toMatchObject({
        kind: "derived_memory",
        revision: 1,
        currentRevision: 2,
        isCurrent: false,
        provenance: { kind: "verified" },
        anchors: [{ inspection: { outcome: "verified" } }],
      });
      expect(await digest(f.source)).toBe(f.sourceDigest);
    } finally {
      store.close();
      engine.close();
    }
  });

  it("quarantines only a revision's own changed evidence and filters related recall", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    let store = new LearnedMemoryStore(engine, { stateDir: f.stateDir });
    try {
      const original = await readFile(f.source, "utf8");
      const parentInterpretation = "The retained launch token is silver cedar.";
      const source = engine.recall({ query: "silver-cedar-17" }).candidates[0]!;
      const parent = storedMemory(store.write({
        operation: "create",
        interpretation: parentInterpretation,
        provenance: { kind: "verified", evidenceIds: [source.evidenceId] },
        scope: null,
      }));
      const child = storedMemory(store.write({
        operation: "create",
        interpretation: "The rollout note is derived from the retained launch token.",
        provenance: {
          kind: "derived",
          parents: [{
            memoryId: parent.memoryId,
            revision: 1,
            relation: "supports",
            reason: "The retained token supports this rollout note.",
          }],
          evidenceIds: [],
        },
        scope: null,
      }));
      const grandchild = storedMemory(store.write({
        operation: "create",
        interpretation: "The summary refines the rollout note.",
        provenance: {
          kind: "derived",
          parents: [{
            memoryId: child.memoryId,
            revision: 1,
            relation: "refines",
            reason: "This summary narrows the rollout note.",
          }],
          evidenceIds: [],
        },
        scope: null,
      }));
      expect(recallMemory(store, grandchild.memoryId, { relatedLimit: 8 }).candidates[0]?.related).toEqual([
        expect.objectContaining({ memoryId: child.memoryId, revision: 1, direction: "outgoing" }),
      ]);

      const changed = original.replace("silver-cedar-17", "bronze-cedar-17");
      expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(original));
      await writeFile(f.source, changed, { mode: 0o600 });
      expect(store.inspect({
        kind: "revision",
        memoryId: parent.memoryId,
        revision: null,
        window: 0,
      })).toMatchObject({
        provenanceOutcome: "quarantined",
        provenanceState: "content_mismatch",
      });
      store.close();
      store = new LearnedMemoryStore(engine, { stateDir: f.stateDir });
      expect(recallMemory(store, parent.memoryId)).toMatchObject({ outcome: "no_match", candidates: [] });
      const recalledChild = recallMemory(store, child.memoryId, { relatedLimit: 1 });
      expect(recalledChild).toMatchObject({
        outcome: "matches",
        candidates: [{
          memoryId: child.memoryId,
          provenanceState: "not_evidence_backed",
          quarantined: false,
        }],
      });
      expect(recalledChild.candidates[0]?.related).toEqual([
        expect.objectContaining({
          memoryId: grandchild.memoryId,
          direction: "incoming",
          quarantined: false,
        }),
      ]);
      expect(JSON.stringify(recalledChild)).not.toContain(parentInterpretation);
      expect(recallMemory(store, child.memoryId, {
        includeInvalid: true,
        relatedLimit: 8,
      }).candidates[0]?.related).toEqual([
        expect.objectContaining({
          memoryId: parent.memoryId,
          direction: "outgoing",
          interpretationExcerpt: parentInterpretation,
          provenanceState: "content_mismatch",
          quarantined: true,
        }),
        expect.objectContaining({
          memoryId: grandchild.memoryId,
          direction: "incoming",
          quarantined: false,
        }),
      ]);
      expect(recallMemory(store, parent.memoryId, { includeInvalid: true })).toMatchObject({
        outcome: "matches",
        candidates: [{
          memoryId: parent.memoryId,
          provenanceState: "content_mismatch",
          quarantined: true,
        }],
      });
    } finally {
      store.close();
      engine.close();
    }
  });

  it("filters out-of-project related memory excerpts", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    const store = new LearnedMemoryStore(engine, { stateDir: f.stateDir });
    try {
      const parentInterpretation = "The other project retains a private rollout note.";
      const otherProjectParent = storedMemory(store.write({
        operation: "create",
        interpretation: parentInterpretation,
        provenance: { kind: "unanchored", basisNote: "Owner-provided working premise." },
        scope: { kind: "project", project: "/work/other-project" },
      }));
      const globalChild = storedMemory(store.write({
        operation: "create",
        interpretation: "A global summary references a project-specific note.",
        provenance: {
          kind: "derived",
          parents: [{
            memoryId: otherProjectParent.memoryId,
            revision: 1,
            relation: "supports",
            reason: "The project note contributes to this global summary.",
          }],
          evidenceIds: [],
        },
        scope: { kind: "global" },
      }));

      const projectRecall = recallMemory(store, globalChild.memoryId, {
        project: "/work/requesting-project",
        includeInvalid: true,
        relatedLimit: 8,
      });
      expect(projectRecall.candidates[0]?.related).toEqual([]);
      expect(JSON.stringify(projectRecall)).not.toContain(parentInterpretation);
      expect(recallMemory(store, globalChild.memoryId, {
        project: null,
        relatedLimit: 8,
      }).candidates[0]?.related).toEqual([
        expect.objectContaining({
          memoryId: otherProjectParent.memoryId,
          direction: "outgoing",
          interpretationExcerpt: parentInterpretation,
        }),
      ]);
    } finally {
      store.close();
      engine.close();
    }
  });

  it("returns active incoming relations after more than 32 archived predecessors", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    const store = new LearnedMemoryStore(engine, { stateDir: f.stateDir });
    try {
      const parent = storedMemory(store.write({
        operation: "create",
        interpretation: "The shared parent remains active.",
        provenance: { kind: "unanchored", basisNote: "Owner-provided working premise." },
        scope: { kind: "global" },
      }));
      const children = Array.from({ length: 34 }, (_, index) => storedMemory(store.write({
        operation: "create",
        interpretation: `Incoming relation ${index + 1}.`,
        provenance: {
          kind: "derived",
          parents: [{
            memoryId: parent.memoryId,
            revision: 1,
            relation: "supports",
            reason: "This child references the shared parent.",
          }],
          evidenceIds: [],
        },
        scope: { kind: "global" },
      })));
      children.sort((left, right) => {
        if (left.memoryId < right.memoryId) return -1;
        if (left.memoryId > right.memoryId) return 1;
        return 0;
      });
      for (const child of children.slice(0, -1)) {
        lifecycleResult(store.write({
          operation: "archive",
          memoryId: child.memoryId,
          expectedRevision: 1,
          expectedMetadataVersion: 1,
        }));
      }
      const firstArchived = children[0]!;
      const active = children[children.length - 1]!;

      expect(recallMemory(store, parent.memoryId, {
        relatedLimit: 1,
      }).candidates[0]?.related).toEqual([
        expect.objectContaining({
          memoryId: active.memoryId,
          direction: "incoming",
          lifecycle: expect.objectContaining({ state: "active" }),
        }),
      ]);
      expect(recallMemory(store, parent.memoryId, {
        includeArchived: true,
        relatedLimit: 1,
      }).candidates[0]?.related).toEqual([
        expect.objectContaining({
          memoryId: firstArchived.memoryId,
          direction: "incoming",
          lifecycle: expect.objectContaining({ state: "archived" }),
        }),
      ]);
    } finally {
      store.close();
      engine.close();
    }
  });


  it("keeps anchored memory recallable while its configured source is temporarily unavailable", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    const store = new LearnedMemoryStore(engine, { stateDir: f.stateDir });
    const unavailableRoot = `${f.sessionsRoot}.unavailable`;
    try {
      const source = engine.recall({ query: "silver-cedar-17" }).candidates[0]!;
      const memory = storedMemory(store.write({
        operation: "create",
        interpretation: "The source-outage convention keeps its verified memory recallable.",
        provenance: { kind: "verified", evidenceIds: [source.evidenceId] },
        scope: null,
      }));

      await rename(f.sessionsRoot, unavailableRoot);
      const recalled = recallMemory(store, memory.memoryId);
      expect(recalled).toMatchObject({
        outcome: "matches",
        candidates: [{
          memoryId: memory.memoryId,
          provenanceState: "last_good",
          quarantined: false,
          evidenceProjection: { freshness: "last_good" },
          anchors: [{ evidenceId: source.evidenceId, state: "last_good" }],
        }],
      });
      expect(recalled.warnings).toEqual([
        "Evidence refresh retained a last-good generation; physically inspect every own anchor before relying on this interpretation.",
      ]);
      expect(store.inspect({
        kind: "revision",
        memoryId: memory.memoryId,
        revision: null,
        window: 0,
      })).toMatchObject({
        provenanceOutcome: "unavailable",
        provenanceState: "unavailable",
        evidenceProjection: { freshness: "last_good" },
        anchors: [{
          evidenceId: source.evidenceId,
          state: "unavailable",
          inspection: { outcome: "missing" },
        }],
      });
      expect(recallMemory(store, memory.memoryId)).toMatchObject({
        outcome: "matches",
        candidates: [{
          memoryId: memory.memoryId,
          provenanceState: "last_good",
          quarantined: false,
        }],
      });
    } finally {
      await rename(unavailableRoot, f.sessionsRoot).catch(() => undefined);
      store.close();
      engine.close();
    }
  });

  it("keeps lifecycle manual and consolidation immutable", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    const store = new LearnedMemoryStore(engine, { stateDir: f.stateDir });
    try {
      const first = storedMemory(store.write({
        operation: "create",
        interpretation: "First explicit premise.",
        provenance: { kind: "unanchored", basisNote: "Owner-provided working premise." },
        scope: { kind: "global" },
      }));
      const second = storedMemory(store.write({
        operation: "create",
        interpretation: "Second explicit premise.",
        provenance: { kind: "unanchored", basisNote: "Owner-provided working premise." },
        scope: { kind: "global" },
      }));
      const consolidated = storedMemory(store.write({
        operation: "consolidate",
        interpretation: "The two explicit premises form one reviewed summary.",
        parents: [
          {
            memoryId: first.memoryId,
            revision: 1,
            relation: "supports",
            reason: "The first premise contributes directly.",
          },
          {
            memoryId: second.memoryId,
            revision: 1,
            relation: "supports",
            reason: "The second premise contributes directly.",
          },
        ],
        evidenceIds: [],
        scope: { kind: "global" },
      }));
      expect(consolidated).toMatchObject({
        outcome: "consolidated",
        revision: 1,
        provenance: { kind: "derived", parents: [{ revision: 1 }, { revision: 1 }] },
      });

      const reinforced = lifecycleResult(store.write({
        operation: "reinforce",
        memoryId: consolidated.memoryId,
        expectedRevision: 1,
        expectedMetadataVersion: 1,
        salience: 72,
      }));
      expect(reinforced).toMatchObject({
        outcome: "reinforced",
        revision: 1,
        lifecycle: { state: "active", metadataVersion: 2, salience: 72, reinforcementCount: 1 },
      });
      const archived = lifecycleResult(store.write({
        operation: "archive",
        memoryId: consolidated.memoryId,
        expectedRevision: 1,
        expectedMetadataVersion: 2,
      }));
      expect(archived).toMatchObject({
        outcome: "archived",
        revision: 1,
        lifecycle: { state: "archived", metadataVersion: 3 },
      });
      expect(recallMemory(store, consolidated.memoryId).outcome).toBe("no_match");
      expect(recallMemory(store, consolidated.memoryId, { includeArchived: true })).toMatchObject({
        candidates: [{ lifecycle: { state: "archived", metadataVersion: 3 } }],
      });
      const activated = lifecycleResult(store.write({
        operation: "activate",
        memoryId: consolidated.memoryId,
        expectedRevision: 1,
        expectedMetadataVersion: 3,
      }));
      expect(activated).toMatchObject({
        outcome: "activated",
        revision: 1,
        lifecycle: { state: "active", metadataVersion: 4, lastActivatedAt: expect.any(String) },
      });
    } finally {
      store.close();
      engine.close();
    }
  });

  it("reviews skill candidates without installing them and blocks dependent deletion", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    const store = new LearnedMemoryStore(engine, { stateDir: f.stateDir });
    try {
      const parent = storedMemory(store.write({
        operation: "create",
        interpretation: "A stable explicit premise.",
        provenance: { kind: "unanchored", basisNote: "Explicit test premise." },
        scope: { kind: "global" },
      }));
      const child = storedMemory(store.write({
        operation: "create",
        interpretation: "A dependent interpretation.",
        provenance: {
          kind: "derived",
          parents: [{
            memoryId: parent.memoryId,
            revision: 1,
            relation: "supports",
            reason: "The premise supports this dependent interpretation.",
          }],
          evidenceIds: [],
        },
        scope: { kind: "global" },
      }));
      const proposed = skillCandidateResult(store.write({
        operation: "propose_skill_candidate",
        sources: [{ memoryId: parent.memoryId, revision: 1 }],
        artifact: {
          name: "reviewed-example",
          description: "A bounded candidate generated from exact learned-memory revisions.",
          instructions: "Apply only after explicit human review.",
        },
      }));
      expect(proposed.candidate).toMatchObject({
        review: { state: "pending_review" },
        installed: false,
        sources: [{ memoryId: parent.memoryId, revision: 1 }],
      });
      const reviewed = skillCandidateResult(store.write({
        operation: "review_skill_candidate",
        candidateId: proposed.candidate.candidateId,
        expectedState: "pending_review",
        decision: "approved",
        reviewNote: "The candidate text was reviewed, but approval does not install it.",
      }));
      expect(reviewed.candidate).toMatchObject({
        review: { state: "approved" },
        installed: false,
      });
      expect(store.inspect({
        kind: "skill_candidate",
        candidateId: proposed.candidate.candidateId,
      })).toEqual(reviewed.candidate);

      expect(store.delete({
        kind: "memory",
        memoryId: parent.memoryId,
        expectedRevision: 1,
        expectedMetadataVersion: 1,
      })).toMatchObject({
        outcome: "blocked",
        dependencyCount: 2,
        dependencies: expect.arrayContaining([
          { kind: "relation", memoryId: child.memoryId, revision: 1 },
          { kind: "skill_candidate", candidateId: proposed.candidate.candidateId },
        ]),
      });
      expect(store.delete({
        kind: "skill_candidate",
        candidateId: proposed.candidate.candidateId,
        expectedState: "approved",
      })).toEqual({
        kind: "skill_candidate_delete",
        outcome: "deleted",
        candidateId: proposed.candidate.candidateId,
      });
      expect(store.delete({
        kind: "memory",
        memoryId: child.memoryId,
        expectedRevision: 1,
        expectedMetadataVersion: 1,
      })).toMatchObject({ outcome: "deleted", deletedRevisions: 1 });
      expect(store.delete({
        kind: "memory",
        memoryId: parent.memoryId,
        expectedRevision: 1,
        expectedMetadataVersion: 1,
      })).toMatchObject({ outcome: "deleted", deletedRevisions: 1 });
      const selfDerived = storedMemory(store.write({
        operation: "create",
        interpretation: "A premise that will be refined in place.",
        provenance: { kind: "unanchored", basisNote: "Explicit test premise." },
        scope: { kind: "global" },
      }));
      const selfRevised = storedMemory(store.write({
        operation: "revise",
        memoryId: selfDerived.memoryId,
        expectedRevision: 1,
        interpretation: "The revised interpretation refines its own prior revision.",
        provenance: {
          kind: "derived",
          parents: [{
            memoryId: selfDerived.memoryId,
            revision: 1,
            relation: "refines",
            reason: "The new revision explicitly refines its own immutable predecessor.",
          }],
          evidenceIds: [],
        },
        scope: null,
      }));
      expect(store.delete({
        kind: "memory",
        memoryId: selfDerived.memoryId,
        expectedRevision: selfRevised.revision,
        expectedMetadataVersion: 1,
      })).toMatchObject({ outcome: "deleted", deletedRevisions: 2 });
      expect(engine.recall({ query: "silver-cedar-17" }).outcome).toBe("matches");
      expect(await digest(f.source)).toBe(f.sourceDigest);
    } finally {
      store.close();
      engine.close();
    }
  });

  it("migrates exact v1 evidence-backed rows to v2 verified revisions", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    const source = engine.recall({ query: "silver-cedar-17" }).candidates[0]!;
    const resolution = engine.resolveEvidenceAnchors([{ locator: source.evidenceId }])[0]!;
    if (resolution.outcome !== "resolved" || resolution.anchor === null) {
      throw new Error("Expected the fixture evidence anchor to resolve.");
    }
    const seeded = await seedVersionOneMemory(f.stateDir, resolution.anchor);
    const store = new LearnedMemoryStore(engine, { stateDir: f.stateDir });
    try {
      expect(store.status()).toMatchObject({
        outcome: "ready",
        schemaVersion: 2,
        memories: 1,
        revisions: 1,
        active: 1,
      });
      expect(store.inspect({
        kind: "revision",
        memoryId: seeded.memoryId,
        revision: null,
        window: 0,
      })).toMatchObject({
        interpretation: seeded.interpretation,
        provenance: { kind: "verified" },
        provenanceOutcome: "verified",
        lifecycle: { state: "active", metadataVersion: 1 },
        anchors: [{ evidenceId: source.evidenceId }],
      });
    } finally {
      store.close();
      engine.close();
    }
  });

  it("refuses recursive Mooncite output and keeps learned-store corruption independent from evidence", async () => {
    const f = await fixture();
    const entries = (await readFile(f.source, "utf8")).trimEnd().split("\n")
      .map((line): unknown => JSON.parse(line));
    entries.push({
      type: "message",
      id: "entry-tool",
      parentId: "entry-b",
      message: {
        role: "toolResult",
        content: "Derived memory mooncite-memory:00000000-0000-4000-8000-000000000000 revision 1: verified provenance.\nInterpretation (derived_memory, not source evidence): recursive marker",
      },
    });
    await writeFile(f.source, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, { mode: 0o600 });
    const options = { sessionsRoot: f.sessionsRoot, stateDir: f.stateDir };
    const engine = new MoonciteEngine(options);
    const store = new LearnedMemoryStore(engine, { stateDir: f.stateDir });
    engine.status();
    const index = new DatabaseSync(join(f.stateDir, "index.sqlite"), { readOnly: true });
    const raw = index.prepare("SELECT evidence_id FROM evidence WHERE entry_id = ?").get("entry-tool");
    index.close();
    if (typeof raw !== "object" || raw === null || !("evidence_id" in raw) || typeof raw.evidence_id !== "string") {
      throw new Error("Expected the recursive rendering evidence locator.");
    }
    const rendering = engine.recall({ query: raw.evidence_id }).candidates[0]!;
    expect(rendering.isEcho).toBe(true);
    expect(() => store.write({
      operation: "create",
      interpretation: "Recursive memory must not be retained.",
      provenance: { kind: "verified", evidenceIds: [rendering.evidenceId] },
      scope: null,
    })).toThrow(/tool renderings cannot be retained/u);
    store.close();
    engine.close();

    const learnedPath = join(f.stateDir, "learned-memory.sqlite");
    await writeFile(learnedPath, "not a sqlite database", { mode: 0o600 });
    await chmod(learnedPath, 0o600);
    const evidenceOnly = new MoonciteEngine(options);
    try {
      expect(() => new LearnedMemoryStore(evidenceOnly, { stateDir: f.stateDir })).toThrow();
      expect(evidenceOnly.recall({ query: "silver-cedar-17" }).outcome).toBe("matches");
      expect(await readFile(learnedPath, "utf8")).toBe("not a sqlite database");
    } finally {
      evidenceOnly.close();
    }
  });
});
