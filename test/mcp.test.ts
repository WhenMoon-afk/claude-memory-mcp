import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createMoonciteMcpServer } from "../src/mcp.js";
import { createFixture, jsonLine, type Fixture } from "./fixture.js";

const fixtures: Fixture[] = [];
afterEach(async () => {
  while (fixtures.length) await fixtures.pop()!.cleanup();
});

interface RpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

async function rpc(
  method: string,
  params?: Record<string, unknown>,
  sourceFixture?: Fixture,
): Promise<RpcResponse> {
  const f = sourceFixture ?? await createFixture();
  if (!sourceFixture) fixtures.push(f);
  const server = createMoonciteMcpServer(
    { sessionsRoot: f.sessionsRoot, stateDir: f.stateDir },
    async () => ({ pi: "exact", omp: "exact", codex: "exact", claudeCode: "exact" }),
  );
  const input = new PassThrough();
  const output = new PassThrough();
  await server.connect(new StdioServerTransport(input, output));
  let pending = "";
  const next = (): Promise<RpcResponse> => {
    const { promise, resolve, reject } = Promise.withResolvers<RpcResponse>();
    output.setEncoding("utf8");
    const receive = (chunk: string): void => {
      pending += chunk;
      const newline = pending.indexOf("\n");
      if (newline < 0) return;
      output.off("data", receive);
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      try { resolve(JSON.parse(line) as RpcResponse); } catch (error) { reject(error); }
    };
    output.on("data", receive);
    return promise;
  };
  const initialized = next();
  input.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "contract", version: "1" } },
  })}\n`);
  expect((await initialized).error).toBeUndefined();
  input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const response = next();
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method, ...(params ? { params } : {}) })}\n`);
  const result = await response;
  await server.close();
  expect((await readdir(f.stateDir)).some((name) => name.startsWith(".engine-"))).toBe(false);
  return result;
}

async function openRpcSession(
  sourceFixture: Fixture,
  clientName = "contract-sequence",
): Promise<{
  request: (method: string, params?: Record<string, unknown>) => Promise<RpcResponse>;
  close: () => Promise<void>;
}> {
  const server = createMoonciteMcpServer(
    { sessionsRoot: sourceFixture.sessionsRoot, stateDir: sourceFixture.stateDir },
    async () => ({ pi: "exact", omp: "exact", codex: "exact", claudeCode: "exact" }),
  );
  const input = new PassThrough();
  const output = new PassThrough();
  await server.connect(new StdioServerTransport(input, output));
  let pending = "";
  let id = 0;
  const receive = (): Promise<RpcResponse> => {
    const { promise, resolve, reject } = Promise.withResolvers<RpcResponse>();
    output.setEncoding("utf8");
    const onData = (chunk: string): void => {
      pending += chunk;
      const newline = pending.indexOf("\n");
      if (newline < 0) return;
      output.off("data", onData);
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      try { resolve(JSON.parse(line) as RpcResponse); } catch (error) { reject(error); }
    };
    output.on("data", onData);
    return promise;
  };
  const request = async (method: string, params?: Record<string, unknown>): Promise<RpcResponse> => {
    const response = receive();
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: ++id, method, ...(params ? { params } : {}) })}\n`);
    return response;
  };
  expect((await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: { resources: {} },
    clientInfo: { name: clientName, version: "1" },
  })).error).toBeUndefined();
  input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  return {
    request,
    close: async () => {
      await server.close();
      expect((await readdir(sourceFixture.stateDir)).some((name) => name.startsWith(".engine-"))).toBe(false);
    },
  };
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  sourceFixture?: Fixture,
): Promise<Record<string, unknown>> {
  const response = await rpc("tools/call", { name, arguments: args }, sourceFixture);
  if (response.error) throw new Error(response.error.message);
  return response.result ?? {};
}

describe("Mooncite stdio MCP seam", () => {
  it("exposes exactly the three Mooncite tools by default without creating learned state", async () => {
    const sourceFixture = await createFixture();
    fixtures.push(sourceFixture);
    const result = await rpc("tools/list", undefined, sourceFixture);
    const tools = result.result?.tools as Array<{ name: string; description: string }>;
    expect(tools.map((tool) => tool.name).sort()).toEqual(["mooncite_inspect", "mooncite_recall", "mooncite_status"]);
    expect(Object.fromEntries(tools.map(({ name, description }) => [name, description]))).toEqual({
      mooncite_inspect: "Verify one Mooncite locator against current source bytes and return a bounded window. Verification proves provenance, not truth.",
      mooncite_recall: "Search authorized local history for bounded lexical evidence. Unquoted multi-word misses may use local embeddings. Returns cited candidates, explicit outcomes, and next actions.",
      mooncite_status: "Report source and index health without transcript text or full source paths.",
    });
    expect(await readdir(sourceFixture.stateDir)).not.toContain("learned-memory.sqlite");
  });


  it("supports the receiver recall-to-inspect flow with both rendered locator forms", async () => {
    const sourceFixture = await createFixture();
    fixtures.push(sourceFixture);
    const recalled = await callTool("mooncite_recall", { query: "silver-cedar-17" }, sourceFixture);
    const content = recalled.content as Array<{ type: string; text: string }>;
    const structured = recalled.structuredContent as {
      outcome: string;
      conclusive: boolean;
      next: { target: string } | null;
      candidates: Array<{
        evidenceId: string;
        evidenceUri: string;
        eventTimestamp: string | null;
        recordProvenance: string;
        sourceOrigin: string;
        role: string;
        match: { kind: string; band: string };
      }>;
    };
    const candidate = structured.candidates[0]!;
    expect(structured).toMatchObject({
      outcome: "matches",
      conclusive: true,
      next: { target: "mooncite_inspect" },
      candidates: [{
        sourceOrigin: "pi",
        role: "user",
        eventTimestamp: "2030-01-01T00:00:01.000Z",
        recordProvenance: "original",
        match: { kind: "text_exact", band: "strong" },
      }],
    });
    expect(content[0]!.text).toMatch(/^1\. pi user · /u);
    expect(content[0]!.text.indexOf("1. pi user")).toBeLessThan(content[0]!.text.indexOf("Finding 1"));
    expect(content[0]!.text).toContain("Finding 1\nExcerpt: ");
    expect(content[0]!.text.indexOf("Excerpt:")).toBeLessThan(content[0]!.text.indexOf("Source: pi"));
    expect(content[0]!.text).toContain("Source: pi\nRole: user\n");
    expect(content[0]!.text).toMatch(/^Time: .+ · .+$/mu);
    expect(content[0]!.text).toContain("Record provenance: original");
    expect(content[0]!.text).toContain("What it establishes:");
    expect(content[0]!.text).toContain("Returned-context relationship:");
    expect(content[0]!.text.indexOf("What it establishes:")).toBeLessThan(content[0]!.text.indexOf("Mooncite recall:"));
    expect(content[0]!.text).toContain("term_coverage=");
    expect(content[0]!.text).toContain("Next: call mooncite_inspect");
    expect(content[0]!.text).toContain("Follow-on queries:");
    expect(content[0]!.text).toContain(`Evidence ID: ${candidate.evidenceId}`);
    expect(content[0]!.text).toContain(`Evidence URI: ${candidate.evidenceUri}`);
    for (const evidence_id of [candidate.evidenceId, candidate.evidenceUri]) {
      const inspected = await callTool("mooncite_inspect", { evidence_id, window: 1 }, sourceFixture);
      expect(inspected.structuredContent).toMatchObject({
        outcome: "verified",
        conclusive: true,
        meaning: expect.stringContaining("verifies provenance, not the truth"),
        next: null,
        target: {
          eventTimestamp: "2030-01-01T00:00:01.000Z",
          recordProvenance: "original",
        },
      });
      const inspectionText = (inspected.content as Array<{ text: string }>)[0]!.text;
      expect(inspectionText).toContain("Mooncite inspection: verified; conclusive=true");
      expect(inspectionText).toContain("silver-cedar-17");
      expect(inspectionText).toMatch(/^Verified target\nSource: pi\nRole: user\n/u);
      expect(inspectionText).toMatch(/^Time: .+ · .+$/mu);
      expect(inspectionText.indexOf("Verified target")).toBeLessThan(inspectionText.indexOf("Mooncite inspection:"));
    }
  });

  it("returns match-centered excerpts through the MCP recall-to-inspect boundary", async () => {
    const sourceFixture = await createFixture();
    fixtures.push(sourceFixture);
    const entries = (await readFile(sourceFixture.source, "utf8")).trimEnd().split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const message = entries[1]!.message as Record<string, unknown>;
    message.content = `BEGIN-GENERIC-PREAMBLE\n${"Generic command output without the answer.\n".repeat(60)}Useful matched context: mcp-excerpt-target-84 explains the actual decision.`;
    const physicalSource = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
    await writeFile(sourceFixture.source, physicalSource);

    const recalled = await callTool("mooncite_recall", { query: "mcp-excerpt-target-84" }, sourceFixture);
    const structured = recalled.structuredContent as {
      candidates: Array<{ evidenceId: string; excerpt: string; omittedBytes: number }>;
    };
    expect(structured.candidates[0]).toMatchObject({
      excerpt: expect.stringContaining("Useful matched context: mcp-excerpt-target-84"),
      omittedBytes: expect.any(Number),
    });
    expect(structured.candidates[0]!.excerpt).not.toContain("BEGIN-GENERIC-PREAMBLE");
    expect((recalled.content as Array<{ text: string }>)[0]!.text)
      .toContain("Excerpt: Useful matched context: mcp-excerpt-target-84");
    expect((await callTool("mooncite_inspect", {
      evidence_id: structured.candidates[0]!.evidenceId,
    }, sourceFixture)).structuredContent).toMatchObject({
      outcome: "verified",
      evidenceId: structured.candidates[0]!.evidenceId,
    });
    expect(await readFile(sourceFixture.source, "utf8")).toBe(physicalSource);
  });

  it("spools long results and reports opt-in recall-to-inspect timing at the MCP receiver", async () => {
    const sourceFixture = await createFixture();
    fixtures.push(sourceFixture);
    let parentId = "entry-b";
    const records: string[] = [];
    for (let index = 0; index < 8; index++) {
      const id = `progressive-${index}`;
      records.push(jsonLine({
        type: "message",
        id,
        parentId,
        timestamp: `2030-01-01T00:01:${String(index).padStart(2, "0")}Z`,
        message: {
          role: "assistant",
          content: `progressive-needle-73 finding ${index} ${"bounded context ".repeat(500)}`,
        },
      }));
      parentId = id;
    }
    await appendFile(sourceFixture.source, records.join(""));

    const session = await openRpcSession(sourceFixture);
    try {
      const recalledResponse = await session.request("tools/call", {
        name: "mooncite_recall",
        arguments: { query: "progressive-needle-73", limit: 8, debug_timing: true },
      });
      expect(recalledResponse.error).toBeUndefined();
      const recalled = recalledResponse.result!;
      const structured = recalled.structuredContent as {
        candidates: Array<{ evidenceId: string }>;
        resultDetail: {
          inlineCandidates: number;
          totalCandidates: number;
          fullResult: { uri: string; bytes: number };
        };
        timing: { workflowId: string; recallMs: number };
      };
      expect(structured.candidates).toHaveLength(3);
      expect(structured.resultDetail).toMatchObject({
        inlineCandidates: 3,
        totalCandidates: 8,
        fullResult: { uri: expect.stringMatching(/^mooncite-result:\/\/artifact\//u) },
      });
      expect(structured.timing).toMatchObject({
        workflowId: expect.any(String),
        recallMs: expect.any(Number),
      });
      const linked = (recalled.content as Array<Record<string, unknown>>)
        .find((item) => item.type === "resource_link");
      expect(linked).toMatchObject({
        uri: structured.resultDetail.fullResult.uri,
        mimeType: "application/json",
      });

      const resourceResponse = await session.request("resources/read", {
        uri: structured.resultDetail.fullResult.uri,
      });
      expect(resourceResponse.error).toBeUndefined();
      const resource = resourceResponse.result!.contents as Array<{ text: string }>;
      const complete = JSON.parse(resource[0]!.text) as {
        renderedText: string;
        structuredContent: { candidates: unknown[] };
      };
      expect(complete.structuredContent.candidates).toHaveLength(8);
      expect(complete.renderedText).toContain("Finding 8");

      const inspectedResponse = await session.request("tools/call", {
        name: "mooncite_inspect",
        arguments: {
          evidence_id: structured.candidates[0]!.evidenceId,
          window: 0,
          debug_timing: true,
          workflow_id: structured.timing.workflowId,
        },
      });
      expect(inspectedResponse.error).toBeUndefined();
      expect(inspectedResponse.result!.structuredContent).toMatchObject({
        outcome: "verified",
        timing: {
          workflowId: structured.timing.workflowId,
          recallMs: structured.timing.recallMs,
          inspectMs: expect.any(Number),
          combinedMs: expect.any(Number),
          combined: true,
        },
      });
      const combinedTiming = z.object({
        timing: z.object({
          recallMs: z.number(),
          inspectMs: z.number(),
          combinedMs: z.number(),
        }),
      }).parse(inspectedResponse.result!.structuredContent).timing;
      expect(combinedTiming.combinedMs).toBe(Number(
        (combinedTiming.recallMs + combinedTiming.inspectMs).toFixed(3),
      ));
    } finally {
      await session.close();
    }

    const piSession = await openRpcSession(sourceFixture, "mooncite-pi");
    try {
      const piResponse = await piSession.request("tools/call", {
        name: "mooncite_recall",
        arguments: { query: "progressive-needle-73", limit: 8 },
      });
      expect(piResponse.error).toBeUndefined();
      const piResult = z.object({
        structuredContent: z.object({ candidates: z.array(z.unknown()) }),
        content: z.array(z.object({ type: z.string() }).passthrough()),
      }).parse(piResponse.result);
      expect(piResult.structuredContent.candidates).toHaveLength(8);
      expect(piResult.content.some(({ type }) => type === "resource_link")).toBe(false);
    } finally {
      await piSession.close();
    }
  });

  it("forwards strict event filters and temporal ordering through the MCP boundary", async () => {
    const sourceFixture = await createFixture();
    fixtures.push(sourceFixture);
    await appendFile(
      sourceFixture.source,
      jsonLine({
        type: "message",
        id: "mcp-time-user",
        parentId: "entry-b",
        timestamp: "2030-01-01T00:00:03-05:00",
        message: { role: "user", content: "mcp-temporal-42 first boundary event" },
      })
      + jsonLine({
        type: "message",
        id: "mcp-time-assistant",
        parentId: "mcp-time-user",
        timestamp: "2030-01-01T06:00:00Z",
        message: { role: "assistant", content: "mcp-temporal-42 second boundary event" },
      }),
    );

    const newest = await callTool("mooncite_recall", {
      query: "mcp-temporal-42",
      limit: 10,
      order: "newest",
    }, sourceFixture);
    const newestStructured = newest.structuredContent as {
      candidates: Array<{ entryId: string; eventTimestamp: string | null }>;
    };
    expect(newestStructured.candidates).toMatchObject([
      { entryId: "mcp-time-assistant", eventTimestamp: "2030-01-01T06:00:00.000Z" },
      { entryId: "mcp-time-user", eventTimestamp: "2030-01-01T05:00:03.000Z" },
    ]);

    const relevance = await callTool("mooncite_recall", {
      query: "mcp-temporal-42",
      order: "relevance",
    }, sourceFixture);
    expect(relevance.structuredContent).toMatchObject({ outcome: "matches" });

    const inclusive = await callTool("mooncite_recall", {
      query: "mcp-temporal-42",
      after: "2030-01-01T05:00:03Z",
      before: "2030-01-01T05:00:03.000Z",
      role: "user",
      source_origin: "pi",
      order: "oldest",
    }, sourceFixture);
    expect(inclusive.structuredContent).toMatchObject({
      outcome: "matches",
      candidates: [{
        entryId: "mcp-time-user",
        role: "user",
        sourceOrigin: "pi",
        eventTimestamp: "2030-01-01T05:00:03.000Z",
      }],
    });

    for (const arguments_ of [
      { query: "mcp-temporal-42", order: "sideways" },
      { query: "mcp-temporal-42", after: "2030-01-01" },
      { query: "mcp-temporal-42", before: "tomorrow" },
      { query: "mcp-temporal-42", role: "observer" },
      { query: "mcp-temporal-42", source_origin: "other" },
      { query: "mcp-temporal-42", unexpected: true },
    ]) {
      const rejected = await rpc("tools/call", {
        name: "mooncite_recall",
        arguments: arguments_,
      }, sourceFixture);
      expect(rejected.error, JSON.stringify(arguments_)).toBeUndefined();
      expect(rejected.result, JSON.stringify(arguments_)).toMatchObject({
        isError: true,
        content: [{
          type: "text",
          text: expect.stringContaining("Input validation error: Invalid arguments for tool mooncite_recall"),
        }],
      });
    }
  });

  it("searches literal failure text and distinguishes weak, empty, and invalid-scope results", async () => {
    const sourceFixture = await createFixture();
    fixtures.push(sourceFixture);
    const entries = (await readFile(sourceFixture.source, "utf8")).trimEnd().split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const message = entries[1]!.message as Record<string, unknown>;
    message.content = "Tool failure: OAuth flow timed out. Please try again. Correlation literal-error-58.";
    await writeFile(sourceFixture.source, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);

    const literal = await callTool("mooncite_recall", { query: "\"OAuth flow timed out. Please try again.\"" }, sourceFixture);
    expect(literal.structuredContent).toMatchObject({
      outcome: "matches",
      conclusive: true,
      candidates: [{ match: { kind: "phrase_exact", band: "strong" } }],
    });
    const weak = await callTool("mooncite_recall", {
      query: "literal-error-58 absent-vocabulary extraneous-term",
    }, sourceFixture);
    expect(weak.structuredContent).toMatchObject({
      outcome: "weak_leads",
      conclusive: false,
      candidates: [{ match: { band: "partial" } }],
    });
    const empty = await callTool("mooncite_recall", { query: "missing-evidence-9098" }, sourceFixture);
    expect(empty.structuredContent).toMatchObject({
      outcome: "no_match",
      conclusive: true,
      candidates: [],
      next: null,
    });
    const invalid = await callTool("mooncite_recall", {
      query: "literal-error-58",
      project: "/work/moon-project",
    }, sourceFixture);
    expect(invalid.structuredContent).toMatchObject({
      outcome: "invalid_scope",
      conclusive: false,
      next: { action: "call", target: "mooncite_recall" },
    });
  });

  it("visibly escapes terminal and bidirectional controls in text and structured results", async () => {
    const sourceFixture = await createFixture();
    fixtures.push(sourceFixture);
    const entries = (await readFile(sourceFixture.source, "utf8")).trimEnd().split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const message = entries[1]!.message as Record<string, unknown>;
    message.content = "The launch marker is silver-cedar-17. Unsafe \u001b]52;clipboard\u0007 and \u202espoof.";
    await writeFile(sourceFixture.source, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
    const recalled = await callTool("mooncite_recall", { query: "silver-cedar-17" }, sourceFixture);
    const rendered = JSON.stringify(recalled);
    expect(rendered).not.toContain("\u001b");
    expect(rendered).not.toContain("\u0007");
    expect(rendered).not.toContain("\u202e");
    expect(rendered).toContain("\\\\u{1b}");
    expect(rendered).toContain("\\\\u{202e}");
  });

  it("reports honest index and all supported client states without transcript text", async () => {
    const result = await callTool("mooncite_status", {});
    expect(result.structuredContent).toMatchObject({
      outcome: "ready",
      freshness: "current",
      sourceFiles: 1,
      sourceFilesByOrigin: { pi: 1, omp: 0, "claude-code": 0, codex: 0, chatgpt: 0 },
      evidenceSpans: 2,
      registrations: { pi: "exact", omp: "exact", codex: "exact", claudeCode: "exact" },
      meaning: expect.stringContaining("current, completely covered"),
      searchUsable: true,
      errorGroups: [],
      lastSuccessfulRefreshAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
      next: null,
    });
    expect(result.structuredContent).not.toHaveProperty("learnedMemory");
    expect(JSON.stringify(result.structuredContent)).not.toContain("silver-cedar-17");
    expect((result.content as Array<{ text: string }>)[0]!.text).toContain("Mooncite status: ready;");
  });

  it("does not rescan sources on mooncite_status after the index is warm", async () => {
    const sourceFixture = await createFixture();
    fixtures.push(sourceFixture);
    expect((await callTool("mooncite_status", {}, sourceFixture)).structuredContent)
      .toMatchObject({ outcome: "ready" });
    let nested = sourceFixture.sessionsRoot;
    for (let depth = 0; depth < 66; depth++) {
      nested = join(nested, `deep-${depth}`);
      await mkdir(nested);
    }
    const result = await callTool("mooncite_status", {}, sourceFixture);
    expect(result.structuredContent).toMatchObject({
      outcome: "ready",
      errorGroups: [],
    });
    expect((result.content as Array<{ text: string }>)[0]!.text).toContain("Mooncite status: ready;");
    expect(JSON.stringify(result.structuredContent)).not.toContain("silver-cedar-17");
  });

  it("keeps a first-generation bounded refresh unavailable without exposing source details", async () => {
    const sourceFixture = await createFixture();
    fixtures.push(sourceFixture);
    let nested = sourceFixture.sessionsRoot;
    for (let depth = 0; depth < 66; depth++) {
      nested = join(nested, `bounded-${depth}`);
      await mkdir(nested);
    }
    const boundedSource = join(nested, "bounded-session.jsonl");
    await writeFile(
      boundedSource,
      jsonLine({
        type: "session",
        version: 3,
        id: "bounded-session",
        timestamp: "2030-02-01T00:00:00.000Z",
        cwd: "/work/bounded-project",
      }) + jsonLine({
        type: "message",
        id: "bounded-entry",
        parentId: null,
        timestamp: "2030-02-01T00:00:01.000Z",
        message: { role: "user", content: "Bounded private marker is hidden-canyon-91." },
      }),
      { mode: 0o600 },
    );
    const sourceBytes = await Promise.all([
      readFile(sourceFixture.source),
      readFile(boundedSource),
    ]);

    const status = await callTool("mooncite_status", {}, sourceFixture);
    expect(status.structuredContent).toMatchObject({
      outcome: "unavailable",
      freshness: "unavailable",
      coverage: "partial",
      sourceFiles: 0,
      records: 0,
      evidenceSpans: 0,
      errors: 1,
      searchUsable: false,
      lastSuccessfulRefreshAt: null,
      lastRefreshOutcome: "unavailable",
      errorGroups: [{
        origin: "pi",
        reason: "source_limit_exceeded",
        count: 1,
        fatalCount: 1,
      }],
    });
    const renderedStatus = (status.content as Array<{ text: string }>)[0]!.text;
    expect(renderedStatus).toContain("pi/source_limit_exceeded=1 (fatal=1)");
    expect(JSON.stringify(status)).not.toContain(sourceFixture.home);
    expect(JSON.stringify(status)).not.toContain("silver-cedar-17");
    expect(JSON.stringify(status)).not.toContain("hidden-canyon-91");

    const recall = await callTool("mooncite_recall", { query: "silver-cedar-17" }, sourceFixture);
    expect(recall.structuredContent).toMatchObject({
      outcome: "unavailable",
      conclusive: false,
      scope: { evidenceSpans: 0 },
      candidates: [],
    });
    expect(await Promise.all([
      readFile(sourceFixture.source),
      readFile(boundedSource),
    ])).toEqual(sourceBytes);
  });
});
