import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
  realpathSync,
  writeFileSync,
  statSync,
  type Dirent,
  type BigIntStats,
  type Stats,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TextDecoder } from "node:util";
import type { SourceRegistration } from "./source-config.js";
import { MOONCITE_STATE_MARKER_CONTENT, MOONCITE_STATE_MARKER_NAME } from "./identity.js";

const MAX_LINE_BYTES = 16 * 1024 * 1024;
const MAX_APPEND_CAPTURE_BYTES = 16 * 1024 * 1024;
const MAX_APPEND_LINES = 4_096;
const MAX_EVIDENCE_TEXT_BYTES = 256 * 1024;
const MAX_INSPECTION_CAPTURE_BYTES = 16 * 1024 * 1024;
const MAX_DISCOVERED_SOURCE_FILES = 10_000;
const MAX_REFRESH_SOURCE_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_DISCOVERY_ENTRIES = 100_000;
const MAX_REFRESH_RECORDS = 2_000_000;
const MAX_REFRESH_WORK_UNITS = 2_000_000;
const MAX_APPEND_BATCH_BYTES = 16 * 1024 * 1024;
const MAX_APPEND_BATCH_RECORDS = 20_000;
const MAX_APPEND_BATCH_EVIDENCE_SPANS = 20_000;
const MAX_REFRESH_EVIDENCE_SPANS = 2_000_000;
const MAX_DISCOVERY_DEPTH = 64;
const MAX_CHATGPT_CONVERSATION_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_IDENTIFIER_BYTES = 256;
const MAX_SOURCE_KIND_BYTES = 64;
const PRESENTATION_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u;
const PRESENTATION_CONTROL_REPLACEMENT_PATTERN = new RegExp(PRESENTATION_CONTROL_PATTERN.source, "gu");
const DERIVATION_VERSION = "13";

export type SourceOrigin = "pi" | "omp" | SourceRegistration["origin"];
const SOURCE_ORIGINS: SourceOrigin[] = ["pi", "omp", "claude-code", "codex", "chatgpt"];

function parseSourceOrigin(value: unknown): SourceOrigin {
  switch (value) {
    case "pi":
    case "omp":
    case "claude-code":
    case "codex":
    case "chatgpt":
      return value;
    default:
      throw new Error("Mooncite derived source origin is invalid.");
  }
}

function qualifiedSessionId(origin: SourceOrigin, sourceRootDigest: string, sessionId: string): string {
  return `${origin}:${sourceRootDigest}:${sessionId}`;
}

function parseQualifiedSessionId(value: string): { origin: SourceOrigin; rootDigest: string; sessionId: string } | null {
  for (const origin of SOURCE_ORIGINS) {
    const prefix = `${origin}:`;
    if (!value.startsWith(prefix)) continue;
    const remainder = value.slice(prefix.length);
    const separator = remainder.indexOf(":");
    if (separator <= 0) return null;
    const rootDigest = remainder.slice(0, separator);
    const sessionId = remainder.slice(separator + 1);
    if (/^[a-f0-9]{64}$/u.test(rootDigest) && isBoundedIdentifier(sessionId)) {
      return { origin, rootDigest, sessionId };
    }
  }
  return null;
}

function sourceRootDigestFromSourcePath(origin: SourceOrigin, sourcePath: string): string {
  const prefix = `${origin}/`;
  const digest = sourcePath.startsWith(prefix) ? sourcePath.slice(prefix.length).split("/", 1)[0] : null;
  if (!digest || !/^[a-f0-9]{64}$/u.test(digest)) throw new Error("Mooncite derived source namespace is invalid.");
  return digest;
}

function citationNamespace(sourceRootDigest: string, sourcePath: string): string {
  return sha256(`citation-source-v1\0${sourceRootDigest}\0${sourcePath}`).slice(0, 24);
}

function evidenceId(origin: SourceOrigin, sourceNamespace: string, sessionId: string, entryId: string, ordinal: number): string {
  return `mooncite:${origin}:${sourceNamespace}:${sha256(sessionId).slice(0, 24)}:${sha256(entryId).slice(0, 24)}:${ordinal}`;
}

function evidenceUri(origin: SourceOrigin, sourceNamespace: string, sessionId: string, entryId: string, ordinal: number): string {
  return `mooncite://${origin}/${sourceNamespace}/${encodeURIComponent(sessionId)}/${encodeURIComponent(entryId)}/${ordinal}`;
}
const DATABASE_SCHEMA = `
  PRAGMA busy_timeout=5000;
  PRAGMA journal_mode=DELETE;
  CREATE TABLE IF NOT EXISTS evidence (
    evidence_id TEXT PRIMARY KEY,
    evidence_uri TEXT NOT NULL,
    text TEXT NOT NULL,
    project TEXT NOT NULL,
    session_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    role TEXT NOT NULL,
    source_origin TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    event_timestamp TEXT,
    source_path TEXT NOT NULL,
    line INTEGER NOT NULL,
    byte_start INTEGER NOT NULL,
    byte_end INTEGER NOT NULL,
    record_digest TEXT NOT NULL,
    prefix_digest TEXT NOT NULL,
    parent_id TEXT,
    branch_state TEXT NOT NULL,
    compaction_state TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS evidence_uri_lookup ON evidence(evidence_uri);
  CREATE INDEX IF NOT EXISTS evidence_project_lookup ON evidence(project);
  CREATE INDEX IF NOT EXISTS evidence_entry_lookup ON evidence(entry_id);
  CREATE INDEX IF NOT EXISTS evidence_session_lookup ON evidence(source_origin, session_id, source_path);
  CREATE INDEX IF NOT EXISTS evidence_source_position ON evidence(source_path, byte_start, evidence_id);
  CREATE INDEX IF NOT EXISTS evidence_timestamp_lookup ON evidence(event_timestamp);
  CREATE VIRTUAL TABLE IF NOT EXISTS evidence_fts USING fts5(
    text,
    content='evidence',
    content_rowid='rowid',
    tokenize='porter unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER IF NOT EXISTS evidence_fts_insert AFTER INSERT ON evidence BEGIN
    INSERT INTO evidence_fts(rowid, text) VALUES (new.rowid, new.text);
  END;
  CREATE TRIGGER IF NOT EXISTS evidence_fts_delete AFTER DELETE ON evidence BEGIN
    INSERT INTO evidence_fts(evidence_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  END;
  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS source_files (
    source_path TEXT PRIMARY KEY,
    source_origin TEXT NOT NULL,
    source_root_digest TEXT NOT NULL,
    session_id TEXT NOT NULL,
    project TEXT NOT NULL,
    dev TEXT NOT NULL,
    ino TEXT NOT NULL,
    observed_size INTEGER NOT NULL,
    admitted_bytes INTEGER NOT NULL,
    mtime_ns TEXT NOT NULL,
    ctime_ns TEXT NOT NULL,
    physical_lines INTEGER NOT NULL,
    records INTEGER NOT NULL,
    eligible_records INTEGER NOT NULL,
    evidence_spans INTEGER NOT NULL,
    skipped INTEGER NOT NULL,
    malformed INTEGER NOT NULL,
    oversized INTEGER NOT NULL,
    errors INTEGER NOT NULL,
    fatal_errors INTEGER NOT NULL,
    leaf_entry_id TEXT,
    latest_compaction_line INTEGER,
    prefix_digest TEXT NOT NULL,
    source_generation TEXT NOT NULL,
    trust_state TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS source_records (
    source_path TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    parent_id TEXT,
    line INTEGER NOT NULL,
    source_kind TEXT NOT NULL,
    PRIMARY KEY (source_path, entry_id)
  );
  CREATE INDEX IF NOT EXISTS source_records_parent ON source_records(source_path, parent_id);
`;
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "did", "do", "does", "for", "from", "how", "i", "in",
  "is", "it", "of", "on", "or", "should", "the", "to", "was", "we", "what", "when", "where", "which", "with",
]);
const MAX_RECALL_RANKING_ROWS = 200;

export interface EngineOptions {
  sessionsRoot: string;
  ompSessionsRoot?: string;
  optionalSources?: SourceRegistration[];
  optionalSourcesProvider?: () => SourceRegistration[];
  stateDir: string;
}

export type RelevanceBand = "strong" | "partial" | "weak";
export type MatchKind = "metadata_exact" | "phrase_exact" | "text_exact" | "terms";
export type TrustState = "full_verified" | "append_trusted";
export type CoverageState = "complete" | "partial";
export type RecallOrder = "relevance" | "newest" | "oldest";
export type EvidenceRole = "user" | "assistant" | "system" | "developer" | "tool" | "toolResult" | "summary" | "unknown";
export type EvidenceRecordProvenance = "original" | "copy";

export interface RecallInput {
  query: string;
  limit?: number;
  project?: string;
  sessionId?: string;
  after?: string;
  before?: string;
  role?: EvidenceRole;
  sourceOrigin?: SourceOrigin;
  order?: RecallOrder;
}

export interface EvidenceMatch {
  kind: MatchKind;
  band: RelevanceBand;
  matchedTerms: string[];
  missingTerms: string[];
  termCoverage: number;
}

export interface EvidenceCandidate {
  evidenceId: string;
  evidenceUri: string;
  excerpt: string;
  omittedBytes: number;
  project: string;
  sessionId: string;
  entryId: string;
  role: EvidenceRole;
  sourceOrigin: SourceOrigin;
  sourceKind: string;
  eventTimestamp: string | null;
  recordProvenance: EvidenceRecordProvenance;
  parentId: string | null;
  branchState: "current" | "off_branch";
  compactionState: "none" | "pre_compaction" | "summary" | "kept_after_compaction";
  duplicateSpanCount?: number;
  isEcho: boolean;
  match: EvidenceMatch;
}

export interface MoonciteNextAction {
  action: "call" | "run";
  target: string;
  arguments?: Record<string, string | number>;
  reason: string;
}

export interface EvidenceBundle {
  outcome: "matches" | "weak_leads" | "no_match" | "inconclusive" | "invalid_scope" | "unavailable";
  conclusive: boolean;
  meaning: string;
  next: MoonciteNextAction | null;
  query: string;
  lexicalTerms: string[];
  scope: { project: string | null; sessionId: string | null; evidenceSpans: number };
  generation: string;
  trustState: TrustState;
  coverage: CoverageState;
  candidates: EvidenceCandidate[];
  echoesSuppressed: number;
  warnings: string[];
}

export type RefreshOutcome = "not_run" | "published" | "unchanged" | "retained_last_good" | "unavailable";

export type MoonciteStatusErrorReason =
  | "source_configuration_failure"
  | "source_root_unavailable"
  | "source_discovery_failure"
  | "source_limit_exceeded"
  | "source_metadata_failure"
  | "source_changed_during_refresh"
  | "source_read_or_parse_failure";

export interface MoonciteStatusErrorGroup {
  origin: SourceOrigin | "unknown";
  reason: MoonciteStatusErrorReason;
  count: number;
  fatalCount: number;
}

export interface MoonciteStatus {
  outcome: "ready" | "degraded" | "unavailable";
  meaning: string;
  next: MoonciteNextAction | null;
  freshness: "current" | "last_good" | "unavailable";
  generation: string;
  trustState: TrustState;
  coverage: CoverageState;
  sourceRoot: string;
  sourceFilesByOrigin: Record<SourceOrigin, number>;
  sourceFiles: number;
  records: number;
  eligibleRecords: number;
  evidenceSpans: number;
  skipped: number;
  malformed: number;
  oversized: number;
  errors: number;
  errorGroups: MoonciteStatusErrorGroup[];
  stateBytes: number;
  lastSuccessfulRefreshAt: string | null;
  lastRefreshOutcome: RefreshOutcome;
  lastRebuildOutcome: RefreshOutcome;
  searchUsable: boolean;
}

export type InspectionOutcome = "verified" | "stale" | "missing" | "excluded" | "corrupt" | "unavailable";

export interface InspectedSpan {
  relation: "before" | "target" | "after";
  evidenceId: string;
  text: string;
  sessionId: string;
  entryId: string;
  parentId: string | null;
  role: EvidenceRole;
  sourceOrigin: SourceOrigin;
  sourceKind: string;
  eventTimestamp: string | null;
  recordProvenance: EvidenceRecordProvenance;
  branchState: "current" | "off_branch";
  compactionState: "none" | "pre_compaction" | "summary" | "kept_after_compaction";
  omittedBytes: number;
}

export interface EvidenceInspection {
  outcome: InspectionOutcome;
  evidenceId: string;
  target: InspectedSpan | null;
  window: InspectedSpan[];
  locator: {
    sourceOrigin: SourceOrigin;
    relativePath: string;
    sessionId: string;
    entryId: string;
    spanOrdinal: number;
    line: number;
    byteStart: number;
    byteEnd: number;
    recordDigest: string;
    prefixDigest: string;
    prefixDigestKind: "full_prefix_sha256" | "append_chain_sha256";
  } | null;
  message?: string;
}

export interface EvidenceAnchorRequest {
  locator: string;
  expectedSource?: {
    sourceOrigin: SourceOrigin;
    sourceRootDigest: string;
  };
}

export interface EvidenceAnchorSnapshot {
  evidenceId: string;
  evidenceUri: string;
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
  branchState: "current" | "off_branch";
  compactionState: "none" | "pre_compaction" | "summary" | "kept_after_compaction";
  isMoonciteRendering: boolean;
}

export interface EvidenceAnchorResolution {
  locator: string;
  outcome: "resolved" | "missing" | "deauthorized" | "unavailable";
  freshness: "current" | "last_good" | "unavailable";
  trustState: TrustState;
  coverage: CoverageState;
  anchor: EvidenceAnchorSnapshot | null;
}

interface IndexedEvidence extends Omit<EvidenceCandidate, "match" | "omittedBytes" | "recordProvenance" | "isEcho"> {
  text: string;
  sourcePath: string;
  line: number;
  byteStart: number;
  byteEnd: number;
  recordDigest: string;
  prefixDigest: string;
}

interface SourceRecord {
  entryId: string;
  parentId: string | null;
  line: number;
  sourceKind: string;
}

interface SourceSnapshot {
  sourceOrigin: SourceOrigin;
  sourcePath: string;
  sourceRootDigest: string;
  sessionId: string;
  project: string;
  dev: string;
  ino: string;
  observedSize: number;
  admittedBytes: number;
  mtimeNs: string;
  ctimeNs: string;
  physicalLines: number;
  records: number;
  eligibleRecords: number;
  evidenceSpans: number;
  skipped: number;
  malformed: number;
  oversized: number;
  errors: number;
  fatalErrors: number;
  leafEntryId: string | null;
  latestCompactionLine: number | null;
  prefixDigest: string;
  sourceGeneration: string;
  trustState: TrustState;
  entries: SourceRecord[];
  evidence: IndexedEvidence[];
  requiresRelabel: boolean;
}

interface ScanResult {
  evidence: IndexedEvidence[];
  sourceFiles: number;
  records: number;
  eligibleRecords: number;
  skipped: number;
  malformed: number;
  oversized: number;
  errors: number;
  fatalErrors: number;
  generation: string;
  trustState: TrustState;
  coverage: CoverageState;
  retainedLastGood: boolean;
  errorGroups: MoonciteStatusErrorGroup[];
}

const STATUS_ERROR_REASONS: Record<MoonciteStatusErrorReason, true> = {
  source_configuration_failure: true,
  source_root_unavailable: true,
  source_discovery_failure: true,
  source_limit_exceeded: true,
  source_metadata_failure: true,
  source_changed_during_refresh: true,
  source_read_or_parse_failure: true,
};

function mergeErrorGroups(...collections: MoonciteStatusErrorGroup[][]): MoonciteStatusErrorGroup[] {
  const merged = new Map<string, MoonciteStatusErrorGroup>();
  for (const group of collections.flat()) {
    if (group.count <= 0) continue;
    const key = `${group.origin}\0${group.reason}`;
    const previous = merged.get(key);
    if (previous) {
      previous.count += group.count;
      previous.fatalCount += group.fatalCount;
    } else {
      merged.set(key, { ...group });
    }
  }
  return [...merged.values()].sort((left, right) =>
    left.origin.localeCompare(right.origin) || left.reason.localeCompare(right.reason));
}

function sourceError(
  origin: SourceOrigin | "unknown",
  reason: MoonciteStatusErrorReason,
  count = 1,
  fatalCount = count,
): MoonciteStatusErrorGroup {
  return { origin, reason, count, fatalCount };
}

function errorGroupTotals(groups: MoonciteStatusErrorGroup[]): { count: number; fatalCount: number } {
  return groups.reduce((totals, group) => ({
    count: totals.count + group.count,
    fatalCount: totals.fatalCount + group.fatalCount,
  }), { count: 0, fatalCount: 0 });
}

function persistedErrorGroups(
  value: unknown,
  errors: number,
  fatalErrors: number,
): MoonciteStatusErrorGroup[] {
  if (errors === 0) return [];
  if (!Array.isArray(value)) return [sourceError("unknown", "source_read_or_parse_failure", errors, fatalErrors)];
  const valid: MoonciteStatusErrorGroup[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const candidate = item as Record<string, unknown>;
    const origin = candidate.origin;
    const reason = candidate.reason;
    const count = candidate.count;
    const fatalCount = candidate.fatalCount;
    if ((origin !== "unknown" && !SOURCE_ORIGINS.includes(origin as SourceOrigin))
      || typeof reason !== "string" || STATUS_ERROR_REASONS[reason as MoonciteStatusErrorReason] !== true
      || !Number.isSafeInteger(count) || Number(count) <= 0
      || !Number.isSafeInteger(fatalCount) || Number(fatalCount) < 0 || Number(fatalCount) > Number(count)) {
      continue;
    }
    valid.push(sourceError(
      origin as SourceOrigin | "unknown",
      reason as MoonciteStatusErrorReason,
      Number(count),
      Number(fatalCount),
    ));
  }
  const merged = mergeErrorGroups(valid);
  const totals = errorGroupTotals(merged);
  return totals.count === errors && totals.fatalCount === fatalErrors
    ? merged
    : [sourceError("unknown", "source_read_or_parse_failure", errors, fatalErrors)];
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function evidenceGeneration(evidence: IndexedEvidence[]): string {
  return sha256(evidence
    .slice()
    .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId))
    .map((item) => [
      item.evidenceId,
      item.recordDigest,
      item.sourcePath,
      item.line,
      item.byteStart,
      item.byteEnd,
      item.project,
      item.eventTimestamp ?? "",
      item.branchState,
      item.compactionState,
    ].join(":"))
    .join("\n"));
}

function aggregateGeneration(sources: Array<{ sourcePath: string; sourceGeneration: string }>): string {
  return sha256(sources
    .slice()
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath))
    .map((source) => `${source.sourcePath}:${source.sourceGeneration}`)
    .join("\n"));
}

function truncateUtf8(value: string, maxBytes: number): { text: string; omittedBytes: number } {
  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength <= maxBytes) return { text: value, omittedBytes: 0 };
  const bytes = Buffer.from(value, "utf8");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let end = Math.max(0, maxBytes);
  while (end > 0) {
    try {
      return { text: decoder.decode(bytes.subarray(0, end)), omittedBytes: byteLength - end };
    } catch {
      end--;
    }
  }
  return { text: "", omittedBytes: byteLength };
}

function literalCaseInsensitiveMatch(value: string, needle: string): { index: number; length: number } | null {
  if (!needle) return null;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(escaped, "iu").exec(value);
  return match ? { index: match.index, length: match[0].length } : null;
}

function matchedExcerpt(
  value: string,
  exactText: string,
  matchedTerms: string[],
  maxBytes: number,
): { text: string; omittedBytes: number } {
  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength <= maxBytes) return { text: value, omittedBytes: 0 };
  const termVariants = matchedTerms.flatMap((term) => {
    const stem = term.replace(/(ing|ed|s)$/u, "");
    return stem.length > 1 && stem !== term ? [term, stem] : [term];
  }).sort((left, right) => right.length - left.length);
  const match = literalCaseInsensitiveMatch(value, exactText)
    ?? termVariants.map((term) => literalCaseInsensitiveMatch(value, term)).find((item) => item !== null)
    ?? null;
  if (!match) return truncateUtf8(value, maxBytes);

  const matchByteStart = Buffer.byteLength(value.slice(0, match.index), "utf8");
  const searchBefore = Math.max(0, match.index - 1);
  const escapedLf = value.lastIndexOf("\\u{a}", searchBefore);
  const escapedCr = value.lastIndexOf("\\u{d}", searchBefore);
  const lineStartIndex = Math.max(
    value.lastIndexOf("\n", searchBefore) + 1,
    escapedLf < 0 ? 0 : escapedLf + 5,
    escapedCr < 0 ? 0 : escapedCr + 5,
  );
  const lineByteStart = Buffer.byteLength(value.slice(0, lineStartIndex), "utf8");
  const precedingLineBytes = matchByteStart - lineByteStart;
  let start = precedingLineBytes <= Math.floor(maxBytes / 4)
    ? lineByteStart
    : Math.max(0, matchByteStart - Math.floor(maxBytes / 8));
  const bytes = Buffer.from(value, "utf8");
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let end = Math.min(bytes.length, start + maxBytes);
  while (end > start) {
    try {
      return {
        text: decoder.decode(bytes.subarray(start, end)),
        omittedBytes: start + byteLength - end,
      };
    } catch {
      end--;
    }
  }
  return { text: "", omittedBytes: byteLength };
}

function queryTerms(input: string): string[] {
  return [...new Set(input.toLowerCase().match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? [])]
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function parsedQueryText(input: string): { text: string; phrase: boolean } {
  const value = input.trim();
  const pairs = new Map([["\"", "\""], ["'", "'"], ["“", "”"], ["‘", "’"]]);
  const closing = pairs.get(value[0] ?? "");
  const phrase = Boolean(closing && value.length > 1 && value.endsWith(closing));
  return { text: phrase ? value.slice(1, -1).trim() : value, phrase };
}

function isMoonciteRenderingText(text: string): boolean {
  const normalized = text
    .slice(0, 4_096)
    .replaceAll("\\u{a}", "\n")
    .replaceAll("\\u{d}", "\r")
    .replaceAll("\\n", "\n");
  const offsets = new Set<number>([0]);
  const marker = /Mooncite (?:recall|inspection|status|is |evidence is unavailable|learned-memory )|(?:Evidence for|Weak evidence leads for|No evidence matched|Verified evidence mooncite:|Evidence mooncite:|Evidence mooncite:\/\/|Derived Mooncite memories for|Derived memory mooncite-memory:|Stored derived memory|Deleted derived memory)/gu;
  for (const match of normalized.matchAll(marker)) offsets.add(match.index);
  const scope = "(?:; scope(?: project=[^\\s\\]\\r\\n]{1,256})?(?: session_id=[^\\s\\]\\r\\n]{1,256})? contains [0-9]{1,12} indexed span\\(s\\))?";
  const trust = `\\[(?:full_verified|append_trusted); (?:complete|partial) coverage${scope}\\]`;
  const tail = "(?: Warnings: [^\\r\\n]{1,1024})?(?:\\n|$)";
  return [...offsets].some((offset) => {
    const head = normalized.slice(offset);
    return /^Mooncite (?:recall|inspection|status):/u.test(head)
      || new RegExp(`^(?:Evidence for|Weak evidence leads for) “[\\s\\S]{0,2200}?”: {0,2}${trust}${tail}`, "u").test(head)
      || new RegExp(`^(?:No evidence matched|Mooncite evidence is unavailable for) “[\\s\\S]{0,2200}?”\\. ${trust}${tail}`, "u").test(head)
      || /^Verified evidence mooncite:(?:pi|omp|claude-code|codex|chatgpt):[^\n]{1,2200}:\n/u.test(head)
      || /^Evidence (?:mooncite:(?:pi|omp|claude-code|codex|chatgpt):|mooncite:\/\/(?:pi|omp|claude-code|codex|chatgpt)\/)[^\n]{1,2200}: (?:stale|missing|excluded|corrupt|unavailable)\./u.test(head)
      || /^Mooncite is (?:ready|unavailable) \((?:current|last_good|unavailable), (?:full_verified|append_trusted), (?:complete|partial) coverage\):/u.test(head)
      || /^Derived Mooncite memories for “[\s\S]{0,2200}?” \(interpretations, not source evidence\):/u.test(head)
      || /^Derived memory mooncite-memory:[0-9a-f-]{36} revision [1-9][0-9]*:/u.test(head)
      || /^(?:Stored|Deleted) derived memory mooncite-memory:[0-9a-f-]{36}/u.test(head)
      || /^Mooncite learned-memory (?:recall|inspection|write|delete) failed\./u.test(head);
  });
}

export function isMoonciteToolRendering(role: string, text: string): boolean {
  return (role === "toolResult" || role === "tool") && isMoonciteRenderingText(text);
}

function isBoundedIdentifier(value: unknown, maxBytes = MAX_SOURCE_IDENTIFIER_BYTES): value is string {
  return typeof value === "string"
    && value.length > 0
    && Buffer.byteLength(value, "utf8") <= maxBytes
    && !PRESENTATION_CONTROL_PATTERN.test(value);
}

function projectIdentity(value: string, labelSource = value): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/{2,}/gu, "/").replace(/\/$/u, "") || "root";
  const normalizedLabel = labelSource.replaceAll("\\", "/").replace(/\/{2,}/gu, "/").replace(/\/$/u, "") || "root";
  const rawLabel = normalizedLabel.split("/").filter(Boolean).at(-1) || "root";
  const label = rawLabel.normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64) || "root";
  const digest = sha256(`project-identity-v2\0${normalized}`).slice(0, 16);

  return `project:${encodeURIComponent(label)}-${digest}`;
}
function sourceAuthorizationDigest(root: string, discovery?: "automatic"): string {
  return sha256(`source-authorization-v1\0${resolve(root)}\0${discovery ?? "configured"}`);
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

interface OwnedDirectoryIdentity {
  dev: string;
  ino: string;
}

function assertSafeAncestorChain(path: string): void {
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
    if (state.isSymbolicLink() || !state.isDirectory()) throw new Error("Mooncite state path has a non-directory ancestor.");
    if (!confined && state.uid !== 0n && state.uid !== uid) {
      throw new Error("Mooncite state path has an untrusted ancestor owner.");
    }
    const mode = Number(state.mode);
    if (confined && state.uid !== uid) throw new Error("Mooncite state path escapes its owner-private ancestor.");
    if (!confined && (mode & 0o022) !== 0 && (mode & 0o1000) === 0) {
      throw new Error("Mooncite state path has an unsafe writable ancestor.");
    }
    if (state.uid === uid && (mode & 0o011) === 0) confined = true;
  }
}

function assertOwnedStateDirectory(path: string, expected?: OwnedDirectoryIdentity): OwnedDirectoryIdentity {
  const absolutePath = resolve(path);
  if (hasSymlinkComponent(absolutePath) || realpathSync(absolutePath) !== absolutePath) {
    throw new Error("Mooncite state path contains a symbolic-link component.");
  }
  const state = lstatSync(absolutePath, { bigint: true });
  if (state.isSymbolicLink() || !state.isDirectory()) throw new Error("Mooncite state path is not a regular directory.");
  const getUid = typeof process.getuid === "function" ? process.getuid.bind(process) : null;
  if (getUid) {
    if (state.uid !== BigInt(getUid())) throw new Error("Mooncite state directory is not owned by the current user.");
    if ((Number(state.mode) & 0o077) !== 0) throw new Error("Mooncite state directory is not private.");
    assertSafeAncestorChain(absolutePath);
  }
  const identity = { dev: state.dev.toString(), ino: state.ino.toString() };
  if (expected && (identity.dev !== expected.dev || identity.ino !== expected.ino)) {
    throw new Error("Mooncite state directory changed identity.");
  }
  return identity;
}

function assertOwnedStateFile(path: string): void {
  const state = lstatSync(path, { bigint: true });
  if (state.isSymbolicLink() || !state.isFile() || state.nlink !== 1n) {
    throw new Error("Mooncite index path is not an owned regular file.");
  }
  if (typeof process.getuid === "function"
    && (state.uid !== BigInt(process.getuid()) || (Number(state.mode) & 0o077) !== 0)) {
    throw new Error("Mooncite index file is not privately owned by the current user.");
  }
}


function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function cleanupStaleEngineLocks(stateDir: string): void {
  for (const entry of readdirSync(stateDir, { withFileTypes: true })) {
    const match = /^\.engine-([1-9]\d*)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.lock$/u.exec(entry.name);
    if (!match) continue;
    const path = join(stateDir, entry.name);
    assertOwnedStateFile(path);
    const pid = Number(match[1]);
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = fstatSync(fd, { bigint: true });
      if (!opened.isFile() || opened.nlink !== 1n) throw new Error("Mooncite engine lock is not an owned regular file.");
      const bytes = Buffer.alloc(32);
      const count = readSync(fd, bytes, 0, bytes.length, 0);
      if (bytes.subarray(0, count).toString("utf8") !== `${pid}\n`) throw new Error("Mooncite engine lock content is invalid.");
    } finally {
      closeSync(fd);
    }
    if (!processIsAlive(pid)) rmSync(path, { force: true });
  }
}
function assertStateMarker(path: string): void {
  assertOwnedStateFile(path);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const state = fstatSync(fd, { bigint: true });
    if (!state.isFile() || state.nlink !== 1n
      || (typeof process.getuid === "function"
        && (state.uid !== BigInt(process.getuid()) || (Number(state.mode) & 0o077) !== 0))) {
      throw new Error("Mooncite state marker is not an owned regular file.");
    }
    const expected = Buffer.from(MOONCITE_STATE_MARKER_CONTENT, "utf8");
    const captured = Buffer.alloc(expected.length + 1);
    const bytesRead = readSync(fd, captured, 0, captured.length, 0);
    if (bytesRead !== expected.length || !captured.subarray(0, bytesRead).equals(expected)) {
      throw new Error("Mooncite state marker is invalid.");
    }
  } finally {
    closeSync(fd);
  }
}

function pathsOverlap(left: string, right: string): boolean {
  const canonicalLeft = resolve(left);
  const canonicalRight = resolve(right);
  const leftFromRight = relative(canonicalRight, canonicalLeft);
  if (leftFromRight === "" || (leftFromRight !== ".." && !leftFromRight.startsWith(`..${sep}`))) return true;
  const rightFromLeft = relative(canonicalLeft, canonicalRight);
  return rightFromLeft === "" || (rightFromLeft !== ".." && !rightFromLeft.startsWith(`..${sep}`));
}

interface SourceFileScan {
  files: string[];
  errors: Array<{
    reason: "source_discovery_failure" | "source_limit_exceeded";
    count: number;
  }>;
}

function sourceFileScan(files: string[], discoveryFailures: number, limitFailures: number): SourceFileScan {
  const errors: SourceFileScan["errors"] = [];
  if (discoveryFailures > 0) errors.push({ reason: "source_discovery_failure", count: discoveryFailures });
  if (limitFailures > 0) errors.push({ reason: "source_limit_exceeded", count: limitFailures });
  return { files: files.sort(), errors };
}


function listProjectSessionFiles(root: string): SourceFileScan {
  if (hasSymlinkComponent(root) || !existsSync(root)) return sourceFileScan([], 0, 0);
  const rootState = lstatSync(root);
  if (rootState.isSymbolicLink() || !rootState.isDirectory()) return sourceFileScan([], 1, 0);
  const canonicalRoot = resolve(root);
  const files: string[] = [];
  let visited = 0;
  let discoveryFailures = 0;
  let projects: Dirent<string>[];
  try {
    projects = readdirSync(canonicalRoot, { withFileTypes: true });
  } catch {
    return sourceFileScan([], 1, 0);
  }
  for (const project of projects) {
    visited++;
    if (visited > MAX_DISCOVERY_ENTRIES || files.length >= MAX_DISCOVERED_SOURCE_FILES) {
      return sourceFileScan(files, discoveryFailures, 1);
    }
    if (project.isSymbolicLink() || !project.isDirectory()) continue;
    const directory = join(canonicalRoot, project.name);
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      discoveryFailures++;
      continue;
    }
    for (const entry of entries) {
      visited++;
      if (visited > MAX_DISCOVERY_ENTRIES || files.length >= MAX_DISCOVERED_SOURCE_FILES) {
        return sourceFileScan(files, discoveryFailures, 1);
      }
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".jsonl")) continue;
      const path = resolve(directory, entry.name);
      if (path.startsWith(`${canonicalRoot}${sep}`)) files.push(path);
    }
  }
  return sourceFileScan(files, discoveryFailures, 0);
}


function listSessionFilesByName(root: string, accept: (name: string) => boolean): SourceFileScan {
  if (hasSymlinkComponent(root) || !existsSync(root)) return sourceFileScan([], 0, 0);
  const rootState = lstatSync(root);
  if (rootState.isSymbolicLink() || !rootState.isDirectory()) return sourceFileScan([], 1, 0);
  const canonicalRoot = resolve(root);
  const files: string[] = [];
  const directories: Array<{ path: string; depth: number }> = [{ path: canonicalRoot, depth: 0 }];
  let directoryIndex = 0;
  let visited = 0;
  let discoveryFailures = 0;
  let limitFailures = 0;
  while (directoryIndex < directories.length) {
    const directory = directories[directoryIndex++]!;
    if (directory.depth > MAX_DISCOVERY_DEPTH) {
      limitFailures++;
      continue;
    }
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(directory.path, { withFileTypes: true });
    } catch {
      discoveryFailures++;
      continue;
    }
    for (const entry of entries) {
      visited++;
      if (visited > MAX_DISCOVERY_ENTRIES || files.length >= MAX_DISCOVERED_SOURCE_FILES) {
        return sourceFileScan(files, discoveryFailures, limitFailures + 1);
      }
      const path = join(directory.path, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) directories.push({ path, depth: directory.depth + 1 });
      else if (entry.isFile() && accept(entry.name)) {
        const canonical = resolve(path);
        if (canonical.startsWith(`${canonicalRoot}${sep}`)) files.push(canonical);
      }
    }
  }
  return sourceFileScan(files, discoveryFailures, limitFailures);
}

function listSourceFiles(origin: SourceOrigin, root: string): SourceFileScan {
  if (origin === "omp" || origin === "claude-code") return listProjectSessionFiles(root);
  if (origin === "chatgpt") {
    return listSessionFilesByName(root, (name) =>
      name === "conversation.json" || name === "conversations.json" || /^conversations-\d+\.json$/u.test(name));
  }
  return listSessionFilesByName(root, (name) => name.endsWith(".jsonl"));
}

function readRangesCoherently(path: string, root: string, ranges: Array<{ start: number; end: number }>): Buffer[] | null {
  const before = sourceMetadata(path, root);
  const maxEnd = ranges.reduce((maximum, range) => Math.max(maximum, range.end), 0);
  if (!before || ranges.some((range) => range.start < 0 || range.end < range.start) || maxEnd > before.size) return null;
  const keys = ranges.map((range) => `${range.start}:${range.end}`);
  const uniqueRanges = new Map<string, { start: number; end: number }>();
  for (let index = 0; index < ranges.length; index++) uniqueRanges.set(keys[index]!, ranges[index]!);
  const totalBytes = [...uniqueRanges.values()].reduce((sum, range) => sum + range.end - range.start, 0);
  if (totalBytes > MAX_INSPECTION_CAPTURE_BYTES) return null;
  const readRanges = (): Map<string, Buffer> | null => {
    const fd = openVerifiedSource(path, before, true);
    if (fd === null) return null;
    try {
      const captured = new Map<string, Buffer>();
      for (const [key, range] of uniqueRanges) {
        const size = range.end - range.start;
        const bytes = Buffer.alloc(size);
        let offset = 0;
        while (offset < size) {
          const count = readSync(fd, bytes, offset, size - offset, range.start + offset);
          if (count === 0) break;
          offset += count;
        }
        captured.set(key, bytes.subarray(0, offset));
      }
      return captured;
    } finally {
      closeSync(fd);
    }
  };
  const first = readRanges();
  if (!first || [...uniqueRanges].some(([key, range]) => first.get(key)?.length !== range.end - range.start)) return null;
  const after = sourceMetadata(path, root);
  if (!after || before.dev !== after.dev || before.ino !== after.ino || after.size < maxEnd) return null;
  const changed = before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs;
  if (changed) {
    const second = readRanges();
    if (!second || [...first].some(([key, bytes]) => !bytes.equals(second.get(key)!))) return null;
  }
  return keys.map((key) => first.get(key)!);
}

interface SourceMetadata {
  root: string;
  dev: string;
  ino: string;
  size: number;
  mtimeNs: string;
  ctimeNs: string;
}

function hashFilePrefix(path: string, size: number, expected: SourceMetadata): string {
  const hash = createHash("sha256");
  const fd = openVerifiedSource(path, expected);
  if (fd === null) throw new Error("Mooncite source changed identity while hashing.");
  const buffer = Buffer.alloc(1024 * 1024);
  let offset = 0;
  try {
    while (offset < size) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
      offset += count;
    }
  } finally {
    closeSync(fd);
  }
  if (offset !== size) throw new Error("Mooncite source prefix ended while hashing.");
  return hash.digest("hex");
}

function splitReadableText(value: string): string[] {
  const rendered = value.replace(
    PRESENTATION_CONTROL_REPLACEMENT_PATTERN,
    (character) => `\\u{${character.codePointAt(0)!.toString(16)}}`,
  );
  if (Buffer.byteLength(rendered, "utf8") <= MAX_EVIDENCE_TEXT_BYTES) return rendered.trim() ? [rendered] : [];
  const bytes = Buffer.from(rendered, "utf8");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    let end = Math.min(bytes.length, offset + MAX_EVIDENCE_TEXT_BYTES);
    let text = "";
    while (end > offset) {
      try {
        text = decoder.decode(bytes.subarray(offset, end));
        break;
      } catch {
        end--;
      }
    }
    if (end === offset) break;
    if (text.trim()) chunks.push(text);
    offset = end;
  }
  return chunks;
}

const ISO_EVENT_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_EVENT_TIMESTAMP.test(value)) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function eventTimestamp(origin: SourceOrigin, entry: Record<string, unknown>): string | null {
  if (origin !== "chatgpt") return normalizeIsoTimestamp(entry.timestamp);
  if (typeof entry.create_time !== "number" || !Number.isFinite(entry.create_time)) return null;
  const milliseconds = entry.create_time * 1_000;
  return Number.isFinite(milliseconds) && Number.isFinite(new Date(milliseconds).getTime())
    ? new Date(milliseconds).toISOString()
    : null;
}


function parseCompactionState(value: unknown): EvidenceCandidate["compactionState"] {
  switch (value) {
    case "pre_compaction":
    case "summary":
    case "kept_after_compaction":
      return value;
    default:
      return "none";
  }
}

function parseEvidenceRole(value: unknown): EvidenceRole {
  switch (value) {
    case "user":
    case "assistant":
    case "system":
    case "developer":
    case "tool":
    case "toolResult":
    case "summary":
    case "unknown":
      return value;
    default:
      return "unknown";
  }
}

function readableSpans(entry: Record<string, unknown>): Array<{ role: EvidenceRole; text: string }> {
  if (entry.type === "message") {
    const message = entry.message;
    if (!message || typeof message !== "object") return [];
    const value = message as Record<string, unknown>;
    const role = parseEvidenceRole(value.role);
    const content = value.content;
    if (typeof content === "string") return splitReadableText(content).map((text) => ({ role, text }));
    if (Array.isArray(content)) {
      return content.flatMap((part) => {
        if (!part || typeof part !== "object") return [];
        const value = part as Record<string, unknown>;
        return value.type === "text" && typeof value.text === "string"
          ? splitReadableText(value.text).map((text) => ({ role, text }))
          : [];
      });
    }
  }
  if ((entry.type === "compaction" || entry.type === "branch_summary") && typeof entry.summary === "string") {
    return splitReadableText(entry.summary).map((text) => ({ role: "summary", text }));
  }
  return [];
}

function readableClaudeSpans(entry: Record<string, unknown>): Array<{ role: EvidenceRole; text: string }> {
  if (entry.type !== "user" && entry.type !== "assistant") return [];
  const message = entry.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return [];
  const value = message as Record<string, unknown>;
  const role = entry.type;
  if (typeof value.content === "string") return splitReadableText(value.content).map((text) => ({ role, text }));
  if (!Array.isArray(value.content)) return [];
  return value.content.flatMap((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return [];
    const content = part as Record<string, unknown>;
    return content.type === "text" && typeof content.text === "string"
      ? splitReadableText(content.text).map((text) => ({ role, text }))
      : [];
  });
}

function readableCodexSpans(entry: Record<string, unknown>): Array<{ role: EvidenceRole; text: string }> {
  if (entry.type !== "event_msg" || !entry.payload || typeof entry.payload !== "object" || Array.isArray(entry.payload)) return [];
  const payload = entry.payload as Record<string, unknown>;
  if ((payload.type !== "user_message" && payload.type !== "agent_message") || typeof payload.message !== "string") return [];
  const role = payload.type === "user_message" ? "user" : "assistant";
  return splitReadableText(payload.message).map((text) => ({ role, text }));
}

function readableChatGptSpans(entry: Record<string, unknown>): Array<{ role: EvidenceRole; text: string }> {
  const author = entry.author;
  const content = entry.content;
  if (!author || typeof author !== "object" || Array.isArray(author)
    || !content || typeof content !== "object" || Array.isArray(content)) return [];
  const role = (author as Record<string, unknown>).role;
  if (role !== "user" && role !== "assistant") return [];
  const value = content as Record<string, unknown>;
  const contentType = value.content_type;
  if (contentType !== "text" && contentType !== "multimodal_text" && contentType !== "code") return [];
  const values: string[] = [];
  if (typeof value.text === "string") values.push(value.text);
  if (Array.isArray(value.parts)) {
    for (const part of value.parts) {
      if (typeof part === "string") values.push(part);
      else if (part && typeof part === "object" && !Array.isArray(part) && typeof (part as Record<string, unknown>).text === "string") {
        values.push(String((part as Record<string, unknown>).text));
      }
    }
  }
  return values.flatMap((text) => splitReadableText(text).map((span) => ({ role, text: span })));
}

interface ChatGptConversationSlice {
  bytes: Buffer;
  byteStart: number;
  byteEnd: number;
  line: number;
}


function isJsonWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}


function scanChatGptConversations(
  path: string,
  metadata: SourceMetadata,
  visit: (conversation: ChatGptConversationSlice) => void,
): { digest: string; physicalLines: number } {
  const fd = openVerifiedSource(path, metadata);
  if (fd === null) throw new Error("Mooncite ChatGPT source changed identity before indexing.");
  const buffer = Buffer.alloc(1024 * 1024);
  const digest = createHash("sha256");
  let fileOffset = 0;
  let line = 1;
  let lastByte: number | null = null;
  let root: "single" | "array" | null = null;
  let rootClosed = false;
  let completedSingle = false;
  let arrayState: "value-or-end" | "comma-or-end" = "value-or-end";
  let arrayHasValue = false;
  let capturing = false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objectStart = 0;
  let objectLine = 1;
  let objectBytes = 0;
  let parts: Buffer[] = [];
  try {
    while (fileOffset < metadata.size) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, metadata.size - fileOffset), fileOffset);
      if (count === 0) break;
      const chunk = buffer.subarray(0, count);
      digest.update(chunk);
      let activeChunkStart: number | null = capturing ? 0 : null;
      for (let index = 0; index < count; index++) {
        const byte = chunk[index]!;
        lastByte = byte;
        if (capturing) {
          if (inString) {
            if (escaped) escaped = false;
            else if (byte === 0x5c) escaped = true;
            else if (byte === 0x22) inString = false;
          } else if (byte === 0x22) {
            inString = true;
          } else if (byte === 0x7b || byte === 0x5b) {
            depth++;
          } else if (byte === 0x7d || byte === 0x5d) {
            depth--;
            if (depth < 0) throw new Error("Mooncite ChatGPT export has invalid JSON nesting.");
            if (depth === 0) {
              const segment = Buffer.from(chunk.subarray(activeChunkStart!, index + 1));
              parts.push(segment);
              objectBytes += segment.length;
              if (objectBytes > MAX_CHATGPT_CONVERSATION_BYTES) throw new Error("Mooncite ChatGPT conversation exceeds the size limit.");
              visit({
                bytes: parts.length === 1 ? parts[0]! : Buffer.concat(parts, objectBytes),
                byteStart: objectStart,
                byteEnd: fileOffset + index + 1,
                line: objectLine,
              });
              capturing = false;
              activeChunkStart = null;
              parts = [];
              objectBytes = 0;
              if (root === "single") completedSingle = true;
              else arrayState = "comma-or-end";
            }
          }
        } else if (!isJsonWhitespace(byte)) {
          if (root === null) {
            if (byte === 0x5b) root = "array";
            else if (byte === 0x7b) {
              root = "single";
              capturing = true;
              depth = 1;
              objectStart = fileOffset + index;
              objectLine = line;
              activeChunkStart = index;
            } else {
              throw new Error("Mooncite ChatGPT export must contain an object or an array of objects.");
            }
          } else if (root === "array" && !rootClosed) {
            if (arrayState === "value-or-end" && byte === 0x7b) {
              capturing = true;
              depth = 1;
              objectStart = fileOffset + index;
              objectLine = line;
              activeChunkStart = index;
              arrayHasValue = true;
            } else if (byte === 0x5d && (arrayState === "comma-or-end" || !arrayHasValue)) {
              rootClosed = true;
            } else if (arrayState === "comma-or-end" && byte === 0x2c) {
              arrayState = "value-or-end";
            } else {
              throw new Error("Mooncite ChatGPT export array contains an unsupported value.");
            }
          } else if (root === "single" && completedSingle) {
            throw new Error("Mooncite ChatGPT export contains trailing data.");
          } else if (rootClosed) {
            throw new Error("Mooncite ChatGPT export contains trailing data.");
          }
        }
        if (byte === 0x0a) line++;
      }
      if (capturing && activeChunkStart !== null) {
        const segment = Buffer.from(chunk.subarray(activeChunkStart, count));
        parts.push(segment);
        objectBytes += segment.length;
        if (objectBytes > MAX_CHATGPT_CONVERSATION_BYTES) throw new Error("Mooncite ChatGPT conversation exceeds the size limit.");
      }
      fileOffset += count;
    }
  } finally {
    closeSync(fd);
  }
  if (fileOffset !== metadata.size || capturing || root === null
    || (root === "single" && !completedSingle) || (root === "array" && !rootClosed)) {
    throw new Error("Mooncite ChatGPT export could not be captured completely.");
  }
  return {
    digest: digest.digest("hex"),
    physicalLines: metadata.size === 0 ? 0 : lastByte === 0x0a ? line - 1 : line,
  };
}

function recordIdentity(origin: SourceOrigin, entry: Record<string, unknown>, physicalLine: number, bytes: Buffer): string | null {
  if (origin === "claude-code") return isBoundedIdentifier(entry.uuid) ? entry.uuid : null;
  if (origin === "codex") return `line-${physicalLine}-${sha256(bytes).slice(0, 16)}`;
  return isBoundedIdentifier(entry.id) ? entry.id : null;
}

function recordMatchesIdentity(
  origin: SourceOrigin,
  entry: Record<string, unknown>,
  physicalLine: number,
  bytes: Buffer,
  expectedEntryId: string,
): boolean {
  if (recordIdentity(origin, entry, physicalLine, bytes) === expectedEntryId) return true;
  if (origin !== "chatgpt") return false;
  const mapping = entry.mapping;
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return false;
  return Object.values(mapping as Record<string, unknown>).some((rawNode) => {
    if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) return false;
    const message = (rawNode as Record<string, unknown>).message;
    return Boolean(message
      && typeof message === "object"
      && !Array.isArray(message)
      && (message as Record<string, unknown>).id === expectedEntryId);
  });
}

interface SourceLocation {
  origin: SourceOrigin;
  root: string;
  path: string;
  sourcePath: string;
  relativePath: string;
  discovery?: "automatic";
}

interface StoredSourceRow {
  source_path: string;
  source_origin: SourceOrigin;
  session_id: string;
  project: string;
  dev: string;
  ino: string;
  observed_size: number;
  admitted_bytes: number;
  mtime_ns: string;
  ctime_ns: string;
  source_root_digest: string;
  physical_lines: number;
  records: number;
  eligible_records: number;
  evidence_spans: number;
  skipped: number;
  malformed: number;
  oversized: number;
  errors: number;
  fatal_errors: number;
  leaf_entry_id: string | null;
  latest_compaction_line: number | null;
  prefix_digest: string;
  source_generation: string;
  trust_state: TrustState;
}
function sourceLocation(origin: SourceOrigin, root: string, path: string, discovery?: "automatic"): SourceLocation {
  const canonicalRoot = resolve(root);
  const canonicalPath = resolve(path);
  if (!canonicalPath.startsWith(`${canonicalRoot}${sep}`)) throw new Error("Mooncite source escapes its authorized root.");
  const relativePath = relative(canonicalRoot, canonicalPath).split(sep).join("/");
  return {
    origin,
    root: canonicalRoot,
    path: canonicalPath,
    sourcePath: `${origin}/${sourceAuthorizationDigest(canonicalRoot, discovery)}/${relativePath}`,
    relativePath,
    ...(discovery ? { discovery } : {}),
  };
}


function sourceMetadata(path: string, root: string): SourceMetadata | null {
  const canonicalRoot = resolve(root);
  const canonicalPath = resolve(path);
  if (!canonicalPath.startsWith(`${canonicalRoot}${sep}`)) return null;
  let metadata: BigIntStats;
  try {
    if (hasSymlinkComponent(canonicalRoot) || hasSymlinkComponent(canonicalPath)) return null;
    metadata = lstatSync(canonicalPath, { bigint: true });
  } catch {
    return null;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
  const size = Number(metadata.size);
  if (!Number.isSafeInteger(size) || size < 0) return null;
  return {
    root: canonicalRoot,
    dev: metadata.dev.toString(),
    ino: metadata.ino.toString(),
    size,
    mtimeNs: metadata.mtimeNs.toString(),
    ctimeNs: metadata.ctimeNs.toString(),
  };
}

function openVerifiedSource(path: string, expected: SourceMetadata, allowGrowth = false): number | null {
  let rootFd: number | null = null;
  let fd: number | null = null;
  const matchesOpened = (opened: BigIntStats): boolean =>
    opened.isFile()
    && opened.dev.toString() === expected.dev
    && opened.ino.toString() === expected.ino
    && (allowGrowth
      ? Number(opened.size) >= expected.size
      : Number(opened.size) === expected.size
        && opened.mtimeNs.toString() === expected.mtimeNs
        && opened.ctimeNs.toString() === expected.ctimeNs);
  try {
    const absolutePath = resolve(path);
    const relativePath = relative(expected.root, absolutePath);
    if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`)) return null;
    if (process.platform !== "linux" || !existsSync("/proc/self/fd")) return null;
    rootFd = openSync(expected.root, constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0));
    const pinnedRoot = realpathSync(`/proc/self/fd/${rootFd}`);
    if (pinnedRoot !== expected.root) return null;
    fd = openSync(`/proc/self/fd/${rootFd}/${relativePath}`, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const openedPath = realpathSync(`/proc/self/fd/${fd}`);
    if (!openedPath.startsWith(`${pinnedRoot}${sep}`) || !matchesOpened(fstatSync(fd, { bigint: true }))) return null;
    const verified = fd;
    fd = null;
    return verified;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
    if (rootFd !== null) closeSync(rootFd);
  }
}

function coherentAppend(path: string, root: string, start: number): { bytes: Buffer; capturedSize: number; metadata: SourceMetadata } | null {
  const before = sourceMetadata(path, root);
  if (!before || before.size < start) return null;
  const capturedSize = before.size;
  const readSuffix = (): Buffer | null => {
    const size = capturedSize - start;
    const fd = openVerifiedSource(path, before, true);
    if (fd === null) return null;
    const bytes = Buffer.alloc(size);
    let offset = 0;
    try {
      while (offset < size) {
        const count = readSync(fd, bytes, offset, size - offset, start + offset);
        if (count === 0) break;
        offset += count;
      }
    } finally {
      closeSync(fd);
    }
    return bytes.subarray(0, offset);
  };
  const first = readSuffix();
  if (!first || first.length !== capturedSize - start) return null;
  const after = sourceMetadata(path, root);
  if (!after || before.dev !== after.dev || before.ino !== after.ino || after.size < capturedSize) return null;
  const changed = before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs;
  if (changed) {
    const second = readSuffix();
    if (!second || !first.equals(second)) return null;
  }
  const finalLf = first.lastIndexOf(0x0a);
  return {
    bytes: finalLf < 0 ? Buffer.alloc(0) : first.subarray(0, finalLf + 1),
    capturedSize,
    metadata: before,
  };
}

function parseAppend(
  location: SourceLocation,
  stored: StoredSourceRow,
  existingEntryIds: Set<string>,
): SourceSnapshot | "requires_full" | null {
  const captured = coherentAppend(location.path, location.root, stored.admitted_bytes);
  if (!captured) return null;
  const lines: Array<{ bytes: Buffer; start: number; end: number }> = [];
  let start = 0;
  for (let index = 0; index < captured.bytes.length; index++) {
    if (captured.bytes[index] !== 0x0a) continue;
    if (lines.length >= MAX_APPEND_LINES) return "requires_full";
    lines.push({
      bytes: captured.bytes.subarray(start, index),
      start: stored.admitted_bytes + start,
      end: stored.admitted_bytes + index,
    });
    start = index + 1;
  }
  const entries: SourceRecord[] = [];
  const evidence: IndexedEvidence[] = [];
  let records = stored.records;
  let eligibleRecords = stored.eligible_records;
  let skipped = stored.skipped;
  let malformed = stored.malformed;
  let oversized = stored.oversized;
  let errors = stored.errors;
  let leafEntryId = stored.leaf_entry_id;
  let expectedParentId = stored.leaf_entry_id;
  let linearAppend = true;
  let latestCompactionLine = stored.latest_compaction_line;
  const newAdmittedBytes = stored.admitted_bytes + captured.bytes.length;
  const prefixDigest = captured.bytes.length === 0
    ? stored.prefix_digest
    : `append-chain:${sha256(`append-v1:${stored.prefix_digest}:${sha256(captured.bytes)}:${newAdmittedBytes}`)}`;
  const sourceNamespace = citationNamespace(stored.source_root_digest, stored.source_path);

  for (let index = 0; index < lines.length; index++) {
    const physical = lines[index]!;
    const physicalLine = stored.physical_lines + index + 1;
    if (physical.bytes.length > MAX_LINE_BYTES) {
      skipped++;
      oversized++;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(physical.bytes.toString("utf8")) as unknown;
    } catch {
      skipped++;
      malformed++;
      errors++;
      continue;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      skipped++;
      malformed++;
      errors++;
      continue;
    }
    const entry = parsed as Record<string, unknown>;
    records++;
    const parentId = entry.parentId === null || entry.parentId === undefined
      ? null
      : isBoundedIdentifier(entry.parentId) ? entry.parentId : undefined;
    if (!isBoundedIdentifier(entry.id) || !isBoundedIdentifier(entry.type, MAX_SOURCE_KIND_BYTES) || parentId === undefined) {
      skipped++;
      malformed++;
      errors++;
      continue;
    }
    if (existingEntryIds.has(entry.id)) {
      skipped++;
      errors++;
      continue;
    }
    existingEntryIds.add(entry.id);
    eligibleRecords++;
    if (parentId !== expectedParentId) linearAppend = false;
    expectedParentId = entry.id;
    entries.push({ entryId: entry.id, parentId, line: physicalLine, sourceKind: entry.type });
    leafEntryId = entry.id;
    if (entry.type === "compaction") latestCompactionLine = physicalLine;
    const spans = readableSpans(entry);
    for (let ordinal = 0; ordinal < spans.length; ordinal++) {
      const span = spans[ordinal]!;
      evidence.push({
        evidenceId: evidenceId(location.origin, sourceNamespace, stored.session_id, entry.id, ordinal),
        evidenceUri: evidenceUri(location.origin, sourceNamespace, stored.session_id, entry.id, ordinal),
        excerpt: span.text,
        text: span.text,
        project: stored.project,
        sessionId: stored.session_id,
        entryId: entry.id,
        role: span.role,
        sourceOrigin: location.origin,
        sourceKind: entry.type,
        eventTimestamp: eventTimestamp(location.origin, entry),
        sourcePath: location.sourcePath,
        line: physicalLine,
        byteStart: physical.start,
        byteEnd: physical.end,
        recordDigest: sha256(physical.bytes),
        prefixDigest,
        parentId,
        branchState: "off_branch",
        compactionState: "none",
      });
    }
  }

  const compactionChanged = latestCompactionLine !== stored.latest_compaction_line;
  const requiresRelabel = !linearAppend || compactionChanged;
  for (const item of evidence) {
    item.branchState = linearAppend ? "current" : "off_branch";
    item.compactionState = item.sourceKind === "compaction" || item.sourceKind === "branch_summary"
      ? "summary"
      : latestCompactionLine === null
        ? "none"
        : item.line < latestCompactionLine
          ? "pre_compaction"
          : "kept_after_compaction";
  }
  const sourceGeneration = requiresRelabel
    ? stored.source_generation
    : evidence.length === 0
      ? stored.source_generation
      : sha256(`append-generation-v1:${stored.source_generation}:${evidenceGeneration(evidence)}`);

  return {
    sourceOrigin: location.origin,
    sourcePath: stored.source_path,
    sourceRootDigest: sourceAuthorizationDigest(location.root, location.discovery),
    sessionId: stored.session_id,
    project: stored.project,
    dev: captured.metadata.dev,
    ino: captured.metadata.ino,
    observedSize: captured.capturedSize,
    admittedBytes: newAdmittedBytes,
    mtimeNs: captured.metadata.mtimeNs,
    ctimeNs: captured.metadata.ctimeNs,
    physicalLines: stored.physical_lines + lines.length,
    records,
    eligibleRecords,
    evidenceSpans: stored.evidence_spans + evidence.length,
    skipped,
    malformed,
    oversized,
    errors,
    fatalErrors: 0,
    leafEntryId,
    latestCompactionLine,
    prefixDigest,
    sourceGeneration,
    trustState: captured.bytes.length > 0 ? "append_trusted" : stored.trust_state,
    entries,
    evidence,
    requiresRelabel,
  };
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

let expectedDatabaseSchemaFingerprint: string | null = null;
function canonicalDatabaseSchemaFingerprint(): string {
  if (expectedDatabaseSchemaFingerprint !== null) return expectedDatabaseSchemaFingerprint;
  const canonical = new DatabaseSync(":memory:");
  try {
    canonical.exec(DATABASE_SCHEMA);
    expectedDatabaseSchemaFingerprint = databaseSchemaFingerprint(canonical);
    return expectedDatabaseSchemaFingerprint;
  } finally {
    canonical.close();
  }
}

function validateDatabaseSchema(database: DatabaseSync): void {
  if (databaseSchemaFingerprint(database) !== canonicalDatabaseSchemaFingerprint()) {
    throw new Error("Mooncite derived schema is corrupt: incompatible canonical schema.");
  }
}
function assertLegacyMoonciteStateDirectory(stateDir: string, databasePath: string): void {
  const allowed = new Set(["index.sqlite", "index.sqlite-journal", "index.sqlite-shm", "index.sqlite-wal"]);
  const entries = readdirSync(stateDir);
  if (!entries.includes("index.sqlite") || entries.some((entry) => !allowed.has(entry))) {
    throw new Error("Mooncite state directory is not marked as Mooncite-owned.");
  }
  for (const entry of entries) assertOwnedStateFile(join(stateDir, entry));
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const tables = new Set((database.prepare("SELECT name FROM sqlite_schema WHERE type IN ('table', 'view')").all() as Array<{ name: string }>)
      .map((row) => row.name));
    const derivation = database.prepare("SELECT value FROM metadata WHERE key = 'derivation_version'").get() as { value?: string } | undefined;
    if (!["metadata", "source_files", "source_records", "evidence"].every((name) => tables.has(name))
      || !derivation?.value || !/^\d+$/u.test(derivation.value)) {
      throw new Error("Mooncite legacy derived state identity is invalid.");
    }
  } catch (error) {
    throw new Error("Mooncite state directory is not marked as Mooncite-owned.", { cause: error });
  } finally {
    database?.close();
  }
}

function openInitializedDatabase(path: string): DatabaseSync {
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(path);
    database.exec(DATABASE_SCHEMA);
    validateDatabaseSchema(database);
    database.prepare("SELECT value FROM metadata WHERE key = 'last_good'").get();
    return database;
  } catch (error) {
    try { database?.close(); } catch { /* The failed derived database is disposable. */ }
    throw error;
  }
}

function isRecoverableDatabaseCorruption(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /malformed|not a database|schema is corrupt|incompatible canonical schema|no such column|has no column named|unsupported file format|integrity check failed/iu.test(message);
}

function isDatabaseBusy(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /database is locked|database is busy|SQLITE_BUSY/iu.test(message);
}

export class MoonciteEngine {
  readonly #baseRoots: Array<{ origin: SourceOrigin; root: string; discovery?: "automatic" }>;
  readonly #optionalSourcesProvider: () => SourceRegistration[];
  readonly #stateDir: string;
  readonly #databasePath: string;
  readonly #db: DatabaseSync;
  readonly #engineLockPath: string;
  #last: ScanResult = { evidence: [], sourceFiles: 0, records: 0, eligibleRecords: 0, skipped: 0, malformed: 0, oversized: 0, errors: 0, fatalErrors: 0, generation: "empty", trustState: "full_verified", coverage: "complete", retainedLastGood: false, errorGroups: [] };
  #lastEvidenceCount = 0;
  #lastRefreshOutcome: RefreshOutcome = "not_run";
  #ingestionBytes = 0;
  #ingestionRecords = 0;
  #ingestionEvidenceSpans = 0;
  #ingestionWorkUnits = 0;
  #appendBatchBytes = 0;
  #appendBatchRecords = 0;
  #appendBatchEvidenceSpans = 0;
  #lastRebuildOutcome: RefreshOutcome = "not_run";
  #lastSuccessfulRefreshAt: string | null = null;

  constructor(options: EngineOptions) {
    if (options.optionalSources && options.optionalSourcesProvider) {
      throw new Error("Mooncite optional sources must use either a fixed list or a provider.");
    }
    if (process.platform !== "linux" || !existsSync("/proc/self/fd")) {
      throw new Error("Mooncite requires Linux procfs for race-safe source containment.");
    }
    this.#baseRoots = [
      { origin: "pi", root: resolve(options.sessionsRoot) },
      ...(options.ompSessionsRoot ? [{ origin: "omp" as const, root: resolve(options.ompSessionsRoot) }] : []),
    ];
    const fixedOptionalSources = [...(options.optionalSources ?? [])];
    this.#optionalSourcesProvider = options.optionalSourcesProvider ?? (() => fixedOptionalSources);
    this.#stateDir = resolve(options.stateDir);
    if (hasSymlinkComponent(this.#stateDir)) throw new Error("Mooncite state path contains a symbolic-link component.");
    this.#configuredRoots();
    if (existsSync(this.#stateDir)) {
      const state = lstatSync(this.#stateDir);
      if (state.isSymbolicLink() || !state.isDirectory()) throw new Error("Mooncite state path is not an owned regular directory.");
    }
    mkdirSync(this.#stateDir, { recursive: true, mode: 0o700 });
    const stateIdentity = assertOwnedStateDirectory(this.#stateDir);
    this.#databasePath = join(this.#stateDir, "index.sqlite");
    const stateMarkerPath = join(this.#stateDir, MOONCITE_STATE_MARKER_NAME);
    if (!existsSync(stateMarkerPath)) {
      if (readdirSync(this.#stateDir).length !== 0) {
        assertLegacyMoonciteStateDirectory(this.#stateDir, this.#databasePath);
      }
      try {
        writeFileSync(stateMarkerPath, MOONCITE_STATE_MARKER_CONTENT, { encoding: "utf8", flag: "wx", mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    assertStateMarker(stateMarkerPath);
    const engineLockPath = join(this.#stateDir, `.engine-${process.pid}-${randomUUID()}.lock`);
    let database: DatabaseSync | null = null;
    try {
      if (existsSync(join(this.#stateDir, ".purge.lock"))) throw new Error("Mooncite state purge is in progress.");
      cleanupStaleEngineLocks(this.#stateDir);
      writeFileSync(engineLockPath, `${process.pid}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      if (existsSync(join(this.#stateDir, ".purge.lock"))) throw new Error("Mooncite state purge is in progress.");
      this.#engineLockPath = engineLockPath;
    if (!existsSync(this.#databasePath)) {
      const databaseFd = openSync(this.#databasePath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600);
      closeSync(databaseFd);
    }
    if (existsSync(this.#databasePath)) {
      assertOwnedStateFile(this.#databasePath);
      chmodSync(this.#databasePath, 0o600);
    }
    try {
      assertOwnedStateDirectory(this.#stateDir, stateIdentity);
      database = openInitializedDatabase(this.#databasePath);
    } catch (error) {
      assertOwnedStateDirectory(this.#stateDir, stateIdentity);
      if (!existsSync(this.#databasePath) || !isRecoverableDatabaseCorruption(error)) throw error;
      assertOwnedStateFile(this.#databasePath);
      const sidecars = ["-journal", "-shm", "-wal"].map((suffix) => `${this.#databasePath}${suffix}`);
      for (const sidecar of sidecars) {
        if (existsSync(sidecar)) assertOwnedStateFile(sidecar);
      }
      rmSync(this.#databasePath, { force: true });
      for (const sidecar of sidecars) rmSync(sidecar, { force: true });
      assertOwnedStateDirectory(this.#stateDir, stateIdentity);
      const replacementFd = openSync(this.#databasePath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600);
      closeSync(replacementFd);
      database = openInitializedDatabase(this.#databasePath);
    }
    assertOwnedStateDirectory(this.#stateDir, stateIdentity);
    assertOwnedStateFile(this.#databasePath);
    if (database === null) throw new Error("Mooncite index initialization failed.");
    this.#db = database;
    chmodSync(this.#databasePath, 0o600);
    const derivation = this.#db.prepare("SELECT value FROM metadata WHERE key = 'derivation_version'").get() as { value?: string } | undefined;
    if (derivation?.value !== DERIVATION_VERSION) {
      this.#db.exec("BEGIN IMMEDIATE");
      try {
        const current = this.#db.prepare("SELECT value FROM metadata WHERE key = 'derivation_version'").get() as { value?: string } | undefined;
        if (current?.value !== DERIVATION_VERSION) {
          this.#db.exec("DELETE FROM evidence; DELETE FROM source_records; DELETE FROM source_files; DELETE FROM metadata WHERE key = 'last_good';");
          this.#db.prepare("INSERT OR REPLACE INTO metadata(key, value) VALUES ('derivation_version', ?)").run(DERIVATION_VERSION);
        }
        this.#db.exec("COMMIT");
      } catch (error) {
        this.#db.exec("ROLLBACK");
        throw error;
      }
    }
    const stored = this.#db.prepare("SELECT value FROM metadata WHERE key = 'last_good'").get() as { value?: string } | undefined;
    if (stored?.value) {
      try {
        const state = JSON.parse(stored.value) as Omit<ScanResult, "evidence" | "malformed" | "oversized" | "trustState" | "errorGroups"> & {
          evidenceSpans: number;
          malformed?: number;
          oversized?: number;
          lastRefreshOutcome?: RefreshOutcome;
          lastRebuildOutcome?: RefreshOutcome;
          trustState?: TrustState;
          coverage?: CoverageState;
          errorGroups?: unknown;
        };
        this.#last = {
          evidence: [],
          sourceFiles: state.sourceFiles,
          records: state.records,
          eligibleRecords: state.eligibleRecords ?? state.records,
          skipped: state.skipped,
          malformed: state.malformed ?? 0,
          oversized: state.oversized ?? 0,
          errors: state.errors,
          fatalErrors: state.fatalErrors,
          generation: state.generation,
          trustState: state.trustState ?? "full_verified",
          coverage: state.coverage ?? "complete",
          retainedLastGood: state.retainedLastGood,
          errorGroups: persistedErrorGroups(state.errorGroups, state.errors, state.fatalErrors),
        };
        this.#lastEvidenceCount = state.evidenceSpans;
        this.#lastRefreshOutcome = state.lastRefreshOutcome ?? "not_run";
        this.#lastRebuildOutcome = state.lastRebuildOutcome ?? "not_run";
      } catch {
        // A malformed derived metadata row is rebuildable and carries no authority.
      }
    }
    const storedRebuild = this.#db.prepare("SELECT value FROM metadata WHERE key = 'last_rebuild_outcome'").get() as { value?: string } | undefined;
    if (storedRebuild?.value && ["not_run", "published", "unchanged", "retained_last_good", "unavailable"].includes(storedRebuild.value)) {
      this.#lastRebuildOutcome = storedRebuild.value as RefreshOutcome;
    }
    const storedRefreshAt = this.#db.prepare("SELECT value FROM metadata WHERE key = 'last_successful_refresh_at'").get() as { value?: string } | undefined;
    if (storedRefreshAt?.value && Number.isFinite(Date.parse(storedRefreshAt.value))) {
      this.#lastSuccessfulRefreshAt = storedRefreshAt.value;
    }
    } catch (error) {
      try { database?.close(); } catch { /* Preserve the constructor failure. */ }
      rmSync(engineLockPath, { force: true });
      throw error;
    }
  }
  #resetIngestionBudget(): void {
    this.#ingestionBytes = 0;
    this.#ingestionRecords = 0;
    this.#ingestionEvidenceSpans = 0;
    this.#ingestionWorkUnits = 0;
    this.#appendBatchBytes = 0;
    this.#appendBatchRecords = 0;
    this.#appendBatchEvidenceSpans = 0;
  }

  #consumeIngestion(bytes: number, records: number, evidenceSpans: number): void {
    if (bytes < 0 || records < 0 || evidenceSpans < 0
      || this.#ingestionBytes + bytes > MAX_REFRESH_SOURCE_BYTES
      || this.#ingestionRecords + records > MAX_REFRESH_RECORDS
      || this.#ingestionEvidenceSpans + evidenceSpans > MAX_REFRESH_EVIDENCE_SPANS) {
      throw new Error("Mooncite refresh exceeded its ingestion budget.");
    }
    this.#ingestionBytes += bytes;
    this.#ingestionRecords += records;
    this.#ingestionEvidenceSpans += evidenceSpans;
  }

  #consumeIngestionWork(): void {
    if (++this.#ingestionWorkUnits > MAX_REFRESH_WORK_UNITS) {
      throw new Error("Mooncite refresh exceeded its work budget.");
    }
  }

  #tryConsumeAppendBatch(bytes: number, records: number, evidenceSpans: number): boolean {
    if (bytes < 0 || records < 0 || evidenceSpans < 0
      || this.#appendBatchBytes + bytes > MAX_APPEND_BATCH_BYTES
      || this.#appendBatchRecords + records > MAX_APPEND_BATCH_RECORDS
      || this.#appendBatchEvidenceSpans + evidenceSpans > MAX_APPEND_BATCH_EVIDENCE_SPANS) {
      return false;
    }
    this.#consumeIngestion(bytes, records, evidenceSpans);
    this.#appendBatchBytes += bytes;
    this.#appendBatchRecords += records;
    this.#appendBatchEvidenceSpans += evidenceSpans;
    return true;
  }

  #consumeIngestionRecord(): void {
    this.#consumeIngestion(0, 1, 0);
  }

  #consumeIngestionEvidenceSpan(): void {
    this.#consumeIngestion(0, 0, 1);
  }

  #configuredRoots(): Array<{ origin: SourceOrigin; root: string; discovery?: "automatic" }> {
    const optionalSources = this.#optionalSourcesProvider();
    if (!Array.isArray(optionalSources)) throw new Error("Mooncite optional source provider returned invalid configuration.");
    const roots = [
      ...this.#baseRoots,
      ...optionalSources.map((source) => ({
        origin: source.origin,
        root: resolve(source.root),
        ...(source.discovery ? { discovery: source.discovery } : {}),
      })),
    ];
    if (roots.some((source) => hasSymlinkComponent(source.root))) {
      throw new Error("Mooncite source root contains a symbolic-link component.");
    }
    if (new Set(roots.map((source) => source.root)).size !== roots.length) {
      throw new Error("Mooncite source roots must be distinct.");
    }
    if (roots.some((source) => pathsOverlap(source.root, this.#stateDir))) {
      throw new Error("Mooncite source roots and derived-state directory must be disjoint.");
    }
    return roots;
  }

  #setOperationOutcome(operation: "refresh" | "rebuild", outcome: RefreshOutcome): void {
    if (operation === "refresh") this.#lastRefreshOutcome = outcome;
    else this.#lastRebuildOutcome = outcome;
    if (outcome === "published" || outcome === "unchanged") {
      this.#lastSuccessfulRefreshAt = new Date().toISOString();
      try {
        this.#db.prepare("INSERT OR REPLACE INTO metadata(key, value) VALUES ('last_successful_refresh_at', ?)")
          .run(this.#lastSuccessfulRefreshAt);
      } catch {
        // Refresh success remains valid when the optional diagnostic timestamp cannot be recorded.
      }
    }
  }

  #stateForInteractiveRead(): ScanResult {
    if (this.#last.generation === "empty" && this.#last.sourceFiles === 0) return this.refresh();
    return this.#last;
  }

  refresh(): ScanResult {
    return this.#performRefresh("refresh", false);
  }

  #storedSources(): StoredSourceRow[] {
    return this.#db.prepare("SELECT * FROM source_files ORDER BY source_path").all() as unknown as StoredSourceRow[];
  }
  #locationForStored(source: Pick<StoredSourceRow, "source_path" | "source_origin" | "source_root_digest">): SourceLocation | null {
    try {
      const configured = this.#configuredRoots().find((root) =>
        root.origin === source.source_origin
        && source.source_root_digest === sourceAuthorizationDigest(root.root, root.discovery));
      if (!configured) return null;
      const prefix = `${source.source_origin}/${source.source_root_digest}/`;
      if (!source.source_path.startsWith(prefix)) return null;
      const relativePath = source.source_path.slice(prefix.length);
      if (!relativePath) return null;
      const location = sourceLocation(source.source_origin, configured.root, resolve(configured.root, relativePath), configured.discovery);
      return location.sourcePath === source.source_path ? location : null;
    } catch {
      return null;
    }
  }

  #scanSources(stored: StoredSourceRow[]): {
    locations: SourceLocation[];
    errorGroups: MoonciteStatusErrorGroup[];
    blocked: boolean;
  } {
    const locations: SourceLocation[] = [];
    const errorGroups: MoonciteStatusErrorGroup[] = [];
    let discoveredBytes = 0;
    let blocked = false;
    let roots: Array<{ origin: SourceOrigin; root: string; discovery?: "automatic" }>;
    try {
      roots = this.#configuredRoots();
    } catch {
      return {
        locations,
        errorGroups: [sourceError("unknown", "source_configuration_failure")],
        blocked: true,
      };
    }
    for (const configured of roots) {
      const rootExists = existsSync(configured.root);
      let rootState: Stats | null = null;
      try {
        rootState = rootExists ? lstatSync(configured.root) : null;
      } catch {
        errorGroups.push(sourceError(configured.origin, "source_root_unavailable"));
        blocked = true;
        continue;
      }
      const unauthorized = hasSymlinkComponent(configured.root)
        || Boolean(rootState && (rootState.isSymbolicLink() || !rootState.isDirectory()));
      if (unauthorized || (!rootExists && stored.some((source) =>
        source.source_root_digest === sourceAuthorizationDigest(configured.root, configured.discovery)))) {
        errorGroups.push(sourceError(configured.origin, "source_root_unavailable"));
        blocked = true;
        continue;
      }
      if (!rootExists) continue;
      const scan = listSourceFiles(configured.origin, configured.root);
      for (const error of scan.errors) {
        errorGroups.push(sourceError(configured.origin, error.reason, error.count));
      }
      for (const path of scan.files) {
        const metadata = sourceMetadata(path, configured.root);
        if (!metadata) {
          errorGroups.push(sourceError(configured.origin, "source_metadata_failure"));
          continue;
        }
        if (locations.length >= MAX_DISCOVERED_SOURCE_FILES || discoveredBytes + metadata.size > MAX_REFRESH_SOURCE_BYTES) {
          errorGroups.push(sourceError(configured.origin, "source_limit_exceeded"));
          continue;
        }
        locations.push(sourceLocation(configured.origin, configured.root, path, configured.discovery));
        discoveredBytes += metadata.size;
      }
    }
    locations.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
    return { locations, errorGroups: mergeErrorGroups(errorGroups), blocked };
  }


  #stateFromSourceFiles(): ScanResult {
    const sources = this.#storedSources();
    const total = (key: keyof StoredSourceRow): number => sources.reduce((sum, source) => sum + Number(source[key] ?? 0), 0);
    return {
      evidence: [],
      sourceFiles: sources.length,
      records: total("records"),
      eligibleRecords: total("eligible_records"),
      skipped: total("skipped"),
      malformed: total("malformed"),
      oversized: total("oversized"),
      errors: total("errors"),
      fatalErrors: total("fatal_errors"),
      generation: aggregateGeneration(sources.map((source) => ({ sourcePath: source.source_path, sourceGeneration: source.source_generation }))),
      trustState: sources.some((source) => source.trust_state === "append_trusted") ? "append_trusted" : "full_verified",
      coverage: "complete",
      retainedLastGood: false,
      errorGroups: mergeErrorGroups(...sources
        .filter((source) => source.errors > 0)
        .map((source) => [sourceError(
          source.source_origin,
          "source_read_or_parse_failure",
          source.errors,
          source.fatal_errors,
        )])),
    };
  }

  #persistLastGood(state: ScanResult, operation: "refresh" | "rebuild", outcome: RefreshOutcome): void {
    const persisted = JSON.stringify({
      sourceFiles: state.sourceFiles,
      records: state.records,
      eligibleRecords: state.eligibleRecords,
      skipped: state.skipped,
      malformed: state.malformed,
      oversized: state.oversized,
      errors: state.errors,
      fatalErrors: state.fatalErrors,
      errorGroups: state.errorGroups,
      generation: state.generation,
      trustState: state.trustState,
      coverage: state.coverage,
      retainedLastGood: false,
      evidenceSpans: this.#storedSources().reduce((sum, source) => sum + source.evidence_spans, 0),
      lastRefreshOutcome: operation === "refresh" ? outcome : this.#lastRefreshOutcome,
      lastRebuildOutcome: operation === "rebuild" ? outcome : this.#lastRebuildOutcome,
    });
    this.#db.prepare("INSERT OR REPLACE INTO metadata(key, value) VALUES ('last_good', ?)").run(persisted);
  }

  #writeSource(source: SourceSnapshot): void {
    this.#db.prepare(`INSERT OR REPLACE INTO source_files VALUES (${Array.from({ length: 25 }, () => "?").join(", ")})`).run(
      source.sourcePath, source.sourceOrigin, source.sourceRootDigest, source.sessionId, source.project, source.dev, source.ino, source.observedSize,
      source.admittedBytes, source.mtimeNs, source.ctimeNs, source.physicalLines, source.records,
      source.eligibleRecords, source.evidenceSpans, source.skipped, source.malformed, source.oversized,
      source.errors, source.fatalErrors, source.leafEntryId, source.latestCompactionLine,
      source.prefixDigest, source.sourceGeneration, source.trustState,
    );
  }

  #insertEvidence(items: IndexedEvidence[]): void {
    const insertEvidence = this.#db.prepare(`INSERT INTO evidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of items) {
      insertEvidence.run(
        item.evidenceId, item.evidenceUri, item.text, item.project, item.sessionId, item.entryId, item.role,
        item.sourceOrigin, item.sourceKind, item.eventTimestamp, item.sourcePath, item.line, item.byteStart,
        item.byteEnd, item.recordDigest, item.prefixDigest, item.parentId, item.branchState, item.compactionState,
      );
    }
  }

  #indexFullChatGptSource(location: SourceLocation): SourceSnapshot {
    const { path, sourcePath } = location;
    const sourceRootDigest = sourceAuthorizationDigest(location.root, location.discovery);
    const sourceNamespace = citationNamespace(sourceRootDigest, sourcePath);
    const metadata = sourceMetadata(path, location.root);
    if (!metadata) throw new Error("Mooncite ChatGPT source is not a regular file.");
    this.#consumeIngestion(metadata.size, 0, 0);
    const captureSize = metadata.size;
    const insertRecord = this.#db.prepare("INSERT INTO source_records(source_path, entry_id, parent_id, line, source_kind) VALUES (?, ?, ?, ?, ?)");
    const insertEvidence = this.#db.prepare(`INSERT INTO evidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const findEvidence = this.#db.prepare("SELECT 1 AS found FROM evidence WHERE evidence_id = ?");
    const seenEntryIds = new Set<string>();
    let conversationCount = 0;
    let firstSessionId: string | null = null;
    let firstProject: string | null = null;
    let records = 0;
    let eligibleRecords = 0;
    let evidenceSpans = 0;
    let skipped = 0;
    let malformed = 0;
    let errors = 0;

    const scanned = scanChatGptConversations(path, metadata, (conversation) => {
      this.#consumeIngestionWork();
      let parsed: unknown;
      try {
        parsed = JSON.parse(conversation.bytes.toString("utf8")) as unknown;
      } catch {
        throw new Error("Mooncite ChatGPT conversation is invalid JSON.");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Mooncite ChatGPT export contains an invalid conversation.");
      }
      const document = parsed as Record<string, unknown>;
      const sessionId = isBoundedIdentifier(document.conversation_id)
        ? document.conversation_id
        : isBoundedIdentifier(document.id) ? document.id : null;
      const mapping = document.mapping;
      if (sessionId === null || !mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
        throw new Error("Mooncite ChatGPT conversation identity or message graph is invalid.");
      }
      conversationCount++;
      this.#consumeIngestionRecord();
      records++;
      firstSessionId ??= sessionId;
      const title = typeof document.title === "string" && document.title.trim() ? document.title : "ChatGPT";
      const project = projectIdentity(title);
      firstProject ??= project;

      interface ChatGptNode {
        nodeId: string;
        parentNodeId: string | null;
        messageId: string;
        message: Record<string, unknown>;
      }
      const nodes = new Map<string, ChatGptNode>();
      for (const [nodeId, rawNode] of Object.entries(mapping as Record<string, unknown>)) {
        this.#consumeIngestionRecord();
        records++;
        if (!isBoundedIdentifier(nodeId) || !rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) continue;
        const node = rawNode as Record<string, unknown>;
        const message = node.message;
        if (!message || typeof message !== "object" || Array.isArray(message)) continue;
        const messageId = isBoundedIdentifier((message as Record<string, unknown>).id)
          ? String((message as Record<string, unknown>).id)
          : null;
        const parentNodeId = node.parent === null || node.parent === undefined
          ? null
          : isBoundedIdentifier(node.parent) ? node.parent : null;
        if (messageId === null) continue;
        const value: ChatGptNode = { nodeId, parentNodeId, messageId, message: message as Record<string, unknown> };
        nodes.set(nodeId, value);
      }
      const currentNode = isBoundedIdentifier(document.current_node)
        ? document.current_node
        : isBoundedIdentifier(document.currentNode) ? document.currentNode : null;
      const currentBranch = new Set<string>();
      if (currentNode !== null) {
        let cursor: string | null = currentNode;
        while (cursor !== null && !currentBranch.has(cursor)) {
          currentBranch.add(cursor);
          const raw: unknown = (mapping as Record<string, unknown>)[cursor];
          cursor = raw && typeof raw === "object" && !Array.isArray(raw) && isBoundedIdentifier((raw as Record<string, unknown>).parent)
            ? String((raw as Record<string, unknown>).parent)
            : null;
        }
      }
      const nearestMessageAncestor = new Map<string, string | null>();
      const parentMessageId = (node: ChatGptNode): string | null => {
        const path: string[] = [];
        const visited = new Set<string>();
        let cursor = node.parentNodeId;
        let result: string | null = null;
        while (cursor !== null && !visited.has(cursor)) {
          const cached = nearestMessageAncestor.get(cursor);
          if (cached !== undefined || nearestMessageAncestor.has(cursor)) {
            result = cached ?? null;
            break;
          }
          visited.add(cursor);
          path.push(cursor);
          const parent = nodes.get(cursor);
          if (parent) {
            result = parent.messageId;
            break;
          }
          const raw: unknown = (mapping as Record<string, unknown>)[cursor];
          cursor = raw && typeof raw === "object" && !Array.isArray(raw) && isBoundedIdentifier((raw as Record<string, unknown>).parent)
            ? String((raw as Record<string, unknown>).parent)
            : null;
        }
        for (const traversed of path) nearestMessageAncestor.set(traversed, result);
        return result;
      };

      const conversationDigest = sha256(conversation.bytes);
      for (const node of nodes.values()) {
        const message = node.message;
        const entryId = node.messageId;
        if (seenEntryIds.has(entryId)) {
          skipped++;
          errors++;
          continue;
        }
        seenEntryIds.add(entryId);
        const content = message.content;
        const contentType = content && typeof content === "object" && !Array.isArray(content)
          ? (content as Record<string, unknown>).content_type
          : null;
        const sourceKind = isBoundedIdentifier(contentType, MAX_SOURCE_KIND_BYTES) ? contentType : "message";
        const parentId = parentMessageId(node);
        const branchState = currentNode === null || currentBranch.has(node.nodeId) ? "current" : "off_branch";
        const spans = readableChatGptSpans(message);
        const timestamp = eventTimestamp("chatgpt", message);
        insertRecord.run(sourcePath, entryId, parentId, conversation.line, sourceKind);
        eligibleRecords++;
        for (let ordinal = 0; ordinal < spans.length; ordinal++) {
          const span = spans[ordinal]!;
          const identifier = evidenceId("chatgpt", sourceNamespace, sessionId, entryId, ordinal);
          if ((findEvidence.get(identifier) as { found?: number } | undefined)?.found) {
            throw new Error("Mooncite evidence identity collision.");
          }
          insertEvidence.run(
            identifier,
            evidenceUri("chatgpt", sourceNamespace, sessionId, entryId, ordinal),
            span.text,
            project,
            sessionId,
            entryId,
            span.role,
            "chatgpt",
            sourceKind,
            timestamp,
            sourcePath,
            conversation.line,
            conversation.byteStart,
            conversation.byteEnd,
            conversationDigest,
            "pending",
            parentId,
            branchState,
            "none",
          );
          this.#consumeIngestionEvidenceSpan();
          evidenceSpans++;
        }
      }
    });
    if (conversationCount === 0 || firstSessionId === null || firstProject === null) {
      throw new Error("Mooncite ChatGPT export contains no conversations.");
    }
    const after = sourceMetadata(path, location.root);
    if (!after || after.dev !== metadata.dev || after.ino !== metadata.ino || after.size < captureSize) {
      throw new Error("Mooncite ChatGPT source changed identity while indexing.");
    }
    const changed = after.size !== metadata.size || after.mtimeNs !== metadata.mtimeNs || after.ctimeNs !== metadata.ctimeNs;
    if (changed && hashFilePrefix(path, captureSize, after) !== scanned.digest) {
      throw new Error("Mooncite ChatGPT source prefix changed while indexing.");
    }
    this.#db.prepare("UPDATE evidence SET prefix_digest = ? WHERE source_path = ?").run(scanned.digest, sourcePath);
    return {
      sourceOrigin: "chatgpt",
      sourcePath,
      sourceRootDigest,
      sessionId: conversationCount === 1 ? firstSessionId : `chatgpt-export-${sha256(sourcePath).slice(0, 32)}`,
      project: firstProject,
      dev: metadata.dev,
      ino: metadata.ino,
      observedSize: captureSize,
      admittedBytes: captureSize,
      mtimeNs: metadata.mtimeNs,
      ctimeNs: metadata.ctimeNs,
      physicalLines: scanned.physicalLines,
      records,
      eligibleRecords,
      evidenceSpans,
      skipped,
      malformed,
      oversized: 0,
      errors,
      fatalErrors: 0,
      leafEntryId: null,
      latestCompactionLine: null,
      prefixDigest: scanned.digest,
      sourceGeneration: sha256(""),
      trustState: "full_verified",
      entries: [],
      evidence: [],
      requiresRelabel: false,
    };
  }

  #indexFullSource(location: SourceLocation): SourceSnapshot {
    if (location.origin === "chatgpt") return this.#indexFullChatGptSource(location);
    const { path, sourcePath } = location;
    const sourceRootDigest = sourceAuthorizationDigest(location.root, location.discovery);
    const sourceNamespace = citationNamespace(sourceRootDigest, sourcePath);
    const metadata = sourceMetadata(path, location.root);
    if (!metadata) throw new Error("Mooncite source is not a regular file.");
    this.#consumeIngestion(metadata.size, 0, 0);
    const captureSize = metadata.size;
    const captureHash = createHash("sha256");
    const prefixHash = createHash("sha256");
    let admittedHash = prefixHash.copy();
    const buffer = Buffer.alloc(1024 * 1024);
    const fd = openVerifiedSource(path, metadata);
    if (fd === null) throw new Error("Mooncite source changed identity before indexing.");
    let fileOffset = 0;
    let lineStart = 0;
    let lineLength = 0;
    let lineOversized = false;
    let lineParts: Buffer[] = [];
    let physicalLines = 0;
    let records = 0;
    let eligibleRecords = 0;
    let evidenceSpans = 0;
    let skipped = 0;
    let malformed = 0;
    let oversized = 0;
    let errors = 0;
    let sessionId: string | null = null;
    if (location.origin === "claude-code") {
      const candidate = basename(path, ".jsonl");
      if (!isBoundedIdentifier(candidate)) throw new Error("Mooncite Claude session identity is invalid.");
      sessionId = candidate;
    }
    let project: string | null = location.origin === "claude-code"
      ? projectIdentity(dirname(location.relativePath), "claude-project")
      : null;
    let leafEntryId: string | null = null;
    let latestCompactionLine: number | null = null;
    const seenEntryIds = new Set<string>();
    const insertRecord = this.#db.prepare("INSERT INTO source_records(source_path, entry_id, parent_id, line, source_kind) VALUES (?, ?, ?, ?, ?)");
    const insertEvidence = this.#db.prepare(`INSERT INTO evidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const findEvidence = this.#db.prepare("SELECT 1 AS found FROM evidence WHERE evidence_id = ?");

    const processLine = (end: number): void => {
      this.#consumeIngestionWork();
      physicalLines++;
      const physicalLine = physicalLines;
      if (lineOversized) {
        if (physicalLine === 1) throw new Error("Mooncite session header exceeds the line limit.");
        skipped++;
        oversized++;
        return;
      }
      const bytes = lineParts.length === 1 ? lineParts[0]! : Buffer.concat(lineParts, lineLength);
      let parsed: unknown;
      try {
        parsed = JSON.parse(bytes.toString("utf8")) as unknown;
      } catch {
        if (physicalLine === 1) throw new Error("Mooncite session header is malformed.");
        skipped++;
        malformed++;
        errors++;
        return;
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        if (physicalLine === 1) throw new Error("Mooncite session header is malformed.");
        skipped++;
        malformed++;
        errors++;
        return;
      }
      const entry = parsed as Record<string, unknown>;
      if (sessionId === null) {
        const ompTitlePreamble = location.origin === "omp"
          && physicalLine === 1
          && entry.type === "title"
          && entry.v === 1
          && typeof entry.title === "string";
        if (ompTitlePreamble) {
          this.#consumeIngestionRecord();
          records++;
          return;
        }
        if (location.origin === "codex") {
          const payload = entry.payload;
          if (physicalLine !== 1
            || entry.type !== "session_meta"
            || !payload
            || typeof payload !== "object"
            || Array.isArray(payload)) {
            throw new Error("Mooncite Codex session header is unsupported.");
          }
          const metadata = payload as Record<string, unknown>;
          const identifier = isBoundedIdentifier(metadata.id)
            ? metadata.id
            : isBoundedIdentifier(metadata.session_id) ? metadata.session_id : null;
          if (identifier === null) throw new Error("Mooncite Codex session identity is invalid.");
          sessionId = identifier;
          project = projectIdentity(typeof metadata.cwd === "string" ? metadata.cwd : location.relativePath);
          this.#consumeIngestionRecord();
          records++;
          eligibleRecords++;
          return;
        }
        if (entry.type !== "session" || entry.version !== 3 || !isBoundedIdentifier(entry.id)) {
          throw new Error("Mooncite session header is unsupported.");
        }
        if (location.origin === "pi" && physicalLine !== 1) throw new Error("Mooncite Pi session header must be the first record.");
        if (location.origin === "omp" && physicalLine > 2) throw new Error("Mooncite OMP session header must follow only its optional title preamble.");
        sessionId = entry.id;
        const projectSource = typeof entry.cwd === "string" ? entry.cwd : location.relativePath.split("/")[0] ?? "unknown";
        project = projectIdentity(projectSource);
        this.#consumeIngestionRecord();
        records++;
        eligibleRecords++;
        return;
      }
      records++;
      this.#consumeIngestionRecord();
      let entryId: string | null;
      let parentId: string | null | undefined;
      let sourceKind: string | null;
      let spans: Array<{ role: EvidenceRole; text: string }>;
      if (location.origin === "claude-code") {
        if (typeof entry.cwd === "string" && entry.cwd.trim()) project = projectIdentity(entry.cwd);
        entryId = recordIdentity(location.origin, entry, physicalLine, bytes);
        if (entryId === null) {
          if (entry.type === "user" || entry.type === "assistant") {
            skipped++;
            malformed++;
            errors++;
          }
          return;
        }
        parentId = entry.parentUuid === null || entry.parentUuid === undefined
          ? null
          : isBoundedIdentifier(entry.parentUuid) ? entry.parentUuid : undefined;
        sourceKind = isBoundedIdentifier(entry.type, MAX_SOURCE_KIND_BYTES) ? entry.type : null;
        spans = readableClaudeSpans(entry);
      } else if (location.origin === "codex") {
        spans = readableCodexSpans(entry);
        if (spans.length === 0) return;
        entryId = recordIdentity(location.origin, entry, physicalLine, bytes);
        parentId = leafEntryId;
        const payload = entry.payload as Record<string, unknown>;
        sourceKind = isBoundedIdentifier(payload.type, MAX_SOURCE_KIND_BYTES) ? payload.type : null;
      } else {
        entryId = recordIdentity(location.origin, entry, physicalLine, bytes);
        parentId = entry.parentId === null || entry.parentId === undefined
          ? null
          : isBoundedIdentifier(entry.parentId) ? entry.parentId : undefined;
        sourceKind = isBoundedIdentifier(entry.type, MAX_SOURCE_KIND_BYTES) ? entry.type : null;
        spans = readableSpans(entry);
      }
      if (entryId === null || sourceKind === null || parentId === undefined) {
        skipped++;
        malformed++;
        errors++;
        return;
      }
      if (seenEntryIds.has(entryId)) {
        skipped++;
        errors++;
        return;
      }
      seenEntryIds.add(entryId);
      eligibleRecords++;
      insertRecord.run(sourcePath, entryId, parentId, physicalLine, sourceKind);
      leafEntryId = entryId;
      if (sourceKind === "compaction") latestCompactionLine = physicalLine;
      const timestamp = eventTimestamp(location.origin, entry);
      for (let ordinal = 0; ordinal < spans.length; ordinal++) {
        const span = spans[ordinal]!;
        const identifier = evidenceId(location.origin, sourceNamespace, sessionId, entryId, ordinal);
        if ((findEvidence.get(identifier) as { found?: number } | undefined)?.found) {
          throw new Error("Mooncite evidence identity collision.");
        }
        insertEvidence.run(
          identifier,
          evidenceUri(location.origin, sourceNamespace, sessionId, entryId, ordinal),
          span.text,
          project!,
          sessionId,
          entryId,
          span.role,
          location.origin,
          sourceKind,
          timestamp,
          sourcePath,
          physicalLine,
          lineStart,
          end,
          sha256(bytes),
          "pending",
          parentId,
          "off_branch",
          "none",
        );
        evidenceSpans++;
        this.#consumeIngestionEvidenceSpan();
      }
    };

    try {
      while (fileOffset < captureSize) {
        const count = readSync(fd, buffer, 0, Math.min(buffer.length, captureSize - fileOffset), fileOffset);
        if (count === 0) break;
        const chunk = buffer.subarray(0, count);
        captureHash.update(chunk);
        let cursor = 0;
        while (cursor < count) {
          const newline = chunk.indexOf(0x0a, cursor);
          const end = newline < 0 ? count : newline;
          const segment = chunk.subarray(cursor, end);
          prefixHash.update(segment);
          lineLength += segment.length;
          if (!lineOversized) {
            if (lineLength <= MAX_LINE_BYTES) lineParts.push(Buffer.from(segment));
            else {
              lineOversized = true;
              lineParts = [];
            }
          }
          if (newline < 0) break;
          prefixHash.update("\n");
          admittedHash = prefixHash.copy();
          processLine(fileOffset + newline);
          lineStart = fileOffset + newline + 1;
          lineLength = 0;
          lineOversized = false;
          lineParts = [];
          cursor = newline + 1;
        }
        fileOffset += count;
      }
    } finally {
      closeSync(fd);
    }
    if (fileOffset !== captureSize || physicalLines === 0 || sessionId === null || project === null) throw new Error("Mooncite source could not be captured completely.");
    const firstDigest = captureHash.digest("hex");
    const after = sourceMetadata(path, location.root);
    if (!after || after.dev !== metadata.dev || after.ino !== metadata.ino || after.size < captureSize) throw new Error("Mooncite source changed identity while indexing.");
    const changed = after.size !== metadata.size || after.mtimeNs !== metadata.mtimeNs || after.ctimeNs !== metadata.ctimeNs;
    if (changed && hashFilePrefix(path, captureSize, after) !== firstDigest) throw new Error("Mooncite source prefix changed while indexing.");
    const prefixDigest = admittedHash.digest("hex");
    this.#db.prepare("UPDATE evidence SET prefix_digest = ? WHERE source_path = ?").run(prefixDigest, sourcePath);
    return {
      sourceOrigin: location.origin,
      sourcePath,
      sourceRootDigest,
      sessionId,
      project,
      dev: metadata.dev,
      ino: metadata.ino,
      observedSize: captureSize,
      admittedBytes: lineStart,
      mtimeNs: metadata.mtimeNs,
      ctimeNs: metadata.ctimeNs,
      physicalLines,
      records,
      eligibleRecords,
      evidenceSpans,
      skipped,
      malformed,
      oversized,
      errors,
      fatalErrors: 0,
      leafEntryId,
      latestCompactionLine,
      prefixDigest,
      sourceGeneration: sha256(""),
      trustState: "full_verified",
      entries: [],
      evidence: [],
      requiresRelabel: true,
    };
  }

  #relabelSource(sourcePath: string, leafEntryId: string | null, latestCompactionLine: number | null): void {
    if (leafEntryId === null) {
      this.#db.prepare("UPDATE evidence SET branch_state = 'off_branch' WHERE source_path = ?").run(sourcePath);
    } else {
      this.#db.prepare(`
        WITH RECURSIVE current(entry_id, parent_id) AS (
          SELECT entry_id, parent_id FROM source_records WHERE source_path = ? AND entry_id = ?
          UNION
          SELECT records.entry_id, records.parent_id
          FROM source_records records JOIN current ON records.source_path = ? AND records.entry_id = current.parent_id
        )
        UPDATE evidence
        SET branch_state = CASE WHEN entry_id IN (SELECT entry_id FROM current) THEN 'current' ELSE 'off_branch' END
        WHERE source_path = ?
      `).run(sourcePath, leafEntryId, sourcePath, sourcePath);
    }
    this.#db.prepare(`
      UPDATE evidence
      SET compaction_state = CASE
        WHEN source_kind IN ('compaction', 'branch_summary') THEN 'summary'
        WHEN ? IS NULL THEN 'none'
        WHEN line < ? THEN 'pre_compaction'
        ELSE 'kept_after_compaction'
      END
      WHERE source_path = ?
    `).run(latestCompactionLine, latestCompactionLine, sourcePath);
  }

  #sourceGenerationFromDatabase(sourcePath: string): string {
    const rows = this.#db.prepare(`
      SELECT evidence_id, record_digest, source_path, line, byte_start, byte_end, project, event_timestamp, branch_state, compaction_state
      FROM evidence WHERE source_path = ? ORDER BY evidence_id
    `).iterate(sourcePath) as Iterable<Record<string, string | number | null>>;
    const digest = createHash("sha256");
    let first = true;
    for (const item of rows) {
      if (!first) digest.update("\n");
      first = false;
      digest.update([
        item.evidence_id,
        item.record_digest,
        item.source_path,
        item.line,
        item.byte_start,
        item.byte_end,
        item.project,
        item.event_timestamp ?? "",
        item.branch_state,
        item.compaction_state,
      ].join(":"));
    }
    return digest.digest("hex");
  }

  #publishChanges(
    appendPlans: Array<{ stored: StoredSourceRow; source: SourceSnapshot }>,
    newSources: SourceLocation[],
    replacementPlans: Array<{ stored: StoredSourceRow; location: SourceLocation }>,
    removedPaths: string[],
    operation: "refresh" | "rebuild",
  ): ScanResult {
    try {
      this.#db.exec("BEGIN IMMEDIATE");
    } catch (error) {
      if (isDatabaseBusy(error) && this.#last.generation !== "empty") {
        this.#last = { ...this.#last, retainedLastGood: true };
        this.#setOperationOutcome(operation, "retained_last_good");
        return this.#last;
      }
      throw error;
    }
    try {
      for (const plan of [...appendPlans, ...replacementPlans.map(({ stored }) => ({ stored }))]) {
        const current = this.#db.prepare("SELECT * FROM source_files WHERE source_path = ?").get(plan.stored.source_path) as unknown as StoredSourceRow | undefined;
        if (!current || current.admitted_bytes !== plan.stored.admitted_bytes || current.observed_size !== plan.stored.observed_size || current.dev !== plan.stored.dev || current.ino !== plan.stored.ino) {
          this.#db.exec("ROLLBACK");
          const state = this.#stateFromSourceFiles();
          this.#last = state;
          this.#lastEvidenceCount = this.#storedSources().reduce((sum, source) => sum + source.evidence_spans, 0);
          this.#setOperationOutcome(operation, "unchanged");
          return state;
        }
      }
      const pathsToDelete = new Set([...removedPaths, ...replacementPlans.map(({ stored }) => stored.source_path)]);
      for (const sourcePath of pathsToDelete) {
        this.#db.prepare("DELETE FROM evidence WHERE source_path = ?").run(sourcePath);
        this.#db.prepare("DELETE FROM source_records WHERE source_path = ?").run(sourcePath);
        this.#db.prepare("DELETE FROM source_files WHERE source_path = ?").run(sourcePath);
      }
      const insertRecord = this.#db.prepare("INSERT INTO source_records(source_path, entry_id, parent_id, line, source_kind) VALUES (?, ?, ?, ?, ?)");
      for (const location of [...newSources, ...replacementPlans.map(({ location }) => location)]) {
        const existing = this.#db.prepare("SELECT 1 AS found FROM source_files WHERE source_path = ?").get(location.sourcePath) as { found?: number } | undefined;
        if (existing?.found) throw new Error(`Mooncite source appeared concurrently: ${location.sourcePath}`);
        const source = this.#indexFullSource(location);
        this.#writeSource(source);
        if (source.requiresRelabel) this.#relabelSource(source.sourcePath, source.leafEntryId, source.latestCompactionLine);
        source.sourceGeneration = this.#sourceGenerationFromDatabase(source.sourcePath);
        this.#db.prepare("UPDATE source_files SET source_generation = ? WHERE source_path = ?").run(source.sourceGeneration, source.sourcePath);
      }
      for (const plan of appendPlans) {
        for (const entry of plan.source.entries) {
          insertRecord.run(plan.source.sourcePath, entry.entryId, entry.parentId, entry.line, entry.sourceKind);
        }
        this.#insertEvidence(plan.source.evidence);
        this.#writeSource(plan.source);
        if (plan.source.requiresRelabel) {
          this.#relabelSource(plan.source.sourcePath, plan.source.leafEntryId, plan.source.latestCompactionLine);
          plan.source.sourceGeneration = this.#sourceGenerationFromDatabase(plan.source.sourcePath);
          this.#db.prepare("UPDATE source_files SET source_generation = ? WHERE source_path = ?").run(plan.source.sourceGeneration, plan.source.sourcePath);
        }
      }
      const state = this.#stateFromSourceFiles();
      const admitted = appendPlans.some((plan) => plan.source.admittedBytes > plan.stored.admitted_bytes);
      const changed = admitted || newSources.length > 0 || replacementPlans.length > 0 || removedPaths.length > 0;
      const outcome: RefreshOutcome = changed ? "published" : "unchanged";
      this.#persistLastGood(state, operation, outcome);
      this.#db.exec("COMMIT");
      this.#last = state;
      this.#lastEvidenceCount = this.#storedSources().reduce((sum, source) => sum + source.evidence_spans, 0);
      this.#setOperationOutcome(operation, outcome);
      return state;
    } catch (error) {
      try { this.#db.exec("ROLLBACK"); } catch { /* Preserve the source update failure. */ }
      if (this.#last.generation !== "empty") return this.#retainForSourceFailure(operation);
      throw error;
    }
  }

  #retainForSourceFailure(
    operation: "refresh" | "rebuild",
    failures: MoonciteStatusErrorGroup[] = [sourceError("unknown", "source_read_or_parse_failure")],
  ): ScanResult {
    const transient = mergeErrorGroups(failures);
    const totals = errorGroupTotals(transient);
    const base: ScanResult = this.#storedSources().length > 0
      ? this.#stateFromSourceFiles()
      : {
        evidence: [],
        sourceFiles: 0,
        records: 0,
        eligibleRecords: 0,
        skipped: 0,
        malformed: 0,
        oversized: 0,
        errors: 0,
        fatalErrors: 0,
        generation: "empty",
        trustState: "full_verified",
        coverage: "complete",
        retainedLastGood: false,
        errorGroups: [],
      };
    this.#last = {
      ...base,
      skipped: base.skipped + totals.count,
      errors: base.errors + totals.count,
      fatalErrors: base.fatalErrors + totals.fatalCount,
      coverage: "partial",
      retainedLastGood: base.generation !== "empty",
      errorGroups: mergeErrorGroups(base.errorGroups, transient),
    };
    this.#setOperationOutcome(operation, this.#last.retainedLastGood ? "retained_last_good" : "unavailable");
    return this.#last;
  }


  #pruneDeauthorizedSources(operation: "refresh" | "rebuild"): MoonciteStatusErrorGroup[] {
    let authorized: Set<string>;
    try {
      authorized = new Set(this.#configuredRoots().map((source) =>
        `${source.origin}:${sourceAuthorizationDigest(source.root, source.discovery)}`));
    } catch {
      return [sourceError("unknown", "source_configuration_failure")];
    }
    const paths = this.#storedSources()
      .filter((source) => !authorized.has(`${source.source_origin}:${source.source_root_digest}`))
      .map((source) => source.source_path);
    if (paths.length === 0) return [];
    try {
      this.#db.exec("BEGIN IMMEDIATE");
      for (const sourcePath of paths) {
        this.#db.prepare("DELETE FROM evidence WHERE source_path = ?").run(sourcePath);
        this.#db.prepare("DELETE FROM source_records WHERE source_path = ?").run(sourcePath);
        this.#db.prepare("DELETE FROM source_files WHERE source_path = ?").run(sourcePath);
      }
      const state = this.#stateFromSourceFiles();
      this.#persistLastGood(state, operation, "published");
      this.#db.exec("COMMIT");
      this.#last = state;
      this.#lastEvidenceCount = this.#storedSources().reduce((sum, source) => sum + source.evidence_spans, 0);
      this.#setOperationOutcome(operation, "published");
      return [];
    } catch {
      try { this.#db.exec("ROLLBACK"); } catch { /* Preserve the authorization-pruning failure. */ }
      return [sourceError("unknown", "source_read_or_parse_failure")];
    }
  }
  #performRefresh(operation: "refresh" | "rebuild", force: boolean): ScanResult {
    this.#resetIngestionBudget();
    const pruningErrors = this.#pruneDeauthorizedSources(operation);
    if (pruningErrors.length > 0) return this.#retainForSourceFailure(operation, pruningErrors);
    if (force) return this.#performFullRefresh(operation);
    const stored = this.#storedSources();
    const scan = this.#scanSources(stored);
    if (scan.blocked) return this.#retainForSourceFailure(operation, scan.errorGroups);
    if (this.#last.generation === "empty" || stored.length === 0) return this.#performFullRefresh(operation);
    if (scan.errorGroups.length > 0) return this.#retainForSourceFailure(operation, scan.errorGroups);
    const byPath = new Map(stored.map((source) => [source.source_path, source]));
    const currentPaths = new Set(scan.locations.map((location) => location.sourcePath));
    const removedPaths = stored.map((source) => source.source_path).filter((sourcePath) => !currentPaths.has(sourcePath));
    const appendPlans: Array<{ location: SourceLocation; stored: StoredSourceRow }> = [];
    const replacementPlans: Array<{ location: SourceLocation; stored: StoredSourceRow }> = [];
    const newSources: SourceLocation[] = [];
    for (const location of scan.locations) {
      const previous = byPath.get(location.sourcePath);
      if (!previous) {
        newSources.push(location);
        continue;
      }
      const metadata = sourceMetadata(location.path, location.root);
      if (!metadata) return this.#retainForSourceFailure(
        operation,
        [sourceError(location.origin, "source_metadata_failure")],
      );
      const exact = metadata.dev === previous.dev && metadata.ino === previous.ino && metadata.size === previous.observed_size && metadata.mtimeNs === previous.mtime_ns && metadata.ctimeNs === previous.ctime_ns;
      if (exact) continue;
      if (location.origin !== "pi") {
        replacementPlans.push({ location, stored: previous });
        continue;
      }
      const monotonicAppend = metadata.dev === previous.dev && metadata.ino === previous.ino && metadata.size > previous.observed_size;
      if (!monotonicAppend) return this.#retainForSourceFailure(
        operation,
        [sourceError(location.origin, "source_changed_during_refresh")],
      );
      if (metadata.size - previous.admitted_bytes > MAX_APPEND_CAPTURE_BYTES) return this.#performFullRefresh(operation);
      appendPlans.push({ location, stored: previous });
    }
    if (appendPlans.length === 0 && replacementPlans.length === 0 && newSources.length === 0 && removedPaths.length === 0) {
      const state = this.#stateFromSourceFiles();
      this.#last = state;
      this.#lastEvidenceCount = stored.reduce((sum, source) => sum + source.evidence_spans, 0);
      this.#setOperationOutcome(operation, "unchanged");
      return state;
    }
    const parsedPlans: Array<{ stored: StoredSourceRow; source: SourceSnapshot }> = [];
    for (const plan of appendPlans) {
      const ids = new Set((this.#db.prepare("SELECT entry_id FROM source_records WHERE source_path = ?").all(plan.stored.source_path) as Array<{ entry_id: string }>).map((row) => row.entry_id));
      const source = parseAppend(plan.location, plan.stored, ids);
      if (source === "requires_full") return this.#performFullRefresh(operation);
      if (!source) return this.#retainForSourceFailure(
        operation,
        [sourceError(plan.location.origin, "source_read_or_parse_failure")],
      );
      if (!this.#tryConsumeAppendBatch(
        source.admittedBytes - plan.stored.admitted_bytes,
        source.records - plan.stored.records,
        source.evidence.length,
      )) {
        this.#resetIngestionBudget();
        return this.#performFullRefresh(operation);
      }
      parsedPlans.push({ stored: plan.stored, source });
    }
    const replacedPaths = new Set(replacementPlans.map(({ stored: source }) => source.source_path));
    const filteredParsedPlans = parsedPlans.filter(({ stored: source }) => !replacedPaths.has(source.source_path));
    return this.#publishChanges(filteredParsedPlans, newSources, replacementPlans, removedPaths, operation);
  }

  #performFullRefresh(operation: "refresh" | "rebuild"): ScanResult {
    const stored = this.#storedSources();
    const scan = this.#scanSources(stored);
    if (scan.blocked) return this.#retainForSourceFailure(operation, scan.errorGroups);
    try {
      this.#db.exec("BEGIN IMMEDIATE");
    } catch (error) {
      if (isDatabaseBusy(error)) {
        if (this.#last.generation !== "empty") {
          this.#last = { ...this.#last, retainedLastGood: true };
          this.#setOperationOutcome(operation, "retained_last_good");
        } else {
          this.#last = {
            ...this.#last,
            skipped: 1,
            errors: 1,
            fatalErrors: 1,
            coverage: "partial",
            errorGroups: [sourceError("unknown", "source_read_or_parse_failure")],
          };
          this.#setOperationOutcome(operation, "unavailable");
        }
        return this.#last;
      }
      throw error;
    }
    try {
      this.#db.exec("DELETE FROM evidence; DELETE FROM source_records; DELETE FROM source_files;");
      const fatalErrorGroups = [...scan.errorGroups];
      for (let index = 0; index < scan.locations.length; index++) {
        const location = scan.locations[index]!;
        const savepoint = `source_${index}`;
        this.#db.exec(`SAVEPOINT ${savepoint}`);
        try {
          const source = this.#indexFullSource(location);
          this.#writeSource(source);
          if (source.requiresRelabel) this.#relabelSource(source.sourcePath, source.leafEntryId, source.latestCompactionLine);
          source.sourceGeneration = this.#sourceGenerationFromDatabase(source.sourcePath);
          this.#db.prepare("UPDATE source_files SET source_generation = ? WHERE source_path = ?").run(source.sourceGeneration, source.sourcePath);
          this.#db.exec(`RELEASE ${savepoint}`);
        } catch {
          try {
            this.#db.exec(`ROLLBACK TO ${savepoint}`);
            this.#db.exec(`RELEASE ${savepoint}`);
          } catch {
            try { this.#db.exec("ROLLBACK"); } catch { /* The SQLite error may already have ended the transaction. */ }
            return this.#retainForSourceFailure(operation);
          }
          fatalErrorGroups.push(sourceError(location.origin, "source_read_or_parse_failure"));
        }
      }
      const fatalSourceErrors = errorGroupTotals(fatalErrorGroups);
      if (fatalSourceErrors.fatalCount > 0) {
        this.#db.exec("ROLLBACK");
        return this.#retainForSourceFailure(operation, fatalErrorGroups);
      }
      const state = this.#stateFromSourceFiles();
      if (state.sourceFiles === 0 && this.#last.generation === "empty") {
        this.#db.exec("ROLLBACK");
        this.#last = { ...state, generation: "empty", retainedLastGood: false };
        this.#lastEvidenceCount = 0;
        this.#setOperationOutcome(operation, "unavailable");
        return this.#last;
      }
      this.#persistLastGood(state, operation, "published");
      this.#db.exec("COMMIT");
      this.#last = state;
      this.#lastEvidenceCount = this.#storedSources().reduce((sum, source) => sum + source.evidence_spans, 0);
      this.#setOperationOutcome(operation, "published");
      return state;
    } catch (error) {
      try { this.#db.exec("ROLLBACK"); } catch { /* Preserve the full-refresh failure. */ }
      throw error;
    }
  }

  rebuild(): MoonciteStatus {
    let state: ScanResult;
    try {
      state = this.#performRefresh("rebuild", true);
    } catch (error) {
      this.#lastRebuildOutcome = "unavailable";
      try {
        this.#db.prepare("INSERT OR REPLACE INTO metadata(key, value) VALUES ('last_rebuild_outcome', ?)").run(this.#lastRebuildOutcome);
      } catch {
        // Preserve the original rebuild failure when diagnostics cannot be persisted.
      }
      throw error;
    }
    this.#db.prepare("INSERT OR REPLACE INTO metadata(key, value) VALUES ('last_rebuild_outcome', ?)").run(this.#lastRebuildOutcome);
    return this.#memoryStatus(state);
  }

  recall(input: RecallInput): EvidenceBundle {
    return this.#recall(input, true);
  }

  #recall(input: RecallInput, refreshOnMiss: boolean): EvidenceBundle {
    const state = this.#stateForInteractiveRead();
    const query = input.query.trim();
    const parsedQuery = parsedQueryText(query);
    const terms = queryTerms(parsedQuery.text);
    const exactText = parsedQuery.text;
    const limit = Math.min(20, Math.max(1, input.limit ?? 5));
    const order = input.order ?? "relevance";
    const after = input.after === undefined ? null : normalizeIsoTimestamp(input.after);
    const before = input.before === undefined ? null : normalizeIsoTimestamp(input.before);
    const invalidScope = (message: string): EvidenceBundle => ({
      outcome: "invalid_scope",
      conclusive: false,
      meaning: message,
      next: {
        action: "call",
        target: "mooncite_recall",
        arguments: { query, limit },
        reason: "Retry with valid filters, or copy an exact project or source-qualified session value from a candidate.",
      },
      query,
      lexicalTerms: terms,
      scope: { project: input.project ?? null, sessionId: input.sessionId ?? null, evidenceSpans: 0 },
      generation: state.generation,
      trustState: state.trustState,
      coverage: state.coverage,
      candidates: [],
      echoesSuppressed: 0,
      warnings: [message],
    });
    if (order !== "relevance" && order !== "newest" && order !== "oldest") {
      return invalidScope("The recall order must be relevance, newest, or oldest.");
    }
    if (input.after !== undefined && after === null) {
      return invalidScope("The inclusive after timestamp must be an ISO 8601 timestamp with an explicit UTC offset.");
    }
    if (input.before !== undefined && before === null) {
      return invalidScope("The inclusive before timestamp must be an ISO 8601 timestamp with an explicit UTC offset.");
    }
    if (after !== null && before !== null && after > before) {
      return invalidScope("The inclusive after timestamp must not be later than before.");
    }
    if (input.role !== undefined && parseEvidenceRole(input.role) !== input.role) {
      return invalidScope("The role filter is not an indexed evidence role.");
    }
    if (input.sourceOrigin !== undefined && !SOURCE_ORIGINS.includes(input.sourceOrigin)) {
      return invalidScope("The source origin filter is invalid.");
    }
    if (input.project && !/^project:[A-Za-z0-9._%~-]{1,160}-[a-f0-9]{16}$/u.test(input.project)) {
      return invalidScope("The project scope is malformed. Copy the exact encoded project value from a recall candidate.");
    }
    let authorizedRoots: Array<{ origin: SourceOrigin; rootDigest: string }>;
    try {
      authorizedRoots = this.#configuredRoots().map((source) => ({
        origin: source.origin,
        rootDigest: sourceAuthorizationDigest(source.root, source.discovery),
      }));
    } catch {
      return {
        outcome: "unavailable",
        conclusive: false,
        meaning: "Source authorization could not be read, so Mooncite did not search the retained index.",
        next: { action: "call", target: "mooncite_status", reason: "Check source and index health before retrying." },
        query,
        lexicalTerms: terms,
        scope: { project: input.project ?? null, sessionId: input.sessionId ?? null, evidenceSpans: 0 },
        generation: state.generation,
        trustState: state.trustState,
        coverage: "partial",
        candidates: [],
        echoesSuppressed: 0,
        warnings: ["Source authorization is unavailable."],
      };
    }
    const authorizedRootKeys = new Set(authorizedRoots.map(({ origin, rootDigest }) => `${origin}\0${rootDigest}`));
    let sessionScope = input.sessionId ? parseQualifiedSessionId(input.sessionId) : null;
    let renderedSessionScope = input.sessionId ?? null;
    if (input.sessionId && !sessionScope) {
      const matchingSources = (this.#db.prepare(`
        SELECT DISTINCT source_origin, source_root_digest, session_id
        FROM source_files
        WHERE session_id = ?
        ORDER BY source_origin, source_root_digest
      `).all(input.sessionId) as Array<{ source_origin: SourceOrigin; source_root_digest: string; session_id: string }>)
        .filter((source) => authorizedRootKeys.has(`${source.source_origin}\0${source.source_root_digest}`));
      if (matchingSources.length === 0 && refreshOnMiss) {
        this.refresh();
        return this.#recall(input, false);
      }
      if (matchingSources.length !== 1) {
        return invalidScope(matchingSources.length === 0
          ? "The session scope is not a source-qualified Mooncite session and no unique authorized session has that bare ID."
          : "The bare session scope is ambiguous across authorized sources. Copy the exact source-qualified sessionId from a candidate.");
      }
      const source = matchingSources[0]!;
      sessionScope = { origin: source.source_origin, rootDigest: source.source_root_digest, sessionId: source.session_id };
      renderedSessionScope = qualifiedSessionId(sessionScope.origin, sessionScope.rootDigest, sessionScope.sessionId);
    }
    if (sessionScope && !authorizedRootKeys.has(`${sessionScope.origin}\0${sessionScope.rootDigest}`)) {
      return invalidScope("The source-qualified session scope is not authorized in this process.");
    }
    const authorizationSql = `EXISTS (
      SELECT 1 FROM source_files sf
      WHERE sf.source_path = e.source_path
        AND (${authorizedRoots.map(() => "(sf.source_origin = ? AND sf.source_root_digest = ?)").join(" OR ")})
    )`;
    const authorizationParams = authorizedRoots.flatMap((source) => [source.origin, source.rootDigest]);
    const evidenceConditions: string[] = [];
    const evidenceParams: string[] = [];
    if (input.project) {
      evidenceConditions.push("e.project = ?");
      evidenceParams.push(input.project);
    }
    if (sessionScope) {
      evidenceConditions.push("EXISTS (SELECT 1 FROM source_files session_source WHERE session_source.source_path = e.source_path AND session_source.source_origin = ? AND session_source.source_root_digest = ?) AND e.session_id = ?");
      evidenceParams.push(sessionScope.origin, sessionScope.rootDigest, sessionScope.sessionId);
    }
    if (input.role) {
      evidenceConditions.push("e.role = ?");
      evidenceParams.push(input.role);
    }
    if (input.sourceOrigin) {
      evidenceConditions.push("e.source_origin = ?");
      evidenceParams.push(input.sourceOrigin);
    }
    if (after !== null) {
      evidenceConditions.push("e.event_timestamp IS NOT NULL AND e.event_timestamp >= ?");
      evidenceParams.push(after);
    }
    if (before !== null) {
      evidenceConditions.push("e.event_timestamp IS NOT NULL AND e.event_timestamp <= ?");
      evidenceParams.push(before);
    }
    const evidenceSql = evidenceConditions.length > 0 ? ` AND ${evidenceConditions.join(" AND ")}` : "";
    const scopeSql = `SELECT COUNT(*) AS count FROM evidence e WHERE ${authorizationSql}${evidenceSql}`;
    const scopeParams = [...authorizationParams, ...evidenceParams];
    const scopeCount = Number((this.#db.prepare(scopeSql).get(...scopeParams) as { count?: number } | undefined)?.count ?? 0);
    const scope = { project: input.project ?? null, sessionId: renderedSessionScope, evidenceSpans: scopeCount };
    const hasFilters = input.project !== undefined
      || input.sessionId !== undefined
      || input.role !== undefined
      || input.sourceOrigin !== undefined
      || after !== null
      || before !== null;
    const scopeWarnings = hasFilters && scopeCount === 0 ? ["Requested filters contain no indexed evidence."] : [];
    if (!state.retainedLastGood && scopeCount === 0 && (state.fatalErrors > 0 || state.sourceFiles === 0)) {
      const warning = state.errors > 0 ? `${state.errors} source error(s)` : "No usable registered session files";
      return {
        outcome: "unavailable",
        conclusive: false,
        meaning: "Mooncite has no usable evidence generation for this search.",
        next: { action: "call", target: "mooncite_status", reason: "Check source and index health before retrying." },
        query,
        lexicalTerms: terms,
        scope,
        generation: state.generation,
        trustState: state.trustState,
        coverage: state.coverage,
        candidates: [],
        echoesSuppressed: 0,
        warnings: [warning, ...scopeWarnings],
      };
    }
    const directConditions = ["e.evidence_id = ?", "e.evidence_uri = ?", "e.entry_id = ?"];
    const directParams: Array<string | number> = [...authorizationParams, query, query, query];
    if (/^project:[A-Za-z0-9._%~-]{1,160}-[a-f0-9]{16}$/u.test(query)) {
      directConditions.push("e.project = ?");
      directParams.push(query);
    }
    const querySession = parseQualifiedSessionId(query);
    if (querySession && authorizedRootKeys.has(`${querySession.origin}\0${querySession.rootDigest}`)) {
      directConditions.push("e.source_origin = ? AND e.session_id = ? AND EXISTS (SELECT 1 FROM source_files direct_session_source WHERE direct_session_source.source_path = e.source_path AND direct_session_source.source_origin = ? AND direct_session_source.source_root_digest = ?)");
      directParams.push(querySession.origin, querySession.sessionId, querySession.origin, querySession.rootDigest);
    }
    let directSql = `SELECT e.*, -1000000.0 AS score FROM evidence e WHERE ${authorizationSql} AND (${directConditions.join(" OR ")})${evidenceSql}`;
    directParams.push(...evidenceParams);
    const physicalOrder = "e.source_origin, e.source_path, e.line, e.byte_start, e.evidence_id";
    const temporalOrder = order === "newest"
      ? `CASE WHEN e.event_timestamp IS NULL THEN 1 ELSE 0 END, e.event_timestamp DESC, ${physicalOrder}`
      : `CASE WHEN e.event_timestamp IS NULL THEN 1 ELSE 0 END, e.event_timestamp ASC, ${physicalOrder}`;
    directSql += ` ORDER BY ${order === "relevance" ? "e.evidence_id" : temporalOrder} LIMIT ?`;
    directParams.push(limit);
    const directRows = this.#db.prepare(directSql).all(...directParams) as Array<Record<string, string | number | null>>;
    const rowsById = new Map(directRows.map((row) => [String(row.evidence_id), row]));
    if (terms.length) {
      const match = parsedQuery.phrase
        ? `"${exactText.replaceAll('"', '""')}"`
        : terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
      let sql = `SELECT e.*, evidence_fts.rank AS score FROM evidence_fts JOIN evidence e ON e.rowid=evidence_fts.rowid WHERE evidence_fts MATCH ? AND ${authorizationSql}${evidenceSql}`;
      const params: Array<string | number> = [match, ...authorizationParams, ...evidenceParams];
      sql += ` ORDER BY ${order === "relevance" ? "evidence_fts.rank, e.evidence_id" : temporalOrder} LIMIT ?`;
      params.push(Math.min(MAX_RECALL_RANKING_ROWS, Math.max(40, limit * 10)));
      const lexicalRows = this.#db.prepare(sql).all(...params) as Array<Record<string, string | number | null>>;
      for (const row of lexicalRows) if (!rowsById.has(String(row.evidence_id))) rowsById.set(String(row.evidence_id), row);
    }
    const lowerQuery = exactText.toLowerCase();
    const rankedWithEchoes = [...rowsById.values()].map((row) => {
      const text = String(row.text);
      const lower = text.toLowerCase();
      const directCitation = String(row.evidence_id) === query || String(row.evidence_uri) === query;
      const metadataExact = directCitation || [
        row.project,
        qualifiedSessionId(parseSourceOrigin(row.source_origin), sourceRootDigestFromSourcePath(parseSourceOrigin(row.source_origin), String(row.source_path)), String(row.session_id)),
        row.entry_id,
      ].some((value) => String(value) === query);
      const matchedTerms = metadataExact ? [query] : terms.filter((term) =>
        lower.includes(term) || lower.includes(term.replace(/(ing|ed|s)$/u, "")));
      const termCoverage = metadataExact ? 1 : terms.length === 0 ? 0 : matchedTerms.length / terms.length;
      const exact = metadataExact || (lowerQuery.length > 0 && lower.includes(lowerQuery));
      const isEcho = isMoonciteRenderingText(text);
      const band: RelevanceBand = exact || termCoverage >= 0.6 ? "strong" : termCoverage >= 0.25 ? "partial" : "weak";
      const kind: MatchKind = metadataExact
        ? "metadata_exact"
        : exact && parsedQuery.phrase
          ? "phrase_exact"
          : exact
            ? "text_exact"
            : "terms";
      return {
        row,
        matchedTerms,
        missingTerms: metadataExact ? [] : terms.filter((term) => !matchedTerms.includes(term)),
        termCoverage,
        exact,
        metadataExact,
        directCitation,
        isEcho,
        band,
        kind,
      };
    }).sort((a, b) => {
      if (order !== "relevance") {
        const timestampA = typeof a.row.event_timestamp === "string" ? a.row.event_timestamp : null;
        const timestampB = typeof b.row.event_timestamp === "string" ? b.row.event_timestamp : null;
        if (timestampA === null && timestampB !== null) return 1;
        if (timestampA !== null && timestampB === null) return -1;
        if (timestampA !== null && timestampB !== null) {
          const timestampComparison = timestampA.localeCompare(timestampB);
          if (timestampComparison !== 0) return order === "newest" ? -timestampComparison : timestampComparison;
        }
        return String(a.row.source_origin).localeCompare(String(b.row.source_origin))
          || String(a.row.source_path).localeCompare(String(b.row.source_path))
          || Number(a.row.line) - Number(b.row.line)
          || Number(a.row.byte_start) - Number(b.row.byte_start)
          || String(a.row.evidence_id).localeCompare(String(b.row.evidence_id));
      }
      return Number(b.directCitation) - Number(a.directCitation)
        || Number(b.metadataExact) - Number(a.metadataExact)
        || Number(a.isEcho) - Number(b.isEcho)
        || Number(b.exact) - Number(a.exact)
        || b.termCoverage - a.termCoverage
        || Number(a.row.score) - Number(b.row.score)
        || String(a.row.source_origin).localeCompare(String(b.row.source_origin))
        || String(a.row.source_path).localeCompare(String(b.row.source_path))
        || Number(a.row.line) - Number(b.row.line)
        || Number(a.row.byte_start) - Number(b.row.byte_start)
        || String(a.row.evidence_id).localeCompare(String(b.row.evidence_id));
    });
    const echoesSuppressed = rankedWithEchoes.filter((candidate) => candidate.isEcho && !candidate.directCitation).length;
    const ranked = rankedWithEchoes.filter((candidate) => !candidate.isEcho || candidate.directCitation);
    const duplicateBuckets = new Map<string, Map<string, typeof ranked[number] & { duplicateSpanCount: number }>>();
    const diverse: Array<typeof ranked[number] & { duplicateSpanCount: number }> = [];
    for (const item of ranked) {
      if (item.metadataExact) {
        diverse.push({ ...item, duplicateSpanCount: 1 });
        continue;
      }
      const row = item.row;
      const bucketKey = [row.source_origin, row.session_id, row.role, row.source_kind, row.branch_state, row.compaction_state].join("\u0000");
      let excerpts = duplicateBuckets.get(bucketKey);
      if (!excerpts) {
        excerpts = new Map();
        duplicateBuckets.set(bucketKey, excerpts);
      }
      const text = String(row.text);
      const duplicate = excerpts.get(text);
      if (duplicate) {
        duplicate.duplicateSpanCount++;
        continue;
      }
      const selected = { ...item, duplicateSpanCount: 1 };
      excerpts.set(text, selected);
      diverse.push(selected);
    }
    const candidates = diverse.slice(0, limit).map(({
      row,
      matchedTerms,
      missingTerms,
      termCoverage,
      band,
      kind,
      isEcho,
      duplicateSpanCount,
    }): EvidenceCandidate => {
      const excerpt = matchedExcerpt(String(row.text), exactText, matchedTerms, 1_024);
      const sourceOrigin = parseSourceOrigin(row.source_origin);
      return {
        evidenceId: String(row.evidence_id),
        evidenceUri: String(row.evidence_uri),
        excerpt: excerpt.text,
        omittedBytes: excerpt.omittedBytes,
        project: String(row.project),
        sessionId: qualifiedSessionId(sourceOrigin, sourceRootDigestFromSourcePath(sourceOrigin, String(row.source_path)), String(row.session_id)),
        entryId: String(row.entry_id),
        role: parseEvidenceRole(row.role),
        sourceOrigin,
        sourceKind: String(row.source_kind),
        eventTimestamp: typeof row.event_timestamp === "string" ? normalizeIsoTimestamp(row.event_timestamp) : null,
        recordProvenance: sourceOrigin === "chatgpt" ? "copy" : "original",
        parentId: row.parent_id === null ? null : String(row.parent_id),
        branchState: String(row.branch_state) === "current" ? "current" : "off_branch",
        compactionState: parseCompactionState(row.compaction_state),
        ...(duplicateSpanCount > 1 ? { duplicateSpanCount } : {}),
        isEcho,
        match: { kind, band, matchedTerms, missingTerms, termCoverage },
      };
    });
    if (candidates.length === 0 && refreshOnMiss) {
      this.refresh();
      return this.#recall(input, false);
    }
    const warnings = state.errors === 0
      ? [...scopeWarnings]
      : [state.retainedLastGood
        ? `${state.errors} source error(s); last good generation retained`
        : `${state.errors} source error(s)`, ...scopeWarnings];
    if (echoesSuppressed > 0) warnings.push(`${echoesSuppressed} recursive Mooncite echo(es) suppressed.`);
    const incompleteMiss = candidates.length === 0
      && (state.coverage === "partial" || state.retainedLastGood || state.errors > 0);
    const outcome: EvidenceBundle["outcome"] = candidates.length === 0
      ? incompleteMiss ? "inconclusive" : "no_match"
      : candidates.some((candidate) => candidate.match.band === "strong") ? "matches" : "weak_leads";
    const conclusive = outcome === "matches" || outcome === "no_match";
    const meaning = outcome === "matches"
      ? "Mooncite found lexical matches. Inspect a cited source window before relying on any claim."
      : outcome === "weak_leads"
        ? "Mooncite found only partial or weak lexical leads. Refine the query or inspect a lead before using it."
        : outcome === "inconclusive"
          ? "The active index is partial or retained from a last-good generation, so an empty result does not prove the evidence is absent."
          : "Mooncite searched the complete requested scope and found no lexical match.";
    const next: MoonciteNextAction | null = candidates.length > 0
      ? {
        action: "call",
        target: "mooncite_inspect",
        arguments: { evidence_id: candidates[0]!.evidenceId },
        reason: "Verify the physical source bytes for the best candidate.",
      }
      : outcome === "inconclusive"
        ? {
          action: "run",
          target: "mooncite rebuild",
          reason: "Refresh the derived index, then retry the same recall query.",
        }
        : null;
    return {
      outcome,
      conclusive,
      meaning,
      next,
      query,
      lexicalTerms: terms,
      scope,
      generation: state.generation,
      trustState: state.trustState,
      coverage: state.coverage,
      candidates,
      echoesSuppressed,
      warnings,
    };
  }

  resolveEvidenceAnchors(requests: readonly EvidenceAnchorRequest[]): EvidenceAnchorResolution[] {
    if (!Array.isArray(requests) || requests.length > 256) {
      throw new Error("Mooncite anchor resolution accepts at most 256 locators.");
    }
    for (const request of requests) {
      if (!request || typeof request !== "object" || !isBoundedIdentifier(request.locator, 2_048)) {
        throw new Error("Mooncite evidence anchor locator is invalid.");
      }
      if (request.expectedSource
        && (!SOURCE_ORIGINS.includes(request.expectedSource.sourceOrigin)
          || !/^[a-f0-9]{64}$/u.test(request.expectedSource.sourceRootDigest))) {
        throw new Error("Mooncite evidence anchor source expectation is invalid.");
      }
    }
    const projection = { trustState: this.#last.trustState, coverage: this.#last.coverage };
    let authorizedRoots: Set<string>;
    try {
      authorizedRoots = new Set(this.#configuredRoots().map((source) =>
        `${source.origin}\0${sourceAuthorizationDigest(source.root, source.discovery)}`));
    } catch {
      return requests.map((request): EvidenceAnchorResolution => ({
        locator: request.locator,
        outcome: "unavailable",
        freshness: "unavailable",
        ...projection,
        anchor: null,
      }));
    }
    const freshness = this.#last.retainedLastGood ? "last_good" as const : "current" as const;
    const statement = this.#db.prepare(`
      SELECT e.*, sf.source_root_digest
      FROM evidence e JOIN source_files sf ON sf.source_path = e.source_path
      WHERE e.evidence_id = ? OR e.evidence_uri = ?
      ORDER BY CASE WHEN e.evidence_id = ? THEN 0 ELSE 1 END
      LIMIT 1
    `);
    return requests.map((request): EvidenceAnchorResolution => {
      if (request.expectedSource
        && !authorizedRoots.has(`${request.expectedSource.sourceOrigin}\0${request.expectedSource.sourceRootDigest}`)) {
        return { locator: request.locator, outcome: "deauthorized", freshness, ...projection, anchor: null };
      }
      const row = statement.get(request.locator, request.locator, request.locator) as
        Record<string, string | number | null> | undefined;
      if (!row) return { locator: request.locator, outcome: "missing", freshness, ...projection, anchor: null };
      const sourceOrigin = parseSourceOrigin(row.source_origin);
      const sourceRootDigest = String(row.source_root_digest);
      if (!authorizedRoots.has(`${sourceOrigin}\0${sourceRootDigest}`)) {
        return { locator: request.locator, outcome: "deauthorized", freshness, ...projection, anchor: null };
      }
      const text = String(row.text);
      const project = String(row.project);
      const sessionId = qualifiedSessionId(sourceOrigin, sourceRootDigest, String(row.session_id));
      const role = String(row.role);
      const sourceKind = String(row.source_kind);
      const parentId = row.parent_id === null ? null : String(row.parent_id);
      const branchState: EvidenceAnchorSnapshot["branchState"] = String(row.branch_state) === "current" ? "current" : "off_branch";
      const compactionState = parseCompactionState(row.compaction_state);
      const contextDigest = sha256([
        "anchor-context-v1",
        sourceOrigin,
        sourceRootDigest,
        project,
        sessionId,
        role,
        sourceKind,
        parentId ?? "<null>",
        branchState,
        compactionState,
      ].join("\0"));
      return {
        locator: request.locator,
        outcome: "resolved",
        freshness,
        ...projection,
        anchor: {
          evidenceId: String(row.evidence_id),
          evidenceUri: String(row.evidence_uri),
          sourceOrigin,
          sourceRootDigest,
          project,
          sessionId,
          recordDigest: String(row.record_digest),
          spanDigest: sha256(text),
          contextDigest,
          role,
          sourceKind,
          parentId,
          branchState,
          compactionState,
          isMoonciteRendering: isMoonciteRenderingText(text),
        },
      };
    });
  }

  inspect(input: { evidenceId: string; window?: number }): EvidenceInspection {
    const row = this.#db.prepare(`
      SELECT e.*, sf.source_root_digest
      FROM evidence e JOIN source_files sf ON sf.source_path = e.source_path
      WHERE e.evidence_id = ? OR e.evidence_uri = ?
      ORDER BY CASE WHEN e.evidence_id = ? THEN 0 ELSE 1 END
      LIMIT 1
    `).get(input.evidenceId, input.evidenceId, input.evidenceId) as Record<string, string | number | null> | undefined;
    if (!row) {
      return { outcome: "unavailable", evidenceId: input.evidenceId, target: null, window: [], locator: null, message: "Evidence ID or URI is not present in the active generation." };
    }
    input = { ...input, evidenceId: String(row.evidence_id) };
    const sourceOrigin = parseSourceOrigin(row.source_origin);
    const sourcePath = String(row.source_path);
    const location = this.#locationForStored({
      source_path: sourcePath,
      source_origin: sourceOrigin,
      source_root_digest: String(row.source_root_digest),
    });
    const locator: NonNullable<EvidenceInspection["locator"]> = {
      sourceOrigin,
      relativePath: location?.relativePath ?? sourcePath,
      sessionId: qualifiedSessionId(sourceOrigin, String(row.source_root_digest), String(row.session_id)),
      entryId: String(row.entry_id),
      spanOrdinal: Number(String(row.evidence_id).split(":").at(-1) ?? 0),
      line: Number(row.line),
      byteStart: Number(row.byte_start),
      byteEnd: Number(row.byte_end),
      recordDigest: String(row.record_digest),
      prefixDigest: String(row.prefix_digest),
      prefixDigestKind: String(row.prefix_digest).startsWith("append-chain:") ? "append_chain_sha256" : "full_prefix_sha256",
    };
    const asSpan = (value: Record<string, string | number | null>, relation: InspectedSpan["relation"]): InspectedSpan => {
      const bounded = truncateUtf8(String(value.text), relation === "target" ? 4_096 : 512);
      const origin = parseSourceOrigin(value.source_origin);
      return {
        relation,
        evidenceId: String(value.evidence_id),
        text: bounded.text,
        sessionId: qualifiedSessionId(origin, sourceRootDigestFromSourcePath(origin, String(value.source_path)), String(value.session_id)),
        entryId: String(value.entry_id),
        parentId: value.parent_id === null ? null : String(value.parent_id),
        role: parseEvidenceRole(value.role),
        sourceOrigin: origin,
        sourceKind: String(value.source_kind),
        eventTimestamp: typeof value.event_timestamp === "string" ? normalizeIsoTimestamp(value.event_timestamp) : null,
        recordProvenance: origin === "chatgpt" ? "copy" : "original",
        branchState: String(value.branch_state) === "current" ? "current" : "off_branch",
        compactionState: parseCompactionState(value.compaction_state),
        omittedBytes: bounded.omittedBytes,
      };
    };
    const target = asSpan(row, "target");
    if (!location) {
      return { outcome: "excluded", evidenceId: input.evidenceId, target: null, window: [], locator, message: "Locator escapes the authorized source root." };
    }
    const absolutePath = location.path;
    if (hasSymlinkComponent(location.root) || hasSymlinkComponent(absolutePath)) {
      return { outcome: "excluded", evidenceId: input.evidenceId, target: null, window: [], locator, message: "Source path contains a symbolic-link component." };
    }
    if (!existsSync(absolutePath)) {
      return { outcome: "missing", evidenceId: input.evidenceId, target, window: [], locator, message: "Source file is missing." };
    }
    const file = lstatSync(absolutePath);
    if (!file.isFile() || file.isSymbolicLink()) {
      return { outcome: "excluded", evidenceId: input.evidenceId, target: null, window: [], locator, message: "Source is no longer an authorized regular file." };
    }
    const radius = Math.min(10, Math.max(0, input.window ?? 2));
    const spanOrdinalSql = "CAST(substr(evidence_id, length(rtrim(evidence_id, '0123456789')) + 1) AS INTEGER)";
    const beforeRows = radius === 0 ? [] : (this.#db.prepare(`
      SELECT * FROM evidence
      WHERE source_path = ? AND (byte_start < ? OR (byte_start = ? AND ${spanOrdinalSql} < ?))
      ORDER BY byte_start DESC, ${spanOrdinalSql} DESC LIMIT ?
    `).all(sourcePath, locator.byteStart, locator.byteStart, locator.spanOrdinal, radius) as Array<Record<string, string | number | null>>).reverse();
    const afterRows = radius === 0 ? [] : this.#db.prepare(`
      SELECT * FROM evidence
      WHERE source_path = ? AND (byte_start > ? OR (byte_start = ? AND ${spanOrdinalSql} > ?))
      ORDER BY byte_start, ${spanOrdinalSql} LIMIT ?
    `).all(sourcePath, locator.byteStart, locator.byteStart, locator.spanOrdinal, radius) as Array<Record<string, string | number | null>>;
    const allRows = [...beforeRows, row, ...afterRows];
    const selectedIds = new Set<string>([String(row.evidence_id)]);
    const selectedRangeKeys = new Set<string>();
    const targetRangeKey = `${row.byte_start}:${row.byte_end}`;
    selectedRangeKeys.add(targetRangeKey);
    let selectedBytes = Number(row.byte_end) - Number(row.byte_start);
    const includeWithinBudget = (candidate: Record<string, string | number | null> | undefined): void => {
      if (!candidate) return;
      const key = `${candidate.byte_start}:${candidate.byte_end}`;
      const size = Number(candidate.byte_end) - Number(candidate.byte_start);
      if (!selectedRangeKeys.has(key) && selectedBytes + size > MAX_INSPECTION_CAPTURE_BYTES) return;
      selectedIds.add(String(candidate.evidence_id));
      if (!selectedRangeKeys.has(key)) {
        selectedRangeKeys.add(key);
        selectedBytes += size;
      }
    };
    for (let offset = 0; offset < radius; offset++) {
      includeWithinBudget(beforeRows[beforeRows.length - 1 - offset]);
      includeWithinBudget(afterRows[offset]);
    }
    const selectedRows = allRows.filter((value) => selectedIds.has(String(value.evidence_id)));
    const selectedTargetIndex = selectedRows.findIndex((value) => String(value.evidence_id) === String(row.evidence_id));
    let captured: Buffer[];
    try {
      const ranges = selectedRows.map((value) => ({ start: Number(value.byte_start), end: Number(value.byte_end) }));
      const bytes = readRangesCoherently(absolutePath, location.root, ranges);
      if (bytes === null) {
        const currentSize = statSync(absolutePath).size;
        const missingRange = ranges.some((range) => range.start < 0 || range.end < range.start || range.end > currentSize);
        return missingRange
          ? { outcome: "stale", evidenceId: input.evidenceId, target, window: [], locator, message: "Located source bytes no longer exist." }
          : { outcome: "corrupt", evidenceId: input.evidenceId, target: null, window: [], locator, message: "Source window could not be captured coherently." };
      }
      captured = bytes;
    } catch {
      return { outcome: "corrupt", evidenceId: input.evidenceId, target: null, window: [], locator, message: "Located source bytes could not be read safely." };
    }
    const targetBytes = captured[selectedTargetIndex]!;
    if (sha256(targetBytes) !== locator.recordDigest) {
      let changed: Record<string, unknown>;
      try {
        changed = JSON.parse(targetBytes.toString("utf8")) as Record<string, unknown>;
      } catch {
        return { outcome: "corrupt", evidenceId: input.evidenceId, target: null, window: [], locator, message: "Located source record is no longer valid JSON." };
      }
      const changedIdentity = recordMatchesIdentity(sourceOrigin, changed, locator.line, targetBytes, locator.entryId);
      if (sourceOrigin !== "codex" && !changedIdentity) {
        return { outcome: "corrupt", evidenceId: input.evidenceId, target: null, window: [], locator, message: "Located source bytes now resolve to a different record." };
      }
      return { outcome: "stale", evidenceId: input.evidenceId, target, window: [], locator, message: "Located source record changed after indexing." };
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(targetBytes.toString("utf8")) as Record<string, unknown>;
    } catch {
      return { outcome: "corrupt", evidenceId: input.evidenceId, target: null, window: [], locator, message: "Located source record is invalid JSON." };
    }
    if (!recordMatchesIdentity(sourceOrigin, parsed, locator.line, targetBytes, locator.entryId)) {
      return { outcome: "corrupt", evidenceId: input.evidenceId, target: null, window: [], locator, message: "Located source identity does not match the evidence ID." };
    }
    for (let index = 0; index < selectedRows.length; index++) {
      if (sha256(captured[index]!) !== String(selectedRows[index]!.record_digest)) {
        return { outcome: "stale", evidenceId: input.evidenceId, target, window: [], locator, message: "A source-window record changed after indexing." };
      }
    }
    const window = selectedRows.map((value, index) =>
      asSpan(value, index < selectedTargetIndex ? "before" : index > selectedTargetIndex ? "after" : "target"),
    );
    return { outcome: "verified", evidenceId: input.evidenceId, target, window, locator };
  }

  #memoryStatus(state: ScanResult): MoonciteStatus {
    const stateBytes = statSync(this.#databasePath).size;
    const searchUsable = state.retainedLastGood || this.#lastEvidenceCount > 0 || (state.sourceFiles > 0 && state.fatalErrors === 0);
    const outcome: MoonciteStatus["outcome"] = !searchUsable
      ? "unavailable"
      : state.retainedLastGood || state.coverage === "partial" || state.errors > 0
        ? "degraded"
        : "ready";
    const freshness: MoonciteStatus["freshness"] = outcome === "unavailable"
      ? "unavailable"
      : state.retainedLastGood
        ? "last_good"
        : "current";
    const meaning = outcome === "ready"
      ? "Mooncite is ready with a current, completely covered evidence generation."
      : outcome === "degraded"
        ? "Mooncite can search retained evidence, but freshness or source coverage is degraded. Empty recall results are not conclusive."
        : "Mooncite has no usable evidence generation.";
    const nextReason = state.errorGroups.some((group) => group.reason === "source_limit_exceeded")
      ? "Mooncite hit a bounded source-discovery or ingestion limit. Rebuilding alone will repeat it until the authorized source set or supported limit changes."
      : state.errorGroups.some((group) =>
        group.reason === "source_root_unavailable" || group.reason === "source_configuration_failure")
        ? "Restore the authorized source root or configuration, then rebuild the derived index."
        : "Rebuild the derived index from authorized source history, then check status again.";
    const next: MoonciteNextAction | null = outcome === "ready"
      ? null
      : {
        action: "run",
        target: "mooncite rebuild",
        reason: nextReason,
      };
    const sourceFilesByOrigin: Record<SourceOrigin, number> = { pi: 0, omp: 0, "claude-code": 0, codex: 0, chatgpt: 0 };
    for (const source of this.#storedSources()) sourceFilesByOrigin[source.source_origin]++;
    const errorGroups = state.errorGroups.map((group) => ({ ...group }));
    return {
      outcome,
      meaning,
      next,
      freshness,
      generation: state.generation,
      trustState: state.trustState,
      coverage: state.coverage,
      sourceRoot: "authorized-conversation-sources",
      sourceFilesByOrigin,
      sourceFiles: state.sourceFiles,
      records: state.records,
      eligibleRecords: state.eligibleRecords,
      evidenceSpans: this.#lastEvidenceCount,
      skipped: state.skipped,
      malformed: state.malformed,
      oversized: state.oversized,
      errors: state.errors,
      errorGroups,
      stateBytes,
      lastSuccessfulRefreshAt: this.#lastSuccessfulRefreshAt,
      lastRefreshOutcome: this.#lastRefreshOutcome,
      lastRebuildOutcome: this.#lastRebuildOutcome,
      searchUsable,
    };
  }

  status(): MoonciteStatus {
    return this.#memoryStatus(this.refresh());
  }

  close(): void {
    try {
      this.#db.close();
    } finally {
      rmSync(this.#engineLockPath, { force: true });
    }
  }
}
