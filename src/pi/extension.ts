import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Type, type TSchema } from "typebox";
import { MOONCITE_VERSION } from "../identity.js";

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
) {
  return (pi: PiExtensionApi): void => {
    pi.registerTool(tool(call, {
      name: "mooncite_recall",
      label: "Recall prior evidence",
      description: "Search authorized local history for bounded lexical evidence. Unquoted multi-word misses may use local embeddings. Returns cited candidates, explicit outcomes, and next actions.",
      promptSnippet: "Recall cited evidence from prior local sessions",
      promptGuidelines: [
        "Use mooncite_recall when past local context may matter. Start with an exact name, identifier, error, hash, or distinctive phrase.",
        "Read outcome, conclusive, match, warnings, and next. Inspect a cited candidate before relying on it. Inconclusive does not prove absence.",
        "Start without a scope. Narrow only with exact project and sessionId values from a candidate. Never pass a filesystem path.",
      ],
      parameters: Type.Object({
        query: Type.String({ minLength: 1, maxLength: 2_000, pattern: PRESENTATION_SAFE_PATTERN, description: "Lexical query. Matching quotes require an exact phrase. Unquoted terms use OR. After an unquoted multi-word miss, local embeddings may add matches. Exact locators and returned identities also match." }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Maximum candidates. Default: 5." })),
        project: Type.Optional(Type.String({ minLength: 1, maxLength: 256, pattern: PRESENTATION_SAFE_PATTERN, description: "Copy candidate.project from a result. Do not pass a filesystem path." })),
        session_id: Type.Optional(Type.String({ minLength: 1, maxLength: 512, pattern: PRESENTATION_SAFE_PATTERN, description: "Copy the source-qualified candidate.sessionId from a result." })),
        after: Type.Optional(Type.String({ format: "date-time", description: "Inclusive lower event-time bound. Untimestamped evidence is excluded." })),
        before: Type.Optional(Type.String({ format: "date-time", description: "Inclusive upper event-time bound. Untimestamped evidence is excluded." })),
        role: Type.Optional(Type.Union([
          Type.Literal("user"),
          Type.Literal("assistant"),
          Type.Literal("system"),
          Type.Literal("developer"),
          Type.Literal("tool"),
          Type.Literal("toolResult"),
          Type.Literal("summary"),
          Type.Literal("unknown"),
        ], { description: "Exact indexed role." })),
        source_origin: Type.Optional(Type.Union([
          Type.Literal("pi"),
          Type.Literal("omp"),
          Type.Literal("claude-code"),
          Type.Literal("codex"),
          Type.Literal("chatgpt"),
        ], { description: "Exact source origin." })),
        order: Type.Optional(Type.Union([
          Type.Literal("relevance"),
          Type.Literal("newest"),
          Type.Literal("oldest"),
        ], { description: "Candidate order. Default: relevance." })),
      }, { additionalProperties: false }),
    }));
    pi.registerTool(tool(call, {
      name: "mooncite_inspect",
      label: "Inspect cited evidence",
      description: "Verify one Mooncite locator against current source bytes and return a bounded window. Verification proves provenance, not truth.",
      promptSnippet: "Verify one Mooncite citation",
      promptGuidelines: ["Inspect the exact locator before relying on recalled evidence. verified proves physical provenance, not truth or current authority."],
      parameters: Type.Object({
        evidence_id: Type.String({ minLength: 1, maxLength: 2_048, pattern: PRESENTATION_SAFE_PATTERN }),
        window: Type.Optional(Type.Integer({ minimum: 0, maximum: 10, description: "Spans before and after the target. Default: 2. Range: 0 to 10." })),
      }, { additionalProperties: false }),
    }));
    pi.registerTool(tool(call, {
      name: "mooncite_status",
      label: "Mooncite status",
      description: "Report source and index health without transcript text or full source paths.",
      promptSnippet: "Check Mooncite source and index health",
      promptGuidelines: ["Use mooncite_status only to diagnose availability or freshness. A degraded search may still work. An empty degraded result is inconclusive."],
      parameters: Type.Object({}, { additionalProperties: false }),
    }));
  };
}

export default createMooncitePiExtension();
