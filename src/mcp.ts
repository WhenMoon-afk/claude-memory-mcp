import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { McpServer, ResourceNotFoundError, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MoonciteEngine, type EngineOptions, type EvidenceBundle, type EvidenceInspection, type MoonciteStatus } from "./engine.js";
import { MOONCITE_MCP_NAME, MOONCITE_VERSION } from "./identity.js";
import type { RegistrationDiagnostics } from "./clients.js";
import {
  LearnedMemoryStore,
  loadLearnedMemoryMode,
  unavailableLearnedMemoryStatus,
  type LearnedMemoryDeleteResult,
  type LearnedMemoryInspection,
  type LearnedMemoryRecall,
  type LearnedMemoryProvenance,
  type LearnedMemoryProvenanceInput,
  type LearnedMemoryRelation,
  type LearnedMemoryStatus,
  type LearnedMemoryWriteResult,
} from "./learned-memory.js";

const PRESENTATION_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u;
const PRESENTATION_CONTROL_REPLACEMENT_PATTERN = new RegExp(PRESENTATION_CONTROL_PATTERN.source, "gu");
const boundedRenderedInput = (maximum: number) => z.string().min(1).max(maximum)
  .refine((value) => !PRESENTATION_CONTROL_PATTERN.test(value), "Control characters are not allowed.");
function sanitizePresentation<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(
      PRESENTATION_CONTROL_REPLACEMENT_PATTERN,
      (character) => `\\u{${character.codePointAt(0)!.toString(16)}}`,
    ) as T;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizePresentation(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizePresentation(item)]),
    ) as T;
  }
  return value;
}

const debugTimingInput = z.boolean().optional()
  .describe("Return monotonic server-side latency data. Default: false.");
const recallInput = z.object({
  query: boundedRenderedInput(2_000).describe("Lexical query. Matching quotes require an exact phrase. Unquoted terms use OR. Exact locators and returned identities also match."),
  limit: z.number().int().min(1).max(20).optional().describe("Maximum candidates. Default: 5."),
  project: boundedRenderedInput(256).optional().describe("Copy candidate.project from a result. Do not pass a filesystem path."),
  session_id: boundedRenderedInput(512).optional().describe("Copy the source-qualified candidate.sessionId from a result."),
  after: z.string().datetime({ offset: true }).optional().describe("Inclusive lower event-time bound. Untimestamped evidence is excluded."),
  before: z.string().datetime({ offset: true }).optional().describe("Inclusive upper event-time bound. Untimestamped evidence is excluded."),
  role: z.enum(["user", "assistant", "system", "developer", "tool", "toolResult", "summary", "unknown"]).optional().describe("Exact indexed role."),
  source_origin: z.enum(["pi", "omp", "claude-code", "codex", "chatgpt"]).optional().describe("Exact source origin."),
  order: z.enum(["relevance", "newest", "oldest"]).optional().describe("Candidate order. Default: relevance."),
  debug_timing: debugTimingInput,
}).strict();
const inspectInput = z.object({
  evidence_id: boundedRenderedInput(2_048),
  window: z.number().int().min(0).max(10).optional()
    .describe("Spans before and after the target. Default: 2. Range: 0 to 10."),
  debug_timing: debugTimingInput,
  workflow_id: boundedRenderedInput(64).uuid().optional()
    .describe("ID from a debug-timed recall. Set debug_timing to true to include combined recall and inspection timing."),
}).strict().refine(
  (input) => input.workflow_id === undefined || input.debug_timing === true,
  { message: "workflow_id requires debug_timing=true.", path: ["workflow_id"] },
);



const memoryIdInput = boundedRenderedInput(64)
  .regex(/^mooncite-memory:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const skillCandidateIdInput = boundedRenderedInput(80)
  .regex(/^mooncite-skill-candidate:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const memoryScopeInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }).strict(),
  z.object({
    kind: z.literal("project"),
    project: boundedRenderedInput(256).describe("Exact encoded project from a source-evidence candidate."),
  }).strict(),
]);
const memoryRelationInput = z.object({
  memory_id: memoryIdInput,
  revision: z.number().int().min(1),
  relation: z.enum(["supports", "contradicts", "refines", "supersedes"]),
  reason: boundedRenderedInput(1_024),
}).strict();
const memoryEvidenceIdsInput = (minimum: 0 | 1) => z.array(boundedRenderedInput(2_048))
  .min(minimum)
  .max(8)
  .refine((values) => new Set(values).size === values.length, "Evidence locators must be unique.");
const memoryRelationsInput = (minimum: 1 | 2) => z.array(memoryRelationInput)
  .min(minimum)
  .max(8)
  .refine(
    (values) => new Set(values.map((value) => `${value.memory_id}\0${value.revision}`)).size === values.length,
    "Exact parent revisions must be unique.",
  );
const memoryRevisionSourcesInput = z.array(z.object({
  memory_id: memoryIdInput,
  revision: z.number().int().min(1),
}).strict()).min(1).max(8).refine(
  (values) => new Set(values.map((value) => `${value.memory_id}\0${value.revision}`)).size === values.length,
  "Exact source revisions must be unique.",
);
const memoryProvenanceInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("verified"),
    evidence_ids: memoryEvidenceIdsInput(1)
      .describe("One to eight evidence locators. Mooncite verifies and canonicalizes every locator."),
  }).strict(),
  z.object({
    kind: z.literal("derived"),
    parents: memoryRelationsInput(1),
    evidence_ids: memoryEvidenceIdsInput(0)
      .describe("Up to eight additional evidence locators owned by this revision."),
  }).strict(),
  z.object({
    kind: z.literal("current_context"),
    context_note: boundedRenderedInput(2_048),
    evidence_ids: memoryEvidenceIdsInput(0)
      .describe("Up to eight evidence locators owned by this revision."),
  }).strict(),
  z.object({
    kind: z.literal("unanchored"),
    basis_note: boundedRenderedInput(2_048),
  }).strict(),
]);
const memoryRecallInput = z.object({
  query: boundedRenderedInput(2_000).describe("Lexical interpretation query or exact mooncite-memory ID."),
  limit: z.number().int().min(1).max(20).optional().describe("Maximum candidates. Default: 5."),
  project: boundedRenderedInput(256).optional().describe("Return this project and global learned memories. Copy the exact encoded project from a result."),
  include_invalid: z.boolean().optional().describe("Include memories quarantined by their own changed, missing, or deauthorized evidence anchors."),
  include_archived: z.boolean().optional().describe("Include archived memories. Default: false."),
  related_limit: z.number().int().min(0).max(8).optional()
    .describe("Maximum one-hop related revisions per result. Default: 0. Mooncite never traverses recursively."),
}).strict();
const memoryInspectInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("revision"),
    memory_id: memoryIdInput,
    revision: z.number().int().min(1).optional().describe("Immutable revision. Default: current revision."),
    window: z.number().int().min(0).max(2).optional()
      .describe("Source spans before and after each own anchor. Default: 0. Range: 0 to 2."),
  }).strict(),
  z.object({
    kind: z.literal("skill_candidate"),
    candidate_id: skillCandidateIdInput,
  }).strict(),
]);
const memoryWriteInput = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"),
    interpretation: boundedRenderedInput(8_192)
      .describe("Agent-authored interpretation up to 8 KiB UTF-8. It is not source evidence."),
    provenance: memoryProvenanceInput,
    scope: memoryScopeInput.optional()
      .describe("Omit to infer scope from same-project dependencies. Evidence-free memory requires an explicit scope."),
  }).strict(),
  z.object({
    operation: z.literal("revise"),
    memory_id: memoryIdInput,
    expected_revision: z.number().int().min(1),
    interpretation: boundedRenderedInput(8_192)
      .describe("Interpretation for the new immutable revision."),
    provenance: memoryProvenanceInput,
    scope: memoryScopeInput.optional().describe("Omit to keep and validate the previous scope."),
  }).strict(),
  z.object({
    operation: z.literal("activate"),
    memory_id: memoryIdInput,
    expected_revision: z.number().int().min(1),
    expected_metadata_version: z.number().int().min(1),
  }).strict(),
  z.object({
    operation: z.literal("reinforce"),
    memory_id: memoryIdInput,
    expected_revision: z.number().int().min(1),
    expected_metadata_version: z.number().int().min(1),
    salience: z.number().int().min(0).max(100),
  }).strict(),
  z.object({
    operation: z.literal("archive"),
    memory_id: memoryIdInput,
    expected_revision: z.number().int().min(1),
    expected_metadata_version: z.number().int().min(1),
  }).strict(),
  z.object({
    operation: z.literal("consolidate"),
    interpretation: boundedRenderedInput(8_192),
    parents: memoryRelationsInput(2),
    evidence_ids: memoryEvidenceIdsInput(0),
    scope: memoryScopeInput.optional()
      .describe("Omit to infer scope from same-project dependencies. Mixed or global dependencies require global scope."),
  }).strict(),
  z.object({
    operation: z.literal("propose_skill_candidate"),
    sources: memoryRevisionSourcesInput,
    artifact: z.object({
      name: boundedRenderedInput(80),
      description: boundedRenderedInput(2_048),
      instructions: boundedRenderedInput(16_384),
    }).strict(),
  }).strict(),
  z.object({
    operation: z.literal("review_skill_candidate"),
    candidate_id: skillCandidateIdInput,
    expected_state: z.literal("pending_review"),
    decision: z.enum(["approved", "rejected"]),
    review_note: boundedRenderedInput(2_048),
  }).strict(),
]);
const memoryDeleteInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("memory"),
    memory_id: memoryIdInput,
    expected_revision: z.number().int().min(1),
    expected_metadata_version: z.number().int().min(1),
  }).strict(),
  z.object({
    kind: z.literal("skill_candidate"),
    candidate_id: skillCandidateIdInput,
    expected_state: z.enum(["pending_review", "approved", "rejected"]),
  }).strict(),
]);
type MemoryRelationWire = z.infer<typeof memoryRelationInput>;
type MemoryProvenanceWire = z.infer<typeof memoryProvenanceInput>;

function memoryRelationFromWire(relation: MemoryRelationWire): LearnedMemoryRelation {
  return {
    memoryId: relation.memory_id,
    revision: relation.revision,
    relation: relation.relation,
    reason: relation.reason,
  };
}

function memoryProvenanceFromWire(provenance: MemoryProvenanceWire): LearnedMemoryProvenanceInput {
  switch (provenance.kind) {
    case "verified":
      return { kind: "verified", evidenceIds: provenance.evidence_ids };
    case "derived":
      return {
        kind: "derived",
        parents: provenance.parents.map(memoryRelationFromWire),
        evidenceIds: provenance.evidence_ids,
      };
    case "current_context":
      return {
        kind: "current_context",
        contextNote: provenance.context_note,
        evidenceIds: provenance.evidence_ids,
      };
    case "unanchored":
      return { kind: "unanchored", basisNote: provenance.basis_note };
  }
}

const RESULT_ARTIFACT_TTL_MS = 10 * 60 * 1_000;
const MAX_RESULT_ARTIFACTS = 12;
const MAX_RECALL_TIMINGS = 64;
const MAX_INLINE_RESULT_BYTES = 8 * 1_024;
const MAX_INLINE_CANDIDATES = 3;
const MAX_INLINE_EXCERPT_CHARACTERS = 640;

interface ResultArtifact {
  id: string;
  uri: string;
  text: string;
  bytes: number;
  createdAt: string;
  expiresAt: number;
}

interface ResultArtifactReference {
  uri: string;
  bytes: number;
  expiresAt: string;
}

interface RecallTiming {
  workflowId: string;
  recallMs: number;
  expiresAt: number;
}

function elapsedMilliseconds(startedAt: number): number {
  return Number((performance.now() - startedAt).toFixed(3));
}

function clipPresentationText(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, maximum)}… [${value.length - maximum} character(s) in full result]`;
}

function compactStructuredValue(value: unknown): unknown {
  if (typeof value === "string") return clipPresentationText(value, MAX_INLINE_EXCERPT_CHARACTERS);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_INLINE_CANDIDATES).map((item) => compactStructuredValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, compactStructuredValue(item)]),
    );
  }
  return value;
}

function compactRenderedText(value: string): string {
  if (Buffer.byteLength(value) <= MAX_INLINE_RESULT_BYTES) return value;
  const head = value.slice(0, 5_500);
  const tail = value.slice(-1_200);
  return `${head}\n\n… full middle section available in the linked result …\n\n${tail}`;
}


function renderNext(next: EvidenceBundle["next"]): string {
  if (!next) return "none";
  const args = next.arguments ? ` ${JSON.stringify(next.arguments)}` : "";
  return `${next.action} ${next.target}${args} — ${next.reason}`;
}
const SYSTEM_TIMESTAMP = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "long",
});

const RELATIVE_TIMESTAMP = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

function relativeTimeUnit(seconds: number): readonly [number, Intl.RelativeTimeFormatUnit] {
  if (seconds < 60) return [1, "second"];
  if (seconds < 3_600) return [60, "minute"];
  if (seconds < 86_400) return [3_600, "hour"];
  if (seconds < 604_800) return [86_400, "day"];
  if (seconds < 2_629_800) return [604_800, "week"];
  if (seconds < 31_557_600) return [2_629_800, "month"];
  return [31_557_600, "year"];
}

function formatDisplayTimestamp(timestamp: string | null, now: number): string {
  if (timestamp === null) return "unknown";
  const date = new Date(timestamp);
  const differenceSeconds = (date.getTime() - now) / 1_000;
  const absoluteSeconds = Math.abs(differenceSeconds);
  const [unitSeconds, unit] = relativeTimeUnit(absoluteSeconds);
  const relativeValue = differenceSeconds === 0
    ? 0
    : Math.sign(differenceSeconds) * Math.round(absoluteSeconds / unitSeconds);
  return `${RELATIVE_TIMESTAMP.format(relativeValue, unit)} · ${SYSTEM_TIMESTAMP.format(date)}`;
}

function renderEstablishment(candidate: EvidenceBundle["candidates"][number]): string {
  switch (candidate.match.kind) {
    case "metadata_exact":
      return "This record exactly matches the requested evidence locator or indexed identity.";
    case "phrase_exact":
      return `This ${candidate.role} record contains the requested phrase verbatim.`;
    case "text_exact":
      return `This ${candidate.role} record contains the requested text verbatim.`;
    case "terms":
      return `This ${candidate.role} record contains ${candidate.match.matchedTerms.length} of ${candidate.match.matchedTerms.length + candidate.match.missingTerms.length} requested lexical terms.`;
  }
}

function renderCandidateRelationship(bundle: EvidenceBundle, index: number): string {
  const candidate = bundle.candidates[index]!;
  const relatedIndex = bundle.candidates.findIndex((other, otherIndex) =>
    otherIndex !== index && other.sessionId === candidate.sessionId);
  if (relatedIndex >= 0) return `Same indexed session as finding ${relatedIndex + 1}.`;
  const projectIndex = bundle.candidates.findIndex((other, otherIndex) =>
    otherIndex !== index && other.project === candidate.project);
  if (projectIndex >= 0) return `Same indexed project as finding ${projectIndex + 1}.`;
  return "No same-session or same-project relationship among the returned findings.";
}

function renderFollowOnQueries(bundle: EvidenceBundle): string {
  const strongest = bundle.candidates[0];
  if (!strongest) return `Follow-on query: ${renderNext(bundle.next)}`;
  const suggestions = [
    `Verify finding 1: call mooncite_inspect ${JSON.stringify({ evidence_id: strongest.evidenceId })}`,
    `Search this session: call mooncite_recall ${JSON.stringify({ query: bundle.query, session_id: strongest.sessionId })}`,
  ];
  if (strongest.match.missingTerms.length > 0) {
    suggestions.push(`Refine missing terms: call mooncite_recall ${JSON.stringify({ query: strongest.match.missingTerms.join(" ") })}`);
  }
  return `Follow-on queries:\n- ${suggestions.join("\n- ")}`;
}

function renderRecall(bundle: EvidenceBundle): string {
  const requestedScope = bundle.scope.project || bundle.scope.sessionId
    ? `; scope${bundle.scope.project ? ` project=${bundle.scope.project}` : ""}${bundle.scope.sessionId ? ` session_id=${bundle.scope.sessionId}` : ""} contains ${bundle.scope.evidenceSpans} indexed span(s)`
    : "";
  const warnings = bundle.warnings.length ? ` Warnings: ${bundle.warnings.join(" ")}` : "";
  const heading = `Mooncite recall: ${bundle.outcome}; conclusive=${bundle.conclusive}; ${bundle.meaning}`;
  const state = `Trust: ${bundle.trustState}; coverage=${bundle.coverage}${requestedScope}; echoes_suppressed=${bundle.echoesSuppressed}.${warnings}`;
  const next = `Next: ${renderNext(bundle.next)}`;
  if (!bundle.candidates.length) return `${heading}\n${state}\n${next}`;
  const renderedAt = Date.now();
  const findings = bundle.candidates.map((candidate, index) => {
    const details = [
      `${candidate.match.band}; ${candidate.match.kind}; term_coverage=${candidate.match.termCoverage.toFixed(2)}`,
      ...(candidate.duplicateSpanCount && candidate.duplicateSpanCount > 1 ? [`duplicates_collapsed=${candidate.duplicateSpanCount}`] : []),
      ...(candidate.omittedBytes > 0 ? [`omitted_bytes=${candidate.omittedBytes}`] : []),
    ].join("; ");
    return `Finding ${index + 1}\n`
      + `Source: ${candidate.sourceOrigin}\n`
      + `Role: ${candidate.role}\n`
      + `Time: ${formatDisplayTimestamp(candidate.eventTimestamp, renderedAt)}\n`
      + `Record provenance: ${candidate.recordProvenance}\n`
      + `Excerpt: ${candidate.excerpt}\n`
      + `What it establishes: ${renderEstablishment(candidate)}\n`
      + `Returned-context relationship: ${renderCandidateRelationship(bundle, index)}\n`
      + `Evidence ID: ${candidate.evidenceId}\n`
      + `Evidence URI: ${candidate.evidenceUri}\n`
      + `Project: ${candidate.project}\n`
      + `Session ID: ${candidate.sessionId}\n`
      + `Match: ${details}\n`
      + `Matched terms: ${candidate.match.matchedTerms.join(", ") || "none"}\n`
      + `Missing terms: ${candidate.match.missingTerms.join(", ") || "none"}`
      + (candidate.isEcho ? "\nRecursive Mooncite rendering: yes" : "");
  }).join("\n\n");
  return `${findings}\n\n${heading}\n${state}\n${renderFollowOnQueries(bundle)}\n${next}`;
}

type InspectionPresentation = EvidenceInspection & {
  conclusive: boolean;
  meaning: string;
  next: EvidenceBundle["next"];
};

function inspectionPresentation(inspection: EvidenceInspection): InspectionPresentation {
  if (inspection.outcome === "verified") {
    return {
      ...inspection,
      conclusive: true,
      meaning: "The cited physical source bytes and identity match the active index. This verifies provenance, not the truth of the quoted claim.",
      next: null,
    };
  }
  const retryable = inspection.outcome === "stale" || inspection.outcome === "missing" || inspection.outcome === "unavailable";
  return {
    ...inspection,
    conclusive: false,
    meaning: inspection.message ?? "The cited source window could not be physically verified.",
    next: retryable
      ? { action: "run", target: "mooncite rebuild", reason: "Refresh the derived index, then recall and inspect a current evidence locator." }
      : { action: "call", target: "mooncite_status", reason: "Check source authorization and index health before relying on this locator." },
  };
}

function renderInspection(inspection: InspectionPresentation): string {
  const heading = `Mooncite inspection: ${inspection.outcome}; conclusive=${inspection.conclusive}; ${inspection.meaning}`;
  const next = `Next: ${renderNext(inspection.next)}`;
  if (inspection.outcome !== "verified") return `${heading}\nEvidence: ${inspection.evidenceId}\n${next}`;
  const renderedAt = Date.now();
  const ordered = [
    ...inspection.window.filter((span) => span.relation === "target"),
    ...inspection.window.filter((span) => span.relation !== "target"),
  ];
  const findings = ordered.map((span) => `${span.relation === "target" ? "Verified target" : `Context ${span.relation}`}\n`
    + `Source: ${span.sourceOrigin}\n`
    + `Role: ${span.role}\n`
    + `Time: ${formatDisplayTimestamp(span.eventTimestamp, renderedAt)}\n`
    + `Record provenance: ${span.recordProvenance}\n`
    + `Excerpt: ${span.text}`).join("\n\n");
  return `${findings}\n\n${heading}\nEvidence: ${inspection.evidenceId}\n${next}`;
}

function renderMemoryProvenance(provenance: LearnedMemoryProvenance): string {
  switch (provenance.kind) {
    case "verified":
      return "verified evidence";
    case "derived":
      return `derived from ${provenance.parents.map((parent) =>
        `${parent.memoryId}@${parent.revision} ${parent.relation} (${parent.reason})`).join("; ")}`;
    case "current_context":
      return `current context (${provenance.contextNote})`;
    case "unanchored":
      return `unanchored (${provenance.basisNote})`;
  }
}

function renderMemoryRecall(bundle: LearnedMemoryRecall): string {
  const heading = `Mooncite learned-memory recall: ${bundle.outcome}; interpretations, never source evidence.`;
  const warnings = bundle.warnings.length === 0 ? "" : `\nWarnings: ${bundle.warnings.join(" ")}`;
  if (bundle.candidates.length === 0) return `${heading}${warnings}`;
  const candidates = bundle.candidates.map((candidate, index) => {
    const anchors = candidate.anchors.length === 0
      ? "none"
      : candidate.anchors.map((anchor) => `${anchor.evidenceUri} (${anchor.state})`).join(", ");
    const related = candidate.related.length === 0
      ? "none"
      : candidate.related.map((item) =>
        `${item.direction} ${item.relation} ${item.memoryId}@${item.revision}; `
        + `reason=${item.reason}; provenance=${item.provenanceKind}/${item.provenanceState}; `
        + `lifecycle=${item.lifecycle.state}; excerpt=${item.interpretationExcerpt}`).join("\n      ");
    return `Memory ${index + 1}\n`
      + `Interpretation: ${candidate.interpretation}\n`
      + `Identity: ${candidate.memoryId}@${candidate.revision}\n`
      + `Scope: ${candidate.scope.kind === "global" ? "global" : `project=${candidate.scope.project}`}\n`
      + `Provenance: ${renderMemoryProvenance(candidate.provenance)}; state=${candidate.provenanceState}; `
      + `quarantined=${candidate.quarantined}\n`
      + `Lifecycle: ${candidate.lifecycle.state}; metadata_version=${candidate.lifecycle.metadataVersion}; `
      + `salience=${candidate.lifecycle.salience}; reinforcements=${candidate.lifecycle.reinforcementCount}\n`
      + `Own source evidence: ${anchors}\n`
      + `Relevance: ${candidate.relevance.band}; ${candidate.relevance.kind}; `
      + `matched_terms=${candidate.relevance.matchedTerms.join(", ") || "none"}\n`
      + `Related revisions (one hop): ${related}`;
  }).join("\n\n");
  return `${candidates}\n\n${heading}${warnings}`;
}

function renderMemoryInspection(inspection: LearnedMemoryInspection): string {
  if (inspection.kind === "skill_candidate") {
    return `Skill candidate ${inspection.candidateId}: review=${inspection.review.state}; installed=false.\n`
      + `Sources: ${inspection.sources.map((source) => `${source.memoryId}@${source.revision}`).join(", ")}\n`
      + `Name: ${inspection.artifact.name}\nDescription: ${inspection.artifact.description}\n`
      + `Candidate instructions:\n${inspection.artifact.instructions}\n`
      + "This is a reviewed candidate artifact only; Mooncite never installs it automatically.";
  }
  const sources = inspection.anchors.length === 0
    ? "none"
    : inspection.anchors.map((anchor) =>
      `${anchor.position + 1}. ${anchor.evidenceUri}: ${anchor.state}; `
      + `physical_inspection=${anchor.inspection.outcome}`).join("\n");
  const candidates = inspection.skillCandidates.length === 0
    ? "none"
    : inspection.skillCandidates.map((candidate) =>
      `${candidate.candidateId} (${candidate.review.state}; installed=false)`).join(", ");
  return `Derived memory ${inspection.memoryId}@${inspection.revision}: `
    + `${inspection.provenanceOutcome} provenance; current_revision=${inspection.currentRevision}; `
    + `is_current=${inspection.isCurrent}.\n`
    + `Interpretation (not source evidence): ${inspection.interpretation}\n`
    + `Provenance: ${renderMemoryProvenance(inspection.provenance)}; state=${inspection.provenanceState}\n`
    + `Lifecycle: ${inspection.lifecycle.state}; metadata_version=${inspection.lifecycle.metadataVersion}; `
    + `salience=${inspection.lifecycle.salience}; reinforcements=${inspection.lifecycle.reinforcementCount}\n`
    + `Own source evidence anchors:\n${sources}\nSkill candidates: ${candidates}`;
}

function renderMemoryWrite(result: LearnedMemoryWriteResult): string {
  switch (result.kind) {
    case "derived_memory_write":
      return `${result.outcome} derived memory ${result.memoryId}@${result.revision}; `
        + `provenance=${renderMemoryProvenance(result.provenance)}; `
        + `${result.evidenceIds.length} physically verified own source anchor(s).\n`
        + "The interpretation is learned memory, never source evidence.";
    case "derived_memory_lifecycle":
      return `${result.outcome} learned memory ${result.memoryId}@${result.revision}; `
        + `state=${result.lifecycle.state}; metadata_version=${result.lifecycle.metadataVersion}; `
        + `salience=${result.lifecycle.salience}; reinforcements=${result.lifecycle.reinforcementCount}. `
        + "No interpretation revision or source evidence was changed.";
    case "skill_candidate_write":
      return `${result.outcome} skill candidate ${result.candidate.candidateId}; `
        + `review=${result.candidate.review.state}; installed=false. `
        + "The candidate remains an artifact for explicit review and is never installed automatically.";
  }
}

function renderMemoryDelete(result: LearnedMemoryDeleteResult): string {
  if (result.kind === "skill_candidate_delete") {
    return `Deleted skill candidate ${result.candidateId}. Learned-memory revisions and source evidence were not changed.`;
  }
  if (result.outcome === "blocked") {
    const dependencies = result.dependencies.map((dependency) =>
      dependency.kind === "relation"
        ? `relation from ${dependency.memoryId}@${dependency.revision}`
        : `skill candidate ${dependency.candidateId}`).join(", ");
    return `Did not delete learned memory ${result.memoryId}: ${result.dependencyCount} surviving dependency item(s). `
      + `Release them explicitly first. Bounded dependency sample: ${dependencies}.`;
  }
  return `Deleted learned memory ${result.memoryId} and ${result.deletedRevisions} immutable revision(s). `
    + "Source files and the disposable evidence index were not changed.";
}

type LearnedMemoryOperation = "recall" | "inspection" | "write" | "delete";
function learnedMemoryError(operation: LearnedMemoryOperation, error?: unknown) {
  const raw = error instanceof Error ? error.message : "";
  const message = /^(?:Mooncite (?:learned|evidence|tool|skill)|A new Mooncite|Project-scoped|Mixed-project|Evidence-free)/u.test(raw)
    ? raw
    : "The separate learned-memory store is unavailable.";
  const structuredContent = sanitizePresentation({
    kind: "derived_memory_error" as const,
    operation,
    outcome: error === undefined ? "unavailable" as const : "failed" as const,
    message,
  });
  return {
    content: [{ type: "text" as const, text: `Mooncite learned-memory ${operation} failed. ${structuredContent.message}` }],
    structuredContent,
    isError: true,
  };
}

type SourceEvidenceOperation = "recall" | "inspection" | "status";
function sourceEvidenceError(operation: SourceEvidenceOperation) {
  const next = operation === "status"
    ? { action: "run" as const, target: "mooncite rebuild", reason: "Rebuild the derived index, then check status again." }
    : { action: "call" as const, target: "mooncite_status", reason: "Check source and index health before retrying." };
  const structuredContent = {
    outcome: "unavailable" as const,
    conclusive: false,
    meaning: `Mooncite ${operation} could not complete.`,
    next,
  };
  return {
    content: [{ type: "text" as const, text: `Mooncite ${operation}: unavailable; conclusive=false; ${structuredContent.meaning}\nNext: ${renderNext(next)}` }],
    structuredContent,
    isError: true,
  };
}

export interface MoonciteToolStatus extends MoonciteStatus {
  registrations: RegistrationDiagnostics;
  learnedMemory?: LearnedMemoryStatus;
}

export type RegistrationProvider = () => Promise<RegistrationDiagnostics>;

function renderStatus(status: MoonciteToolStatus): string {
  const registrations = status.registrations;
  const sourceCounts = `${status.sourceFilesByOrigin.pi} Pi, ${status.sourceFilesByOrigin.omp} OMP, ${status.sourceFilesByOrigin["claude-code"]} Claude Code, ${status.sourceFilesByOrigin.codex} Codex, ${status.sourceFilesByOrigin.chatgpt} ChatGPT`;
  const memory = status.learnedMemory === undefined
    ? ""
    : ` Learned memory: ${status.learnedMemory.outcome}, ${status.learnedMemory.memories} item(s), `
      + `${status.learnedMemory.revisions} revision(s), ${status.learnedMemory.active} active, `
      + `${status.learnedMemory.archived} archived, ${status.learnedMemory.pendingSkillCandidates} pending skill candidate(s)`
      + `${status.learnedMemory.outcome === "unavailable" ? `, error=${status.learnedMemory.errorCode}` : ""}.`;
  const errors = status.errorGroups.length
    ? ` Error groups: ${status.errorGroups.map((group) => `${group.origin}/${group.reason}=${group.count} (fatal=${group.fatalCount})`).join(", ")}.`
    : "";
  const refresh = status.lastSuccessfulRefreshAt ?? "never";
  return `Mooncite status: ${status.outcome}; ${status.meaning}\n`
    + `Freshness: ${status.freshness}; trust=${status.trustState}; coverage=${status.coverage}; search_usable=${status.searchUsable}; last_successful_refresh=${refresh}; last_refresh=${status.lastRefreshOutcome}; last_rebuild=${status.lastRebuildOutcome}.\n`
    + `Sources: ${status.evidenceSpans} searchable span(s) from ${status.sourceFiles} session file(s) (${sourceCounts}); derived_state_bytes=${status.stateBytes}; ${status.malformed} malformed, ${status.oversized} oversized, ${status.errors} error(s); registrations: Pi ${registrations.pi}, OMP ${registrations.omp}, Codex ${registrations.codex}, Claude Code ${registrations.claudeCode}.${errors}${memory}\n`
    + `Next: ${renderNext(status.next)}`;
}

export interface MoonciteLearnedMemoryServerOptions {
  configPath: string;
}

export function createMoonciteMcpServer(
  options: EngineOptions,
  registrations: RegistrationProvider = async () => ({ pi: "unavailable", omp: "unavailable", codex: "unavailable", claudeCode: "unavailable" }),
  learnedMemory?: MoonciteLearnedMemoryServerOptions,
): McpServer {
  const engine = new MoonciteEngine(options);
  let learnedMemoryEnabled = false;
  if (learnedMemory) {
    try {
      learnedMemoryEnabled = loadLearnedMemoryMode(learnedMemory.configPath).enabled;
    } catch {
      // A malformed optional config must not alter or disable the evidence server.
    }
  }
  let learnedStore: LearnedMemoryStore | null = null;
  let learnedStoreError: unknown;
  if (learnedMemoryEnabled) {
    try {
      learnedStore = new LearnedMemoryStore(engine, { stateDir: options.stateDir });
    } catch (error) {
      learnedStoreError = error;
    }
  }
  const server = new McpServer(
    { name: MOONCITE_MCP_NAME, version: MOONCITE_VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );
  const resultArtifacts = new Map<string, ResultArtifact>();
  const recallTimings = new Map<string, RecallTiming>();
  const cleanupTransientResults = (): void => {
    const now = Date.now();
    for (const [id, artifact] of resultArtifacts) {
      if (artifact.expiresAt <= now) resultArtifacts.delete(id);
    }
    for (const [id, timing] of recallTimings) {
      if (timing.expiresAt <= now) recallTimings.delete(id);
    }
  };
  const storeResultArtifact = (
    tool: string,
    renderedText: string,
    structuredContent: Record<string, unknown>,
  ): ResultArtifact | null => {
    const createdAt = new Date().toISOString();
    const text = JSON.stringify({
      kind: "mooncite_result_artifact",
      tool,
      createdAt,
      renderedText,
      structuredContent,
    }, null, 2);
    const bytes = Buffer.byteLength(text);
    if (bytes <= MAX_INLINE_RESULT_BYTES) return null;
    cleanupTransientResults();
    while (resultArtifacts.size >= MAX_RESULT_ARTIFACTS) {
      const oldest = resultArtifacts.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      resultArtifacts.delete(oldest);
    }
    const id = randomUUID();
    const artifact = {
      id,
      uri: `mooncite-result://artifact/${id}`,
      text,
      bytes,
      createdAt,
      expiresAt: Date.now() + RESULT_ARTIFACT_TTL_MS,
    };
    resultArtifacts.set(id, artifact);
    return artifact;
  };
  const toolResult = (
    tool: string,
    renderedText: string,
    structuredContent: Record<string, unknown>,
  ) => {
    const artifact = server.server.getClientVersion()?.name === "mooncite-pi"
      ? null
      : storeResultArtifact(tool, renderedText, structuredContent);
    if (!artifact) {
      return {
        content: [{ type: "text" as const, text: renderedText }],
        structuredContent,
      };
    }
    const reference: ResultArtifactReference = {
      uri: artifact.uri,
      bytes: artifact.bytes,
      expiresAt: new Date(artifact.expiresAt).toISOString(),
    };
    const candidates = Array.isArray(structuredContent.candidates) ? structuredContent.candidates.length : undefined;
    const compact = compactStructuredValue(structuredContent) as Record<string, unknown>;
    compact.resultDetail = {
      kind: "progressive_result",
      complete: false,
      ...(candidates === undefined ? {} : { inlineCandidates: Math.min(candidates, MAX_INLINE_CANDIDATES), totalCandidates: candidates }),
      fullResult: reference,
    };
    return {
      content: [
        {
          type: "text" as const,
          text: `${compactRenderedText(renderedText)}\n\nFull result: read ${artifact.uri} before ${reference.expiresAt} (${artifact.bytes} bytes).`,
        },
        {
          type: "resource_link" as const,
          uri: artifact.uri,
          name: `Mooncite ${tool} complete result`,
          description: "Complete Mooncite result stored in this server process for a short time.",
          mimeType: "application/json",
          size: artifact.bytes,
        },
      ],
      structuredContent: compact,
    };
  };
  server.registerResource(
    "mooncite_result_artifact",
    new ResourceTemplate("mooncite-result://artifact/{id}", { list: undefined }),
    {
      title: "Mooncite complete result",
      description: "Complete result linked from a shortened tool response.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      cleanupTransientResults();
      const id = Array.isArray(variables.id) ? variables.id[0] : variables.id;
      const artifact = id === undefined ? undefined : resultArtifacts.get(id);
      if (!artifact) throw new ResourceNotFoundError(uri.href);
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: artifact.text,
        }],
      };
    },
  );
  const closeServer = server.close.bind(server);
  let engineClosed = false;
  server.close = async (): Promise<void> => {
    try {
      await closeServer();
    } finally {
      resultArtifacts.clear();
      recallTimings.clear();
      if (!engineClosed) {
        engineClosed = true;
        try {
          learnedStore?.close();
        } finally {
          engine.close();
        }
      }
    }
  };

  server.registerTool(
    "mooncite_recall",
    {
      title: "Recall prior evidence",
      description: "Search authorized local history for bounded lexical evidence. Returns cited candidates, explicit outcomes, and next actions.",
      inputSchema: recallInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit, project, session_id, after, before, role, source_origin, order, debug_timing }) => {
      const startedAt = performance.now();
      try {
        const bundle = engine.recall({
          query,
          ...(limit === undefined ? {} : { limit }),
          ...(project === undefined ? {} : { project }),
          ...(session_id === undefined ? {} : { sessionId: session_id }),
          ...(after === undefined ? {} : { after: new Date(after).toISOString() }),
          ...(before === undefined ? {} : { before: new Date(before).toISOString() }),
          ...(role === undefined ? {} : { role }),
          ...(source_origin === undefined ? {} : { sourceOrigin: source_origin }),
          ...(order === undefined ? {} : { order }),
        });
        const safeBundle = sanitizePresentation(bundle);
        let structuredContent = safeBundle as unknown as Record<string, unknown>;
        let renderedText = renderRecall(safeBundle);
        if (debug_timing === true) {
          cleanupTransientResults();
          const timing: RecallTiming = {
            workflowId: randomUUID(),
            recallMs: elapsedMilliseconds(startedAt),
            expiresAt: Date.now() + RESULT_ARTIFACT_TTL_MS,
          };
          while (recallTimings.size >= MAX_RECALL_TIMINGS) {
            const oldest = recallTimings.keys().next().value as string | undefined;
            if (oldest === undefined) break;
            recallTimings.delete(oldest);
          }
          recallTimings.set(timing.workflowId, timing);
          structuredContent = {
            ...safeBundle,
            timing: {
              enabled: true,
              workflowId: timing.workflowId,
              recallMs: timing.recallMs,
              expiresAt: new Date(timing.expiresAt).toISOString(),
            },
          };
          renderedText += `\nDebug timing: workflow_id=${timing.workflowId}; recall_ms=${timing.recallMs}.`;
        }
        return toolResult("mooncite_recall", renderedText, structuredContent);
      } catch {
        return sourceEvidenceError("recall");
      }
    },
  );

  server.registerTool(
    "mooncite_inspect",
    {
      title: "Inspect cited evidence",
      description: "Verify one Mooncite locator against current source bytes and return a bounded window. Verification proves provenance, not truth.",
      inputSchema: inspectInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ evidence_id, window, debug_timing, workflow_id }) => {
      const startedAt = performance.now();
      try {
        const inspection = inspectionPresentation(engine.inspect({
          evidenceId: evidence_id,
          ...(window === undefined ? {} : { window }),
        }));
        const safeInspection = sanitizePresentation(inspection);
        let structuredContent = safeInspection as unknown as Record<string, unknown>;
        let renderedText = renderInspection(safeInspection);
        if (debug_timing === true) {
          cleanupTransientResults();
          const inspectMs = elapsedMilliseconds(startedAt);
          const recallTiming = workflow_id === undefined ? undefined : recallTimings.get(workflow_id);
          const timing = recallTiming
            ? {
              enabled: true,
              workflowId: recallTiming.workflowId,
              recallMs: recallTiming.recallMs,
              inspectMs,
              combinedMs: Number((recallTiming.recallMs + inspectMs).toFixed(3)),
              combined: true,
            }
            : {
              enabled: true,
              workflowId: workflow_id ?? null,
              inspectMs,
              combined: false,
              ...(workflow_id === undefined ? {} : { warning: "The recall timing workflow is unknown or expired." }),
            };
          structuredContent = { ...safeInspection, timing };
          renderedText += timing.combined
            ? `\nDebug timing: workflow_id=${timing.workflowId}; recall_ms=${timing.recallMs}; inspect_ms=${timing.inspectMs}; combined_ms=${timing.combinedMs}.`
            : `\nDebug timing: inspect_ms=${timing.inspectMs}; combined=false${"warning" in timing ? `; ${timing.warning}` : ""}.`;
        }
        return toolResult("mooncite_inspect", renderedText, structuredContent);
      } catch {
        return sourceEvidenceError("inspection");
      }
    },
  );

  server.registerTool(
    "mooncite_status",
    {
      title: "Check Mooncite status",
      description: "Report source and index health without transcript text or full source paths.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const status: MoonciteToolStatus = { ...engine.status(), registrations: await registrations() };
        if (learnedMemoryEnabled) {
          if (!learnedStore) {
            status.learnedMemory = unavailableLearnedMemoryStatus(learnedStoreError);
          } else {
            try {
              status.learnedMemory = learnedStore.status();
            } catch (error) {
              status.learnedMemory = unavailableLearnedMemoryStatus(error);
            }
          }
        }
        const safeStatus = sanitizePresentation(status);
        return toolResult(
          "mooncite_status",
          renderStatus(safeStatus),
          safeStatus as unknown as Record<string, unknown>,
        );
      } catch {
        return sourceEvidenceError("status");
      }
    },
  );

  if (learnedMemoryEnabled) {
    server.registerTool(
      "mooncite_memory_recall",
      {
        title: "Recall learned memory",
        description: "Search agent-authored interpretations. Results are learned memory, not source evidence.",
        inputSchema: memoryRecallInput,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ query, limit, project, include_invalid, include_archived, related_limit }) => {
        if (!learnedStore) return learnedMemoryError("recall");
        try {
          const result = learnedStore.recall({
            query,
            limit: limit ?? 5,
            project: project ?? null,
            includeInvalid: include_invalid ?? false,
            includeArchived: include_archived ?? false,
            relatedLimit: related_limit ?? 0,
          });
          const safeResult = sanitizePresentation(result);
          return toolResult(
            "mooncite_memory_recall",
            renderMemoryRecall(safeResult),
            safeResult as unknown as Record<string, unknown>,
          );
        } catch (error) {
          return learnedMemoryError("recall", error);
        }
      },
    );

    server.registerTool(
      "mooncite_memory_inspect",
      {
        title: "Inspect learned memory",
        description: "Inspect one immutable memory revision and verify its own anchors, or inspect one skill candidate.",
        inputSchema: memoryInspectInput,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (input) => {
        if (!learnedStore) return learnedMemoryError("inspection");
        try {
          const result = input.kind === "revision"
            ? learnedStore.inspect({
              kind: "revision",
              memoryId: input.memory_id,
              revision: input.revision ?? null,
              window: input.window ?? 0,
            })
            : learnedStore.inspect({
              kind: "skill_candidate",
              candidateId: input.candidate_id,
            });
          const safeResult = sanitizePresentation(result);
          return toolResult(
            "mooncite_memory_inspect",
            renderMemoryInspection(safeResult),
            safeResult as unknown as Record<string, unknown>,
          );
        } catch (error) {
          return learnedMemoryError("inspection", error);
        }
      },
    );

    server.registerTool(
      "mooncite_memory_write",
      {
        title: "Write or manage learned memory",
        description: "Write immutable learned-memory revisions, manage lifecycle metadata, or propose and review skill candidates. Candidate review never installs a skill.",
        inputSchema: memoryWriteInput,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      async (input) => {
        if (!learnedStore) return learnedMemoryError("write");
        try {
          const result = (() => {
            switch (input.operation) {
              case "create":
                return learnedStore.write({
                  operation: "create",
                  interpretation: input.interpretation,
                  provenance: memoryProvenanceFromWire(input.provenance),
                  scope: input.scope ?? null,
                });
              case "revise":
                return learnedStore.write({
                  operation: "revise",
                  memoryId: input.memory_id,
                  expectedRevision: input.expected_revision,
                  interpretation: input.interpretation,
                  provenance: memoryProvenanceFromWire(input.provenance),
                  scope: input.scope ?? null,
                });
              case "activate":
                return learnedStore.write({
                  operation: "activate",
                  memoryId: input.memory_id,
                  expectedRevision: input.expected_revision,
                  expectedMetadataVersion: input.expected_metadata_version,
                });
              case "reinforce":
                return learnedStore.write({
                  operation: "reinforce",
                  memoryId: input.memory_id,
                  expectedRevision: input.expected_revision,
                  expectedMetadataVersion: input.expected_metadata_version,
                  salience: input.salience,
                });
              case "archive":
                return learnedStore.write({
                  operation: "archive",
                  memoryId: input.memory_id,
                  expectedRevision: input.expected_revision,
                  expectedMetadataVersion: input.expected_metadata_version,
                });
              case "consolidate":
                return learnedStore.write({
                  operation: "consolidate",
                  interpretation: input.interpretation,
                  parents: input.parents.map(memoryRelationFromWire),
                  evidenceIds: input.evidence_ids,
                  scope: input.scope ?? null,
                });
              case "propose_skill_candidate":
                return learnedStore.write({
                  operation: "propose_skill_candidate",
                  sources: input.sources.map((source) => ({
                    memoryId: source.memory_id,
                    revision: source.revision,
                  })),
                  artifact: input.artifact,
                });
              case "review_skill_candidate":
                return learnedStore.write({
                  operation: "review_skill_candidate",
                  candidateId: input.candidate_id,
                  expectedState: input.expected_state,
                  decision: input.decision,
                  reviewNote: input.review_note,
                });
            }
          })();
          const safeResult = sanitizePresentation(result);
          return toolResult(
            "mooncite_memory_write",
            renderMemoryWrite(safeResult),
            safeResult as unknown as Record<string, unknown>,
          );
        } catch (error) {
          return learnedMemoryError("write", error);
        }
      },
    );

    server.registerTool(
      "mooncite_memory_delete",
      {
        title: "Delete learned memory",
        description: "Delete one learned memory or skill candidate. Memory deletion fails while a surviving dependency remains.",
        inputSchema: memoryDeleteInput,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      },
      async (input) => {
        if (!learnedStore) return learnedMemoryError("delete");
        try {
          const result = input.kind === "memory"
            ? learnedStore.delete({
              kind: "memory",
              memoryId: input.memory_id,
              expectedRevision: input.expected_revision,
              expectedMetadataVersion: input.expected_metadata_version,
            })
            : learnedStore.delete({
              kind: "skill_candidate",
              candidateId: input.candidate_id,
              expectedState: input.expected_state,
            });
          const safeResult = sanitizePresentation(result);
          return toolResult(
            "mooncite_memory_delete",
            renderMemoryDelete(safeResult),
            safeResult as unknown as Record<string, unknown>,
          );
        } catch (error) {
          return learnedMemoryError("delete", error);
        }
      },
    );
  }

  return server;
}
