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
    expect(Object.fromEntries(registered.map(({ name, description }) => [name, description]))).toEqual({
      mooncite_inspect: "Verify one Mooncite locator against current source bytes and return a bounded window. Verification proves provenance, not truth.",
      mooncite_recall: "Search authorized local history for bounded lexical evidence. Returns cited candidates, explicit outcomes, and next actions.",
      mooncite_status: "Report source and index health without transcript text or full source paths.",
    });

    const inputs = [
      {
        query: "receiver phrase",
        limit: 3,
        project: "claude-memory-mcp",
        session_id: "pi:session-123",
        after: "2026-01-01T00:00:00.000Z",
        before: "2026-08-20T23:59:59.999Z",
        role: "assistant",
        source_origin: "pi",
        order: "newest",
      },
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
    expect(Object.fromEntries(registered.map(({ name, description }) => [name, description]))).toMatchObject({
      mooncite_memory_delete: "Delete one learned memory or skill candidate. Memory deletion fails while a surviving dependency remains.",
      mooncite_memory_inspect: "Inspect one immutable memory revision and verify its own anchors, or inspect one skill candidate.",
      mooncite_memory_recall: "Search agent-authored interpretations. Results are learned memory, not source evidence.",
      mooncite_memory_write: "Write immutable learned-memory revisions, manage lifecycle metadata, or propose and review skill candidates. Candidate review never installs a skill.",
    });

    const memoryId = "mooncite-memory:00000000-0000-4000-8000-000000000001";
    const candidateId = "mooncite-skill-candidate:00000000-0000-4000-8000-000000000002";
    const evidenceId = "mooncite:pi:source:session:entry:0";
    const inputs: Record<string, unknown>[] = [
      {
        query: "durable interpretation",
        include_invalid: true,
        include_archived: true,
        related_limit: 2,
      },
      { kind: "revision", memory_id: memoryId, revision: 1, window: 2 },
      {
        operation: "create",
        interpretation: "A verified learned interpretation.",
        provenance: { kind: "verified", evidence_ids: [evidenceId] },
        scope: { kind: "global" },
      },
      {
        kind: "memory",
        memory_id: memoryId,
        expected_revision: 1,
        expected_metadata_version: 1,
      },
    ];
    for (let index = 0; index < inputs.length; index++) {
      const definition = registered[index + 3]!;
      expect(Value.Check(definition.parameters, inputs[index])).toBe(true);
      await definition.execute(`memory-${index}`, inputs[index]!, new AbortController().signal);
    }
    const recallParameters = registered[3]!.parameters;
    const inspectParameters = registered[4]!.parameters;
    const writeParameters = registered[5]!.parameters;
    const deleteParameters = registered[6]!.parameters;
    expect(Value.Check(recallParameters, { query: "x", include_invalid: "yes" })).toBe(false);
    expect(Value.Check(inspectParameters, { memory_id: memoryId, window: 2 })).toBe(false);
    expect(Value.Check(inspectParameters, { kind: "revision", memory_id: memoryId, window: 3 })).toBe(false);
    expect(Value.Check(inspectParameters, { kind: "skill_candidate", candidate_id: candidateId })).toBe(true);
    expect(Value.Check(writeParameters, {
      operation: "create",
      interpretation: "Evidence is required for verified provenance.",
      provenance: { kind: "verified", evidence_ids: [] },
      scope: { kind: "global" },
    })).toBe(false);
    expect(Value.Check(writeParameters, {
      operation: "create",
      interpretation: "A current-context interpretation.",
      provenance: { kind: "current_context", context_note: "Explicit current task.", evidence_ids: [] },
      scope: { kind: "global" },
    })).toBe(true);
    expect(Value.Check(writeParameters, {
      operation: "create",
      interpretation: "An unanchored interpretation.",
      provenance: { kind: "unanchored", basis_note: "Explicit working assumption." },
      scope: { kind: "global" },
    })).toBe(true);
    expect(Value.Check(writeParameters, {
      operation: "revise",
      memory_id: memoryId,
      expected_revision: 1,
      interpretation: "A derived correction.",
      provenance: {
        kind: "derived",
        parents: [{
          memory_id: memoryId,
          revision: 1,
          relation: "refines",
          reason: "The correction refines the prior exact revision.",
        }],
        evidence_ids: [],
      },
    })).toBe(true);
    expect(Value.Check(writeParameters, {
      operation: "reinforce",
      memory_id: memoryId,
      expected_revision: 1,
      expected_metadata_version: 1,
      salience: 75,
    })).toBe(true);
    expect(Value.Check(writeParameters, {
      operation: "consolidate",
      interpretation: "A consolidated interpretation.",
      parents: [
        { memory_id: memoryId, revision: 1, relation: "supports", reason: "First exact source." },
        { memory_id: memoryId, revision: 2, relation: "supports", reason: "Second exact source." },
      ],
      evidence_ids: [],
      scope: { kind: "global" },
    })).toBe(true);
    expect(Value.Check(writeParameters, {
      operation: "propose_skill_candidate",
      sources: [{ memory_id: memoryId, revision: 1 }],
      artifact: {
        name: "candidate",
        description: "Reviewed candidate artifact.",
        instructions: "Do not install automatically.",
      },
    })).toBe(true);
    expect(Value.Check(writeParameters, {
      operation: "review_skill_candidate",
      candidate_id: candidateId,
      expected_state: "pending_review",
      decision: "approved",
      review_note: "Explicitly reviewed.",
    })).toBe(true);
    expect(Value.Check(writeParameters, {
      interpretation: "Old optional-field write bag.",
      evidence_ids: [evidenceId],
    })).toBe(false);
    expect(Value.Check(deleteParameters, {
      kind: "memory",
      memory_id: memoryId,
      expected_revision: 1,
    })).toBe(false);
    expect(Value.Check(deleteParameters, {
      kind: "skill_candidate",
      candidate_id: candidateId,
      expected_state: "approved",
    })).toBe(true);
    expect(calls.map(({ name }) => name)).toEqual(registered.slice(3).map(({ name }) => name));
  });
});
