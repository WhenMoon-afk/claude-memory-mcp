import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  MoonciteEngine,
  type EvidenceAnchorResolution,
  type EvidenceAnchorSnapshot,
  type EvidenceInspection,
  type SourceOrigin,
} from "./engine.js";
import {
  MOONCITE_STATE_MARKER_CONTENT,
  MOONCITE_STATE_MARKER_NAME,
  MOONCITE_VERSION,
} from "./identity.js";

const MEMORY_SCHEMA_VERSION = 2;
const MEMORY_DATABASE_NAME = "learned-memory.sqlite";
const MAX_MEMORY_CONFIG_BYTES = 4_096;
const MAX_INTERPRETATION_BYTES = 8 * 1_024;
const MAX_MEMORY_QUERY_BYTES = 2_000;
const MAX_MEMORY_PROJECT_BYTES = 256;
const MAX_MEMORY_LOCATOR_BYTES = 2_048;
const MAX_PROVENANCE_NOTE_BYTES = 2_048;
const MAX_RELATION_REASON_BYTES = 1_024;
const MAX_SKILL_NAME_BYTES = 80;
const MAX_SKILL_DESCRIPTION_BYTES = 2_048;
const MAX_SKILL_INSTRUCTIONS_BYTES = 16 * 1_024;
const MAX_SKILL_REVIEW_NOTE_BYTES = 2_048;
const MAX_MEMORY_RECALL_ROWS = 200;
const MAX_RELATED_REVISIONS = 8;
const MEMORY_ID_PATTERN = /^mooncite-memory:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SKILL_CANDIDATE_ID_PATTERN = /^mooncite-skill-candidate:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PRESENTATION_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u;
const OBSERVED_ANCHOR_INVALIDITY_PREFIX = "observed_anchor_invalidity:";
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
const MEMORY_SCHEMA_V2 = `
  CREATE TABLE memory_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE learned_memories (
    memory_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );
  CREATE TABLE learned_memory_revisions (
    memory_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    interpretation TEXT NOT NULL,
    scope_project TEXT,
    provenance_kind TEXT NOT NULL
      CHECK (provenance_kind IN ('verified', 'derived', 'current_context', 'unanchored')),
    provenance_note TEXT,
    derived_at TEXT NOT NULL,
    derivation_kind TEXT NOT NULL CHECK (derivation_kind = 'explicit_agent'),
    mooncite_version TEXT NOT NULL,
    PRIMARY KEY (memory_id, revision),
    CHECK (
      (provenance_kind IN ('verified', 'derived') AND provenance_note IS NULL)
      OR (provenance_kind IN ('current_context', 'unanchored') AND provenance_note IS NOT NULL)
    ),
    FOREIGN KEY (memory_id) REFERENCES learned_memories(memory_id) ON DELETE CASCADE
  );
  CREATE TABLE learned_memory_heads (
    memory_id TEXT PRIMARY KEY,
    current_revision INTEGER NOT NULL CHECK (current_revision >= 1),
    FOREIGN KEY (memory_id) REFERENCES learned_memories(memory_id) ON DELETE CASCADE,
    FOREIGN KEY (memory_id, current_revision)
      REFERENCES learned_memory_revisions(memory_id, revision) ON DELETE CASCADE
  );
  CREATE TABLE learned_memory_lifecycle (
    memory_id TEXT PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN ('active', 'archived')),
    metadata_version INTEGER NOT NULL CHECK (metadata_version >= 1),
    salience INTEGER NOT NULL CHECK (salience BETWEEN 0 AND 100),
    last_activation_at TEXT,
    reinforcement_count INTEGER NOT NULL CHECK (reinforcement_count >= 0),
    archived_at TEXT,
    CHECK (
      (state = 'active' AND archived_at IS NULL)
      OR (state = 'archived' AND archived_at IS NOT NULL)
    ),
    FOREIGN KEY (memory_id) REFERENCES learned_memories(memory_id) ON DELETE CASCADE
  );
  CREATE TABLE learned_memory_evidence (
    memory_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 7),
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
  CREATE TABLE learned_memory_relations (
    child_memory_id TEXT NOT NULL,
    child_revision INTEGER NOT NULL,
    position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 7),
    parent_memory_id TEXT NOT NULL,
    parent_revision INTEGER NOT NULL CHECK (parent_revision >= 1),
    relation_kind TEXT NOT NULL
      CHECK (relation_kind IN ('supports', 'contradicts', 'refines', 'supersedes')),
    reason TEXT NOT NULL,
    PRIMARY KEY (child_memory_id, child_revision, position),
    UNIQUE (child_memory_id, child_revision, parent_memory_id, parent_revision),
    CHECK (child_memory_id <> parent_memory_id OR child_revision <> parent_revision),
    FOREIGN KEY (child_memory_id, child_revision)
      REFERENCES learned_memory_revisions(memory_id, revision) ON DELETE CASCADE,
    FOREIGN KEY (parent_memory_id, parent_revision)
      REFERENCES learned_memory_revisions(memory_id, revision) ON DELETE RESTRICT
  );
  CREATE INDEX learned_memory_relation_parent
    ON learned_memory_relations(parent_memory_id, parent_revision);
  CREATE TABLE learned_skill_candidates (
    candidate_id TEXT PRIMARY KEY,
    skill_name TEXT NOT NULL,
    description TEXT NOT NULL,
    instructions TEXT NOT NULL,
    review_state TEXT NOT NULL
      CHECK (review_state IN ('pending_review', 'approved', 'rejected')),
    review_note TEXT,
    created_at TEXT NOT NULL,
    reviewed_at TEXT,
    CHECK (
      (review_state = 'pending_review' AND review_note IS NULL AND reviewed_at IS NULL)
      OR (review_state IN ('approved', 'rejected') AND review_note IS NOT NULL AND reviewed_at IS NOT NULL)
    )
  );
  CREATE TABLE learned_skill_candidate_sources (
    candidate_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 7),
    memory_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    PRIMARY KEY (candidate_id, position),
    UNIQUE (candidate_id, memory_id, revision),
    FOREIGN KEY (candidate_id) REFERENCES learned_skill_candidates(candidate_id) ON DELETE CASCADE,
    FOREIGN KEY (memory_id, revision)
      REFERENCES learned_memory_revisions(memory_id, revision) ON DELETE RESTRICT
  );
  CREATE INDEX learned_skill_candidate_source
    ON learned_skill_candidate_sources(memory_id, revision);
  CREATE VIRTUAL TABLE learned_memory_fts USING fts5(
    memory_id UNINDEXED,
    revision UNINDEXED,
    interpretation,
    tokenize='porter unicode61 remove_diacritics 2'
  );
`;

export interface LearnedMemoryMode {
  version: 1;
  enabled: boolean;
  configured: boolean;
}

export type LearnedMemoryScope =
  | { kind: "global" }
  | { kind: "project"; project: string };

export type LearnedMemoryRelationKind = "supports" | "contradicts" | "refines" | "supersedes";
export interface LearnedMemoryRelation {
  memoryId: string;
  revision: number;
  relation: LearnedMemoryRelationKind;
  reason: string;
}

export type LearnedMemoryProvenance =
  | { kind: "verified" }
  | { kind: "derived"; parents: LearnedMemoryRelation[] }
  | { kind: "current_context"; contextNote: string }
  | { kind: "unanchored"; basisNote: string };

export type LearnedMemoryProvenanceInput =
  | { kind: "verified"; evidenceIds: string[] }
  | { kind: "derived"; parents: LearnedMemoryRelation[]; evidenceIds: string[] }
  | { kind: "current_context"; contextNote: string; evidenceIds: string[] }
  | { kind: "unanchored"; basisNote: string };

export type LearnedMemoryProvenanceState =
  | "not_evidence_backed"
  | "indexed"
  | "last_good"
  | "content_mismatch"
  | "context_mismatch"
  | "unavailable"
  | "deauthorized";

export interface LearnedMemoryAnchorSummary {
  evidenceId: string;
  evidenceUri: string;
  state: Exclude<LearnedMemoryProvenanceState, "not_evidence_backed">;
}

export interface LearnedMemoryEvidenceProjection {
  freshness: "current" | "last_good" | "unavailable";
  trustState: "full_verified" | "append_trusted";
  coverage: "complete" | "partial";
}

export type LearnedMemoryLifecycle =
  | {
    state: "active";
    metadataVersion: number;
    salience: number;
    lastActivatedAt: string | null;
    reinforcementCount: number;
  }
  | {
    state: "archived";
    metadataVersion: number;
    salience: number;
    lastActivatedAt: string | null;
    reinforcementCount: number;
    archivedAt: string;
  };

export interface LearnedMemoryRelatedRevision {
  direction: "outgoing" | "incoming";
  relation: LearnedMemoryRelationKind;
  reason: string;
  memoryId: string;
  revision: number;
  isCurrent: boolean;
  interpretationExcerpt: string;
  provenanceKind: LearnedMemoryProvenance["kind"];
  provenanceState: LearnedMemoryProvenanceState;
  quarantined: boolean;
  lifecycle: LearnedMemoryLifecycle;
}

export interface LearnedMemoryCandidate {
  kind: "derived_memory";
  memoryId: string;
  revision: number;
  interpretation: string;
  scope: LearnedMemoryScope;
  derivedAt: string;
  derivationKind: "explicit_agent";
  moonciteVersion: string;
  provenance: LearnedMemoryProvenance;
  anchors: LearnedMemoryAnchorSummary[];
  relevance: {
    kind: "exact_id" | "lexical";
    band: "strong" | "partial" | "weak";
    matchedTerms: string[];
  };
  provenanceState: LearnedMemoryProvenanceState;
  quarantined: boolean;
  evidenceProjection: LearnedMemoryEvidenceProjection | null;
  lifecycle: LearnedMemoryLifecycle;
  related: LearnedMemoryRelatedRevision[];
}

export interface LearnedMemoryRecall {
  kind: "derived_memory_recall";
  outcome: "matches" | "no_match";
  query: string;
  project: string | null;
  includeInvalid: boolean;
  includeArchived: boolean;
  relatedLimit: number;
  candidates: LearnedMemoryCandidate[];
  warnings: string[];
}

export interface LearnedMemoryInspectionAnchor {
  kind: "source_evidence_anchor";
  position: number;
  evidenceId: string;
  evidenceUri: string;
  state: Exclude<LearnedMemoryProvenanceState, "not_evidence_backed">;
  saved: {
    sourceOrigin: SourceOrigin;
    sourceRootDigest: string;
    project: string;
    sessionId: string;
    recordDigest: string;
    spanDigest: string;
    contextDigest: string;
    role: string;
    sourceKind: string;
    parentId: string | null;
    branchState: string;
    compactionState: string;
  };
  current: EvidenceAnchorSnapshot | null;
  inspection: EvidenceInspection;
}

export type LearnedSkillCandidateReview =
  | { state: "pending_review" }
  | { state: "approved"; note: string; reviewedAt: string }
  | { state: "rejected"; note: string; reviewedAt: string };

export interface LearnedSkillCandidate {
  kind: "skill_candidate";
  candidateId: string;
  sources: Array<{ memoryId: string; revision: number }>;
  artifact: { name: string; description: string; instructions: string };
  review: LearnedSkillCandidateReview;
  createdAt: string;
  installed: false;
}

export interface LearnedMemoryRevisionInspection {
  kind: "derived_memory";
  memoryId: string;
  revision: number;
  currentRevision: number;
  isCurrent: boolean;
  interpretation: string;
  scope: LearnedMemoryScope;
  derivedAt: string;
  derivationKind: "explicit_agent";
  moonciteVersion: string;
  provenance: LearnedMemoryProvenance;
  provenanceOutcome: "verified" | "quarantined" | "unavailable" | "not_evidence_backed";
  provenanceState: LearnedMemoryProvenanceState;
  evidenceProjection: LearnedMemoryEvidenceProjection | null;
  lifecycle: LearnedMemoryLifecycle;
  anchors: LearnedMemoryInspectionAnchor[];
  skillCandidates: LearnedSkillCandidate[];
}

export type LearnedMemoryInspection = LearnedMemoryRevisionInspection | LearnedSkillCandidate;

export type LearnedMemoryInspectInput =
  | { kind: "revision"; memoryId: string; revision: number | null; window: number }
  | { kind: "skill_candidate"; candidateId: string };

export type LearnedMemoryWriteInput =
  | {
    operation: "create";
    interpretation: string;
    provenance: LearnedMemoryProvenanceInput;
    scope: LearnedMemoryScope | null;
  }
  | {
    operation: "revise";
    memoryId: string;
    expectedRevision: number;
    interpretation: string;
    provenance: LearnedMemoryProvenanceInput;
    scope: LearnedMemoryScope | null;
  }
  | {
    operation: "activate" | "archive";
    memoryId: string;
    expectedRevision: number;
    expectedMetadataVersion: number;
  }
  | {
    operation: "reinforce";
    memoryId: string;
    expectedRevision: number;
    expectedMetadataVersion: number;
    salience: number;
  }
  | {
    operation: "consolidate";
    interpretation: string;
    parents: LearnedMemoryRelation[];
    evidenceIds: string[];
    scope: LearnedMemoryScope | null;
  }
  | {
    operation: "propose_skill_candidate";
    sources: Array<{ memoryId: string; revision: number }>;
    artifact: { name: string; description: string; instructions: string };
  }
  | {
    operation: "review_skill_candidate";
    candidateId: string;
    expectedState: "pending_review";
    decision: "approved" | "rejected";
    reviewNote: string;
  };

export interface LearnedMemoryStoredResult {
  kind: "derived_memory_write";
  outcome: "created" | "revised" | "consolidated";
  memoryId: string;
  revision: number;
  interpretation: string;
  scope: LearnedMemoryScope;
  provenance: LearnedMemoryProvenance;
  provenanceOutcome: "verified" | "not_evidence_backed";
  evidenceIds: string[];
  evidenceUris: string[];
}

export interface LearnedMemoryLifecycleResult {
  kind: "derived_memory_lifecycle";
  outcome: "activated" | "reinforced" | "archived";
  memoryId: string;
  revision: number;
  lifecycle: LearnedMemoryLifecycle;
}

export interface LearnedSkillCandidateWriteResult {
  kind: "skill_candidate_write";
  outcome: "proposed" | "reviewed";
  candidate: LearnedSkillCandidate;
}

export type LearnedMemoryWriteResult =
  | LearnedMemoryStoredResult
  | LearnedMemoryLifecycleResult
  | LearnedSkillCandidateWriteResult;

export type LearnedMemoryDeleteInput =
  | { kind: "memory"; memoryId: string; expectedRevision: number; expectedMetadataVersion: number }
  | { kind: "skill_candidate"; candidateId: string; expectedState: LearnedSkillCandidateReview["state"] };

export type LearnedMemoryDeleteResult =
  | {
    kind: "derived_memory_delete";
    outcome: "deleted";
    memoryId: string;
    deletedRevisions: number;
  }
  | {
    kind: "derived_memory_delete";
    outcome: "blocked";
    memoryId: string;
    dependencyCount: number;
    dependencies: Array<
      | { kind: "relation"; memoryId: string; revision: number }
      | { kind: "skill_candidate"; candidateId: string }
    >;
  }
  | {
    kind: "skill_candidate_delete";
    outcome: "deleted";
    candidateId: string;
  };

interface LearnedMemoryReadyStatus {
  kind: "derived_memory_status";
  enabled: true;
  outcome: "ready";
  database: "learned-memory.sqlite";
  schemaVersion: 2;
  memories: number;
  revisions: number;
  active: number;
  archived: number;
  skillCandidates: number;
  pendingSkillCandidates: number;
  stateBytes: number;
}

interface LearnedMemoryUnavailableStatus {
  kind: "derived_memory_status";
  enabled: true;
  outcome: "unavailable";
  database: "learned-memory.sqlite";
  schemaVersion: null;
  memories: 0;
  revisions: 0;
  active: 0;
  archived: 0;
  skillCandidates: 0;
  pendingSkillCandidates: 0;
  stateBytes: 0;
  errorCode: "unsupported_schema" | "unsafe_storage" | "busy" | "unavailable";
  message: string;
}

export type LearnedMemoryStatus = LearnedMemoryReadyStatus | LearnedMemoryUnavailableStatus;

interface RevisionRow {
  memory_id: string;
  revision: number;
  current_revision: number;
  interpretation: string;
  scope_project: string | null;
  derived_at: string;
  derivation_kind: "explicit_agent";
  mooncite_version: string;
  provenance_kind: LearnedMemoryProvenance["kind"];
  provenance_note: string | null;
  lifecycle_state: LearnedMemoryLifecycle["state"];
  lifecycle_metadata_version: number;
  salience: number;
  last_activation_at: string | null;
  reinforcement_count: number;
  archived_at: string | null;
}

interface AnchorRow {
  memory_id: string;
  revision: number;
  position: number;
  evidence_id: string;
  evidence_uri: string;
  source_origin: SourceOrigin;
  source_root_digest: string;
  source_project: string;
  source_session_id: string;
  expected_record_digest: string;
  expected_span_digest: string;
  expected_context_digest: string;
  expected_role: string;
  expected_source_kind: string;
  expected_parent_id: string | null;
  expected_branch_state: string;
  expected_compaction_state: string;
}

interface RelationRow {
  child_memory_id: string;
  child_revision: number;
  position: number;
  parent_memory_id: string;
  parent_revision: number;
  relation_kind: LearnedMemoryRelationKind;
  reason: string;
}

interface SkillCandidateRow {
  candidate_id: string;
  skill_name: string;
  description: string;
  instructions: string;
  review_state: LearnedSkillCandidateReview["state"];
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

interface SkillCandidateSourceRow {
  candidate_id: string;
  position: number;
  memory_id: string;
  revision: number;
}


function hasSymlinkComponent(path: string): boolean {
  let current = resolve(path);
  while (true) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function assertSafeAncestorChain(path: string, subject: string): void {
  if (typeof process.getuid !== "function") return;
  const uid = BigInt(process.getuid());
  const chain: string[] = [];
  let current = resolve(path);
  while (true) {
    chain.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  let confined = false;
  for (const component of chain.reverse()) {
    const state = lstatSync(component, { bigint: true });
    if (state.isSymbolicLink() || !state.isDirectory()) throw new Error(`${subject} has a non-directory ancestor.`);
    if (!confined && state.uid !== 0n && state.uid !== uid) throw new Error(`${subject} has an untrusted ancestor owner.`);
    const mode = Number(state.mode);
    if (confined && state.uid !== uid) throw new Error(`${subject} escapes its owner-private ancestor.`);
    if (!confined && (mode & 0o022) !== 0 && (mode & 0o1000) === 0) {
      throw new Error(`${subject} has an unsafe writable ancestor.`);
    }
    if (state.uid === uid && (mode & 0o011) === 0) confined = true;
  }
}

function assertPrivateDirectory(path: string, subject: string): void {
  const absolutePath = resolve(path);
  if (hasSymlinkComponent(absolutePath)) throw new Error(`${subject} path contains a symbolic-link component.`);
  const state = lstatSync(absolutePath, { bigint: true });
  if (state.isSymbolicLink() || !state.isDirectory()) throw new Error(`${subject} directory is not regular.`);
  if (typeof process.getuid === "function") {
    if (state.uid !== BigInt(process.getuid())) throw new Error(`${subject} directory is not owned by the current user.`);
    if ((Number(state.mode) & 0o077) !== 0) throw new Error(`${subject} directory is not private.`);
    assertSafeAncestorChain(absolutePath, subject);
  }
}

function readPrivateFile(path: string, maximumBytes: number, subject: string): Buffer {
  if (hasSymlinkComponent(path)) throw new Error(`${subject} path contains a symbolic-link component.`);
  assertPrivateDirectory(dirname(path), subject);
  const before = lstatSync(path, { bigint: true });
  if (before.isSymbolicLink() || !before.isFile()) throw new Error(`${subject} is not a regular file.`);
  if (typeof process.getuid === "function" && before.uid !== BigInt(process.getuid())) {
    throw new Error(`${subject} is not owned by the current user.`);
  }
  if ((Number(before.mode) & 0o077) !== 0) throw new Error(`${subject} is not private.`);
  const size = Number(before.size);
  if (!Number.isSafeInteger(size) || size < 0 || size > maximumBytes) throw new Error(`${subject} exceeds the size limit.`);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let bytes: Buffer;
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile()
      || opened.dev !== before.dev
      || opened.ino !== before.ino
      || opened.size !== before.size
      || opened.mtimeNs !== before.mtimeNs
      || opened.ctimeNs !== before.ctimeNs) {
      throw new Error(`${subject} changed identity.`);
    }
    bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const count = readSync(fd, bytes, offset, size - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    if (offset !== size) throw new Error(`${subject} could not be read completely.`);
  } finally {
    closeSync(fd);
  }
  const after = lstatSync(path, { bigint: true });
  if (after.dev !== before.dev
    || after.ino !== before.ino
    || after.size !== before.size
    || after.mtimeNs !== before.mtimeNs
    || after.ctimeNs !== before.ctimeNs) {
    throw new Error(`${subject} changed while reading.`);
  }
  return bytes;
}

function parseMemoryConfig(value: unknown): { version: 1; enabled: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Mooncite learned-memory configuration is invalid.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "enabled,version"
    || record.version !== 1
    || typeof record.enabled !== "boolean") {
    throw new Error("Mooncite learned-memory configuration is invalid.");
  }
  return { version: 1, enabled: record.enabled };
}

export function resolveLearnedMemoryConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = resolve(env.HOME || homedir());
  const configHome = resolve(env.XDG_CONFIG_HOME || join(home, ".config"));
  return resolve(join(configHome, "mooncite", "learned-memory.json"));
}

export function loadLearnedMemoryMode(configPath: string): LearnedMemoryMode {
  const path = resolve(configPath);
  if (hasSymlinkComponent(path)) throw new Error("Mooncite learned-memory configuration path contains a symbolic-link component.");
  if (!existsSync(path)) return { version: 1, enabled: false, configured: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readPrivateFile(path, MAX_MEMORY_CONFIG_BYTES, "Mooncite learned-memory configuration").toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Mooncite learned-memory configuration is invalid.", { cause: error });
    throw error;
  }
  return { ...parseMemoryConfig(parsed), configured: true };
}

export function setLearnedMemoryEnabled(configPath: string, enabled: boolean): LearnedMemoryMode {
  const path = resolve(configPath);
  const directory = dirname(path);
  if (hasSymlinkComponent(directory)) throw new Error("Mooncite learned-memory configuration path contains a symbolic-link component.");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertPrivateDirectory(directory, "Mooncite learned-memory configuration");
  if (existsSync(path)) readPrivateFile(path, MAX_MEMORY_CONFIG_BYTES, "Mooncite learned-memory configuration");
  const config = parseMemoryConfig({ version: 1, enabled });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let ownsTemporary = false;
  try {
    const fd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    ownsTemporary = true;
    try {
      writeFileSync(fd, `${JSON.stringify(config)}\n`, { encoding: "utf8" });
    } finally {
      closeSync(fd);
    }
    assertPrivateDirectory(directory, "Mooncite learned-memory configuration");
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } finally {
    if (ownsTemporary) rmSync(temporary, { force: true });
  }
  return { ...config, configured: true };
}

function recordFromUnknown(value: unknown, subject: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${subject} is corrupt.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(row: Record<string, unknown>, key: string, subject: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`${subject} is corrupt.`);
  return value;
}

function nullableString(row: Record<string, unknown>, key: string, subject: string): string | null {
  const value = row[key];
  if (value !== null && typeof value !== "string") throw new Error(`${subject} is corrupt.`);
  return value;
}

function requiredInteger(row: Record<string, unknown>, key: string, subject: string): number {
  const value = row[key];
  if (!Number.isSafeInteger(value)) throw new Error(`${subject} is corrupt.`);
  return Number(value);
}

function scalarInteger(database: DatabaseSync, sql: string, subject: string, ...parameters: SQLInputValue[]): number {
  const row = recordFromUnknown(database.prepare(sql).get(...parameters), subject);
  return requiredInteger(row, "value", subject);
}

function databaseSchemaFingerprint(database: DatabaseSync): string {
  return JSON.stringify(database.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_stat%'
    ORDER BY type, name, tbl_name
  `).all());
}

let expectedMemorySchemaV1Fingerprint: string | null = null;
let expectedMemorySchemaV2Fingerprint: string | null = null;
function canonicalMemorySchemaFingerprint(version: 1 | 2): string {
  const cached = version === 1 ? expectedMemorySchemaV1Fingerprint : expectedMemorySchemaV2Fingerprint;
  if (cached !== null) return cached;
  const canonical = new DatabaseSync(":memory:");
  try {
    canonical.exec(version === 1 ? MEMORY_SCHEMA_V1 : MEMORY_SCHEMA_V2);
    const fingerprint = databaseSchemaFingerprint(canonical);
    if (version === 1) expectedMemorySchemaV1Fingerprint = fingerprint;
    else expectedMemorySchemaV2Fingerprint = fingerprint;
    return fingerprint;
  } finally {
    canonical.close();
  }
}

function memorySchemaVersion(database: DatabaseSync): string | null {
  const value = database.prepare("SELECT value FROM memory_metadata WHERE key = 'schema_version'").get();
  if (value === undefined) return null;
  return requiredString(recordFromUnknown(value, "Mooncite learned-memory metadata"), "value", "Mooncite learned-memory metadata");
}

function assertNoForeignKeyViolations(database: DatabaseSync): void {
  if (database.prepare("PRAGMA foreign_key_check").all().length !== 0) {
    throw new Error("Mooncite learned-memory schema is corrupt or unsupported.");
  }
}

function assertMemoryV1Invariants(database: DatabaseSync): void {
  assertNoForeignKeyViolations(database);
  const invalidRevisions = scalarInteger(database, `
    SELECT COUNT(*) AS value
    FROM (
      SELECT revisions.memory_id, revisions.revision
      FROM learned_memory_revisions revisions
      LEFT JOIN learned_memory_evidence evidence
        ON evidence.memory_id = revisions.memory_id
       AND evidence.revision = revisions.revision
      GROUP BY revisions.memory_id, revisions.revision
      HAVING COUNT(evidence.evidence_id) NOT BETWEEN 1 AND 8
        OR MIN(evidence.position) <> 0
        OR MAX(evidence.position) <> COUNT(evidence.evidence_id) - 1
    )
  `, "Mooncite learned-memory v1 revision invariants");
  const invalidHeads = scalarInteger(database, `
    SELECT COUNT(*) AS value
    FROM learned_memories memories
    LEFT JOIN learned_memory_revisions revisions
      ON revisions.memory_id = memories.memory_id
     AND revisions.revision = memories.current_revision
    WHERE revisions.memory_id IS NULL
  `, "Mooncite learned-memory v1 head invariants");
  const invalidFts = scalarInteger(database, `
    SELECT
      (
        SELECT COUNT(*) FROM (
          SELECT memories.memory_id, memories.current_revision AS revision, revisions.interpretation
          FROM learned_memories memories
          JOIN learned_memory_revisions revisions
            ON revisions.memory_id = memories.memory_id
           AND revisions.revision = memories.current_revision
          EXCEPT
          SELECT memory_id, CAST(revision AS INTEGER), interpretation FROM learned_memory_fts
        )
      )
      + (
        SELECT COUNT(*) FROM (
          SELECT memory_id, CAST(revision AS INTEGER), interpretation FROM learned_memory_fts
          EXCEPT
          SELECT memories.memory_id, memories.current_revision, revisions.interpretation
          FROM learned_memories memories
          JOIN learned_memory_revisions revisions
            ON revisions.memory_id = memories.memory_id
           AND revisions.revision = memories.current_revision
        )
      ) AS value
  `, "Mooncite learned-memory v1 FTS invariants");
  if (invalidRevisions !== 0 || invalidHeads !== 0 || invalidFts !== 0) {
    throw new Error("Mooncite learned-memory schema is corrupt or unsupported.");
  }
}

function assertMemoryV2Invariants(database: DatabaseSync): void {
  assertNoForeignKeyViolations(database);
  const invalidRevisions = scalarInteger(database, `
    SELECT COUNT(*) AS value
    FROM learned_memory_revisions revisions
    WHERE NOT (
      (
        revisions.provenance_kind = 'verified'
        AND revisions.provenance_note IS NULL
        AND (SELECT COUNT(*) FROM learned_memory_evidence evidence
             WHERE evidence.memory_id = revisions.memory_id AND evidence.revision = revisions.revision) BETWEEN 1 AND 8
        AND NOT EXISTS (
          SELECT 1 FROM learned_memory_relations relations
          WHERE relations.child_memory_id = revisions.memory_id AND relations.child_revision = revisions.revision
        )
      )
      OR (
        revisions.provenance_kind = 'derived'
        AND revisions.provenance_note IS NULL
        AND (SELECT COUNT(*) FROM learned_memory_evidence evidence
             WHERE evidence.memory_id = revisions.memory_id AND evidence.revision = revisions.revision) BETWEEN 0 AND 8
        AND (SELECT COUNT(*) FROM learned_memory_relations relations
             WHERE relations.child_memory_id = revisions.memory_id AND relations.child_revision = revisions.revision) BETWEEN 1 AND 8
      )
      OR (
        revisions.provenance_kind = 'current_context'
        AND revisions.provenance_note IS NOT NULL
        AND LENGTH(CAST(revisions.provenance_note AS BLOB)) BETWEEN 1 AND ${MAX_PROVENANCE_NOTE_BYTES}
        AND (SELECT COUNT(*) FROM learned_memory_evidence evidence
             WHERE evidence.memory_id = revisions.memory_id AND evidence.revision = revisions.revision) BETWEEN 0 AND 8
        AND NOT EXISTS (
          SELECT 1 FROM learned_memory_relations relations
          WHERE relations.child_memory_id = revisions.memory_id AND relations.child_revision = revisions.revision
        )
      )
      OR (
        revisions.provenance_kind = 'unanchored'
        AND revisions.provenance_note IS NOT NULL
        AND LENGTH(CAST(revisions.provenance_note AS BLOB)) BETWEEN 1 AND ${MAX_PROVENANCE_NOTE_BYTES}
        AND NOT EXISTS (
          SELECT 1 FROM learned_memory_evidence evidence
          WHERE evidence.memory_id = revisions.memory_id AND evidence.revision = revisions.revision
        )
        AND NOT EXISTS (
          SELECT 1 FROM learned_memory_relations relations
          WHERE relations.child_memory_id = revisions.memory_id AND relations.child_revision = revisions.revision
        )
      )
    )
  `, "Mooncite learned-memory v2 revision invariants");
  const invalidPositions = scalarInteger(database, `
    SELECT
      (
        SELECT COUNT(*) FROM (
          SELECT memory_id, revision
          FROM learned_memory_evidence
          GROUP BY memory_id, revision
          HAVING MIN(position) <> 0 OR MAX(position) <> COUNT(*) - 1
        )
      )
      + (
        SELECT COUNT(*) FROM (
          SELECT child_memory_id, child_revision
          FROM learned_memory_relations
          GROUP BY child_memory_id, child_revision
          HAVING MIN(position) <> 0 OR MAX(position) <> COUNT(*) - 1
        )
      ) AS value
  `, "Mooncite learned-memory position invariants");
  const invalidIdentity = scalarInteger(database, `
    SELECT COUNT(*) AS value
    FROM learned_memories memories
    LEFT JOIN learned_memory_heads heads ON heads.memory_id = memories.memory_id
    LEFT JOIN learned_memory_lifecycle lifecycle ON lifecycle.memory_id = memories.memory_id
    WHERE heads.memory_id IS NULL OR lifecycle.memory_id IS NULL
  `, "Mooncite learned-memory identity invariants");
  const invalidLifecycle = scalarInteger(database, `
    SELECT COUNT(*) AS value
    FROM learned_memory_lifecycle
    WHERE NOT (
      (state = 'active' AND archived_at IS NULL)
      OR (state = 'archived' AND archived_at IS NOT NULL)
    )
  `, "Mooncite learned-memory lifecycle invariants");
  const invalidCandidates = scalarInteger(database, `
    SELECT COUNT(*) AS value
    FROM (
      SELECT candidates.candidate_id
      FROM learned_skill_candidates candidates
      LEFT JOIN learned_skill_candidate_sources sources
        ON sources.candidate_id = candidates.candidate_id
      GROUP BY candidates.candidate_id
      HAVING COUNT(sources.memory_id) NOT BETWEEN 1 AND 8
        OR MIN(sources.position) <> 0
        OR MAX(sources.position) <> COUNT(sources.memory_id) - 1
    )
  `, "Mooncite skill-candidate source invariants");
  const invalidFts = scalarInteger(database, `
    SELECT
      (
        SELECT COUNT(*) FROM (
          SELECT heads.memory_id, heads.current_revision AS revision, revisions.interpretation
          FROM learned_memory_heads heads
          JOIN learned_memory_revisions revisions
            ON revisions.memory_id = heads.memory_id
           AND revisions.revision = heads.current_revision
          EXCEPT
          SELECT memory_id, CAST(revision AS INTEGER), interpretation FROM learned_memory_fts
        )
      )
      + (
        SELECT COUNT(*) FROM (
          SELECT memory_id, CAST(revision AS INTEGER), interpretation FROM learned_memory_fts
          EXCEPT
          SELECT heads.memory_id, heads.current_revision, revisions.interpretation
          FROM learned_memory_heads heads
          JOIN learned_memory_revisions revisions
            ON revisions.memory_id = heads.memory_id
           AND revisions.revision = heads.current_revision
        )
      ) AS value
  `, "Mooncite learned-memory v2 FTS invariants");
  if (invalidRevisions !== 0 || invalidPositions !== 0 || invalidIdentity !== 0 || invalidLifecycle !== 0
    || invalidCandidates !== 0 || invalidFts !== 0) {
    throw new Error("Mooncite learned-memory schema is corrupt or unsupported.");
  }
}

function initializeMemoryV2(database: DatabaseSync): void {
  database.exec(MEMORY_SCHEMA_V2);
  database.prepare("INSERT INTO memory_metadata(key, value) VALUES ('schema_version', '2')").run();
  assertMemoryV2Invariants(database);
}

function migrateMemoryV1ToV2(database: DatabaseSync): void {
  assertMemoryV1Invariants(database);
  database.exec(`
    DROP TABLE learned_memory_fts;
    DROP INDEX learned_memory_evidence_locator;
    ALTER TABLE learned_memory_evidence RENAME TO learned_memory_evidence_v1;
    ALTER TABLE learned_memory_revisions RENAME TO learned_memory_revisions_v1;
    ALTER TABLE learned_memories RENAME TO learned_memories_v1;
    ALTER TABLE memory_metadata RENAME TO memory_metadata_v1;
  `);
  database.exec(MEMORY_SCHEMA_V2);
  database.prepare("INSERT INTO memory_metadata(key, value) VALUES ('schema_version', '1')").run();
  database.exec(`
    INSERT INTO learned_memories(memory_id, created_at)
      SELECT memory_id, created_at FROM learned_memories_v1;
    INSERT INTO learned_memory_revisions(
      memory_id, revision, interpretation, scope_project, provenance_kind, provenance_note,
      derived_at, derivation_kind, mooncite_version
    )
      SELECT memory_id, revision, interpretation, scope_project, 'verified', NULL,
             derived_at, derivation_kind, mooncite_version
      FROM learned_memory_revisions_v1;
    INSERT INTO learned_memory_heads(memory_id, current_revision)
      SELECT memory_id, current_revision FROM learned_memories_v1;
    INSERT INTO learned_memory_lifecycle(
      memory_id, state, metadata_version, salience, last_activation_at, reinforcement_count, archived_at
    )
      SELECT memory_id, 'active', 1, 0, NULL, 0, NULL FROM learned_memories_v1;
    INSERT INTO learned_memory_evidence(
      memory_id, revision, position, evidence_id, evidence_uri,
      source_origin, source_root_digest, source_project, source_session_id,
      expected_record_digest, expected_span_digest, expected_context_digest,
      expected_role, expected_source_kind, expected_parent_id,
      expected_branch_state, expected_compaction_state
    )
      SELECT memory_id, revision, position, evidence_id, evidence_uri,
             source_origin, source_root_digest, source_project, source_session_id,
             expected_record_digest, expected_span_digest, expected_context_digest,
             expected_role, expected_source_kind, expected_parent_id,
             expected_branch_state, expected_compaction_state
      FROM learned_memory_evidence_v1;
    INSERT INTO learned_memory_fts(memory_id, revision, interpretation)
      SELECT heads.memory_id, heads.current_revision, revisions.interpretation
      FROM learned_memory_heads heads
      JOIN learned_memory_revisions revisions
        ON revisions.memory_id = heads.memory_id
       AND revisions.revision = heads.current_revision;
  `);
  const copyMismatch = scalarInteger(database, `
    SELECT
      (
        SELECT COUNT(*) FROM (
          SELECT memory_id, revision, interpretation, scope_project, derived_at, derivation_kind, mooncite_version
          FROM learned_memory_revisions_v1
          EXCEPT
          SELECT memory_id, revision, interpretation, scope_project, derived_at, derivation_kind, mooncite_version
          FROM learned_memory_revisions
        )
      )
      + (
        SELECT COUNT(*) FROM (
          SELECT memory_id, revision, interpretation, scope_project, derived_at, derivation_kind, mooncite_version
          FROM learned_memory_revisions
          EXCEPT
          SELECT memory_id, revision, interpretation, scope_project, derived_at, derivation_kind, mooncite_version
          FROM learned_memory_revisions_v1
        )
      )
      + (
        SELECT COUNT(*) FROM (
          SELECT * FROM learned_memory_evidence_v1
          EXCEPT
          SELECT * FROM learned_memory_evidence
        )
      )
      + (
        SELECT COUNT(*) FROM (
          SELECT * FROM learned_memory_evidence
          EXCEPT
          SELECT * FROM learned_memory_evidence_v1
        )
      ) AS value
  `, "Mooncite learned-memory v1 migration");
  if (copyMismatch !== 0) throw new Error("Mooncite learned-memory v1 migration did not preserve every revision and anchor.");
  database.exec(`
    DROP TABLE learned_memory_evidence_v1;
    DROP TABLE learned_memory_revisions_v1;
    DROP TABLE learned_memories_v1;
    DROP TABLE memory_metadata_v1;
  `);
  assertMemoryV2Invariants(database);
  if (databaseSchemaFingerprint(database) !== canonicalMemorySchemaFingerprint(2)) {
    throw new Error("Mooncite learned-memory schema is corrupt or unsupported.");
  }
  database.prepare("UPDATE memory_metadata SET value = '2' WHERE key = 'schema_version'").run();
}

function assertMemoryDatabaseFile(path: string): void {
  if (hasSymlinkComponent(path)) throw new Error("Mooncite learned-memory database path contains a symbolic-link component.");
  const state = lstatSync(path, { bigint: true });
  if (state.isSymbolicLink() || !state.isFile()) throw new Error("Mooncite learned-memory database is not a regular file.");
  if (typeof process.getuid === "function" && state.uid !== BigInt(process.getuid())) {
    throw new Error("Mooncite learned-memory database is not owned by the current user.");
  }
  if ((Number(state.mode) & 0o077) !== 0) throw new Error("Mooncite learned-memory database is not private.");
  if (Number(state.nlink) !== 1) throw new Error("Mooncite learned-memory database is hard-linked.");
}

function assertMemoryStateDirectory(stateDir: string): string {
  const directory = resolve(stateDir);
  assertPrivateDirectory(directory, "Mooncite learned-memory state");
  const markerPath = join(directory, MOONCITE_STATE_MARKER_NAME);
  const marker = readPrivateFile(markerPath, 1_024, "Mooncite state marker").toString("utf8");
  if (marker !== MOONCITE_STATE_MARKER_CONTENT) throw new Error("Mooncite learned-memory state marker is invalid.");
  return directory;
}

function openMemoryDatabase(stateDir: string): { database: DatabaseSync; path: string } {
  const directory = assertMemoryStateDirectory(stateDir);
  const path = join(directory, MEMORY_DATABASE_NAME);
  if (!existsSync(path)) {
    const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600);
    closeSync(fd);
  }
  assertMemoryDatabaseFile(path);
  chmodSync(path, 0o600);
  for (const suffix of ["-journal", "-shm", "-wal"]) {
    const sidecar = `${path}${suffix}`;
    if (existsSync(sidecar)) assertMemoryDatabaseFile(sidecar);
  }
  const database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON;");
    if (scalarInteger(database, "SELECT COUNT(*) AS value FROM sqlite_schema", "Mooncite learned-memory schema") === 0) {
      database.exec("BEGIN IMMEDIATE");
      try {
        if (scalarInteger(database, "SELECT COUNT(*) AS value FROM sqlite_schema", "Mooncite learned-memory schema") === 0) {
          initializeMemoryV2(database);
        }
        database.exec("COMMIT");
      } catch (error) {
        try { database.exec("ROLLBACK"); } catch { /* Preserve the schema initialization failure. */ }
        throw error;
      }
    }

    let fingerprint = databaseSchemaFingerprint(database);
    if (fingerprint === canonicalMemorySchemaFingerprint(1)) {
      database.exec("BEGIN IMMEDIATE");
      try {
        fingerprint = databaseSchemaFingerprint(database);
        if (fingerprint === canonicalMemorySchemaFingerprint(1) && memorySchemaVersion(database) === "1") {
          migrateMemoryV1ToV2(database);
        } else if (fingerprint !== canonicalMemorySchemaFingerprint(2) || memorySchemaVersion(database) !== "2") {
          throw new Error("Mooncite learned-memory schema is corrupt or unsupported.");
        }
        database.exec("COMMIT");
      } catch (error) {
        try { database.exec("ROLLBACK"); } catch { /* Preserve the migration failure. */ }
        throw error;
      }
      fingerprint = databaseSchemaFingerprint(database);
    }
    if (fingerprint !== canonicalMemorySchemaFingerprint(2) || memorySchemaVersion(database) !== "2") {
      throw new Error("Mooncite learned-memory schema is corrupt or unsupported.");
    }
    assertMemoryV2Invariants(database);
    assertMemoryStateDirectory(directory);
    assertMemoryDatabaseFile(path);
    chmodSync(path, 0o600);
    return { database, path };
  } catch (error) {
    try { database.close(); } catch { /* Preserve the learned-store failure. */ }
    throw error;
  }
}

export function learnedMemoryDatabaseRetained(stateDir: string): boolean {
  const path = join(resolve(stateDir), MEMORY_DATABASE_NAME);
  if (!existsSync(path)) return false;
  assertMemoryStateDirectory(stateDir);
  assertMemoryDatabaseFile(path);
  return true;
}

export function unavailableLearnedMemoryStatus(error: unknown): LearnedMemoryStatus {
  const message = error instanceof Error ? error.message : String(error);
  const errorCode = /schema.+unsupported|unsupported.+schema/iu.test(message)
    ? "unsupported_schema" as const
    : /symbolic|owned|owner|private|regular|marker|ancestor|writable|hard-link/iu.test(message)
      ? "unsafe_storage" as const
      : /locked|busy|SQLITE_BUSY/iu.test(message)
        ? "busy" as const
        : "unavailable" as const;
  return {
    kind: "derived_memory_status",
    enabled: true,
    outcome: "unavailable",
    database: MEMORY_DATABASE_NAME,
    schemaVersion: null,
    memories: 0,
    revisions: 0,
    active: 0,
    archived: 0,
    skillCandidates: 0,
    pendingSkillCandidates: 0,
    stateBytes: 0,
    errorCode,
    message: errorCode === "unsupported_schema"
      ? "This Mooncite process does not support the learned-memory schema. "
        + "Keep learned-memory.sqlite intact and run a Mooncite version that supports it."
      : "Learned memory is enabled but its separate store is unavailable.",
  };
}

function assertBoundedText(value: unknown, maximumBytes: number, subject: string): string {
  if (typeof value !== "string") throw new Error(`${subject} must be a string.`);
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximumBytes || PRESENTATION_CONTROL_PATTERN.test(normalized)) {
    throw new Error(`${subject} is invalid or exceeds its byte limit.`);
  }
  return normalized;
}

function assertMemoryId(value: unknown): string {
  if (typeof value !== "string" || !MEMORY_ID_PATTERN.test(value)) throw new Error("Mooncite learned-memory ID is invalid.");
  return value;
}

function assertSkillCandidateId(value: unknown): string {
  if (typeof value !== "string" || !SKILL_CANDIDATE_ID_PATTERN.test(value)) {
    throw new Error("Mooncite skill-candidate ID is invalid.");
  }
  return value;
}

function assertRevision(value: unknown, subject: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${subject} must be a positive integer.`);
  return Number(value);
}

function assertIntegerRange(value: unknown, minimum: number, maximum: number, subject: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${subject} must be between ${minimum} and ${maximum}.`);
  }
  return Number(value);
}

function sourceOriginFromUnknown(value: unknown, subject: string): SourceOrigin {
  switch (value) {
    case "pi":
    case "omp":
    case "claude-code":
    case "codex":
    case "chatgpt":
      return value;
    default:
      throw new Error(`${subject} is corrupt.`);
  }
}

function relationKindFromUnknown(value: unknown, subject: string): LearnedMemoryRelationKind {
  switch (value) {
    case "supports":
    case "contradicts":
    case "refines":
    case "supersedes":
      return value;
    default:
      throw new Error(`${subject} is corrupt.`);
  }
}

function provenanceKindFromUnknown(value: unknown, subject: string): LearnedMemoryProvenance["kind"] {
  switch (value) {
    case "verified":
    case "derived":
    case "current_context":
    case "unanchored":
      return value;
    default:
      throw new Error(`${subject} is corrupt.`);
  }
}

function lifecycleStateFromUnknown(value: unknown, subject: string): LearnedMemoryLifecycle["state"] {
  switch (value) {
    case "active":
    case "archived":
      return value;
    default:
      throw new Error(`${subject} is corrupt.`);
  }
}

function reviewStateFromUnknown(value: unknown, subject: string): LearnedSkillCandidateReview["state"] {
  switch (value) {
    case "pending_review":
    case "approved":
    case "rejected":
      return value;
    default:
      throw new Error(`${subject} is corrupt.`);
  }
}

function parseRevisionRow(value: unknown): RevisionRow {
  const subject = "Mooncite learned-memory revision";
  const row = recordFromUnknown(value, subject);
  const derivationKind = requiredString(row, "derivation_kind", subject);
  if (derivationKind !== "explicit_agent") throw new Error(`${subject} is corrupt.`);
  return {
    memory_id: assertMemoryId(requiredString(row, "memory_id", subject)),
    revision: assertRevision(requiredInteger(row, "revision", subject), subject),
    current_revision: assertRevision(requiredInteger(row, "current_revision", subject), `${subject} current revision`),
    interpretation: assertBoundedText(requiredString(row, "interpretation", subject), MAX_INTERPRETATION_BYTES, `${subject} interpretation`),
    scope_project: nullableString(row, "scope_project", subject),
    derived_at: requiredString(row, "derived_at", subject),
    derivation_kind: "explicit_agent",
    mooncite_version: requiredString(row, "mooncite_version", subject),
    provenance_kind: provenanceKindFromUnknown(row.provenance_kind, subject),
    provenance_note: nullableString(row, "provenance_note", subject),
    lifecycle_state: lifecycleStateFromUnknown(row.lifecycle_state, subject),
    lifecycle_metadata_version: assertRevision(
      requiredInteger(row, "lifecycle_metadata_version", subject),
      `${subject} lifecycle metadata version`,
    ),
    salience: assertIntegerRange(requiredInteger(row, "salience", subject), 0, 100, `${subject} salience`),
    last_activation_at: nullableString(row, "last_activation_at", subject),
    reinforcement_count: assertIntegerRange(
      requiredInteger(row, "reinforcement_count", subject),
      0,
      Number.MAX_SAFE_INTEGER,
      `${subject} reinforcement count`,
    ),
    archived_at: nullableString(row, "archived_at", subject),
  };
}

function parseAnchorRow(value: unknown): AnchorRow {
  const subject = "Mooncite learned-memory evidence anchor";
  const row = recordFromUnknown(value, subject);
  return {
    memory_id: assertMemoryId(requiredString(row, "memory_id", subject)),
    revision: assertRevision(requiredInteger(row, "revision", subject), `${subject} revision`),
    position: assertIntegerRange(requiredInteger(row, "position", subject), 0, 7, `${subject} position`),
    evidence_id: assertBoundedText(requiredString(row, "evidence_id", subject), MAX_MEMORY_LOCATOR_BYTES, `${subject} ID`),
    evidence_uri: assertBoundedText(requiredString(row, "evidence_uri", subject), MAX_MEMORY_LOCATOR_BYTES, `${subject} URI`),
    source_origin: sourceOriginFromUnknown(row.source_origin, subject),
    source_root_digest: requiredString(row, "source_root_digest", subject),
    source_project: requiredString(row, "source_project", subject),
    source_session_id: requiredString(row, "source_session_id", subject),
    expected_record_digest: requiredString(row, "expected_record_digest", subject),
    expected_span_digest: requiredString(row, "expected_span_digest", subject),
    expected_context_digest: requiredString(row, "expected_context_digest", subject),
    expected_role: requiredString(row, "expected_role", subject),
    expected_source_kind: requiredString(row, "expected_source_kind", subject),
    expected_parent_id: nullableString(row, "expected_parent_id", subject),
    expected_branch_state: requiredString(row, "expected_branch_state", subject),
    expected_compaction_state: requiredString(row, "expected_compaction_state", subject),
  };
}

function parseRelationRow(value: unknown): RelationRow {
  const subject = "Mooncite learned-memory relation";
  const row = recordFromUnknown(value, subject);
  return {
    child_memory_id: assertMemoryId(requiredString(row, "child_memory_id", subject)),
    child_revision: assertRevision(requiredInteger(row, "child_revision", subject), `${subject} child revision`),
    position: assertIntegerRange(requiredInteger(row, "position", subject), 0, 7, `${subject} position`),
    parent_memory_id: assertMemoryId(requiredString(row, "parent_memory_id", subject)),
    parent_revision: assertRevision(requiredInteger(row, "parent_revision", subject), `${subject} parent revision`),
    relation_kind: relationKindFromUnknown(row.relation_kind, subject),
    reason: assertBoundedText(requiredString(row, "reason", subject), MAX_RELATION_REASON_BYTES, `${subject} reason`),
  };
}

function parseSkillCandidateRow(value: unknown): SkillCandidateRow {
  const subject = "Mooncite skill candidate";
  const row = recordFromUnknown(value, subject);
  return {
    candidate_id: assertSkillCandidateId(requiredString(row, "candidate_id", subject)),
    skill_name: assertBoundedText(requiredString(row, "skill_name", subject), MAX_SKILL_NAME_BYTES, `${subject} name`),
    description: assertBoundedText(requiredString(row, "description", subject), MAX_SKILL_DESCRIPTION_BYTES, `${subject} description`),
    instructions: assertBoundedText(requiredString(row, "instructions", subject), MAX_SKILL_INSTRUCTIONS_BYTES, `${subject} instructions`),
    review_state: reviewStateFromUnknown(row.review_state, subject),
    review_note: nullableString(row, "review_note", subject),
    created_at: requiredString(row, "created_at", subject),
    reviewed_at: nullableString(row, "reviewed_at", subject),
  };
}

function parseSkillCandidateSourceRow(value: unknown): SkillCandidateSourceRow {
  const subject = "Mooncite skill-candidate source";
  const row = recordFromUnknown(value, subject);
  return {
    candidate_id: assertSkillCandidateId(requiredString(row, "candidate_id", subject)),
    position: assertIntegerRange(requiredInteger(row, "position", subject), 0, 7, `${subject} position`),
    memory_id: assertMemoryId(requiredString(row, "memory_id", subject)),
    revision: assertRevision(requiredInteger(row, "revision", subject), `${subject} revision`),
  };
}

function scopeFromProject(project: string | null): LearnedMemoryScope {
  return project === null ? { kind: "global" } : { kind: "project", project };
}

function lifecycleFromRow(row: RevisionRow): LearnedMemoryLifecycle {
  const common = {
    metadataVersion: row.lifecycle_metadata_version,
    salience: row.salience,
    lastActivatedAt: row.last_activation_at,
    reinforcementCount: row.reinforcement_count,
  };
  switch (row.lifecycle_state) {
    case "active":
      if (row.archived_at !== null) throw new Error("Mooncite learned-memory lifecycle is corrupt.");
      return { state: "active", ...common };
    case "archived":
      if (row.archived_at === null) throw new Error("Mooncite learned-memory lifecycle is corrupt.");
      return { state: "archived", ...common, archivedAt: row.archived_at };
  }
}

function skillCandidateFromRow(
  row: SkillCandidateRow,
  sources: readonly SkillCandidateSourceRow[],
): LearnedSkillCandidate {
  if (sources.length < 1 || sources.length > 8) throw new Error("Mooncite skill-candidate sources are corrupt.");
  let review: LearnedSkillCandidateReview;
  switch (row.review_state) {
    case "pending_review":
      if (row.review_note !== null || row.reviewed_at !== null) throw new Error("Mooncite skill-candidate review is corrupt.");
      review = { state: "pending_review" };
      break;
    case "approved":
    case "rejected":
      if (row.review_note === null || row.reviewed_at === null) throw new Error("Mooncite skill-candidate review is corrupt.");
      review = { state: row.review_state, note: row.review_note, reviewedAt: row.reviewed_at };
      break;
  }
  return {
    kind: "skill_candidate",
    candidateId: row.candidate_id,
    sources: sources.map((source) => ({ memoryId: source.memory_id, revision: source.revision })),
    artifact: { name: row.skill_name, description: row.description, instructions: row.instructions },
    review,
    createdAt: row.created_at,
    installed: false,
  };
}

function queryTerms(input: string): string[] {
  return [...new Set(input.toLowerCase().match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? [])]
    .filter((term) => term.length > 1);
}

function anchorContextMatches(saved: AnchorRow, current: EvidenceAnchorSnapshot): boolean {
  return saved.evidence_id === current.evidenceId
    && saved.evidence_uri === current.evidenceUri
    && saved.source_origin === current.sourceOrigin
    && saved.source_root_digest === current.sourceRootDigest
    && saved.source_project === current.project
    && saved.source_session_id === current.sessionId
    && saved.expected_context_digest === current.contextDigest
    && saved.expected_role === current.role
    && saved.expected_source_kind === current.sourceKind
    && saved.expected_parent_id === current.parentId
    && saved.expected_branch_state === current.branchState
    && saved.expected_compaction_state === current.compactionState;
}

function anchorState(
  saved: AnchorRow,
  resolution: EvidenceAnchorResolution,
): Exclude<LearnedMemoryProvenanceState, "not_evidence_backed"> {
  if (resolution.outcome === "deauthorized") return "deauthorized";
  if (resolution.outcome !== "resolved" || !resolution.anchor) return "unavailable";
  if (saved.expected_record_digest !== resolution.anchor.recordDigest
    || saved.expected_span_digest !== resolution.anchor.spanDigest) return "content_mismatch";
  if (!anchorContextMatches(saved, resolution.anchor)) return "context_mismatch";
  return resolution.freshness === "last_good" ? "last_good" : "indexed";
}

function aggregateProvenance(
  states: readonly Exclude<LearnedMemoryProvenanceState, "not_evidence_backed">[],
): LearnedMemoryProvenanceState {
  if (states.length === 0) return "not_evidence_backed";
  const priority: Array<Exclude<LearnedMemoryProvenanceState, "not_evidence_backed">> = [
    "deauthorized",
    "content_mismatch",
    "context_mismatch",
    "unavailable",
    "last_good",
    "indexed",
  ];
  return priority.find((state) => states.includes(state)) ?? "unavailable";
}

function aggregateProjection(resolutions: readonly EvidenceAnchorResolution[]): LearnedMemoryEvidenceProjection | null {
  if (resolutions.length === 0) return null;
  return {
    freshness: resolutions.some((resolution) => resolution.freshness === "unavailable")
      ? "unavailable"
      : resolutions.some((resolution) => resolution.freshness === "last_good")
        ? "last_good"
        : "current",
    trustState: resolutions.every((resolution) => resolution.trustState === "full_verified")
      ? "full_verified"
      : "append_trusted",
    coverage: resolutions.every((resolution) => resolution.coverage === "complete") ? "complete" : "partial",
  };
}

function isQuarantined(state: LearnedMemoryProvenanceState): boolean {
  return state === "content_mismatch" || state === "context_mismatch" || state === "unavailable" || state === "deauthorized";
}
type ObservedAnchorInvalidity = "content_mismatch" | "context_mismatch" | "deauthorized";

function anchorObservationKey(anchor: AnchorRow): string {
  return `${OBSERVED_ANCHOR_INVALIDITY_PREFIX}${anchor.memory_id}:${anchor.revision}:${anchor.position}`;
}

function loadObservedAnchorInvalidities(database: DatabaseSync): Map<string, ObservedAnchorInvalidity> {
  const invalidities = new Map<string, ObservedAnchorInvalidity>();
  const anchorExists = database.prepare(`
    SELECT 1 AS found
    FROM learned_memory_evidence
    WHERE memory_id = ? AND revision = ? AND position = ?
  `);
  const rows = database.prepare(`
    SELECT key, value
    FROM memory_metadata
    WHERE key GLOB ?
    ORDER BY key
  `).all(`${OBSERVED_ANCHOR_INVALIDITY_PREFIX}*`);
  for (const value of rows) {
    const row = recordFromUnknown(value, "Mooncite learned-memory anchor invalidity");
    const key = requiredString(row, "key", "Mooncite learned-memory anchor invalidity");
    const state = requiredString(row, "value", "Mooncite learned-memory anchor invalidity");
    const parts = key.slice(OBSERVED_ANCHOR_INVALIDITY_PREFIX.length).split(":");
    const memoryId = `${parts[0] ?? ""}:${parts[1] ?? ""}`;
    const revision = Number(parts[2]);
    const position = Number(parts[3]);
    if (parts.length !== 4
      || !MEMORY_ID_PATTERN.test(memoryId)
      || !Number.isSafeInteger(revision)
      || revision < 1
      || String(revision) !== parts[2]
      || !Number.isSafeInteger(position)
      || position < 0
      || position > 7
      || String(position) !== parts[3]
      || anchorExists.get(memoryId, revision, position) === undefined) {
      throw new Error("Mooncite learned-memory anchor invalidity is corrupt.");
    }
    if (state !== "content_mismatch" && state !== "context_mismatch" && state !== "deauthorized") {
      throw new Error("Mooncite learned-memory anchor invalidity is corrupt.");
    }
    invalidities.set(key, state);
  }
  return invalidities;
}

interface ResolvedAnchorHealth {
  resolutions: EvidenceAnchorResolution[];
  states: Array<Exclude<LearnedMemoryProvenanceState, "not_evidence_backed">>;
  provenanceState: LearnedMemoryProvenanceState;
  quarantined: boolean;
  projection: LearnedMemoryEvidenceProjection | null;
}
interface InspectedAnchorHealth {
  indexedHealth: ResolvedAnchorHealth;
  health: ResolvedAnchorHealth;
  inspections: EvidenceInspection[];
}

type PreparedProvenance =
  | { kind: "verified"; evidenceIds: string[] }
  | { kind: "derived"; parents: LearnedMemoryRelation[]; evidenceIds: string[] }
  | { kind: "current_context"; contextNote: string; evidenceIds: string[] }
  | { kind: "unanchored"; basisNote: string };

type RevisionWriteTarget =
  | { kind: "create" }
  | { kind: "revise"; memoryId: string; expectedRevision: number };

export class LearnedMemoryStore {
  readonly #engine: MoonciteEngine;
  readonly #db: DatabaseSync;
  readonly #databasePath: string;
  readonly #observedAnchorInvalidities: Map<string, ObservedAnchorInvalidity>;
  #closed = false;

  constructor(engine: MoonciteEngine, options: { stateDir: string }) {
    this.#engine = engine;
    const opened = openMemoryDatabase(options.stateDir);
    this.#db = opened.database;
    this.#databasePath = opened.path;
    this.#observedAnchorInvalidities = loadObservedAnchorInvalidities(this.#db);
  }

  #revision(memoryId: string, revision: number | null): RevisionRow {
    const value = this.#db.prepare(`
      SELECT revisions.*, heads.current_revision,
             lifecycle.state AS lifecycle_state,
             lifecycle.metadata_version AS lifecycle_metadata_version,
             lifecycle.salience,
             lifecycle.last_activation_at,
             lifecycle.reinforcement_count,
             lifecycle.archived_at
      FROM learned_memory_revisions revisions
      JOIN learned_memory_heads heads ON heads.memory_id = revisions.memory_id
      JOIN learned_memory_lifecycle lifecycle ON lifecycle.memory_id = revisions.memory_id
      WHERE revisions.memory_id = ?
        AND revisions.revision = COALESCE(?, heads.current_revision)
    `).get(memoryId, revision);
    if (value === undefined) throw new Error("Mooncite learned memory or revision was not found.");
    return parseRevisionRow(value);
  }

  #anchors(memoryId: string, revision: number): AnchorRow[] {
    return this.#db.prepare(`
      SELECT * FROM learned_memory_evidence
      WHERE memory_id = ? AND revision = ?
      ORDER BY position
    `).all(memoryId, revision).map((value) => parseAnchorRow(value));
  }

  #relations(memoryId: string, revision: number): RelationRow[] {
    return this.#db.prepare(`
      SELECT * FROM learned_memory_relations
      WHERE child_memory_id = ? AND child_revision = ?
      ORDER BY position
    `).all(memoryId, revision).map((value) => parseRelationRow(value));
  }

  #skillCandidate(candidateId: string): LearnedSkillCandidate {
    const value = this.#db.prepare(`
      SELECT * FROM learned_skill_candidates WHERE candidate_id = ?
    `).get(candidateId);
    if (value === undefined) throw new Error("Mooncite skill candidate was not found.");
    const row = parseSkillCandidateRow(value);
    const sources = this.#db.prepare(`
      SELECT * FROM learned_skill_candidate_sources
      WHERE candidate_id = ?
      ORDER BY position
    `).all(candidateId).map((source) => parseSkillCandidateSourceRow(source));
    return skillCandidateFromRow(row, sources);
  }

  #skillCandidatesForRevision(memoryId: string, revision: number): LearnedSkillCandidate[] {
    const rows = this.#db.prepare(`
      SELECT DISTINCT candidates.*
      FROM learned_skill_candidates candidates
      JOIN learned_skill_candidate_sources sources
        ON sources.candidate_id = candidates.candidate_id
      WHERE sources.memory_id = ? AND sources.revision = ?
      ORDER BY candidates.created_at, candidates.candidate_id
      LIMIT 8
    `).all(memoryId, revision).map((value) => parseSkillCandidateRow(value));
    return rows.map((row) => this.#skillCandidate(row.candidate_id));
  }

  #provenance(row: RevisionRow): LearnedMemoryProvenance {
    switch (row.provenance_kind) {
      case "verified":
        if (row.provenance_note !== null) throw new Error("Mooncite learned-memory provenance is corrupt.");
        return { kind: "verified" };
      case "derived": {
        if (row.provenance_note !== null) throw new Error("Mooncite learned-memory provenance is corrupt.");
        const relations = this.#relations(row.memory_id, row.revision);
        if (relations.length < 1 || relations.length > 8) throw new Error("Mooncite learned-memory provenance is corrupt.");
        return {
          kind: "derived",
          parents: relations.map((relation) => ({
            memoryId: relation.parent_memory_id,
            revision: relation.parent_revision,
            relation: relation.relation_kind,
            reason: relation.reason,
          })),
        };
      }
      case "current_context":
        return {
          kind: "current_context",
          contextNote: assertBoundedText(
            row.provenance_note,
            MAX_PROVENANCE_NOTE_BYTES,
            "Mooncite learned-memory current-context note",
          ),
        };
      case "unanchored":
        return {
          kind: "unanchored",
          basisNote: assertBoundedText(
            row.provenance_note,
            MAX_PROVENANCE_NOTE_BYTES,
            "Mooncite learned-memory unanchored basis",
          ),
        };
    }
  }

  #resolveAnchors(anchors: AnchorRow[]): ResolvedAnchorHealth {
    if (anchors.length > 8) throw new Error("Mooncite learned-memory revision has an invalid evidence-anchor count.");
    if (anchors.length === 0) {
      return {
        resolutions: [],
        states: [],
        provenanceState: "not_evidence_backed",
        quarantined: false,
        projection: null,
      };
    }
    const resolutions = this.#engine.resolveEvidenceAnchors(anchors.map((anchor) => ({
      locator: anchor.evidence_id,
      expectedSource: {
        sourceOrigin: anchor.source_origin,
        sourceRootDigest: anchor.source_root_digest,
      },
    })));
    if (resolutions.length !== anchors.length) throw new Error("Mooncite learned-memory anchor resolution is incomplete.");
    const states = anchors.map((anchor, index) => anchorState(anchor, resolutions[index]!));
    const provenanceState = aggregateProvenance(states);
    return {
      resolutions,
      states,
      provenanceState,
      quarantined: isQuarantined(provenanceState),
      projection: aggregateProjection(resolutions),
    };
  }
  #resolveRecallAnchors(anchors: AnchorRow[]): ResolvedAnchorHealth {
    const resolved = this.#resolveAnchors(anchors);
    const states = resolved.states.map((state, index) => {
      const observed = this.#observedAnchorInvalidities.get(anchorObservationKey(anchors[index]!));
      if (observed === undefined) return state;
      if (state === "deauthorized" || observed === "deauthorized") return "deauthorized";
      if (state === "content_mismatch" || observed === "content_mismatch") return "content_mismatch";
      return "context_mismatch";
    });
    const provenanceState = aggregateProvenance(states);
    return {
      ...resolved,
      states,
      provenanceState,
      quarantined: isQuarantined(provenanceState),
    };
  }

  #inspectAnchors(anchors: AnchorRow[], window: number): InspectedAnchorHealth {
    const indexedHealth = this.#resolveAnchors(anchors);
    if (anchors.length === 0) return { indexedHealth, health: indexedHealth, inspections: [] };
    const inspections = anchors.map((anchor) => this.#engine.inspect({
      evidenceId: anchor.evidence_id,
      window,
    }));
    const states: ResolvedAnchorHealth["states"] = indexedHealth.states.map((state, index) => {
      const outcome = inspections[index]!.outcome;
      if (state !== "indexed" && state !== "last_good") return state;
      if (outcome === "stale") return "content_mismatch";
      if (outcome !== "verified") {
        return this.#observedAnchorInvalidities.get(anchorObservationKey(anchors[index]!)) ?? "unavailable";
      }
      return state;
    });
    const provenanceState = aggregateProvenance(states);
    return {
      indexedHealth,
      health: {
        ...indexedHealth,
        states,
        provenanceState,
        quarantined: isQuarantined(provenanceState),
      },
      inspections,
    };
  }

  #persistObservedAnchorInvalidities(
    anchors: AnchorRow[],
    states: ResolvedAnchorHealth["states"],
    inspections: EvidenceInspection[],
  ): void {
    const changes: Array<{ key: string; state: ObservedAnchorInvalidity | null }> = [];
    for (const [index, state] of states.entries()) {
      const key = anchorObservationKey(anchors[index]!);
      if (state === "content_mismatch" || state === "context_mismatch" || state === "deauthorized") {
        if (this.#observedAnchorInvalidities.get(key) !== state) changes.push({ key, state });
      } else if (inspections[index]!.outcome === "verified" && this.#observedAnchorInvalidities.has(key)) {
        changes.push({ key, state: null });
      }
    }
    if (changes.length === 0) return;

    const upsert = this.#db.prepare("INSERT OR REPLACE INTO memory_metadata(key, value) VALUES (?, ?)");
    const remove = this.#db.prepare("DELETE FROM memory_metadata WHERE key = ?");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      for (const change of changes) {
        if (change.state === null) remove.run(change.key);
        else upsert.run(change.key, change.state);
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      try { this.#db.exec("ROLLBACK"); } catch { /* Preserve the anchor-invalidity persistence failure. */ }
      throw error;
    }
    for (const change of changes) {
      if (change.state === null) this.#observedAnchorInvalidities.delete(change.key);
      else this.#observedAnchorInvalidities.set(change.key, change.state);
    }
  }

  #related(
    row: RevisionRow,
    limit: number,
    visibility: {
      project: string | null;
      includeInvalid: boolean;
      includeArchived: boolean;
    },
    anchorHealth: (memoryId: string, revision: number) => ResolvedAnchorHealth,
  ): LearnedMemoryRelatedRevision[] {
    if (limit === 0) return [];
    const related: LearnedMemoryRelatedRevision[] = [];
    const add = (
      direction: "outgoing" | "incoming",
      relation: RelationRow,
    ): boolean => {
      const memoryId = direction === "outgoing"
        ? relation.parent_memory_id
        : relation.child_memory_id;
      const revision = direction === "outgoing"
        ? relation.parent_revision
        : relation.child_revision;
      const relatedRow = this.#revision(memoryId, revision);
      if (visibility.project !== null
        && relatedRow.scope_project !== null
        && relatedRow.scope_project !== visibility.project) return false;
      if (relatedRow.lifecycle_state === "archived" && !visibility.includeArchived) return false;
      const health = anchorHealth(memoryId, revision);
      if (health.quarantined && !visibility.includeInvalid) return false;
      related.push({
        direction,
        relation: relation.relation_kind,
        reason: relation.reason,
        memoryId,
        revision,
        isCurrent: revision === relatedRow.current_revision,
        interpretationExcerpt: relatedRow.interpretation.slice(0, 512),
        provenanceKind: relatedRow.provenance_kind,
        provenanceState: health.provenanceState,
        quarantined: health.quarantined,
        lifecycle: lifecycleFromRow(relatedRow),
      });
      return related.length === limit;
    };
    for (const relation of this.#relations(row.memory_id, row.revision)) {
      if (add("outgoing", relation)) return related;
    }

    const scopeSql = visibility.project === null
      ? ""
      : " AND (revisions.scope_project IS NULL OR revisions.scope_project = ?)";
    const lifecycleSql = visibility.includeArchived ? "" : " AND lifecycle.state = 'active'";
    const incomingQuery = this.#db.prepare(`
      SELECT relations.*
      FROM learned_memory_relations relations
      JOIN learned_memory_revisions revisions
        ON revisions.memory_id = relations.child_memory_id
       AND revisions.revision = relations.child_revision
      JOIN learned_memory_lifecycle lifecycle
        ON lifecycle.memory_id = relations.child_memory_id
      WHERE relations.parent_memory_id = ?
        AND relations.parent_revision = ?${scopeSql}${lifecycleSql}
      ORDER BY relations.child_memory_id, relations.child_revision, relations.position
      LIMIT ? OFFSET ?
    `);
    const incomingPageSize = 32;
    let incomingOffset = 0;
    while (related.length < limit) {
      const incoming = incomingQuery.all(
        row.memory_id,
        row.revision,
        ...(visibility.project === null ? [] : [visibility.project]),
        incomingPageSize,
        incomingOffset,
      ).map((value) => parseRelationRow(value));
      for (const relation of incoming) {
        if (add("incoming", relation)) return related;
      }
      if (incoming.length < incomingPageSize) break;
      incomingOffset += incoming.length;
    }
    return related;
  }

  recall(input: {
    query: string;
    limit: number;
    project: string | null;
    includeInvalid: boolean;
    includeArchived: boolean;
    relatedLimit: number;
  }): LearnedMemoryRecall {
    const query = assertBoundedText(input.query, MAX_MEMORY_QUERY_BYTES, "Mooncite learned-memory query");
    const limit = assertIntegerRange(input.limit, 1, 20, "Mooncite learned-memory recall limit");
    const project = input.project === null
      ? null
      : assertBoundedText(input.project, MAX_MEMORY_PROJECT_BYTES, "Mooncite learned-memory project scope");
    if (typeof input.includeInvalid !== "boolean") throw new Error("Mooncite learned-memory include-invalid flag is invalid.");
    if (typeof input.includeArchived !== "boolean") throw new Error("Mooncite learned-memory include-archived flag is invalid.");
    const visibility = {
      project,
      includeInvalid: input.includeInvalid,
      includeArchived: input.includeArchived,
    };
    const relatedLimit = assertIntegerRange(
      input.relatedLimit,
      0,
      MAX_RELATED_REVISIONS,
      "Mooncite learned-memory related limit",
    );
    const terms = queryTerms(query);
    const exactId = MEMORY_ID_PATTERN.test(query);
    const scopeSql = project === null ? "" : " AND (revisions.scope_project IS NULL OR revisions.scope_project = ?)";
    const lifecycleSql = input.includeArchived ? "" : " AND lifecycle.state = 'active'";
    let rows: RevisionRow[] = [];
    if (exactId) {
      rows = this.#db.prepare(`
        SELECT revisions.*, heads.current_revision,
               lifecycle.state AS lifecycle_state,
               lifecycle.metadata_version AS lifecycle_metadata_version,
               lifecycle.salience,
               lifecycle.last_activation_at,
               lifecycle.reinforcement_count,
               lifecycle.archived_at
        FROM learned_memory_revisions revisions
        JOIN learned_memory_heads heads
          ON heads.memory_id = revisions.memory_id
         AND heads.current_revision = revisions.revision
        JOIN learned_memory_lifecycle lifecycle ON lifecycle.memory_id = revisions.memory_id
        WHERE revisions.memory_id = ?${scopeSql}${lifecycleSql}
      `).all(query, ...(project === null ? [] : [project])).map((value) => parseRevisionRow(value));
    } else if (terms.length > 0) {
      const match = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
      rows = this.#db.prepare(`
        SELECT revisions.*, heads.current_revision,
               lifecycle.state AS lifecycle_state,
               lifecycle.metadata_version AS lifecycle_metadata_version,
               lifecycle.salience,
               lifecycle.last_activation_at,
               lifecycle.reinforcement_count,
               lifecycle.archived_at,
               bm25(learned_memory_fts) AS score
        FROM learned_memory_fts
        JOIN learned_memory_revisions revisions
          ON revisions.memory_id = learned_memory_fts.memory_id
         AND revisions.revision = learned_memory_fts.revision
        JOIN learned_memory_heads heads
          ON heads.memory_id = revisions.memory_id
         AND heads.current_revision = revisions.revision
        JOIN learned_memory_lifecycle lifecycle ON lifecycle.memory_id = revisions.memory_id
        WHERE learned_memory_fts MATCH ?${scopeSql}${lifecycleSql}
        ORDER BY score, revisions.memory_id
        LIMIT ?
      `).all(match, ...(project === null ? [] : [project]), MAX_MEMORY_RECALL_ROWS)
        .map((value) => parseRevisionRow(value));
    }
    const prepared = rows.map((row) => ({ row, anchors: this.#anchors(row.memory_id, row.revision) }));
    if (prepared.some((item) => item.anchors.length > 0) || relatedLimit > 0) this.#engine.refresh();
    const healthByRevision = new Map<string, Map<number, ResolvedAnchorHealth>>();
    const anchorHealth = (
      memoryId: string,
      revision: number,
      anchors?: AnchorRow[],
    ): ResolvedAnchorHealth => {
      let revisions = healthByRevision.get(memoryId);
      const cached = revisions?.get(revision);
      if (cached) return cached;
      const health = this.#resolveRecallAnchors(anchors ?? this.#anchors(memoryId, revision));
      if (!revisions) {
        revisions = new Map<number, ResolvedAnchorHealth>();
        healthByRevision.set(memoryId, revisions);
      }
      revisions.set(revision, health);
      return health;
    };
    const candidates: LearnedMemoryCandidate[] = [];
    let filteredInvalid = 0;
    for (const item of prepared) {
      const health = anchorHealth(item.row.memory_id, item.row.revision, item.anchors);
      if (health.quarantined && !input.includeInvalid) {
        filteredInvalid++;
        continue;
      }
      const lower = item.row.interpretation.toLowerCase();
      const matchedTerms = exactId ? [query] : terms.filter((term) => lower.includes(term));
      const coverage = exactId ? 1 : matchedTerms.length / Math.max(1, terms.length);
      const band = coverage >= 0.6 ? "strong" as const : coverage >= 0.25 ? "partial" as const : "weak" as const;
      candidates.push({
        kind: "derived_memory",
        memoryId: item.row.memory_id,
        revision: item.row.revision,
        interpretation: item.row.interpretation,
        scope: scopeFromProject(item.row.scope_project),
        derivedAt: item.row.derived_at,
        derivationKind: "explicit_agent",
        moonciteVersion: item.row.mooncite_version,
        provenance: this.#provenance(item.row),
        anchors: item.anchors.map((anchor, index) => ({
          evidenceId: anchor.evidence_id,
          evidenceUri: anchor.evidence_uri,
          state: health.states[index]!,
        })),
        relevance: { kind: exactId ? "exact_id" : "lexical", band, matchedTerms },
        provenanceState: health.provenanceState,
        quarantined: health.quarantined,
        evidenceProjection: health.projection,
        lifecycle: lifecycleFromRow(item.row),
        related: this.#related(item.row, relatedLimit, visibility, anchorHealth),
      });
      if (candidates.length === limit) break;
    }
    const warnings: string[] = [];
    if (filteredInvalid > 0) {
      warnings.push(`${filteredInvalid} quarantined learned-memory item(s) were omitted; set include_invalid=true to review them.`);
    }
    if (candidates.some((candidate) => candidate.provenanceState === "last_good")) {
      warnings.push("Evidence refresh retained a last-good generation; physically inspect every own anchor before relying on this interpretation.");
    }
    return {
      kind: "derived_memory_recall",
      outcome: candidates.length > 0 ? "matches" : "no_match",
      query,
      project,
      includeInvalid: input.includeInvalid,
      includeArchived: input.includeArchived,
      relatedLimit,
      candidates,
      warnings,
    };
  }

  inspect(input: LearnedMemoryInspectInput): LearnedMemoryInspection {
    if (input.kind === "skill_candidate") {
      return this.#skillCandidate(assertSkillCandidateId(input.candidateId));
    }
    const memoryId = assertMemoryId(input.memoryId);
    const revision = input.revision === null
      ? null
      : assertRevision(input.revision, "Mooncite learned-memory revision");
    const window = assertIntegerRange(input.window, 0, 2, "Mooncite learned-memory inspection window");
    const row = this.#revision(memoryId, revision);
    const anchors = this.#anchors(memoryId, row.revision);
    if (anchors.length > 0) this.#engine.refresh();
    const inspectedHealth = this.#inspectAnchors(anchors, window);
    const { indexedHealth, health, inspections } = inspectedHealth;
    this.#persistObservedAnchorInvalidities(anchors, health.states, inspections);
    const { states, provenanceState } = health;
    let provenanceOutcome: LearnedMemoryRevisionInspection["provenanceOutcome"];
    if (anchors.length === 0) {
      provenanceOutcome = "not_evidence_backed";
    } else if (!isQuarantined(provenanceState)
      && inspections.every((inspection) => inspection.outcome === "verified")) {
      provenanceOutcome = "verified";
    } else if (indexedHealth.quarantined || inspections.some((inspection) => inspection.outcome === "stale")) {
      provenanceOutcome = "quarantined";
    } else {
      provenanceOutcome = "unavailable";
    }
    return {
      kind: "derived_memory",
      memoryId,
      revision: row.revision,
      currentRevision: row.current_revision,
      isCurrent: row.revision === row.current_revision,
      interpretation: row.interpretation,
      scope: scopeFromProject(row.scope_project),
      derivedAt: row.derived_at,
      derivationKind: "explicit_agent",
      moonciteVersion: row.mooncite_version,
      provenance: this.#provenance(row),
      provenanceOutcome,
      provenanceState,
      evidenceProjection: indexedHealth.projection,
      lifecycle: lifecycleFromRow(row),
      anchors: anchors.map((anchor, index) => ({
        kind: "source_evidence_anchor",
        position: anchor.position,
        evidenceId: anchor.evidence_id,
        evidenceUri: anchor.evidence_uri,
        state: states[index]!,
        saved: {
          sourceOrigin: anchor.source_origin,
          sourceRootDigest: anchor.source_root_digest,
          project: anchor.source_project,
          sessionId: anchor.source_session_id,
          recordDigest: anchor.expected_record_digest,
          spanDigest: anchor.expected_span_digest,
          contextDigest: anchor.expected_context_digest,
          role: anchor.expected_role,
          sourceKind: anchor.expected_source_kind,
          parentId: anchor.expected_parent_id,
          branchState: anchor.expected_branch_state,
          compactionState: anchor.expected_compaction_state,
        },
        current: indexedHealth.resolutions[index]!.anchor,
        inspection: inspections[index]!,
      })),
      skillCandidates: this.#skillCandidatesForRevision(memoryId, row.revision),
    };
  }

  #prepareProvenance(input: LearnedMemoryProvenanceInput): PreparedProvenance {
    switch (input.kind) {
      case "verified":
        return { kind: "verified", evidenceIds: input.evidenceIds };
      case "derived":
        return { kind: "derived", parents: input.parents, evidenceIds: input.evidenceIds };
      case "current_context":
        return {
          kind: "current_context",
          contextNote: assertBoundedText(
            input.contextNote,
            MAX_PROVENANCE_NOTE_BYTES,
            "Mooncite learned-memory current-context note",
          ),
          evidenceIds: input.evidenceIds,
        };
      case "unanchored":
        return {
          kind: "unanchored",
          basisNote: assertBoundedText(
            input.basisNote,
            MAX_PROVENANCE_NOTE_BYTES,
            "Mooncite learned-memory unanchored basis",
          ),
        };
    }
  }

  #verifyEvidence(evidenceIds: string[], minimum: 0 | 1): EvidenceAnchorSnapshot[] {
    if (!Array.isArray(evidenceIds) || evidenceIds.length < minimum || evidenceIds.length > 8) {
      const requirement = minimum === 1 ? "between 1 and 8" : "between 0 and 8";
      throw new Error(`Mooncite learned memory requires ${requirement} evidence anchors for this provenance.`);
    }
    const locators = evidenceIds.map((locator) =>
      assertBoundedText(locator, MAX_MEMORY_LOCATOR_BYTES, "Mooncite evidence anchor locator"));
    if (new Set(locators).size !== locators.length) throw new Error("Mooncite learned-memory evidence anchors must be unique.");
    if (locators.length === 0) return [];
    this.#engine.refresh();
    const inspections = locators.map((locator) => this.#engine.inspect({ evidenceId: locator, window: 0 }));
    const resolutions = this.#engine.resolveEvidenceAnchors(locators.map((locator) => ({ locator })));
    const snapshots = resolutions.map((resolution, index) => {
      const inspection = inspections[index]!;
      if (resolution.outcome !== "resolved" || !resolution.anchor || inspection.outcome !== "verified") {
        throw new Error(`Mooncite evidence anchor ${index + 1} was not physically verified.`);
      }
      if (inspection.evidenceId !== resolution.anchor.evidenceId
        || inspection.locator?.recordDigest !== resolution.anchor.recordDigest) {
        throw new Error(`Mooncite evidence anchor ${index + 1} changed during verification.`);
      }
      if (resolution.anchor.isMoonciteRendering) {
        throw new Error("Mooncite tool renderings cannot be retained as learned-memory evidence anchors.");
      }
      return resolution.anchor;
    });
    if (new Set(snapshots.map((anchor) => anchor.evidenceId)).size !== snapshots.length) {
      throw new Error("Mooncite learned-memory evidence anchors resolve to duplicate canonical spans.");
    }
    return snapshots;
  }

  #validateRelations(
    input: LearnedMemoryRelation[],
    minimum: 1 | 2,
  ): { relations: LearnedMemoryRelation[]; parentRows: RevisionRow[] } {
    if (!Array.isArray(input) || input.length < minimum || input.length > 8) {
      throw new Error(`Mooncite ${minimum === 2 ? "consolidation" : "derived memory"} requires between ${minimum} and 8 exact parent revisions.`);
    }
    const relations = input.map((relation, index) => {
      if (typeof relation !== "object" || relation === null) {
        throw new Error(`Mooncite learned-memory parent ${index + 1} is invalid.`);
      }
      return {
        memoryId: assertMemoryId(relation.memoryId),
        revision: assertRevision(relation.revision, `Mooncite learned-memory parent ${index + 1} revision`),
        relation: relationKindFromUnknown(relation.relation, `Mooncite learned-memory parent ${index + 1}`),
        reason: assertBoundedText(
          relation.reason,
          MAX_RELATION_REASON_BYTES,
          `Mooncite learned-memory parent ${index + 1} reason`,
        ),
      };
    });
    const keys = relations.map((relation) => `${relation.memoryId}\0${relation.revision}`);
    if (new Set(keys).size !== keys.length) throw new Error("Mooncite learned-memory exact parent revisions must be unique.");
    return {
      relations,
      parentRows: relations.map((relation) => this.#revision(relation.memoryId, relation.revision)),
    };
  }

  #resolveScope(
    requested: LearnedMemoryScope | null,
    previous: RevisionRow | null,
    snapshots: readonly EvidenceAnchorSnapshot[],
    parents: readonly RevisionRow[],
  ): LearnedMemoryScope {
    let scope: LearnedMemoryScope | null = requested;
    if (scope === null && previous !== null) scope = scopeFromProject(previous.scope_project);
    const dependencyProjects: Array<string | null> = [
      ...snapshots.map((anchor) => anchor.project),
      ...parents.map((parent) => parent.scope_project),
    ];
    if (scope === null) {
      if (dependencyProjects.length === 0) {
        throw new Error("Evidence-free learned memory requires an explicit global or project scope.");
      }
      if (dependencyProjects.some((project) => project === null)
        || new Set(dependencyProjects).size !== 1) {
        throw new Error("Mixed-project learned memory requires an explicit global scope.");
      }
      return { kind: "project", project: dependencyProjects[0]! };
    }
    if (scope.kind === "global") return { kind: "global" };
    if (scope.kind !== "project") throw new Error("Mooncite learned-memory scope is invalid.");
    const project = assertBoundedText(scope.project, MAX_MEMORY_PROJECT_BYTES, "Mooncite learned-memory project scope");
    if (dependencyProjects.some((dependency) => dependency !== project)) {
      throw new Error("Project-scoped learned memory requires every own anchor and exact parent to use that project.");
    }
    return { kind: "project", project };
  }

  #storedProvenance(prepared: PreparedProvenance): LearnedMemoryProvenance {
    switch (prepared.kind) {
      case "verified":
        return { kind: "verified" };
      case "derived":
        return { kind: "derived", parents: prepared.parents };
      case "current_context":
        return { kind: "current_context", contextNote: prepared.contextNote };
      case "unanchored":
        return { kind: "unanchored", basisNote: prepared.basisNote };
    }
  }

  #insertAnchors(memoryId: string, revision: number, snapshots: readonly EvidenceAnchorSnapshot[]): void {
    const insert = this.#db.prepare(`
      INSERT INTO learned_memory_evidence(
        memory_id, revision, position, evidence_id, evidence_uri,
        source_origin, source_root_digest, source_project, source_session_id,
        expected_record_digest, expected_span_digest, expected_context_digest,
        expected_role, expected_source_kind, expected_parent_id,
        expected_branch_state, expected_compaction_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let position = 0; position < snapshots.length; position++) {
      const anchor = snapshots[position]!;
      insert.run(
        memoryId,
        revision,
        position,
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
    }
  }

  #insertRelations(memoryId: string, revision: number, relations: readonly LearnedMemoryRelation[]): void {
    const insert = this.#db.prepare(`
      INSERT INTO learned_memory_relations(
        child_memory_id, child_revision, position,
        parent_memory_id, parent_revision, relation_kind, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (let position = 0; position < relations.length; position++) {
      const relation = relations[position]!;
      insert.run(
        memoryId,
        revision,
        position,
        relation.memoryId,
        relation.revision,
        relation.relation,
        relation.reason,
      );
    }
  }

  #writeRevision(
    target: RevisionWriteTarget,
    interpretation: string,
    prepared: PreparedProvenance,
    snapshots: EvidenceAnchorSnapshot[],
    relations: LearnedMemoryRelation[],
    scope: LearnedMemoryScope,
    consolidated: boolean,
  ): LearnedMemoryStoredResult {
    const memoryId = target.kind === "create" ? `mooncite-memory:${randomUUID()}` : target.memoryId;
    const derivedAt = new Date().toISOString();
    let revision = 1;
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      if (target.kind === "create") {
        this.#db.prepare("INSERT INTO learned_memories(memory_id, created_at) VALUES (?, ?)")
          .run(memoryId, derivedAt);
      } else {
        const current = this.#revision(memoryId, null);
        if (current.current_revision !== target.expectedRevision) {
          throw new Error(`Mooncite learned memory changed; expected revision ${target.expectedRevision}, current revision ${current.current_revision}.`);
        }
        if (current.lifecycle_state !== "active") {
          throw new Error("Mooncite learned memory must be active before appending a revision.");
        }
        revision = current.current_revision + 1;
      }
      const provenanceNote = prepared.kind === "current_context"
        ? prepared.contextNote
        : prepared.kind === "unanchored"
          ? prepared.basisNote
          : null;
      this.#db.prepare(`
        INSERT INTO learned_memory_revisions(
          memory_id, revision, interpretation, scope_project, provenance_kind, provenance_note,
          derived_at, derivation_kind, mooncite_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'explicit_agent', ?)
      `).run(
        memoryId,
        revision,
        interpretation,
        scope.kind === "global" ? null : scope.project,
        prepared.kind,
        provenanceNote,
        derivedAt,
        MOONCITE_VERSION,
      );
      this.#insertAnchors(memoryId, revision, snapshots);
      this.#insertRelations(memoryId, revision, relations);
      if (target.kind === "create") {
        this.#db.prepare("INSERT INTO learned_memory_heads(memory_id, current_revision) VALUES (?, ?)")
          .run(memoryId, revision);
        this.#db.prepare(`
          INSERT INTO learned_memory_lifecycle(
            memory_id, state, metadata_version, salience,
            last_activation_at, reinforcement_count, archived_at
          ) VALUES (?, 'active', 1, 0, NULL, 0, NULL)
        `).run(memoryId);
      } else {
        this.#db.prepare("UPDATE learned_memory_heads SET current_revision = ? WHERE memory_id = ?")
          .run(revision, memoryId);
      }
      this.#db.prepare("DELETE FROM learned_memory_fts WHERE memory_id = ?").run(memoryId);
      this.#db.prepare("INSERT INTO learned_memory_fts(memory_id, revision, interpretation) VALUES (?, ?, ?)")
        .run(memoryId, revision, interpretation);
      this.#db.exec("COMMIT");
    } catch (error) {
      try { this.#db.exec("ROLLBACK"); } catch { /* Preserve the learned-memory write failure. */ }
      throw error;
    }
    return {
      kind: "derived_memory_write",
      outcome: consolidated ? "consolidated" : target.kind === "create" ? "created" : "revised",
      memoryId,
      revision,
      interpretation,
      scope,
      provenance: this.#storedProvenance(prepared),
      provenanceOutcome: snapshots.length > 0 ? "verified" : "not_evidence_backed",
      evidenceIds: snapshots.map((anchor) => anchor.evidenceId),
      evidenceUris: snapshots.map((anchor) => anchor.evidenceUri),
    };
  }

  #writeLifecycle(
    input: Extract<LearnedMemoryWriteInput, { operation: "activate" | "archive" | "reinforce" }>,
  ): LearnedMemoryLifecycleResult {
    const memoryId = assertMemoryId(input.memoryId);
    const expectedRevision = assertRevision(input.expectedRevision, "Mooncite learned-memory expected revision");
    const expectedMetadataVersion = assertRevision(
      input.expectedMetadataVersion,
      "Mooncite learned-memory expected metadata version",
    );
    const salience = input.operation === "reinforce"
      ? assertIntegerRange(input.salience, 0, 100, "Mooncite learned-memory salience")
      : null;
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.#revision(memoryId, null);
      if (current.current_revision !== expectedRevision) {
        throw new Error(`Mooncite learned memory changed; expected revision ${expectedRevision}, current revision ${current.current_revision}.`);
      }
      if (current.lifecycle_metadata_version !== expectedMetadataVersion) {
        throw new Error(
          `Mooncite learned-memory metadata changed; expected version ${expectedMetadataVersion}, current version ${current.lifecycle_metadata_version}.`,
        );
      }
      const now = new Date().toISOString();
      switch (input.operation) {
        case "activate":
          this.#db.prepare(`
            UPDATE learned_memory_lifecycle
            SET state = 'active', metadata_version = metadata_version + 1,
                last_activation_at = ?, archived_at = NULL
            WHERE memory_id = ?
          `).run(now, memoryId);
          break;
        case "archive":
          if (current.lifecycle_state !== "active") throw new Error("Mooncite learned memory is already archived.");
          this.#db.prepare(`
            UPDATE learned_memory_lifecycle
            SET state = 'archived', metadata_version = metadata_version + 1, archived_at = ?
            WHERE memory_id = ?
          `).run(now, memoryId);
          break;
        case "reinforce":
          if (current.lifecycle_state !== "active") {
            throw new Error("Mooncite learned memory must be active before reinforcement.");
          }
          this.#db.prepare(`
            UPDATE learned_memory_lifecycle
            SET metadata_version = metadata_version + 1,
                salience = ?, reinforcement_count = reinforcement_count + 1
            WHERE memory_id = ?
          `).run(salience, memoryId);
          break;
      }
      const updated = this.#revision(memoryId, null);
      this.#db.exec("COMMIT");
      return {
        kind: "derived_memory_lifecycle",
        outcome: input.operation === "activate" ? "activated" : input.operation === "archive" ? "archived" : "reinforced",
        memoryId,
        revision: updated.current_revision,
        lifecycle: lifecycleFromRow(updated),
      };
    } catch (error) {
      try { this.#db.exec("ROLLBACK"); } catch { /* Preserve the lifecycle failure. */ }
      throw error;
    }
  }

  #proposeSkillCandidate(
    input: Extract<LearnedMemoryWriteInput, { operation: "propose_skill_candidate" }>,
  ): LearnedSkillCandidateWriteResult {
    if (!Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 8) {
      throw new Error("Mooncite skill candidate requires between 1 and 8 exact source revisions.");
    }
    const sources = input.sources.map((source, index) => ({
      memoryId: assertMemoryId(source.memoryId),
      revision: assertRevision(source.revision, `Mooncite skill-candidate source ${index + 1} revision`),
    }));
    const keys = sources.map((source) => `${source.memoryId}\0${source.revision}`);
    if (new Set(keys).size !== keys.length) throw new Error("Mooncite skill-candidate source revisions must be unique.");
    for (const source of sources) this.#revision(source.memoryId, source.revision);
    const artifact = {
      name: assertBoundedText(input.artifact.name, MAX_SKILL_NAME_BYTES, "Mooncite skill-candidate name"),
      description: assertBoundedText(
        input.artifact.description,
        MAX_SKILL_DESCRIPTION_BYTES,
        "Mooncite skill-candidate description",
      ),
      instructions: assertBoundedText(
        input.artifact.instructions,
        MAX_SKILL_INSTRUCTIONS_BYTES,
        "Mooncite skill-candidate instructions",
      ),
    };
    const candidateId = `mooncite-skill-candidate:${randomUUID()}`;
    const createdAt = new Date().toISOString();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare(`
        INSERT INTO learned_skill_candidates(
          candidate_id, skill_name, description, instructions,
          review_state, review_note, created_at, reviewed_at
        ) VALUES (?, ?, ?, ?, 'pending_review', NULL, ?, NULL)
      `).run(candidateId, artifact.name, artifact.description, artifact.instructions, createdAt);
      const insertSource = this.#db.prepare(`
        INSERT INTO learned_skill_candidate_sources(candidate_id, position, memory_id, revision)
        VALUES (?, ?, ?, ?)
      `);
      for (let position = 0; position < sources.length; position++) {
        const source = sources[position]!;
        insertSource.run(candidateId, position, source.memoryId, source.revision);
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      try { this.#db.exec("ROLLBACK"); } catch { /* Preserve the candidate proposal failure. */ }
      throw error;
    }
    return { kind: "skill_candidate_write", outcome: "proposed", candidate: this.#skillCandidate(candidateId) };
  }

  #reviewSkillCandidate(
    input: Extract<LearnedMemoryWriteInput, { operation: "review_skill_candidate" }>,
  ): LearnedSkillCandidateWriteResult {
    const candidateId = assertSkillCandidateId(input.candidateId);
    if (input.expectedState !== "pending_review") throw new Error("Mooncite skill-candidate expected state is invalid.");
    const decision = reviewStateFromUnknown(input.decision, "Mooncite skill-candidate review decision");
    if (decision === "pending_review") throw new Error("Mooncite skill-candidate review decision is invalid.");
    const reviewNote = assertBoundedText(
      input.reviewNote,
      MAX_SKILL_REVIEW_NOTE_BYTES,
      "Mooncite skill-candidate review note",
    );
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.#skillCandidate(candidateId);
      if (current.review.state !== input.expectedState) {
        throw new Error(
          `Mooncite skill-candidate review changed; expected ${input.expectedState}, current ${current.review.state}.`,
        );
      }
      this.#db.prepare(`
        UPDATE learned_skill_candidates
        SET review_state = ?, review_note = ?, reviewed_at = ?
        WHERE candidate_id = ?
      `).run(decision, reviewNote, new Date().toISOString(), candidateId);
      this.#db.exec("COMMIT");
    } catch (error) {
      try { this.#db.exec("ROLLBACK"); } catch { /* Preserve the candidate review failure. */ }
      throw error;
    }
    return { kind: "skill_candidate_write", outcome: "reviewed", candidate: this.#skillCandidate(candidateId) };
  }

  write(input: LearnedMemoryWriteInput): LearnedMemoryWriteResult {
    switch (input.operation) {
      case "create":
      case "revise": {
        const interpretation = assertBoundedText(
          input.interpretation,
          MAX_INTERPRETATION_BYTES,
          "Mooncite learned-memory interpretation",
        );
        const prepared = this.#prepareProvenance(input.provenance);
        const evidenceIds = prepared.kind === "unanchored" ? [] : prepared.evidenceIds;
        const snapshots = this.#verifyEvidence(evidenceIds, prepared.kind === "verified" ? 1 : 0);
        const validated = prepared.kind === "derived"
          ? this.#validateRelations(prepared.parents, 1)
          : { relations: [], parentRows: [] };
        let previous: RevisionRow | null;
        let target: RevisionWriteTarget;
        if (input.operation === "revise") {
          const memoryId = assertMemoryId(input.memoryId);
          const expectedRevision = assertRevision(input.expectedRevision, "Mooncite learned-memory expected revision");
          previous = this.#revision(memoryId, null);
          if (previous.current_revision !== expectedRevision) {
            throw new Error(
              `Mooncite learned memory changed; expected revision ${expectedRevision}, current revision ${previous.current_revision}.`,
            );
          }
          target = { kind: "revise", memoryId, expectedRevision };
        } else {
          previous = null;
          target = { kind: "create" };
        }
        const scope = this.#resolveScope(input.scope, previous, snapshots, validated.parentRows);
        const normalizedPrepared = prepared.kind === "derived"
          ? { ...prepared, parents: validated.relations }
          : prepared;
        return this.#writeRevision(
          target,
          interpretation,
          normalizedPrepared,
          snapshots,
          validated.relations,
          scope,
          false,
        );
      }
      case "consolidate": {
        const interpretation = assertBoundedText(
          input.interpretation,
          MAX_INTERPRETATION_BYTES,
          "Mooncite learned-memory interpretation",
        );
        const validated = this.#validateRelations(input.parents, 2);
        const snapshots = this.#verifyEvidence(input.evidenceIds, 0);
        const scope = this.#resolveScope(input.scope, null, snapshots, validated.parentRows);
        const prepared: PreparedProvenance = {
          kind: "derived",
          parents: validated.relations,
          evidenceIds: input.evidenceIds,
        };
        return this.#writeRevision(
          { kind: "create" },
          interpretation,
          prepared,
          snapshots,
          validated.relations,
          scope,
          true,
        );
      }
      case "activate":
      case "archive":
      case "reinforce":
        return this.#writeLifecycle(input);
      case "propose_skill_candidate":
        return this.#proposeSkillCandidate(input);
      case "review_skill_candidate":
        return this.#reviewSkillCandidate(input);
    }
  }

  delete(input: LearnedMemoryDeleteInput): LearnedMemoryDeleteResult {
    if (input.kind === "skill_candidate") {
      const candidateId = assertSkillCandidateId(input.candidateId);
      const expectedState = reviewStateFromUnknown(input.expectedState, "Mooncite skill-candidate expected state");
      this.#db.exec("BEGIN IMMEDIATE");
      try {
        const current = this.#skillCandidate(candidateId);
        if (current.review.state !== expectedState) {
          throw new Error(`Mooncite skill candidate changed; expected ${expectedState}, current ${current.review.state}.`);
        }
        this.#db.prepare("DELETE FROM learned_skill_candidates WHERE candidate_id = ?").run(candidateId);
        this.#db.exec("COMMIT");
        return { kind: "skill_candidate_delete", outcome: "deleted", candidateId };
      } catch (error) {
        try { this.#db.exec("ROLLBACK"); } catch { /* Preserve the candidate deletion failure. */ }
        throw error;
      }
    }

    const memoryId = assertMemoryId(input.memoryId);
    const expectedRevision = assertRevision(input.expectedRevision, "Mooncite learned-memory expected revision");
    const expectedMetadataVersion = assertRevision(
      input.expectedMetadataVersion,
      "Mooncite learned-memory expected metadata version",
    );
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.#revision(memoryId, null);
      if (current.current_revision !== expectedRevision) {
        throw new Error(`Mooncite learned memory changed; expected revision ${expectedRevision}, current revision ${current.current_revision}.`);
      }
      if (current.lifecycle_metadata_version !== expectedMetadataVersion) {
        throw new Error(
          `Mooncite learned-memory metadata changed; expected version ${expectedMetadataVersion}, current version ${current.lifecycle_metadata_version}.`,
        );
      }
      const relationCount = scalarInteger(this.#db, `
        SELECT COUNT(*) AS value FROM (
          SELECT DISTINCT child_memory_id, child_revision
          FROM learned_memory_relations
          WHERE parent_memory_id = ? AND child_memory_id <> ?
        )
      `, "Mooncite learned-memory relation dependencies", memoryId, memoryId);
      const candidateCount = scalarInteger(this.#db, `
        SELECT COUNT(*) AS value FROM (
          SELECT DISTINCT candidate_id
          FROM learned_skill_candidate_sources
          WHERE memory_id = ?
        )
      `, "Mooncite skill-candidate dependencies", memoryId);
      const dependencyCount = relationCount + candidateCount;
      if (dependencyCount > 0) {
        const relations = this.#db.prepare(`
          SELECT DISTINCT child_memory_id, child_revision
          FROM learned_memory_relations
          WHERE parent_memory_id = ? AND child_memory_id <> ?
          ORDER BY child_memory_id, child_revision
          LIMIT 8
        `).all(memoryId, memoryId).map((value) => {
          const row = recordFromUnknown(value, "Mooncite learned-memory relation dependency");
          return {
            kind: "relation" as const,
            memoryId: assertMemoryId(requiredString(row, "child_memory_id", "Mooncite learned-memory relation dependency")),
            revision: assertRevision(
              requiredInteger(row, "child_revision", "Mooncite learned-memory relation dependency"),
              "Mooncite learned-memory relation dependency revision",
            ),
          };
        });
        const remaining = Math.max(0, 8 - relations.length);
        const candidates = remaining === 0
          ? []
          : this.#db.prepare(`
            SELECT DISTINCT candidate_id
            FROM learned_skill_candidate_sources
            WHERE memory_id = ?
            ORDER BY candidate_id
            LIMIT ?
          `).all(memoryId, remaining).map((value) => {
            const row = recordFromUnknown(value, "Mooncite skill-candidate dependency");
            return {
              kind: "skill_candidate" as const,
              candidateId: assertSkillCandidateId(
                requiredString(row, "candidate_id", "Mooncite skill-candidate dependency"),
              ),
            };
          });
        this.#db.exec("COMMIT");
        return {
          kind: "derived_memory_delete",
          outcome: "blocked",
          memoryId,
          dependencyCount,
          dependencies: [...relations, ...candidates],
        };
      }
      const deletedRevisions = scalarInteger(
        this.#db,
        "SELECT COUNT(*) AS value FROM learned_memory_revisions WHERE memory_id = ?",
        "Mooncite learned-memory revision count",
        memoryId,
      );
      const observationPrefix = `${OBSERVED_ANCHOR_INVALIDITY_PREFIX}${memoryId}:`;
      this.#db.prepare("DELETE FROM memory_metadata WHERE key GLOB ?").run(`${observationPrefix}*`);
      this.#db.prepare("DELETE FROM learned_memory_relations WHERE child_memory_id = ?").run(memoryId);
      this.#db.prepare("DELETE FROM learned_memory_fts WHERE memory_id = ?").run(memoryId);
      this.#db.prepare("DELETE FROM learned_memories WHERE memory_id = ?").run(memoryId);
      this.#db.exec("COMMIT");
      for (const key of this.#observedAnchorInvalidities.keys()) {
        if (key.startsWith(observationPrefix)) this.#observedAnchorInvalidities.delete(key);
      }
      return { kind: "derived_memory_delete", outcome: "deleted", memoryId, deletedRevisions };
    } catch (error) {
      try { this.#db.exec("ROLLBACK"); } catch { /* Preserve the learned-memory deletion failure. */ }
      throw error;
    }
  }

  status(): LearnedMemoryStatus {
    return {
      kind: "derived_memory_status",
      enabled: true,
      outcome: "ready",
      database: MEMORY_DATABASE_NAME,
      schemaVersion: MEMORY_SCHEMA_VERSION,
      memories: scalarInteger(
        this.#db,
        "SELECT COUNT(*) AS value FROM learned_memories",
        "Mooncite learned-memory count",
      ),
      revisions: scalarInteger(
        this.#db,
        "SELECT COUNT(*) AS value FROM learned_memory_revisions",
        "Mooncite learned-memory revision count",
      ),
      active: scalarInteger(
        this.#db,
        "SELECT COUNT(*) AS value FROM learned_memory_lifecycle WHERE state = 'active'",
        "Mooncite active learned-memory count",
      ),
      archived: scalarInteger(
        this.#db,
        "SELECT COUNT(*) AS value FROM learned_memory_lifecycle WHERE state = 'archived'",
        "Mooncite archived learned-memory count",
      ),
      skillCandidates: scalarInteger(
        this.#db,
        "SELECT COUNT(*) AS value FROM learned_skill_candidates",
        "Mooncite skill-candidate count",
      ),
      pendingSkillCandidates: scalarInteger(
        this.#db,
        "SELECT COUNT(*) AS value FROM learned_skill_candidates WHERE review_state = 'pending_review'",
        "Mooncite pending skill-candidate count",
      ),
      stateBytes: statSync(this.#databasePath).size,
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }
}
