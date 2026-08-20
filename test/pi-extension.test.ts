import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import {
  createMooncitePiExtension,
  type McpToolCaller,
  type PiExtensionApi,
} from "../src/pi/extension.js";

describe("Mooncite Pi extension seam", () => {
  it("registers exactly three tools and forwards their calls to the packaged MCP seam", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown>; signal: AbortSignal | undefined }> = [];
    const caller: McpToolCaller = async (name, args, signal) => {
      calls.push({ name, args, signal });
      return {
        content: [{ type: "text", text: `called ${name}` }],
        structuredContent: { forwarded: name },
      };
    };
    const registered: Array<Parameters<PiExtensionApi["registerTool"]>[0]> = [];
    const pi: PiExtensionApi = {
      registerTool(definition) {
        registered.push(definition);
      },
    };

    createMooncitePiExtension(caller, false)(pi);
    expect(registered.map(({ name }) => name)).toEqual([
      "mooncite_recall",
      "mooncite_inspect",
      "mooncite_status",
    ]);

    const inputs = [
      { query: "receiver phrase", limit: 3 },
      { evidence_id: "mooncite:pi:source:session:entry:0", window: 2 },
      {},
    ];
    const signal = new AbortController().signal;
    expect(Value.Check(registered[0]!.parameters, inputs[0])).toBe(true);
    expect(Value.Check(registered[0]!.parameters, { query: "" })).toBe(false);
    expect(Value.Check(registered[1]!.parameters, inputs[1])).toBe(true);
    expect(Value.Check(registered[1]!.parameters, { evidence_id: "citation", window: 11 })).toBe(false);
    expect(Value.Check(registered[2]!.parameters, inputs[2])).toBe(true);
    expect(Value.Check(registered[2]!.parameters, { unexpected: true })).toBe(false);
    for (const [index, definition] of registered.entries()) {
      const result = await definition.execute(`call-${index}`, inputs[index]!, signal);
      expect(result).toEqual({
        content: [{ type: "text", text: `called ${definition.name}` }],
        details: { forwarded: definition.name },
      });
    }
    expect(calls).toEqual(registered.map((definition, index) => ({
      name: definition.name,
      args: inputs[index],
      signal,
    })));
  });

  it("registers the same four additional learned-memory tools only when enabled", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const caller: McpToolCaller = async (name, args) => {
      calls.push({ name, args });
      return { content: [{ type: "text", text: `called ${name}` }], structuredContent: { forwarded: name } };
    };
    const registered: Array<Parameters<PiExtensionApi["registerTool"]>[0]> = [];
    createMooncitePiExtension(caller, true)({ registerTool: (definition) => registered.push(definition) });
    expect(registered.map(({ name }) => name)).toEqual([
      "mooncite_recall",
      "mooncite_inspect",
      "mooncite_status",
      "mooncite_memory_recall",
      "mooncite_memory_inspect",
      "mooncite_memory_write",
      "mooncite_memory_delete",
    ]);

    const memoryId = "mooncite-memory:00000000-0000-4000-8000-000000000001";
    const inputs: Record<string, unknown>[] = [
      { query: "durable interpretation", include_invalid: true },
      { memory_id: memoryId, revision: 1, window: 2 },
      {
        interpretation: "A citation-backed derived interpretation.",
        evidence_ids: ["mooncite:pi:source:session:entry:0"],
        scope: { kind: "global" },
      },
      { memory_id: memoryId, expected_revision: 1 },
    ];
    for (let index = 0; index < inputs.length; index++) {
      const definition = registered[index + 3]!;
      expect(Value.Check(definition.parameters, inputs[index])).toBe(true);
      await definition.execute(`memory-${index}`, inputs[index]!, new AbortController().signal);
    }
    expect(Value.Check(registered[3]!.parameters, { query: "x", include_invalid: "yes" })).toBe(false);
    expect(Value.Check(registered[4]!.parameters, { memory_id: memoryId, window: 3 })).toBe(false);
    expect(Value.Check(registered[5]!.parameters, { interpretation: "uncited", evidence_ids: [] })).toBe(false);
    expect(Value.Check(registered[5]!.parameters, {
      memory_id: memoryId,
      interpretation: "missing stale guard",
      evidence_ids: ["mooncite:pi:source:session:entry:0"],
    })).toBe(false);
    expect(Value.Check(registered[6]!.parameters, { memory_id: memoryId })).toBe(false);
    expect(calls.map(({ name }) => name)).toEqual(registered.slice(3).map(({ name }) => name));
  });
});
