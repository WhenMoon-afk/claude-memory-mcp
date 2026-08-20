import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Type, type TSchema } from "typebox";
import { MOONCITE_VERSION } from "../identity.js";
import { loadLearnedMemoryMode, resolveLearnedMemoryConfigPath } from "../learned-memory.js";

export interface PiToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
}

export type McpToolCaller = (
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<PiToolResult>;

interface PiToolDefinition {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
  parameters: TSchema;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<{ content: PiToolResult["content"]; details: Record<string, unknown> }>;
}

export interface PiExtensionApi {
  registerTool(tool: PiToolDefinition): void;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

const packagedCliPath = fileURLToPath(new URL("../cli.js", import.meta.url));
const PRESENTATION_SAFE_PATTERN = "^[^\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200e\\u200f\\u2028-\\u202e\\u2066-\\u2069]*$";
const MEMORY_ID_PATTERN = "^mooncite-memory:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const MEMORY_SCOPE_PARAMETER = Type.Union([
  Type.Object({ kind: Type.Literal("global") }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("project"),
    project: Type.String({ minLength: 1, maxLength: 256, pattern: PRESENTATION_SAFE_PATTERN }),
  }, { additionalProperties: false }),
]);
const MEMORY_INTERPRETATION_PARAMETER = Type.String({ minLength: 1, maxLength: 8_192, pattern: PRESENTATION_SAFE_PATTERN });
const MEMORY_EVIDENCE_PARAMETERS = Type.Array(
  Type.String({ minLength: 1, maxLength: 2_048, pattern: PRESENTATION_SAFE_PATTERN }),
  { minItems: 1, maxItems: 8, uniqueItems: true },
);

function learnedMemoryEnabled(): boolean {
  try {
    return loadLearnedMemoryMode(resolveLearnedMemoryConfigPath()).enabled;
  } catch {
    return false;
  }
}

export const callPackagedMcp: McpToolCaller = async (name, args, signal) =>
  new Promise<PiToolResult>((resolvePromise, reject) => {
    const cliPath = process.env.MOONCITE_CLI_PATH || packagedCliPath;
    const child = spawn(process.execPath, [cliPath, "serve"], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let pending = "";
    let initialized = false;
    let settled = false;
    let stdoutBytes = 0;
    let timer: NodeJS.Timeout;

    const finishError = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      child.kill("SIGTERM");
      reject(error);
    };
    const finishResult = (result: PiToolResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      child.stdin.end();
      resolvePromise(result);
    };
    const onAbort = (): void => finishError(new Error("Mooncite MCP call cancelled."));
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => finishError(new Error("Mooncite MCP call timed out.")), 30_000);
    timer.unref();
    if (signal?.aborted) {
      finishError(new Error("Mooncite MCP call cancelled."));
      return;
    }

    child.once("error", () => finishError(new Error("Mooncite MCP process failed.")));
    child.stderr.resume();
    child.once("close", (code) => {
      if (!settled) finishError(new Error(`Mooncite MCP process exited with code ${code ?? 1}.`));
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBytes += Buffer.byteLength(chunk, "utf8");
      if (stdoutBytes > 4 * 1024 * 1024) {
        finishError(new Error("Mooncite MCP response exceeded the output limit."));
        return;
      }
      pending += chunk;
      while (pending.includes("\n")) {
        const newline = pending.indexOf("\n");
        const physical = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (Buffer.byteLength(physical, "utf8") > 1024 * 1024) {
          finishError(new Error("Mooncite MCP response line exceeded the output limit."));
          return;
        }
        if (!physical.trim()) continue;
        let message: JsonRpcMessage;
        try { message = JSON.parse(physical) as JsonRpcMessage; } catch { continue; }
        if (message.id === 1) {
          if (message.error) {
            finishError(new Error("Mooncite MCP initialization failed."));
            return;
          }
          initialized = true;
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } })}\n`);
          continue;
        }
        if (message.id === 2 && initialized) {
          if (message.error) {
            finishError(new Error(`Mooncite MCP tool ${name} failed.`));
            return;
          }
          const result = message.result ?? {};
          if (result.isError === true) {
            finishError(new Error(`Mooncite MCP tool ${name} failed.`));
            return;
          }
          const content = Array.isArray(result.content)
            ? result.content.filter((part): part is { type: "text"; text: string } =>
              Boolean(part) && typeof part === "object" && (part as Record<string, unknown>).type === "text" && typeof (part as Record<string, unknown>).text === "string")
            : [];
          const structuredContent = result.structuredContent;
          finishResult({
            content,
            ...(structuredContent && typeof structuredContent === "object"
              ? { structuredContent: structuredContent as Record<string, unknown> }
              : {}),
          });
          return;
        }
      }
    });

    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "mooncite-pi", version: MOONCITE_VERSION },
      },
    })}\n`);
  });

function tool(
  call: McpToolCaller,
  definition: Omit<PiToolDefinition, "execute">,
): PiToolDefinition {
  return {
    ...definition,
    async execute(_toolCallId, params, signal) {
      const result = await call(definition.name, params, signal);
      return { content: result.content, details: result.structuredContent ?? {} };
    },
  };
}

export function createMooncitePiExtension(
  call: McpToolCaller = callPackagedMcp,
  memoryEnabled = learnedMemoryEnabled(),
) {
  return (pi: PiExtensionApi): void => {
    pi.registerTool(tool(call, {
      name: "mooncite_recall",
      label: "Recall prior evidence",
      description: "Find bounded cited evidence with transparent lexical search over authorized local conversation history. Returns at most 20 candidates.",
      promptSnippet: "Recall cited evidence from prior local sessions",
      promptGuidelines: [
        "Use mooncite_recall when earlier local-session evidence could materially inform the current task. Start with exact names, identifiers, literal error text, hashes, or distinctive phrases; quote a multiword phrase for exact phrase search.",
        "Read outcome, conclusive, match, warnings, and next before acting. Inspect a cited candidate before reliance. An inconclusive result is not evidence of absence.",
        "Start unscoped. Narrow only by copying exact project and sessionId values returned by a candidate; never invent a scope or pass a filesystem path.",
      ],
      parameters: Type.Object({
        query: Type.String({ minLength: 1, maxLength: 2_000, pattern: PRESENTATION_SAFE_PATTERN, description: "Lexical query. Wrap a multiword phrase in matching quotes for phrase search; otherwise terms are ORed. Exact Mooncite locators and returned encoded identities also match directly." }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Maximum candidates to return; defaults to 5." })),
        project: Type.Optional(Type.String({ minLength: 1, maxLength: 256, pattern: PRESENTATION_SAFE_PATTERN, description: "Copy the exact candidate.project value from an earlier result; never pass a filesystem path." })),
        session_id: Type.Optional(Type.String({ minLength: 1, maxLength: 512, pattern: PRESENTATION_SAFE_PATTERN, description: "Copy the exact source-qualified candidate.sessionId value from an earlier result." })),
      }, { additionalProperties: false }),
    }));
    pi.registerTool(tool(call, {
      name: "mooncite_inspect",
      label: "Inspect cited evidence",
      description: "Physically verify one Mooncite evidence ID or URI and return a bounded source window (maximum 10 spans each side). Byte verification proves provenance, not claim truth.",
      promptSnippet: "Verify and expand one Mooncite citation",
      promptGuidelines: ["Before relying on recalled evidence, inspect its exact locator. Treat verified as physical provenance, not truth or current authority."],
      parameters: Type.Object({
        evidence_id: Type.String({ minLength: 1, maxLength: 2_048, pattern: PRESENTATION_SAFE_PATTERN }),
        window: Type.Optional(Type.Integer({ minimum: 0, maximum: 10, description: "Number of indexed spans before and after the target; defaults to 2, range 0–10." })),
      }, { additionalProperties: false }),
    }));
    pi.registerTool(tool(call, {
      name: "mooncite_status",
      label: "Mooncite status",
      description: "Report usable, degraded, or unavailable source/index health, explicit freshness, grouped errors, and next action without transcript text.",
      promptSnippet: "Check Mooncite source and index health",
      promptGuidelines: ["Use mooncite_status to diagnose availability or freshness. Search may remain usable when degraded, but empty results are then inconclusive."],
      parameters: Type.Object({}, { additionalProperties: false }),
    }));
    if (!memoryEnabled) return;
    pi.registerTool(tool(call, {
      name: "mooncite_memory_recall",
      label: "Recall derived memory",
      description: "Search explicit citation-backed interpretations. Results are derived memory, not source evidence.",
      promptSnippet: "Recall citation-backed derived interpretations",
      promptGuidelines: [
        "Treat every result as derived_memory, not evidence. Inspect the learned item and its source anchors before consequential reliance.",
        "Use include_invalid only to review or repair quarantined interpretations.",
      ],
      parameters: Type.Object({
        query: Type.String({ minLength: 1, maxLength: 2_000, pattern: PRESENTATION_SAFE_PATTERN, description: "Lexical interpretation query or exact mooncite-memory ID." }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
        project: Type.Optional(Type.String({ minLength: 1, maxLength: 256, pattern: PRESENTATION_SAFE_PATTERN })),
        include_invalid: Type.Optional(Type.Boolean()),
      }, { additionalProperties: false }),
    }));
    pi.registerTool(tool(call, {
      name: "mooncite_memory_inspect",
      label: "Inspect derived memory",
      description: "Resolve one immutable derived-memory revision and physically inspect every source-evidence anchor.",
      promptSnippet: "Verify a learned interpretation and all citations",
      promptGuidelines: ["A verified provenance outcome verifies the source anchors, not the truth or current authority of the interpretation."],
      parameters: Type.Object({
        memory_id: Type.String({ minLength: 1, maxLength: 64, pattern: MEMORY_ID_PATTERN }),
        revision: Type.Optional(Type.Integer({ minimum: 1 })),
        window: Type.Optional(Type.Integer({ minimum: 0, maximum: 2 })),
      }, { additionalProperties: false }),
    }));
    pi.registerTool(tool(call, {
      name: "mooncite_memory_write",
      label: "Write derived memory",
      description: "Create or append an immutable citation-backed interpretation after physical verification of every evidence anchor.",
      promptSnippet: "Retain an explicit citation-backed interpretation",
      promptGuidelines: [
        "Recall and inspect source evidence before writing. Never write an uncited interpretation or cite another learned memory.",
        "Supply memory_id and its exact current expected_revision only to append a correction; history is immutable.",
      ],
      parameters: Type.Union([
        Type.Object({
          interpretation: MEMORY_INTERPRETATION_PARAMETER,
          evidence_ids: MEMORY_EVIDENCE_PARAMETERS,
          scope: Type.Optional(MEMORY_SCOPE_PARAMETER),
        }, { additionalProperties: false }),
        Type.Object({
          memory_id: Type.String({ minLength: 1, maxLength: 64, pattern: MEMORY_ID_PATTERN }),
          expected_revision: Type.Integer({ minimum: 1 }),
          interpretation: MEMORY_INTERPRETATION_PARAMETER,
          evidence_ids: MEMORY_EVIDENCE_PARAMETERS,
          scope: Type.Optional(MEMORY_SCOPE_PARAMETER),
        }, { additionalProperties: false }),
      ]),
    }));
    pi.registerTool(tool(call, {
      name: "mooncite_memory_delete",
      label: "Delete derived memory",
      description: "Delete one learned item and every revision without changing source history or the evidence index.",
      promptSnippet: "Delete a learned interpretation only",
      promptGuidelines: ["Use the exact current revision as the stale-write guard. Deletion never deletes cited source evidence."],
      parameters: Type.Object({
        memory_id: Type.String({ minLength: 1, maxLength: 64, pattern: MEMORY_ID_PATTERN }),
        expected_revision: Type.Integer({ minimum: 1 }),
      }, { additionalProperties: false }),
    }));
  };
}

export default createMooncitePiExtension();
