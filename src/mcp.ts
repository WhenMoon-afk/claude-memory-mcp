import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MoonciteEngine, type EngineOptions, type EvidenceBundle, type EvidenceInspection, type MoonciteStatus } from "./engine.js";
import { MOONCITE_MCP_NAME, MOONCITE_VERSION } from "./identity.js";
import type { RegistrationDiagnostics } from "./clients.js";

const PRESENTATION_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const boundedRenderedInput = (maximum: number) => z.string().min(1).max(maximum)
  .refine((value) => !PRESENTATION_CONTROL_PATTERN.test(value), "Control characters are not allowed.");

const recallInput = z.object({
  query: boundedRenderedInput(2_000).describe("Lexical query; exact names, identifiers, error text, hashes, and distinctive phrases work best."),
  limit: z.number().int().min(1).max(20).optional().describe("Maximum candidates to return; defaults to 5."),
  project: boundedRenderedInput(256).optional().describe("Exact encoded project identity returned by an earlier candidate, such as project:example-0123456789abcdef."),
  session_id: boundedRenderedInput(256).optional().describe("Exact Pi session identifier returned by an earlier candidate."),
}).strict();

function renderRecall(bundle: EvidenceBundle): string {
  const heading = bundle.outcome === "unavailable"
    ? `Mooncite evidence is unavailable for “${bundle.query}”.`
    : bundle.outcome === "no_match"
      ? `No evidence matched “${bundle.query}”.`
      : bundle.outcome === "weak_leads"
        ? `Weak evidence leads for “${bundle.query}”: `
        : `Evidence for “${bundle.query}”:`;
  const requestedScope = bundle.scope.project || bundle.scope.sessionId
    ? `; scope${bundle.scope.project ? ` project=${bundle.scope.project}` : ""}${bundle.scope.sessionId ? ` session_id=${bundle.scope.sessionId}` : ""} contains ${bundle.scope.evidenceSpans} indexed span(s)`
    : "";
  const warnings = bundle.warnings.length ? ` Warnings: ${bundle.warnings.join(" ")}` : "";
  const trustedHeading = `${heading} [${bundle.trustState}; ${bundle.coverage} coverage${requestedScope}]${warnings}`;
  if (!bundle.candidates.length) return trustedHeading;
  return `${trustedHeading}\n${bundle.candidates.map((candidate, index) => {
    const duplicates = candidate.duplicateSpanCount && candidate.duplicateSpanCount > 1
      ? ` [${candidate.duplicateSpanCount} equivalent ranked spans collapsed]`
      : "";
    return `${index + 1}. [${candidate.relevance.band}]${duplicates} ${candidate.excerpt}\n   evidence_id: ${candidate.evidenceId}\n   evidence_uri: ${candidate.evidenceUri}`;
  }).join("\n")}`;
}

function renderInspection(inspection: EvidenceInspection): string {
  if (inspection.outcome !== "verified") return `Evidence ${inspection.evidenceId}: ${inspection.outcome}. ${inspection.message ?? ""}`.trim();
  return `Verified evidence ${inspection.evidenceId}:\n${inspection.window.map((span) => `${span.relation}: ${span.text}`).join("\n")}`;
}

export interface MoonciteToolStatus extends MoonciteStatus {
  registrations: RegistrationDiagnostics;
}

export type RegistrationProvider = () => Promise<RegistrationDiagnostics>;

function renderStatus(status: MoonciteToolStatus): string {
  const registrations = status.registrations;
  return `Mooncite is ${status.outcome} (${status.freshness}, ${status.trustState}, ${status.coverage} coverage): ${status.evidenceSpans} searchable span(s) from ${status.sourceFiles} Pi session file(s); ${status.malformed} malformed, ${status.oversized} oversized, ${status.errors} error(s); registrations: Pi ${registrations.pi}, OMP ${registrations.omp}, Codex ${registrations.codex}, Claude Code ${registrations.claudeCode}; last good usable: ${status.lastGoodUsable}.`;
}

export function createMoonciteMcpServer(
  options: EngineOptions,
  registrations: RegistrationProvider = async () => ({ pi: "unavailable", omp: "unavailable", codex: "unavailable", claudeCode: "unavailable" }),
): McpServer {
  const engine = new MoonciteEngine(options);
  const server = new McpServer({ name: MOONCITE_MCP_NAME, version: MOONCITE_VERSION }, { capabilities: { tools: {} } });

  server.registerTool(
    "mooncite_recall",
    {
      title: "Recall prior Pi evidence",
      description: "Find bounded cited evidence with transparent lexical search over authorized local Pi history.",
      inputSchema: recallInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit, project, session_id }) => {
      const bundle = engine.recall({
        query,
        ...(limit === undefined ? {} : { limit }),
        ...(project === undefined ? {} : { project }),
        ...(session_id === undefined ? {} : { sessionId: session_id }),
      });
      return {
        content: [{ type: "text" as const, text: renderRecall(bundle) }],
        structuredContent: bundle,
      };
    },
  );

  server.registerTool(
    "mooncite_inspect",
    {
      title: "Inspect cited Pi evidence",
      description: "Verify one evidence ID or evidence URI and return a bounded physical source window.",
      inputSchema: z.object({
        evidence_id: boundedRenderedInput(2_048),
        window: z.number().int().min(0).max(10).optional(),
      }).strict(),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ evidence_id, window }) => {
      const inspection = engine.inspect({ evidenceId: evidence_id, ...(window === undefined ? {} : { window }) });
      return {
        content: [{ type: "text" as const, text: renderInspection(inspection) }],
        structuredContent: inspection,
      };
    },
  );

  server.registerTool(
    "mooncite_status",
    {
      title: "Check Mooncite status",
      description: "Report local source and index health without transcript text.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const status: MoonciteToolStatus = { ...engine.status(), registrations: await registrations() };
      return {
        content: [{ type: "text" as const, text: renderStatus(status) }],
        structuredContent: status,
      };
    },
  );

  return server;
}
