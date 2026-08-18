import { createHash } from "node:crypto";
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
  statSync,
  type Dirent,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TextDecoder } from "node:util";

const MAX_LINE_BYTES = 16 * 1024 * 1024;
const MAX_APPEND_CAPTURE_BYTES = 16 * 1024 * 1024;
const MAX_APPEND_LINES = 4_096;
const MAX_EVIDENCE_TEXT_BYTES = 256 * 1024;
const MAX_SOURCE_IDENTIFIER_BYTES = 256;
const MAX_SOURCE_KIND_BYTES = 64;
const PRESENTATION_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const DERIVATION_VERSION = "5";
const EVIDENCE_ID_PREFIX = "mooncite:pi:";

function evidenceId(sessionId: string, entryId: string, ordinal: number): string {
  return `${EVIDENCE_ID_PREFIX}${sessionId}:${entryId}:${ordinal}`;
}

function evidenceUri(sessionId: string, entryId: string, ordinal: number): string {
  return `mooncite://pi/${encodeURIComponent(sessionId)}/${encodeURIComponent(entryId)}/${ordinal}`;
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
    source_kind TEXT NOT NULL,
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
  CREATE VIRTUAL TABLE IF NOT EXISTS evidence_fts USING fts5(
    evidence_id UNINDEXED,
    text,
    tokenize='porter unicode61 remove_diacritics 2'
  );
  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS source_files (
    source_path TEXT PRIMARY KEY,
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
    PRIMARY KEY (source_path, entry_id),
    UNIQUE (source_path, line)
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
  stateDir: string;
}

export type RelevanceBand = "strong" | "partial" | "weak";
export type TrustState = "full_verified" | "append_trusted";
export type CoverageState = "complete" | "partial";

export interface EvidenceCandidate {
  evidenceId: string;
  evidenceUri: string;
  excerpt: string;
  project: string;
  sessionId: string;
  entryId: string;
  role: string;
  sourceKind: string;
  parentId: string | null;
  branchState: "current" | "off_branch";
  compactionState: "none" | "pre_compaction" | "summary" | "kept_after_compaction";
  duplicateSpanCount?: number;
  relevance: { band: RelevanceBand; matchedTerms: string[] };
}

export interface EvidenceBundle {
  outcome: "matches" | "weak_leads" | "no_match" | "unavailable";
  query: string;
  lexicalTerms: string[];
  scope: { project: string | null; sessionId: string | null; evidenceSpans: number };
  generation: string;
  trustState: TrustState;
  coverage: CoverageState;
  candidates: EvidenceCandidate[];
  warnings: string[];
}

export type RefreshOutcome = "not_run" | "published" | "unchanged" | "retained_last_good" | "unavailable";

export interface MoonciteStatus {
  outcome: "ready" | "unavailable";
  freshness: "current" | "last_good" | "unavailable";
  generation: string;
  trustState: TrustState;
  coverage: CoverageState;
  sourceRoot: string;
  sourceFiles: number;
  records: number;
  eligibleRecords: number;
  evidenceSpans: number;
  skipped: number;
  malformed: number;
  oversized: number;
  errors: number;
  stateBytes: number;
  lastRefreshOutcome: RefreshOutcome;
  lastRebuildOutcome: RefreshOutcome;
  lastGoodUsable: boolean;
}

export type InspectionOutcome = "verified" | "stale" | "missing" | "excluded" | "corrupt" | "unavailable";

export interface InspectedSpan {
  relation: "before" | "target" | "after";
  evidenceId: string;
  text: string;
  sessionId: string;
  entryId: string;
  parentId: string | null;
  role: string;
  sourceKind: string;
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

interface IndexedEvidence extends Omit<EvidenceCandidate, "relevance"> {
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
  sourcePath: string;
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
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return { text: value, omittedBytes: 0 };
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let end = Math.max(0, maxBytes);
  while (end > 0) {
    try {
      return { text: decoder.decode(bytes.subarray(0, end)), omittedBytes: bytes.length - end };
    } catch {
      end--;
    }
  }
  return { text: "", omittedBytes: bytes.length };
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

export function isMoonciteToolRendering(role: string, text: string): boolean {
  if (role !== "toolResult") return false;
  const head = text.slice(0, 4_096);
  const scope = "(?:; scope(?: project=[^\\s\\]\\r\\n]{1,256})?(?: session_id=[^\\s\\]\\r\\n]{1,256})? contains [0-9]{1,12} indexed span\\(s\\))?";
  const trust = `\\[(?:full_verified|append_trusted); (?:complete|partial) coverage${scope}\\]`;
  const tail = "(?: Warnings: [^\\r\\n]{1,1024})?(?:\\n|$)";
  return new RegExp(`^(?:Evidence for|Weak evidence leads for) “[\\s\\S]{0,2200}?”: {0,2}${trust}${tail}`, "u").test(head)
    || new RegExp(`^(?:No evidence matched|Mooncite evidence is unavailable for) “[\\s\\S]{0,2200}?”\\. ${trust}${tail}`, "u").test(head)
    || /^Verified evidence mooncite:pi:[^\n]{1,2200}:\n/u.test(head)
    || /^Evidence (?:mooncite:pi:|mooncite:\/\/pi\/)[^\n]{1,2200}: (?:stale|missing|excluded|corrupt|unavailable)\./u.test(head)
    || /^Mooncite is (?:ready|unavailable) \((?:current|last_good|unavailable), (?:full_verified|append_trusted), (?:complete|partial) coverage\):/u.test(head);
}

function isBoundedIdentifier(value: unknown, maxBytes = MAX_SOURCE_IDENTIFIER_BYTES): value is string {
  return typeof value === "string"
    && value.length > 0
    && Buffer.byteLength(value, "utf8") <= maxBytes
    && !PRESENTATION_CONTROL_PATTERN.test(value);
}

function projectIdentity(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/{2,}/gu, "/").replace(/\/$/u, "") || "root";
  const rawLabel = normalized.split("/").filter(Boolean).at(-1) || "root";
  const label = rawLabel.normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64) || "root";
  const digest = sha256(`project-identity-v2\0${normalized}`).slice(0, 16);
  return `project:${encodeURIComponent(label)}-${digest}`;
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

function listSessionFiles(root: string): { files: string[]; errors: number } {
  if (hasSymlinkComponent(root) || !existsSync(root)) return { files: [], errors: 0 };
  const rootState = lstatSync(root);
  if (rootState.isSymbolicLink() || !rootState.isDirectory()) return { files: [], errors: 1 };
  const canonicalRoot = resolve(root);
  const files: string[] = [];
  let errors = 0;
  const visit = (directory: string): void => {
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      errors++;
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const canonical = resolve(path);
        if (canonical.startsWith(`${canonicalRoot}${sep}`)) files.push(canonical);
      }
    }
  };
  visit(canonicalRoot);
  return { files: files.sort(), errors };
}

function readRangesCoherently(path: string, ranges: Array<{ start: number; end: number }>): Buffer[] | null {
  const before = sourceMetadata(path);
  const maxEnd = ranges.reduce((maximum, range) => Math.max(maximum, range.end), 0);
  if (!before || ranges.some((range) => range.start < 0 || range.end < range.start) || maxEnd > before.size) return null;
  const readRanges = (): Buffer[] | null => {
    const fd = openVerifiedSource(path, before);
    if (fd === null) return null;
    try {
      return ranges.map((range) => {
        const size = range.end - range.start;
        const bytes = Buffer.alloc(size);
        let offset = 0;
        while (offset < size) {
          const count = readSync(fd, bytes, offset, size - offset, range.start + offset);
          if (count === 0) break;
          offset += count;
        }
        return bytes.subarray(0, offset);
      });
    } finally {
      closeSync(fd);
    }
  };
  const first = readRanges();
  if (!first || first.some((bytes, index) => bytes.length !== ranges[index]!.end - ranges[index]!.start)) return null;
  const after = sourceMetadata(path);
  if (!after || before.dev !== after.dev || before.ino !== after.ino || after.size < maxEnd) return null;
  const changed = before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs;
  if (!changed) return first;
  const second = readRanges();
  return second && first.every((bytes, index) => bytes.equals(second[index]!)) ? first : null;
}

function hashFilePrefix(path: string, size: number, expected: NonNullable<ReturnType<typeof sourceMetadata>>): string {
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
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= MAX_EVIDENCE_TEXT_BYTES) return value.trim() ? [value] : [];
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

function readableSpans(entry: Record<string, unknown>): Array<{ role: string; text: string }> {
  if (entry.type === "message") {
    const message = entry.message;
    if (!message || typeof message !== "object") return [];
    const role = typeof (message as Record<string, unknown>).role === "string"
      ? String((message as Record<string, unknown>).role)
      : "unknown";
    const content = (message as Record<string, unknown>).content;
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

interface StoredSourceRow {
  source_path: string;
  session_id: string;
  project: string;
  dev: string;
  ino: string;
  observed_size: number;
  admitted_bytes: number;
  mtime_ns: string;
  ctime_ns: string;
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

function sourceMetadata(path: string): { dev: string; ino: string; size: number; mtimeNs: string; ctimeNs: string } | null {
  if (hasSymlinkComponent(path)) return null;
  const metadata = lstatSync(path, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
  const size = Number(metadata.size);
  if (!Number.isSafeInteger(size) || size < 0) return null;
  return {
    dev: metadata.dev.toString(),
    ino: metadata.ino.toString(),
    size,
    mtimeNs: metadata.mtimeNs.toString(),
    ctimeNs: metadata.ctimeNs.toString(),
  };
}

function openVerifiedSource(path: string, expected: NonNullable<ReturnType<typeof sourceMetadata>>): number | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.isSymbolicLink() || opened.dev.toString() !== expected.dev || opened.ino.toString() !== expected.ino) {
      closeSync(fd);
      return null;
    }
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function coherentAppend(path: string, start: number): { bytes: Buffer; capturedSize: number; metadata: NonNullable<ReturnType<typeof sourceMetadata>> } | null {
  const before = sourceMetadata(path);
  if (!before || before.size < start) return null;
  const capturedSize = before.size;
  const readSuffix = (): Buffer | null => {
    const size = capturedSize - start;
    const fd = openVerifiedSource(path, before);
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
  const after = sourceMetadata(path);
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
  path: string,
  root: string,
  stored: StoredSourceRow,
  existingEntryIds: Set<string>,
): SourceSnapshot | "requires_full" | null {
  const captured = coherentAppend(path, stored.admitted_bytes);
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
        evidenceId: evidenceId(stored.session_id, entry.id, ordinal),
        evidenceUri: evidenceUri(stored.session_id, entry.id, ordinal),
        excerpt: span.text,
        text: span.text,
        project: stored.project,
        sessionId: stored.session_id,
        entryId: entry.id,
        role: span.role,
        sourceKind: entry.type,
        sourcePath: relative(root, path),
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
    sourcePath: stored.source_path,
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
  readonly #root: string;
  readonly #stateDir: string;
  readonly #databasePath: string;
  readonly #db: DatabaseSync;
  #last: ScanResult = { evidence: [], sourceFiles: 0, records: 0, eligibleRecords: 0, skipped: 0, malformed: 0, oversized: 0, errors: 0, fatalErrors: 0, generation: "empty", trustState: "full_verified", coverage: "complete", retainedLastGood: false };
  #lastEvidenceCount = 0;
  #lastRefreshOutcome: RefreshOutcome = "not_run";
  #lastRebuildOutcome: RefreshOutcome = "not_run";

  constructor(options: EngineOptions) {
    this.#root = resolve(options.sessionsRoot);
    this.#stateDir = resolve(options.stateDir);
    if (hasSymlinkComponent(this.#stateDir)) throw new Error("Mooncite state path contains a symbolic-link component.");
    if (existsSync(this.#stateDir)) {
      const state = lstatSync(this.#stateDir);
      if (state.isSymbolicLink() || !state.isDirectory()) throw new Error("Mooncite state path is not an owned regular directory.");
    }
    mkdirSync(this.#stateDir, { recursive: true, mode: 0o700 });
    if (hasSymlinkComponent(this.#stateDir)) throw new Error("Mooncite state path contains a symbolic-link component.");
    chmodSync(this.#stateDir, 0o700);
    this.#databasePath = join(this.#stateDir, "index.sqlite");
    if (existsSync(this.#databasePath)) {
      const database = lstatSync(this.#databasePath);
      if (database.isSymbolicLink() || !database.isFile()) throw new Error("Mooncite index path is not an owned regular file.");
    }
    let database: DatabaseSync;
    try {
      database = openInitializedDatabase(this.#databasePath);
    } catch (error) {
      if (!existsSync(this.#databasePath) || !isRecoverableDatabaseCorruption(error)) throw error;
      rmSync(this.#databasePath, { force: true });
      rmSync(`${this.#databasePath}-journal`, { force: true });
      database = openInitializedDatabase(this.#databasePath);
    }
    this.#db = database;
    chmodSync(this.#databasePath, 0o600);
    const derivation = this.#db.prepare("SELECT value FROM metadata WHERE key = 'derivation_version'").get() as { value?: string } | undefined;
    if (derivation?.value !== DERIVATION_VERSION) {
      this.#db.exec("BEGIN IMMEDIATE");
      try {
        const current = this.#db.prepare("SELECT value FROM metadata WHERE key = 'derivation_version'").get() as { value?: string } | undefined;
        if (current?.value !== DERIVATION_VERSION) {
          this.#db.exec("DELETE FROM evidence; DELETE FROM evidence_fts; DELETE FROM source_records; DELETE FROM source_files; DELETE FROM metadata WHERE key = 'last_good';");
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
        const state = JSON.parse(stored.value) as Omit<ScanResult, "evidence" | "malformed" | "oversized" | "trustState"> & {
          evidenceSpans: number;
          malformed?: number;
          oversized?: number;
          lastRefreshOutcome?: RefreshOutcome;
          lastRebuildOutcome?: RefreshOutcome;
          trustState?: TrustState;
          coverage?: CoverageState;
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
  }

  #setOperationOutcome(operation: "refresh" | "rebuild", outcome: RefreshOutcome): void {
    if (operation === "refresh") this.#lastRefreshOutcome = outcome;
    else this.#lastRebuildOutcome = outcome;
  }

  refresh(): ScanResult {
    return this.#performRefresh("refresh", false);
  }

  #storedSources(): StoredSourceRow[] {
    return this.#db.prepare("SELECT * FROM source_files ORDER BY source_path").all() as unknown as StoredSourceRow[];
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
    this.#db.prepare(`INSERT OR REPLACE INTO source_files VALUES (${Array.from({ length: 23 }, () => "?").join(", ")})`).run(
      source.sourcePath, source.sessionId, source.project, source.dev, source.ino, source.observedSize,
      source.admittedBytes, source.mtimeNs, source.ctimeNs, source.physicalLines, source.records,
      source.eligibleRecords, source.evidenceSpans, source.skipped, source.malformed, source.oversized,
      source.errors, source.fatalErrors, source.leafEntryId, source.latestCompactionLine,
      source.prefixDigest, source.sourceGeneration, source.trustState,
    );
  }

  #insertEvidence(items: IndexedEvidence[]): void {
    const insertEvidence = this.#db.prepare(`INSERT INTO evidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertFts = this.#db.prepare("INSERT INTO evidence_fts(evidence_id, text) VALUES (?, ?)");
    for (const item of items) {
      insertEvidence.run(
        item.evidenceId, item.evidenceUri, item.text, item.project, item.sessionId, item.entryId, item.role,
        item.sourceKind, item.sourcePath, item.line, item.byteStart, item.byteEnd, item.recordDigest,
        item.prefixDigest, item.parentId, item.branchState, item.compactionState,
      );
      insertFts.run(item.evidenceId, item.text);
    }
  }

  #indexFullSource(path: string): SourceSnapshot {
    const metadata = sourceMetadata(path);
    if (!metadata) throw new Error("Mooncite source is not a regular file.");
    const sourcePath = relative(this.#root, path);
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
    let project: string | null = null;
    let leafEntryId: string | null = null;
    let latestCompactionLine: number | null = null;
    const seenEntryIds = new Set<string>();
    const insertRecord = this.#db.prepare("INSERT INTO source_records(source_path, entry_id, parent_id, line, source_kind) VALUES (?, ?, ?, ?, ?)");
    const insertEvidence = this.#db.prepare(`INSERT INTO evidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertFts = this.#db.prepare("INSERT INTO evidence_fts(evidence_id, text) VALUES (?, ?)");
    const findEvidence = this.#db.prepare("SELECT 1 AS found FROM evidence WHERE evidence_id = ?");

    const processLine = (end: number): void => {
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
      if (physicalLine === 1) {
        if (entry.type !== "session" || entry.version !== 3 || !isBoundedIdentifier(entry.id)) throw new Error("Mooncite session header is unsupported.");
        sessionId = entry.id;
        const projectSource = typeof entry.cwd === "string" ? entry.cwd : sourcePath.split(sep)[0] ?? "unknown";
        project = projectIdentity(projectSource);
        records = 1;
        eligibleRecords = 1;
        return;
      }
      records++;
      const parentId = entry.parentId === null || entry.parentId === undefined
        ? null
        : isBoundedIdentifier(entry.parentId) ? entry.parentId : undefined;
      if (!isBoundedIdentifier(entry.id) || !isBoundedIdentifier(entry.type, MAX_SOURCE_KIND_BYTES) || parentId === undefined) {
        skipped++;
        malformed++;
        errors++;
        return;
      }
      if (seenEntryIds.has(entry.id)) {
        skipped++;
        errors++;
        return;
      }
      seenEntryIds.add(entry.id);
      eligibleRecords++;
      insertRecord.run(sourcePath, entry.id, parentId, physicalLine, entry.type);
      leafEntryId = entry.id;
      if (entry.type === "compaction") latestCompactionLine = physicalLine;
      const spans = readableSpans(entry);
      for (let ordinal = 0; ordinal < spans.length; ordinal++) {
        const span = spans[ordinal]!;
        const identifier = evidenceId(sessionId!, entry.id, ordinal);
        if ((findEvidence.get(identifier) as { found?: number } | undefined)?.found) {
          skipped++;
          errors++;
          continue;
        }
        const sourceKind = entry.type;
        insertEvidence.run(
          identifier,
          evidenceUri(sessionId!, entry.id, ordinal),
          span.text,
          project!,
          sessionId!,
          entry.id,
          span.role,
          sourceKind,
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
        insertFts.run(identifier, span.text);
        evidenceSpans++;
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
          prefixHash.update(Buffer.from([0x0a]));
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
    const after = sourceMetadata(path);
    if (!after || after.dev !== metadata.dev || after.ino !== metadata.ino || after.size < captureSize) throw new Error("Mooncite source changed identity while indexing.");
    const changed = after.size !== metadata.size || after.mtimeNs !== metadata.mtimeNs || after.ctimeNs !== metadata.ctimeNs;
    if (changed && hashFilePrefix(path, captureSize, after) !== firstDigest) throw new Error("Mooncite source prefix changed while indexing.");
    const prefixDigest = admittedHash.digest("hex");
    this.#db.prepare("UPDATE evidence SET prefix_digest = ? WHERE source_path = ?").run(prefixDigest, sourcePath);
    return {
      sourcePath,
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
      SELECT evidence_id, record_digest, source_path, line, byte_start, byte_end, project, branch_state, compaction_state
      FROM evidence WHERE source_path = ? ORDER BY evidence_id
    `).all(sourcePath) as Array<Record<string, string | number>>;
    return sha256(rows.map((item) => [
      item.evidence_id,
      item.record_digest,
      item.source_path,
      item.line,
      item.byte_start,
      item.byte_end,
      item.project,
      item.branch_state,
      item.compaction_state,
    ].join(":")).join("\n"));
  }

  #publishChanges(
    appendPlans: Array<{ stored: StoredSourceRow; source: SourceSnapshot }>,
    newPaths: string[],
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
      for (const plan of appendPlans) {
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
      for (const sourcePath of removedPaths) {
        this.#db.prepare("DELETE FROM evidence_fts WHERE evidence_id IN (SELECT evidence_id FROM evidence WHERE source_path = ?)").run(sourcePath);
        this.#db.prepare("DELETE FROM evidence WHERE source_path = ?").run(sourcePath);
        this.#db.prepare("DELETE FROM source_records WHERE source_path = ?").run(sourcePath);
        this.#db.prepare("DELETE FROM source_files WHERE source_path = ?").run(sourcePath);
      }
      const insertRecord = this.#db.prepare("INSERT INTO source_records(source_path, entry_id, parent_id, line, source_kind) VALUES (?, ?, ?, ?, ?)");
      for (const path of newPaths) {
        const sourcePath = relative(this.#root, path);
        const existing = this.#db.prepare("SELECT 1 AS found FROM source_files WHERE source_path = ?").get(sourcePath) as { found?: number } | undefined;
        if (existing?.found) throw new Error(`Mooncite source appeared concurrently: ${sourcePath}`);
        const source = this.#indexFullSource(path);
        this.#writeSource(source);
        this.#relabelSource(source.sourcePath, source.leafEntryId, source.latestCompactionLine);
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
      const changed = admitted || newPaths.length > 0 || removedPaths.length > 0;
      const outcome: RefreshOutcome = changed ? "published" : "unchanged";
      this.#persistLastGood(state, operation, outcome);
      this.#db.exec("COMMIT");
      this.#last = state;
      this.#lastEvidenceCount = this.#storedSources().reduce((sum, source) => sum + source.evidence_spans, 0);
      this.#setOperationOutcome(operation, outcome);
      return state;
    } catch (error) {
      try { this.#db.exec("ROLLBACK"); } catch { /* Preserve the append failure. */ }
      if (this.#last.generation !== "empty") return this.#retainForSourceFailure(operation);
      throw error;
    }
  }

  #retainForSourceFailure(operation: "refresh" | "rebuild", count = 1): ScanResult {
    const base = this.#storedSources().length > 0 ? this.#stateFromSourceFiles() : this.#last;
    this.#last = {
      ...base,
      skipped: base.skipped + count,
      errors: base.errors + count,
      fatalErrors: count,
      coverage: "partial",
      retainedLastGood: base.generation !== "empty",
    };
    this.#setOperationOutcome(operation, this.#last.retainedLastGood ? "retained_last_good" : "unavailable");
    return this.#last;
  }

  #performRefresh(operation: "refresh" | "rebuild", force: boolean): ScanResult {
    if (force) return this.#performFullRefresh(operation, true);
    const rootExists = existsSync(this.#root);
    const rootState = rootExists ? lstatSync(this.#root) : null;
    const rootUnauthorized = hasSymlinkComponent(this.#root) || Boolean(rootState && (rootState.isSymbolicLink() || !rootState.isDirectory()));
    if (rootUnauthorized || (!rootExists && this.#last.generation !== "empty")) {
      return this.#retainForSourceFailure(operation);
    }
    const scan = listSessionFiles(this.#root);
    const files = scan.files;
    const stored = this.#storedSources();
    if (this.#last.generation === "empty" || stored.length === 0) return this.#performFullRefresh(operation, false);
    if (scan.errors > 0) return this.#retainForSourceFailure(operation, scan.errors);
    const byPath = new Map(stored.map((source) => [source.source_path, source]));
    const currentPaths = new Set(files.map((path) => relative(this.#root, path)));
    const removedPaths = stored.map((source) => source.source_path).filter((sourcePath) => !currentPaths.has(sourcePath));
    const appendPlans: Array<{ path: string; stored: StoredSourceRow }> = [];
    const newPaths: string[] = [];
    for (const path of files) {
      const relativePath = relative(this.#root, path);
      const previous = byPath.get(relativePath);
      if (!previous) {
        newPaths.push(path);
        continue;
      }
      const metadata = sourceMetadata(path);
      if (!metadata) return this.#retainForSourceFailure(operation);
      const exact = metadata.dev === previous.dev && metadata.ino === previous.ino && metadata.size === previous.observed_size && metadata.mtimeNs === previous.mtime_ns && metadata.ctimeNs === previous.ctime_ns;
      if (exact) continue;
      const monotonicAppend = metadata.dev === previous.dev && metadata.ino === previous.ino && metadata.size > previous.observed_size;
      if (!monotonicAppend) return this.#retainForSourceFailure(operation);
      if (metadata.size - previous.admitted_bytes > MAX_APPEND_CAPTURE_BYTES) return this.#performFullRefresh(operation, true);
      appendPlans.push({ path, stored: previous });
    }
    if (appendPlans.length === 0 && newPaths.length === 0 && removedPaths.length === 0) {
      const state = this.#stateFromSourceFiles();
      this.#last = state;
      this.#lastEvidenceCount = stored.reduce((sum, source) => sum + source.evidence_spans, 0);
      this.#setOperationOutcome(operation, "unchanged");
      return state;
    }
    const parsedPlans: Array<{ stored: StoredSourceRow; source: SourceSnapshot }> = [];
    for (const plan of appendPlans) {
      const ids = new Set((this.#db.prepare("SELECT entry_id FROM source_records WHERE source_path = ?").all(plan.stored.source_path) as Array<{ entry_id: string }>).map((row) => row.entry_id));
      const source = parseAppend(plan.path, this.#root, plan.stored, ids);
      if (source === "requires_full") return this.#performFullRefresh(operation, true);
      if (!source) return this.#retainForSourceFailure(operation);
      parsedPlans.push({ stored: plan.stored, source });
    }
    return this.#publishChanges(parsedPlans, newPaths, removedPaths, operation);
  }

  #performFullRefresh(operation: "refresh" | "rebuild", _force: boolean): ScanResult {
    const rootExists = existsSync(this.#root);
    const rootState = rootExists ? lstatSync(this.#root) : null;
    const rootUnauthorized = hasSymlinkComponent(this.#root) || Boolean(rootState && (rootState.isSymbolicLink() || !rootState.isDirectory()));
    const rootMissingAfterSuccess = !rootExists && this.#last.generation !== "empty";
    if (rootUnauthorized || rootMissingAfterSuccess) return this.#retainForSourceFailure(operation);
    const scan = listSessionFiles(this.#root);
    const files = scan.files;
    try {
      this.#db.exec("BEGIN IMMEDIATE");
    } catch (error) {
      if (isDatabaseBusy(error)) {
        if (this.#last.generation !== "empty") {
          this.#last = { ...this.#last, retainedLastGood: true };
          this.#setOperationOutcome(operation, "retained_last_good");
        } else {
          this.#last = { ...this.#last, skipped: 1, errors: 1, fatalErrors: 1, coverage: "partial" };
          this.#setOperationOutcome(operation, "unavailable");
        }
        return this.#last;
      }
      throw error;
    }
    try {
      this.#db.exec("DELETE FROM evidence; DELETE FROM evidence_fts; DELETE FROM source_records; DELETE FROM source_files;");
      let fatalSourceErrors = scan.errors;
      for (let index = 0; index < files.length; index++) {
        const savepoint = `source_${index}`;
        this.#db.exec(`SAVEPOINT ${savepoint}`);
        try {
          const source = this.#indexFullSource(files[index]!);
          this.#writeSource(source);
          this.#relabelSource(source.sourcePath, source.leafEntryId, source.latestCompactionLine);
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
          fatalSourceErrors++;
        }
      }
      if (fatalSourceErrors > 0 && this.#last.generation !== "empty") {
        this.#db.exec("ROLLBACK");
        this.#last = {
          ...this.#last,
          skipped: this.#last.skipped + fatalSourceErrors,
          errors: this.#last.errors + fatalSourceErrors,
          fatalErrors: fatalSourceErrors,
          coverage: "partial",
          retainedLastGood: true,
        };
        this.#setOperationOutcome(operation, "retained_last_good");
        return this.#last;
      }
      const state = this.#stateFromSourceFiles();
      if (fatalSourceErrors > 0) {
        state.skipped += fatalSourceErrors;
        state.errors += fatalSourceErrors;
        state.fatalErrors += fatalSourceErrors;
        state.coverage = "partial";
      }
      if (state.sourceFiles === 0 && (fatalSourceErrors > 0 || this.#last.generation === "empty")) {
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

  recall(input: { query: string; limit?: number; project?: string; sessionId?: string }): EvidenceBundle {
    const state = this.refresh();
    const query = input.query.trim();
    const parsedQuery = parsedQueryText(query);
    const terms = queryTerms(parsedQuery.text);
    const exactText = parsedQuery.text;
    const limit = Math.min(20, Math.max(1, input.limit ?? 5));
    let scopeSql = "SELECT COUNT(*) AS count FROM evidence WHERE 1 = 1";
    const scopeParams: string[] = [];
    if (input.project) { scopeSql += " AND project = ?"; scopeParams.push(input.project); }
    if (input.sessionId) { scopeSql += " AND session_id = ?"; scopeParams.push(input.sessionId); }
    const scopeCount = Number((this.#db.prepare(scopeSql).get(...scopeParams) as { count?: number } | undefined)?.count ?? 0);
    const scope = { project: input.project ?? null, sessionId: input.sessionId ?? null, evidenceSpans: scopeCount };
    const scopeWarnings = (input.project || input.sessionId) && scopeCount === 0 ? ["Requested scope contains no indexed evidence."] : [];
    if (!state.retainedLastGood && this.#lastEvidenceCount === 0 && (state.fatalErrors > 0 || state.sourceFiles === 0)) {
      const warning = state.errors > 0 ? `${state.errors} source error(s)` : "No usable Pi session files";
      return { outcome: "unavailable", query, lexicalTerms: terms, scope, generation: state.generation, trustState: state.trustState, coverage: state.coverage, candidates: [], warnings: [warning, ...scopeWarnings] };
    }
    let directSql = `SELECT e.*, -1000000.0 AS score FROM evidence e WHERE (e.evidence_id = ? OR e.evidence_uri = ? OR e.project = ? OR e.session_id = ? OR e.entry_id = ?)`;
    const directParams: Array<string | number> = [query, query, query, query, query];
    if (input.project) { directSql += " AND e.project = ?"; directParams.push(input.project); }
    if (input.sessionId) { directSql += " AND e.session_id = ?"; directParams.push(input.sessionId); }
    directSql += " ORDER BY e.evidence_id LIMIT ?";
    directParams.push(limit);
    const directRows = this.#db.prepare(directSql).all(...directParams) as Array<Record<string, string | number | null>>;
    const rowsById = new Map(directRows.map((row) => [String(row.evidence_id), row]));
    if (terms.length) {
      const match = parsedQuery.phrase
        ? `"${exactText.replaceAll('"', '""')}"`
        : terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
      let sql = `SELECT e.*, bm25(evidence_fts) AS score FROM evidence_fts JOIN evidence e ON e.evidence_id=evidence_fts.evidence_id WHERE evidence_fts MATCH ?`;
      const params: Array<string | number> = [match];
      if (input.project) { sql += " AND e.project = ?"; params.push(input.project); }
      if (input.sessionId) { sql += " AND e.session_id = ?"; params.push(input.sessionId); }
      sql += " ORDER BY CASE WHEN instr(lower(e.text), lower(?)) > 0 THEN 0 ELSE 1 END, score, e.evidence_id LIMIT ?";
      params.push(exactText, Math.min(MAX_RECALL_RANKING_ROWS, Math.max(40, limit * 10)));
      const lexicalRows = this.#db.prepare(sql).all(...params) as Array<Record<string, string | number | null>>;
      for (const row of lexicalRows) if (!rowsById.has(String(row.evidence_id))) rowsById.set(String(row.evidence_id), row);
    }
    const rows = [...rowsById.values()];
    const lowerQuery = exactText.toLowerCase();
    const ranked = rows.map((row) => {
      const text = String(row.text);
      const lower = text.toLowerCase();
      const metadataExact = [row.evidence_id, row.evidence_uri, row.project, row.session_id, row.entry_id].some((value) => String(value) === query);
      const matchedTerms = metadataExact ? [query] : terms.filter((term) => lower.includes(term) || lower.includes(term.replace(/(ing|ed|s)$/u, "")));
      const coverage = metadataExact ? 1 : terms.length === 0 ? 0 : matchedTerms.length / terms.length;
      const exact = metadataExact || (lowerQuery.length > 0 && lower.includes(lowerQuery));
      const memoryToolOutput = isMoonciteToolRendering(String(row.role), text);
      const band: RelevanceBand = exact || coverage >= 0.6 ? "strong" : coverage >= 0.25 ? "partial" : "weak";
      return { row, matchedTerms, coverage, exact, metadataExact, memoryToolOutput, band };
    }).sort((a, b) =>
      Number(b.metadataExact) - Number(a.metadataExact)
      || Number(a.memoryToolOutput) - Number(b.memoryToolOutput)
      || Number(b.exact) - Number(a.exact)
      || b.coverage - a.coverage
      || Number(a.row.score) - Number(b.row.score)
      || String(a.row.evidence_id).localeCompare(String(b.row.evidence_id)),
    );
    const duplicateBuckets = new Map<string, Map<string, typeof ranked[number] & { duplicateSpanCount: number }>>();
    const diverse: Array<typeof ranked[number] & { duplicateSpanCount: number }> = [];
    for (const item of ranked) {
      if (item.metadataExact) {
        diverse.push({ ...item, duplicateSpanCount: 1 });
        continue;
      }
      const row = item.row;
      const bucketKey = [row.session_id, row.role, row.source_kind, row.branch_state, row.compaction_state].join("\u0000");
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
    const candidates = diverse.slice(0, limit).map(({ row, matchedTerms, band, duplicateSpanCount }) => ({
      evidenceId: String(row.evidence_id),
      evidenceUri: String(row.evidence_uri),
      excerpt: truncateUtf8(String(row.text), 1_024).text,
      project: String(row.project),
      sessionId: String(row.session_id),
      entryId: String(row.entry_id),
      role: String(row.role),
      sourceKind: String(row.source_kind),
      parentId: row.parent_id === null ? null : String(row.parent_id),
      branchState: String(row.branch_state) === "current" ? "current" as const : "off_branch" as const,
      compactionState: ["pre_compaction", "summary", "kept_after_compaction"].includes(String(row.compaction_state))
        ? String(row.compaction_state) as EvidenceCandidate["compactionState"]
        : "none" as const,
      ...(duplicateSpanCount > 1 ? { duplicateSpanCount } : {}),
      relevance: { band, matchedTerms },
    }));
    const outcome = candidates.length === 0 ? "no_match" : candidates[0]!.relevance.band === "weak" ? "weak_leads" : "matches";
    const warnings = state.errors === 0
      ? [...scopeWarnings]
      : [state.retainedLastGood
        ? `${state.errors} source error(s); last good generation retained`
        : `${state.errors} source error(s)`, ...scopeWarnings];
    return { outcome, query, lexicalTerms: terms, scope, generation: state.generation, trustState: state.trustState, coverage: state.coverage, candidates, warnings };
  }

  inspect(input: { evidenceId: string; window?: number }): EvidenceInspection {
    const row = this.#db.prepare(`
      SELECT * FROM evidence
      WHERE evidence_id = ? OR evidence_uri = ?
      ORDER BY CASE WHEN evidence_id = ? THEN 0 ELSE 1 END
      LIMIT 1
    `).get(input.evidenceId, input.evidenceId, input.evidenceId) as Record<string, string | number | null> | undefined;
    if (!row) {
      return { outcome: "unavailable", evidenceId: input.evidenceId, target: null, window: [], locator: null, message: "Evidence ID or URI is not present in the active generation." };
    }
    input = { ...input, evidenceId: String(row.evidence_id) };
    const relativePath = String(row.source_path);
    const absolutePath = resolve(this.#root, relativePath);
    const locator: NonNullable<EvidenceInspection["locator"]> = {
      relativePath,
      sessionId: String(row.session_id),
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
      return {
        relation,
        evidenceId: String(value.evidence_id),
        text: bounded.text,
        sessionId: String(value.session_id),
        entryId: String(value.entry_id),
        parentId: value.parent_id === null ? null : String(value.parent_id),
        role: String(value.role),
        sourceKind: String(value.source_kind),
        branchState: String(value.branch_state) === "current" ? "current" : "off_branch",
        compactionState: ["pre_compaction", "summary", "kept_after_compaction"].includes(String(value.compaction_state))
          ? String(value.compaction_state) as InspectedSpan["compactionState"]
          : "none",
        omittedBytes: bounded.omittedBytes,
      };
    };
    const target = asSpan(row, "target");
    if (!absolutePath.startsWith(`${this.#root}${sep}`)) {
      return { outcome: "excluded", evidenceId: input.evidenceId, target: null, window: [], locator, message: "Locator escapes the authorized source root." };
    }
    if (hasSymlinkComponent(this.#root) || hasSymlinkComponent(absolutePath)) {
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
    const spanOrdinalSql = "CAST(substr(evidence_id, length('mooncite:pi:' || session_id || ':' || entry_id || ':') + 1) AS INTEGER)";
    const beforeRows = radius === 0 ? [] : (this.#db.prepare(`
      SELECT * FROM evidence
      WHERE source_path = ? AND (line < ? OR (line = ? AND ${spanOrdinalSql} < ?))
      ORDER BY line DESC, ${spanOrdinalSql} DESC LIMIT ?
    `).all(relativePath, locator.line, locator.line, locator.spanOrdinal, radius) as Array<Record<string, string | number | null>>).reverse();
    const afterRows = radius === 0 ? [] : this.#db.prepare(`
      SELECT * FROM evidence
      WHERE source_path = ? AND (line > ? OR (line = ? AND ${spanOrdinalSql} > ?))
      ORDER BY line, ${spanOrdinalSql} LIMIT ?
    `).all(relativePath, locator.line, locator.line, locator.spanOrdinal, radius) as Array<Record<string, string | number | null>>;
    const selectedRows = [...beforeRows, row, ...afterRows];
    const selectedTargetIndex = beforeRows.length;
    let captured: Buffer[];
    try {
      const ranges = selectedRows.map((value) => ({ start: Number(value.byte_start), end: Number(value.byte_end) }));
      const bytes = readRangesCoherently(absolutePath, ranges);
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
      if (changed.id !== locator.entryId) {
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
    if (parsed.id !== locator.entryId) {
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
    const outcome = !state.retainedLastGood && this.#lastEvidenceCount === 0 && (state.fatalErrors > 0 || state.sourceFiles === 0) ? "unavailable" : "ready";
    return {
      outcome,
      freshness: outcome === "unavailable" ? "unavailable" : state.retainedLastGood ? "last_good" : "current",
      generation: state.generation,
      trustState: state.trustState,
      coverage: state.coverage,
      sourceRoot: "standard-pi-sessions",
      sourceFiles: state.sourceFiles,
      records: state.records,
      eligibleRecords: state.eligibleRecords,
      evidenceSpans: this.#lastEvidenceCount,
      skipped: state.skipped,
      malformed: state.malformed,
      oversized: state.oversized,
      errors: state.errors,
      stateBytes,
      lastRefreshOutcome: this.#lastRefreshOutcome,
      lastRebuildOutcome: this.#lastRebuildOutcome,
      lastGoodUsable: outcome === "ready",
    };
  }

  status(): MoonciteStatus {
    return this.#memoryStatus(this.refresh());
  }

  close(): void {
    this.#db.close();
  }
}
