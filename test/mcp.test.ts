import { readFile, readdir, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { afterEach, describe, expect, it } from "vitest";
import { createMoonciteMcpServer } from "../src/mcp.js";
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

async function rpc(method: string, params?: Record<string, unknown>, sourceFixture?: Fixture): Promise<RpcResponse> {
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

async function callTool(name: string, args: Record<string, unknown>, sourceFixture?: Fixture): Promise<Record<string, unknown>> {
  const response = await rpc("tools/call", { name, arguments: args }, sourceFixture);
  if (response.error) throw new Error(response.error.message);
  return response.result ?? {};
}

describe("Mooncite stdio MCP seam", () => {
  it("exposes exactly the three Mooncite tools", async () => {
    const result = await rpc("tools/list");
    const tools = result.result?.tools as Array<{ name: string }>;
    expect(tools.map((tool) => tool.name).sort()).toEqual(["mooncite_inspect", "mooncite_recall", "mooncite_status"]);
  });

  it("supports the receiver recall-to-inspect flow with both rendered locator forms", async () => {
    const sourceFixture = await createFixture();
    fixtures.push(sourceFixture);
    const recalled = await callTool("mooncite_recall", { query: "silver-cedar-17" }, sourceFixture);
    const content = recalled.content as Array<{ type: string; text: string }>;
    const structured = recalled.structuredContent as { candidates: Array<{ evidenceId: string; evidenceUri: string }> };
    const candidate = structured.candidates[0]!;
    expect(content[0]!.text).toContain(`evidence_id: ${candidate.evidenceId}`);
    expect(content[0]!.text).toContain(`evidence_uri: ${candidate.evidenceUri}`);
    for (const evidence_id of [candidate.evidenceId, candidate.evidenceUri]) {
      const inspected = await callTool("mooncite_inspect", { evidence_id, window: 1 }, sourceFixture);
      expect(inspected.structuredContent).toMatchObject({ outcome: "verified" });
      expect((inspected.content as Array<{ text: string }>)[0]!.text).toContain("silver-cedar-17");
    }
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
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("silver-cedar-17");
  });
});
