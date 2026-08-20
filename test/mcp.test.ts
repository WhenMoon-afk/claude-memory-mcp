import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { afterEach, describe, expect, it } from "vitest";
import { createMoonciteMcpServer } from "../src/mcp.js";
import { setLearnedMemoryEnabled } from "../src/learned-memory.js";
import { createFixture, type Fixture } from "./fixture.js";

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
  learnedConfigPath?: string,
): Promise<RpcResponse> {
  const f = sourceFixture ?? await createFixture();
  if (!sourceFixture) fixtures.push(f);
  const server = createMoonciteMcpServer(
    { sessionsRoot: f.sessionsRoot, stateDir: f.stateDir },
    async () => ({ pi: "exact", omp: "exact", codex: "exact", claudeCode: "exact" }),
    learnedConfigPath ? { configPath: learnedConfigPath } : undefined,
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

async function callTool(
  name: string,
  args: Record<string, unknown>,
  sourceFixture?: Fixture,
  learnedConfigPath?: string,
): Promise<Record<string, unknown>> {
  const response = await rpc("tools/call", { name, arguments: args }, sourceFixture, learnedConfigPath);
  if (response.error) throw new Error(response.error.message);
  return response.result ?? {};
}

describe("Mooncite stdio MCP seam", () => {
  it("exposes exactly the three Mooncite tools by default without creating learned state", async () => {
    const sourceFixture = await createFixture();
    fixtures.push(sourceFixture);
    const result = await rpc("tools/list", undefined, sourceFixture);
    const tools = result.result?.tools as Array<{ name: string }>;
    expect(tools.map((tool) => tool.name).sort()).toEqual(["mooncite_inspect", "mooncite_recall", "mooncite_status"]);
    expect(await readdir(sourceFixture.stateDir)).not.toContain("learned-memory.sqlite");
  });

  it("conditionally exposes and exercises the four provenance-native learned-memory tools", async () => {
    const sourceFixture = await createFixture();
    fixtures.push(sourceFixture);
    const configPath = join(sourceFixture.home, ".config", "mooncite", "learned-memory.json");
    setLearnedMemoryEnabled(configPath, true);

    const listed = await rpc("tools/list", undefined, sourceFixture, configPath);
    const tools = listed.result?.tools as Array<{ name: string }>;
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "mooncite_inspect",
      "mooncite_memory_delete",
      "mooncite_memory_inspect",
      "mooncite_memory_recall",
      "mooncite_memory_write",
      "mooncite_recall",
      "mooncite_status",
    ]);

    const recalledEvidence = await callTool("mooncite_recall", { query: "silver-cedar-17" }, sourceFixture, configPath);
    const evidenceStructured = recalledEvidence.structuredContent as { candidates: Array<{ evidenceId: string }> };
    const evidence = evidenceStructured.candidates[0]!;
    const written = await callTool("mooncite_memory_write", {
      interpretation: "The launch marker is silver cedar.",
      evidence_ids: [evidence.evidenceId],
    }, sourceFixture, configPath);
    expect(written.structuredContent).toMatchObject({
      kind: "derived_memory_write",
      outcome: "created",
      revision: 1,
      provenanceOutcome: "verified",
    });
    const writtenContent = written.content as Array<{ text: string }>;
    expect(writtenContent[0]!.text).toContain("derived_memory");
    const writtenStructured = written.structuredContent as { memoryId: string };
    const memoryId = writtenStructured.memoryId;
    const staleWrite = await callTool("mooncite_memory_write", {
      memory_id: memoryId,
      expected_revision: 2,
      interpretation: "This stale correction must not commit.",
      evidence_ids: [evidence.evidenceId],
    }, sourceFixture, configPath);
    expect(staleWrite).toMatchObject({
      isError: true,
      structuredContent: {
        kind: "derived_memory_error",
        operation: "write",
        outcome: "failed",
        message: expect.stringMatching(/expected revision 2, current revision 1/u),
      },
    });

    const recalledMemory = await callTool("mooncite_memory_recall", { query: memoryId }, sourceFixture, configPath);
    expect(recalledMemory.structuredContent).toMatchObject({
      kind: "derived_memory_recall",
      candidates: [{ kind: "derived_memory", memoryId, revision: 1, provenanceState: "indexed" }],
    });
    const recalledMemoryContent = recalledMemory.content as Array<{ text: string }>;
    expect(recalledMemoryContent[0]!.text).toContain("interpretations, not source evidence");

    const inspected = await callTool("mooncite_memory_inspect", { memory_id: memoryId, window: 1 }, sourceFixture, configPath);
    expect(inspected.structuredContent).toMatchObject({
      kind: "derived_memory",
      memoryId,
      provenanceOutcome: "verified",
      anchors: [{ kind: "source_evidence_anchor", inspection: { outcome: "verified" } }],
    });

    const status = await callTool("mooncite_status", {}, sourceFixture, configPath);
    expect(status.structuredContent).toMatchObject({
      outcome: "ready",
      learnedMemory: { kind: "derived_memory_status", enabled: true, outcome: "ready", memories: 1, revisions: 1 },
    });
    const deleted = await callTool("mooncite_memory_delete", {
      memory_id: memoryId,
      expected_revision: 1,
    }, sourceFixture, configPath);
    expect(deleted.structuredContent).toMatchObject({
      kind: "derived_memory_delete",
      outcome: "deleted",
      memoryId,
      deletedRevisions: 1,
    });
    expect((await callTool("mooncite_recall", { query: "silver-cedar-17" }, sourceFixture, configPath)).structuredContent)
      .toMatchObject({ outcome: "matches" });
    setLearnedMemoryEnabled(configPath, false);
    const disabled = await rpc("tools/list", undefined, sourceFixture, configPath);
    const disabledTools = disabled.result?.tools as Array<{ name: string }>;
    expect(disabledTools.map(({ name }) => name).sort()).toEqual(["mooncite_inspect", "mooncite_recall", "mooncite_status"]);
    expect(await readdir(sourceFixture.stateDir)).toContain("learned-memory.sqlite");
  });

  it("keeps evidence tools available when the enabled learned store cannot open", async () => {
    const sourceFixture = await createFixture();
    fixtures.push(sourceFixture);
    const configPath = join(sourceFixture.home, ".config", "mooncite", "learned-memory.json");
    setLearnedMemoryEnabled(configPath, true);
    await rpc("tools/list", undefined, sourceFixture, configPath);
    await writeFile(join(sourceFixture.stateDir, "learned-memory.sqlite"), "not a sqlite database", { mode: 0o600 });

    const recalled = await callTool("mooncite_recall", { query: "silver-cedar-17" }, sourceFixture, configPath);
    expect(recalled.structuredContent).toMatchObject({ outcome: "matches" });
    const status = await callTool("mooncite_status", {}, sourceFixture, configPath);
    expect(status.structuredContent).toMatchObject({
      outcome: "ready",
      learnedMemory: { enabled: true, outcome: "unavailable" },
    });
    const memory = await callTool("mooncite_memory_recall", { query: "silver cedar" }, sourceFixture, configPath);
    expect(memory).toMatchObject({ isError: true });
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
      candidates: Array<{ evidenceId: string; evidenceUri: string; match: { kind: string; band: string } }>;
    };
    const candidate = structured.candidates[0]!;
    expect(structured).toMatchObject({
      outcome: "matches",
      conclusive: true,
      next: { target: "mooncite_inspect" },
      candidates: [{ match: { kind: "text_exact", band: "strong" } }],
    });
    expect(content[0]!.text).toContain("Mooncite recall: matches; conclusive=true");
    expect(content[0]!.text).toContain("term_coverage=");
    expect(content[0]!.text).toContain("Next: call mooncite_inspect");
    expect(content[0]!.text).toContain(`evidence_id: ${candidate.evidenceId}`);
    expect(content[0]!.text).toContain(`evidence_uri: ${candidate.evidenceUri}`);
    for (const evidence_id of [candidate.evidenceId, candidate.evidenceUri]) {
      const inspected = await callTool("mooncite_inspect", { evidence_id, window: 1 }, sourceFixture);
      expect(inspected.structuredContent).toMatchObject({
        outcome: "verified",
        conclusive: true,
        meaning: expect.stringContaining("verifies provenance, not the truth"),
        next: null,
      });
      const inspectionText = (inspected.content as Array<{ text: string }>)[0]!.text;
      expect(inspectionText).toContain("Mooncite inspection: verified; conclusive=true");
      expect(inspectionText).toContain("silver-cedar-17");
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
});
