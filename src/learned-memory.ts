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
import { DatabaseSync } from "node:sqlite";
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

const MEMORY_SCHEMA_VERSION = 1;
const MEMORY_DATABASE_NAME = "learned-memory.sqlite";
const MAX_MEMORY_CONFIG_BYTES = 4_096;
const MAX_INTERPRETATION_BYTES = 8 * 1_024;
const MAX_MEMORY_QUERY_BYTES = 2_000;
const MAX_MEMORY_PROJECT_BYTES = 256;
const MAX_MEMORY_LOCATOR_BYTES = 2_048;
const MAX_MEMORY_RECALL_ROWS = 200;
const MEMORY_ID_PATTERN = /^mooncite-memory:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PRESENTATION_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u;
const MEMORY_SCHEMA = `
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

export interface LearnedMemoryMode {
  version: 1;
  enabled: boolean;
  configured: boolean;
}

export type LearnedMemoryScope =
  | { kind: "global" }
  | { kind: "project"; project: string };

export type LearnedMemoryProvenanceState =
  | "indexed"
  | "last_good"
  | "content_mismatch"
  | "context_mismatch"
  | "unavailable"
  | "deauthorized";

export interface LearnedMemoryAnchorSummary {
  evidenceId: string;
  evidenceUri: string;
  state: LearnedMemoryProvenanceState;
}

export interface LearnedMemoryEvidenceProjection {
  freshness: "current" | "last_good" | "unavailable";
  trustState: "full_verified" | "append_trusted";
  coverage: "complete" | "partial";
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
  anchors: LearnedMemoryAnchorSummary[];
  relevance: {
    kind: "exact_id" | "lexical";
    band: "strong" | "partial" | "weak";
    matchedTerms: string[];
  };
  provenanceState: LearnedMemoryProvenanceState;
  quarantined: boolean;
  evidenceProjection: LearnedMemoryEvidenceProjection;
}

export interface LearnedMemoryRecall {
  kind: "derived_memory_recall";
  outcome: "matches" | "no_match";
  query: string;
  project: string | null;
  includeInvalid: boolean;
  candidates: LearnedMemoryCandidate[];
  warnings: string[];
}

export interface LearnedMemoryInspectionAnchor {
  kind: "source_evidence_anchor";
  position: number;
  evidenceId: string;
  evidenceUri: string;
  state: LearnedMemoryProvenanceState;
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

export interface LearnedMemoryInspection {
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
  provenanceOutcome: "verified" | "quarantined" | "unavailable";
  provenanceState: LearnedMemoryProvenanceState;
  evidenceProjection: LearnedMemoryEvidenceProjection;
  anchors: LearnedMemoryInspectionAnchor[];
}

export interface LearnedMemoryWriteInput {
  memoryId?: string;
  expectedRevision?: number;
  interpretation: string;
  evidenceIds: string[];
  scope?: LearnedMemoryScope;
}

export interface LearnedMemoryWriteResult {
  kind: "derived_memory_write";
  outcome: "created" | "revised";
  memoryId: string;
  revision: number;
  interpretation: string;
  scope: LearnedMemoryScope;
  provenanceOutcome: "verified";
  evidenceIds: string[];
  evidenceUris: string[];
}

export interface LearnedMemoryDeleteResult {
  kind: "derived_memory_delete";
  outcome: "deleted";
  memoryId: string;
  deletedRevisions: number;
}

export interface LearnedMemoryStatus {
  kind: "derived_memory_status";
  enabled: true;
  outcome: "ready" | "unavailable";
  database: "learned-memory.sqlite";
  schemaVersion: 1 | null;
  memories: number;
  revisions: number;
  stateBytes: number;
  errorCode?: "unsupported_schema" | "unsafe_storage" | "busy" | "unavailable";
  message?: string;
}

interface RevisionRow {
  memory_id: string;
  revision: number;
  current_revision: number;
  interpretation: string;
  scope_project: string | null;
  derived_at: string;
  derivation_kind: "explicit_agent";
  mooncite_version: string;
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

function databaseSchemaFingerprint(database: DatabaseSync): string {
  const rows = database.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_stat%'
    ORDER BY type, name, tbl_name
  `).all() as Array<{ type: string; name: string; tbl_name: string; sql: string | null }>;
  return JSON.stringify(rows);
}

let expectedMemorySchemaFingerprint: string | null = null;
function canonicalMemorySchemaFingerprint(): string {
  if (expectedMemorySchemaFingerprint !== null) return expectedMemorySchemaFingerprint;
  const canonical = new DatabaseSync(":memory:");
  try {
    canonical.exec(MEMORY_SCHEMA);
    expectedMemorySchemaFingerprint = databaseSchemaFingerprint(canonical);
    return expectedMemorySchemaFingerprint;
  } finally {
    canonical.close();
  }
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
    const objectCount = Number((database.prepare("SELECT COUNT(*) AS count FROM sqlite_schema").get() as { count?: number } | undefined)?.count ?? 0);
    if (objectCount === 0) {
      database.exec("BEGIN IMMEDIATE");
      try {
        database.exec(MEMORY_SCHEMA);
        database.prepare("INSERT INTO memory_metadata(key, value) VALUES ('schema_version', ?)").run(String(MEMORY_SCHEMA_VERSION));
        database.exec("COMMIT");
      } catch (error) {
        try { database.exec("ROLLBACK"); } catch { /* Preserve the schema initialization failure. */ }
        throw error;
      }
    }
    if (databaseSchemaFingerprint(database) !== canonicalMemorySchemaFingerprint()) {
      throw new Error("Mooncite learned-memory schema is corrupt or unsupported.");
    }
    const schema = database.prepare("SELECT value FROM memory_metadata WHERE key = 'schema_version'").get() as { value?: string } | undefined;
    if (schema?.value !== String(MEMORY_SCHEMA_VERSION)) {
      throw new Error("Mooncite learned-memory schema version is unsupported.");
    }
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
    stateBytes: 0,
    errorCode,
    message: "Learned memory is enabled but its separate store is unavailable.",
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

function assertRevision(value: unknown, subject: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${subject} must be a positive integer.`);
  return Number(value);
}

function scopeFromProject(project: string | null): LearnedMemoryScope {
  return project === null ? { kind: "global" } : { kind: "project", project };
}

function validateScope(scope: LearnedMemoryScope, anchors: EvidenceAnchorSnapshot[]): LearnedMemoryScope {
  if (!scope || typeof scope !== "object") throw new Error("Mooncite learned-memory scope is invalid.");
  if (scope.kind === "global" && Object.keys(scope).length === 1) return { kind: "global" };
  if (scope.kind !== "project" || Object.keys(scope).sort().join(",") !== "kind,project") {
    throw new Error("Mooncite learned-memory scope is invalid.");
  }
  const project = assertBoundedText(scope.project, MAX_MEMORY_PROJECT_BYTES, "Mooncite learned-memory project scope");
  if (anchors.some((anchor) => anchor.project !== project)) {
    throw new Error("Project-scoped learned memory requires every evidence anchor to use that exact encoded project.");
  }
  return { kind: "project", project };
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

function anchorState(saved: AnchorRow, resolution: EvidenceAnchorResolution): LearnedMemoryProvenanceState {
  if (resolution.outcome === "deauthorized") return "deauthorized";
  if (resolution.outcome !== "resolved" || !resolution.anchor) return "unavailable";
  if (saved.expected_record_digest !== resolution.anchor.recordDigest
    || saved.expected_span_digest !== resolution.anchor.spanDigest) return "content_mismatch";
  if (!anchorContextMatches(saved, resolution.anchor)) return "context_mismatch";
  return resolution.freshness === "last_good" ? "last_good" : "indexed";
}

function aggregateProvenance(states: readonly LearnedMemoryProvenanceState[]): LearnedMemoryProvenanceState {
  const priority: LearnedMemoryProvenanceState[] = [
    "deauthorized",
    "content_mismatch",
    "context_mismatch",
    "unavailable",
    "last_good",
    "indexed",
  ];
  return priority.find((state) => states.includes(state)) ?? "unavailable";
}

function isQuarantined(state: LearnedMemoryProvenanceState): boolean {
  return state === "content_mismatch" || state === "context_mismatch" || state === "unavailable" || state === "deauthorized";
}

export class LearnedMemoryStore {
  readonly #engine: MoonciteEngine;
  readonly #db: DatabaseSync;
  readonly #databasePath: string;
  #closed = false;

  constructor(engine: MoonciteEngine, options: { stateDir: string }) {
    this.#engine = engine;
    const opened = openMemoryDatabase(options.stateDir);
    this.#db = opened.database;
    this.#databasePath = opened.path;
  }

  #revision(memoryId: string, revision?: number): RevisionRow {
    const row = this.#db.prepare(`
      SELECT revisions.*, memories.current_revision
      FROM learned_memory_revisions revisions
      JOIN learned_memories memories ON memories.memory_id = revisions.memory_id
      WHERE revisions.memory_id = ?
        AND revisions.revision = COALESCE(?, memories.current_revision)
    `).get(memoryId, revision ?? null) as unknown as RevisionRow | undefined;
    if (!row) throw new Error("Mooncite learned memory or revision was not found.");
    return row;
  }

  #anchors(memoryId: string, revision: number): AnchorRow[] {
    return this.#db.prepare(`
      SELECT * FROM learned_memory_evidence
      WHERE memory_id = ? AND revision = ?
      ORDER BY position
    `).all(memoryId, revision) as unknown as AnchorRow[];
  }

  #resolveAnchors(anchors: AnchorRow[]): {
    resolutions: EvidenceAnchorResolution[];
    states: LearnedMemoryProvenanceState[];
  } {
    if (anchors.length < 1 || anchors.length > 8) {
      throw new Error("Mooncite learned-memory revision has an invalid evidence-anchor count.");
    }
    const resolutions = this.#engine.resolveEvidenceAnchors(anchors.map((anchor) => ({
      locator: anchor.evidence_id,
      expectedSource: {
        sourceOrigin: anchor.source_origin,
        sourceRootDigest: anchor.source_root_digest,
      },
    })));
    return { resolutions, states: anchors.map((anchor, index) => anchorState(anchor, resolutions[index]!)) };
  }

  recall(input: { query: string; limit?: number; project?: string; includeInvalid?: boolean }): LearnedMemoryRecall {
    const query = assertBoundedText(input.query, MAX_MEMORY_QUERY_BYTES, "Mooncite learned-memory query");
    const limit = input.limit === undefined ? 5 : assertRevision(input.limit, "Mooncite learned-memory recall limit");
    if (limit > 20) throw new Error("Mooncite learned-memory recall limit must be between 1 and 20.");
    const project = input.project === undefined
      ? null
      : assertBoundedText(input.project, MAX_MEMORY_PROJECT_BYTES, "Mooncite learned-memory project scope");
    const includeInvalid = input.includeInvalid ?? false;
    if (typeof includeInvalid !== "boolean") throw new Error("Mooncite learned-memory include-invalid flag is invalid.");
    this.#engine.refresh();
    const terms = queryTerms(query);
    const exactId = MEMORY_ID_PATTERN.test(query);
    const scopeSql = project === null ? "" : " AND (revisions.scope_project IS NULL OR revisions.scope_project = ?)";
    let rows: RevisionRow[] = [];
    if (exactId) {
      rows = this.#db.prepare(`
        SELECT revisions.*, memories.current_revision, -1000000.0 AS score
        FROM learned_memory_revisions revisions
        JOIN learned_memories memories
          ON memories.memory_id = revisions.memory_id
         AND memories.current_revision = revisions.revision
        WHERE revisions.memory_id = ?${scopeSql}
      `).all(query, ...(project === null ? [] : [project])) as unknown as RevisionRow[];
    } else if (terms.length > 0) {
      const match = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
      rows = this.#db.prepare(`
        SELECT revisions.*, memories.current_revision, bm25(learned_memory_fts) AS score
        FROM learned_memory_fts
        JOIN learned_memory_revisions revisions
          ON revisions.memory_id = learned_memory_fts.memory_id
         AND revisions.revision = learned_memory_fts.revision
        JOIN learned_memories memories
          ON memories.memory_id = revisions.memory_id
         AND memories.current_revision = revisions.revision
        WHERE learned_memory_fts MATCH ?${scopeSql}
        ORDER BY score, revisions.memory_id
        LIMIT ?
      `).all(match, ...(project === null ? [] : [project]), MAX_MEMORY_RECALL_ROWS) as unknown as RevisionRow[];
    }
    const candidates: LearnedMemoryCandidate[] = [];
    let filteredInvalid = 0;
    for (const row of rows) {
      const anchors = this.#anchors(row.memory_id, row.revision);
      const { resolutions, states } = this.#resolveAnchors(anchors);
      const provenanceState = aggregateProvenance(states);
      const quarantined = isQuarantined(provenanceState);
      if (quarantined && !includeInvalid) {
        filteredInvalid++;
        continue;
      }
      const lower = row.interpretation.toLowerCase();
      const matchedTerms = exactId ? [query] : terms.filter((term) => lower.includes(term));
      const coverage = exactId ? 1 : matchedTerms.length / Math.max(1, terms.length);
      const band = coverage >= 0.6 ? "strong" as const : coverage >= 0.25 ? "partial" as const : "weak" as const;
      candidates.push({
        kind: "derived_memory",
        memoryId: row.memory_id,
        revision: row.revision,
        interpretation: row.interpretation,
        scope: scopeFromProject(row.scope_project),
        derivedAt: row.derived_at,
        derivationKind: "explicit_agent",
        moonciteVersion: row.mooncite_version,
        anchors: anchors.map((anchor, index) => ({
          evidenceId: anchor.evidence_id,
          evidenceUri: anchor.evidence_uri,
          state: states[index]!,
        })),
        relevance: { kind: exactId ? "exact_id" : "lexical", band, matchedTerms },
        provenanceState,
        quarantined,
        evidenceProjection: {
          freshness: resolutions[0]!.freshness,
          trustState: resolutions[0]!.trustState,
          coverage: resolutions[0]!.coverage,
        },
      });
      if (candidates.length === limit) break;
    }
    const warnings: string[] = [];
    if (filteredInvalid > 0) warnings.push(`${filteredInvalid} quarantined derived memory item(s) were omitted; set include_invalid=true to review them.`);
    if (candidates.some((candidate) => candidate.provenanceState === "last_good")) {
      warnings.push("Evidence refresh retained a last-good generation; physically inspect every anchor before relying on this interpretation.");
    }
    return {
      kind: "derived_memory_recall",
      outcome: candidates.length > 0 ? "matches" : "no_match",
      query,
      project,
      includeInvalid,
      candidates,
      warnings,
    };
  }

  inspect(input: { memoryId: string; revision?: number; window?: number }): LearnedMemoryInspection {
    const memoryId = assertMemoryId(input.memoryId);
    const revision = input.revision === undefined ? undefined : assertRevision(input.revision, "Mooncite learned-memory revision");
    const window = input.window ?? 0;
    if (!Number.isInteger(window) || window < 0 || window > 2) throw new Error("Mooncite learned-memory inspection window must be between 0 and 2.");
    this.#engine.refresh();
    const row = this.#revision(memoryId, revision);
    const anchors = this.#anchors(memoryId, row.revision);
    const { resolutions, states: indexedStates } = this.#resolveAnchors(anchors);
    const inspections = anchors.map((anchor) => this.#engine.inspect({ evidenceId: anchor.evidence_id, window }));
    const states = indexedStates.map((state, index) => {
      const outcome = inspections[index]!.outcome;
      if (state !== "indexed" && state !== "last_good") return state;
      if (outcome === "stale") return "content_mismatch" as const;
      if (outcome !== "verified") return "unavailable" as const;
      return state;
    });
    const provenanceState = aggregateProvenance(states);
    const indexedProvenanceState = aggregateProvenance(indexedStates);
    const allPhysicallyVerified = inspections.every((inspection) => inspection.outcome === "verified");
    const physicallyStale = inspections.some((inspection) => inspection.outcome === "stale");
    const provenanceOutcome = !isQuarantined(provenanceState) && allPhysicallyVerified
      ? "verified" as const
      : isQuarantined(indexedProvenanceState) || physicallyStale
        ? "quarantined" as const
        : "unavailable" as const;
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
      provenanceOutcome,
      provenanceState,
      evidenceProjection: {
        freshness: resolutions[0]!.freshness,
        trustState: resolutions[0]!.trustState,
        coverage: resolutions[0]!.coverage,
      },
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
        current: resolutions[index]!.anchor,
        inspection: inspections[index]!,
      })),
    };
  }

  write(input: LearnedMemoryWriteInput): LearnedMemoryWriteResult {
    const interpretation = assertBoundedText(input.interpretation, MAX_INTERPRETATION_BYTES, "Mooncite learned-memory interpretation");
    if (!Array.isArray(input.evidenceIds) || input.evidenceIds.length < 1 || input.evidenceIds.length > 8) {
      throw new Error("Mooncite learned memory requires between 1 and 8 evidence anchors.");
    }
    const locators = input.evidenceIds.map((locator) => assertBoundedText(locator, MAX_MEMORY_LOCATOR_BYTES, "Mooncite evidence anchor locator"));
    if (new Set(locators).size !== locators.length) throw new Error("Mooncite learned-memory evidence anchors must be unique.");
    const memoryId = input.memoryId === undefined ? undefined : assertMemoryId(input.memoryId);
    if (memoryId === undefined && input.expectedRevision !== undefined) {
      throw new Error("A new Mooncite learned memory must not include expected_revision.");
    }
    const expectedRevision = memoryId === undefined
      ? undefined
      : assertRevision(input.expectedRevision, "Mooncite learned-memory expected revision");
    const previous = memoryId === undefined ? undefined : this.#revision(memoryId);
    if (previous && previous.current_revision !== expectedRevision) {
      throw new Error(`Mooncite learned memory changed; expected revision ${expectedRevision}, current revision ${previous.current_revision}.`);
    }

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

    let scope: LearnedMemoryScope;
    if (input.scope !== undefined) {
      scope = validateScope(input.scope, snapshots);
    } else if (previous) {
      scope = validateScope(scopeFromProject(previous.scope_project), snapshots);
    } else {
      const projects = [...new Set(snapshots.map((anchor) => anchor.project))];
      if (projects.length !== 1) throw new Error("Mixed-project learned memory requires an explicit global scope.");
      scope = { kind: "project", project: projects[0]! };
    }

    const logicalId = memoryId ?? `mooncite-memory:${randomUUID()}`;
    const derivedAt = new Date().toISOString();
    let revision = 1;
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      if (memoryId === undefined) {
        this.#db.prepare("INSERT INTO learned_memories(memory_id, current_revision, created_at) VALUES (?, 1, ?)")
          .run(logicalId, derivedAt);
      } else {
        const current = this.#db.prepare("SELECT current_revision FROM learned_memories WHERE memory_id = ?").get(memoryId) as
          { current_revision?: number } | undefined;
        if (!current?.current_revision) throw new Error("Mooncite learned memory was not found.");
        if (current.current_revision !== expectedRevision) {
          throw new Error(`Mooncite learned memory changed; expected revision ${expectedRevision}, current revision ${current.current_revision}.`);
        }
        revision = current.current_revision + 1;
      }
      this.#db.prepare(`
        INSERT INTO learned_memory_revisions(
          memory_id, revision, interpretation, scope_project, derived_at, derivation_kind, mooncite_version
        ) VALUES (?, ?, ?, ?, ?, 'explicit_agent', ?)
      `).run(logicalId, revision, interpretation, scope.kind === "global" ? null : scope.project, derivedAt, MOONCITE_VERSION);
      const insertAnchor = this.#db.prepare(`
        INSERT INTO learned_memory_evidence(
          memory_id, revision, position, evidence_id, evidence_uri,
          source_origin, source_root_digest, source_project, source_session_id,
          expected_record_digest, expected_span_digest, expected_context_digest, expected_role, expected_source_kind,
          expected_parent_id, expected_branch_state, expected_compaction_state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (let position = 0; position < snapshots.length; position++) {
        const anchor = snapshots[position]!;
        insertAnchor.run(
          logicalId,
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
      if (memoryId !== undefined) {
        this.#db.prepare("UPDATE learned_memories SET current_revision = ? WHERE memory_id = ?").run(revision, logicalId);
      }
      this.#db.prepare("DELETE FROM learned_memory_fts WHERE memory_id = ?").run(logicalId);
      this.#db.prepare("INSERT INTO learned_memory_fts(memory_id, revision, interpretation) VALUES (?, ?, ?)")
        .run(logicalId, revision, interpretation);
      this.#db.exec("COMMIT");
    } catch (error) {
      try { this.#db.exec("ROLLBACK"); } catch { /* Preserve the write failure. */ }
      throw error;
    }
    return {
      kind: "derived_memory_write",
      outcome: memoryId === undefined ? "created" : "revised",
      memoryId: logicalId,
      revision,
      interpretation,
      scope,
      provenanceOutcome: "verified",
      evidenceIds: snapshots.map((anchor) => anchor.evidenceId),
      evidenceUris: snapshots.map((anchor) => anchor.evidenceUri),
    };
  }

  delete(input: { memoryId: string; expectedRevision: number }): LearnedMemoryDeleteResult {
    const memoryId = assertMemoryId(input.memoryId);
    const expectedRevision = assertRevision(input.expectedRevision, "Mooncite learned-memory expected revision");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.#db.prepare("SELECT current_revision FROM learned_memories WHERE memory_id = ?").get(memoryId) as
        { current_revision?: number } | undefined;
      if (!current?.current_revision) throw new Error("Mooncite learned memory was not found.");
      if (current.current_revision !== expectedRevision) {
        throw new Error(`Mooncite learned memory changed; expected revision ${expectedRevision}, current revision ${current.current_revision}.`);
      }
      const deletedRevisions = Number((this.#db.prepare("SELECT COUNT(*) AS count FROM learned_memory_revisions WHERE memory_id = ?")
        .get(memoryId) as { count?: number } | undefined)?.count ?? 0);
      this.#db.prepare("DELETE FROM learned_memory_fts WHERE memory_id = ?").run(memoryId);
      this.#db.prepare("DELETE FROM learned_memories WHERE memory_id = ?").run(memoryId);
      this.#db.exec("COMMIT");
      return { kind: "derived_memory_delete", outcome: "deleted", memoryId, deletedRevisions };
    } catch (error) {
      try { this.#db.exec("ROLLBACK"); } catch { /* Preserve the delete failure. */ }
      throw error;
    }
  }

  status(): LearnedMemoryStatus {
    const memories = Number((this.#db.prepare("SELECT COUNT(*) AS count FROM learned_memories").get() as { count?: number } | undefined)?.count ?? 0);
    const revisions = Number((this.#db.prepare("SELECT COUNT(*) AS count FROM learned_memory_revisions").get() as { count?: number } | undefined)?.count ?? 0);
    return {
      kind: "derived_memory_status",
      enabled: true,
      outcome: "ready",
      database: MEMORY_DATABASE_NAME,
      schemaVersion: MEMORY_SCHEMA_VERSION,
      memories,
      revisions,
      stateBytes: statSync(this.#databasePath).size,
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }
}
