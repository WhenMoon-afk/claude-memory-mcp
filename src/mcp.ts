import { McpServer } from "@modelcontextprotocol/server";
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

const recallInput = z.object({
  query: boundedRenderedInput(2_000).describe("Lexical query. Wrap a multiword phrase in matching quotes for phrase search; otherwise terms are ORed. Exact Mooncite locators and returned encoded identities also match directly."),
  limit: z.number().int().min(1).max(20).optional().describe("Maximum candidates to return; defaults to 5."),
  project: boundedRenderedInput(256).optional().describe("Copy the exact candidate.project value from an earlier result; never pass a filesystem path."),
  session_id: boundedRenderedInput(512).optional().describe("Copy the exact source-qualified candidate.sessionId value from an earlier result."),
}).strict();

const memoryIdInput = boundedRenderedInput(64)
  .regex(/^mooncite-memory:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const memoryScopeInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }).strict(),
  z.object({
    kind: z.literal("project"),
    project: boundedRenderedInput(256).describe("Exact encoded Mooncite project identity from a source-evidence candidate."),
  }).strict(),
]);
const memoryRecallInput = z.object({
  query: boundedRenderedInput(2_000).describe("Lexical interpretation query or exact mooncite-memory ID."),
  limit: z.number().int().min(1).max(20).optional().describe("Maximum derived-memory candidates; defaults to 5."),
  project: boundedRenderedInput(256).optional().describe("Return this exact encoded project plus global learned memories."),
  include_invalid: z.boolean().optional().describe("Include quarantined interpretations whose source provenance changed, disappeared, or was deauthorized."),
}).strict();
const memoryInspectInput = z.object({
  memory_id: memoryIdInput,
  revision: z.number().int().min(1).optional().describe("Immutable revision to inspect; defaults to the current revision."),
  window: z.number().int().min(0).max(2).optional().describe("Physical source spans before and after every anchor; defaults to 0, range 0–2."),
}).strict();
const memoryWriteInput = z.object({
  memory_id: memoryIdInput.optional().describe("Omit to create; supply with expected_revision to append an immutable correction."),
  expected_revision: z.number().int().min(1).optional().describe("Required stale-write guard when memory_id is supplied."),
  interpretation: boundedRenderedInput(8_192).describe("Derived interpretation, at most 8 KiB UTF-8. This is never source evidence."),
  evidence_ids: z.array(boundedRenderedInput(2_048)).min(1).max(8)
    .refine((values) => new Set(values).size === values.length, "Evidence locators must be unique.")
    .describe("One to eight Mooncite evidence IDs or URIs. The server physically verifies and canonicalizes every anchor."),
  scope: memoryScopeInput.optional().describe("Same-project creation defaults to that project; mixed-project creation requires explicit global scope."),
}).strict().superRefine((value, context) => {
  if ((value.memory_id === undefined) !== (value.expected_revision === undefined)) {
    context.addIssue({
      code: "custom",
      message: "memory_id and expected_revision must either both be supplied for revision or both be omitted for creation.",
    });
  }
});
const memoryDeleteInput = z.object({
  memory_id: memoryIdInput,
  expected_revision: z.number().int().min(1).describe("Required stale-write guard for destructive deletion."),
}).strict();

function renderNext(next: EvidenceBundle["next"]): string {
  if (!next) return "none";
  const args = next.arguments ? ` ${JSON.stringify(next.arguments)}` : "";
  return `${next.action} ${next.target}${args} — ${next.reason}`;
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
  return `${heading}\n${state}\n${bundle.candidates.map((candidate, index) => {
    const duplicates = candidate.duplicateSpanCount && candidate.duplicateSpanCount > 1
      ? `; duplicates_collapsed=${candidate.duplicateSpanCount}`
      : "";
    const omitted = candidate.omittedBytes > 0 ? `; omitted_bytes=${candidate.omittedBytes}` : "";
    return `${index + 1}. [${candidate.match.band}; ${candidate.match.kind}; term_coverage=${candidate.match.termCoverage.toFixed(2)}${duplicates}${omitted}] ${candidate.excerpt}\n`
      + `   evidence_id: ${candidate.evidenceId}\n`
      + `   evidence_uri: ${candidate.evidenceUri}\n`
      + `   project: ${candidate.project}\n`
      + `   session_id: ${candidate.sessionId}\n`
      + `   matched_terms: ${candidate.match.matchedTerms.join(", ") || "none"}\n`
      + `   missing_terms: ${candidate.match.missingTerms.join(", ") || "none"}`;
  }).join("\n")}\n${next}`;
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
  return `${heading}\nEvidence: ${inspection.evidenceId}\n${inspection.window.map((span) => `${span.relation}: ${span.text}`).join("\n")}\n${next}`;
}

function renderMemoryRecall(bundle: LearnedMemoryRecall): string {
  const heading = `Derived Mooncite memories for “${bundle.query}” (interpretations, not source evidence):`;
  const warnings = bundle.warnings.length ? ` Warnings: ${bundle.warnings.join(" ")}` : "";
  if (bundle.candidates.length === 0) return `${heading} no match.${warnings}`;
  return `${heading}${warnings}\n${bundle.candidates.map((candidate, index) =>
    `${index + 1}. [${candidate.relevance.band}; provenance=${candidate.provenanceState}${candidate.quarantined ? "; quarantined" : ""}] ${candidate.interpretation}\n`
    + `   kind: derived_memory\n   memory_id: ${candidate.memoryId}\n   revision: ${candidate.revision}\n`
    + `   source_evidence: ${candidate.anchors.map((anchor) => `${anchor.evidenceUri} (${anchor.state})`).join(", ")}`,
  ).join("\n")}`;
}

function renderMemoryInspection(inspection: LearnedMemoryInspection): string {
  const sources = inspection.anchors.map((anchor) =>
    `${anchor.position + 1}. ${anchor.evidenceUri}: ${anchor.state}; physical_inspection=${anchor.inspection.outcome}`).join("\n");
  return `Derived memory ${inspection.memoryId} revision ${inspection.revision}: ${inspection.provenanceOutcome} provenance.`
    + `\nInterpretation (derived_memory, not source evidence): ${inspection.interpretation}`
    + `\nSource evidence anchors:\n${sources}`;
}

function renderMemoryWrite(result: LearnedMemoryWriteResult): string {
  return `Stored derived memory ${result.memoryId} revision ${result.revision} with ${result.evidenceIds.length} physically verified source anchor(s).`
    + "\nThe stored text is derived_memory; the cited Mooncite locators remain source evidence.";
}

function renderMemoryDelete(result: LearnedMemoryDeleteResult): string {
  return `Deleted derived memory ${result.memoryId} and ${result.deletedRevisions} immutable revision(s). Source files and the evidence index were not changed.`;
}

type LearnedMemoryOperation = "recall" | "inspection" | "write" | "delete";
function learnedMemoryError(operation: LearnedMemoryOperation, error?: unknown) {
  const raw = error instanceof Error ? error.message : "";
  const message = /^(?:Mooncite (?:learned|evidence|tool)|A new Mooncite|Project-scoped|Mixed-project)/u.test(raw)
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
  const memory = status.learnedMemory
    ? ` Learned memory: ${status.learnedMemory.outcome}, ${status.learnedMemory.memories} item(s), ${status.learnedMemory.revisions} revision(s)${status.learnedMemory.errorCode ? `, error=${status.learnedMemory.errorCode}` : ""}.`
    : "";
  const errors = status.errorGroups.length
    ? ` Error groups: ${status.errorGroups.map((group) => `${group.origin}/${group.reason}=${group.count} (fatal=${group.fatalCount})`).join(", ")}.`
    : "";
  const refresh = status.lastSuccessfulRefreshAt ?? "never";
  return `Mooncite status: ${status.outcome}; ${status.meaning}\n`
    + `Freshness: ${status.freshness}; trust=${status.trustState}; coverage=${status.coverage}; search_usable=${status.searchUsable}; last_successful_refresh=${refresh}; last_refresh=${status.lastRefreshOutcome}; last_rebuild=${status.lastRebuildOutcome}.\n`
    + `Sources: ${status.evidenceSpans} searchable span(s) from ${status.sourceFiles} session file(s) (${sourceCounts}); ${status.malformed} malformed, ${status.oversized} oversized, ${status.errors} error(s); registrations: Pi ${registrations.pi}, OMP ${registrations.omp}, Codex ${registrations.codex}, Claude Code ${registrations.claudeCode}.${errors}${memory}\n`
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
  const server = new McpServer({ name: MOONCITE_MCP_NAME, version: MOONCITE_VERSION }, { capabilities: { tools: {} } });
  const closeServer = server.close.bind(server);
  let engineClosed = false;
  server.close = async (): Promise<void> => {
    try {
      await closeServer();
    } finally {
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
      title: "Recall prior session evidence",
      description: "Find bounded cited evidence with transparent lexical matching, explicit six-outcome semantics, and a concrete next action across authorized local histories.",
      inputSchema: recallInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit, project, session_id }) => {
      try {
        const bundle = engine.recall({
          query,
          ...(limit === undefined ? {} : { limit }),
          ...(project === undefined ? {} : { project }),
          ...(session_id === undefined ? {} : { sessionId: session_id }),
        });
        const safeBundle = sanitizePresentation(bundle);
        return {
          content: [{ type: "text" as const, text: renderRecall(safeBundle) }],
          structuredContent: safeBundle,
        };
      } catch {
        return sourceEvidenceError("recall");
      }
    },
  );

  server.registerTool(
    "mooncite_inspect",
    {
      title: "Inspect cited session evidence",
      description: "Physically verify one evidence ID or URI and return a bounded source window. Verified means provenance bytes match, not that the quoted claim is true.",
      inputSchema: z.object({
        evidence_id: boundedRenderedInput(2_048),
        window: z.number().int().min(0).max(10).optional().describe("Number of indexed spans before and after the target; defaults to 2, range 0–10."),
      }).strict(),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ evidence_id, window }) => {
      try {
        const inspection = inspectionPresentation(engine.inspect({
          evidenceId: evidence_id,
          ...(window === undefined ? {} : { window }),
        }));
        const safeInspection = sanitizePresentation(inspection);
        return {
          content: [{ type: "text" as const, text: renderInspection(safeInspection) }],
          structuredContent: safeInspection,
        };
      } catch {
        return sourceEvidenceError("inspection");
      }
    },
  );

  server.registerTool(
    "mooncite_status",
    {
      title: "Check Mooncite status",
      description: "Report ready, degraded, or unavailable source/index health, explicit freshness, grouped errors, and next action without transcript text.",
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
        return {
          content: [{ type: "text" as const, text: renderStatus(safeStatus) }],
          structuredContent: safeStatus,
        };
      } catch {
        return sourceEvidenceError("status");
      }
    },
  );

  if (learnedMemoryEnabled) {
    server.registerTool(
      "mooncite_memory_recall",
      {
        title: "Recall derived Mooncite memory",
        description: "Search explicit citation-backed interpretations. Results are derived memory, never source evidence.",
        inputSchema: memoryRecallInput,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ query, limit, project, include_invalid }) => {
        if (!learnedStore) return learnedMemoryError("recall");
        try {
          const result = learnedStore.recall({
            query,
            ...(limit === undefined ? {} : { limit }),
            ...(project === undefined ? {} : { project }),
            ...(include_invalid === undefined ? {} : { includeInvalid: include_invalid }),
          });
          const safeResult = sanitizePresentation(result);
          return {
            content: [{ type: "text" as const, text: renderMemoryRecall(safeResult) }],
            structuredContent: safeResult,
          };
        } catch (error) {
          return learnedMemoryError("recall", error);
        }
      },
    );

    server.registerTool(
      "mooncite_memory_inspect",
      {
        title: "Inspect derived Mooncite memory",
        description: "Resolve one immutable derived-memory revision and physically inspect every cited source-evidence anchor.",
        inputSchema: memoryInspectInput,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ memory_id, revision, window }) => {
        if (!learnedStore) return learnedMemoryError("inspection");
        try {
          const result = learnedStore.inspect({
            memoryId: memory_id,
            ...(revision === undefined ? {} : { revision }),
            ...(window === undefined ? {} : { window }),
          });
          const safeResult = sanitizePresentation(result);
          return {
            content: [{ type: "text" as const, text: renderMemoryInspection(safeResult) }],
            structuredContent: safeResult,
          };
        } catch (error) {
          return learnedMemoryError("inspection", error);
        }
      },
    );

    server.registerTool(
      "mooncite_memory_write",
      {
        title: "Write citation-backed Mooncite memory",
        description: "Create or append an immutable revision of a derived interpretation after every Mooncite evidence anchor is physically verified.",
        inputSchema: memoryWriteInput,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      async ({ memory_id, expected_revision, interpretation, evidence_ids, scope }) => {
        if (!learnedStore) return learnedMemoryError("write");
        try {
          const result = learnedStore.write({
            ...(memory_id === undefined ? {} : { memoryId: memory_id }),
            ...(expected_revision === undefined ? {} : { expectedRevision: expected_revision }),
            interpretation,
            evidenceIds: evidence_ids,
            ...(scope === undefined ? {} : { scope }),
          });
          const safeResult = sanitizePresentation(result);
          return {
            content: [{ type: "text" as const, text: renderMemoryWrite(safeResult) }],
            structuredContent: safeResult,
          };
        } catch (error) {
          return learnedMemoryError("write", error);
        }
      },
    );

    server.registerTool(
      "mooncite_memory_delete",
      {
        title: "Delete derived Mooncite memory",
        description: "Delete one learned-memory item and all immutable revisions without changing source files or the disposable evidence index.",
        inputSchema: memoryDeleteInput,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      },
      async ({ memory_id, expected_revision }) => {
        if (!learnedStore) return learnedMemoryError("delete");
        try {
          const result = learnedStore.delete({ memoryId: memory_id, expectedRevision: expected_revision });
          const safeResult = sanitizePresentation(result);
          return {
            content: [{ type: "text" as const, text: renderMemoryDelete(safeResult) }],
            structuredContent: safeResult,
          };
        } catch (error) {
          return learnedMemoryError("delete", error);
        }
      },
    );
  }

  return server;
}
