import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { appendFile, chmod, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MoonciteEngine } from "../src/engine.js";
import { addSourceRegistration, loadSourceRegistrations, removeSourceRegistration, resolveSourceRegistrations } from "../src/source-config.js";
import { createFixture, digest, jsonLine, ompTitleLine, type Fixture } from "./fixture.js";

const fixtures: Fixture[] = [];
afterEach(async () => {
  while (fixtures.length) await fixtures.pop()!.cleanup();
});

async function fixture(): Promise<Fixture> {
  const value = await createFixture();
  fixtures.push(value);
  return value;
}

function chatGptConversation(
  sessionId: string,
  title: string,
  userMarker: string,
  assistantMarker: string,
  alternateMarker = "unused alternate branch",
): Record<string, unknown> {
  const userId = `${sessionId}-user`;
  const assistantId = `${sessionId}-assistant`;
  const alternateId = `${sessionId}-alternate`;
  return {
    title,
    conversation_id: sessionId,
    current_node: assistantId,
    mapping: {
      root: { id: "root", parent: null, children: [userId], message: null },
      [userId]: {
        id: userId,
        parent: "root",
        children: [assistantId, alternateId],
        message: {
          id: userId,
          create_time: 1_893_456_001,
          author: { role: "user" },
          content: { content_type: "text", parts: [userMarker] },
        },
      },
      [assistantId]: {
        id: assistantId,
        parent: userId,
        children: [],
        message: {
          id: assistantId,
          create_time: 1_893_456_002,
          author: { role: "assistant" },
          content: { content_type: "text", parts: [assistantMarker] },
        },
      },
      [alternateId]: {
        id: alternateId,
        parent: userId,
        children: [],
        message: {
          id: alternateId,
          create_time: 1_893_456_003,
          author: { role: "assistant" },
          content: { content_type: "text", parts: [alternateMarker] },
        },
      },
    },
  };
}

describe("Mooncite engine public seam", () => {
  it("recalls a stable source-qualified citation and physically inspects both rendered locators without changing source", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    try {
      const recalled = engine.recall({ query: "silver-cedar-17" });
      expect(recalled.outcome).toBe("matches");
      expect(recalled.candidates).toHaveLength(1);
      const candidate = recalled.candidates[0]!;
      expect(candidate.evidenceId).toMatch(/^mooncite:pi:[a-f0-9]{24}:[a-f0-9]{24}:[a-f0-9]{24}:0$/u);
      expect(candidate.evidenceUri).toMatch(/^mooncite:\/\/pi\/[a-f0-9]{24}\/session-moon\/entry-a\/0$/u);
      expect(candidate).toMatchObject({
        eventTimestamp: "2030-01-01T00:00:01.000Z",
        recordProvenance: "original",
      });
      const [byId, byUri] = engine.resolveEvidenceAnchors([
        { locator: candidate.evidenceId },
        { locator: candidate.evidenceUri },
      ]);
      expect(byId).toMatchObject({
        outcome: "resolved",
        freshness: "current",
        anchor: {
          evidenceId: candidate.evidenceId,
          evidenceUri: candidate.evidenceUri,
          sourceOrigin: "pi",
          recordDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
          contextDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
          spanDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
          isMoonciteRendering: false,
        },
      });
      expect(byUri?.anchor).toEqual(byId?.anchor);
      expect(byId?.anchor).not.toHaveProperty("text");
      expect(byId?.anchor).not.toHaveProperty("sourcePath");
      for (const locator of [candidate.evidenceId, candidate.evidenceUri]) {
        const inspected = engine.inspect({ evidenceId: locator, window: 1 });
        expect(inspected.outcome).toBe("verified");
        expect(inspected.target?.text).toContain("silver-cedar-17");
        expect(inspected.target).toMatchObject({
          eventTimestamp: "2030-01-01T00:00:01.000Z",
          recordProvenance: "original",
        });
        expect(inspected.window.map((span) => span.relation)).toEqual(["target", "after"]);
      }
      expect(await digest(f.source)).toBe(f.sourceDigest);
    } finally {
      engine.close();
    }
  });

  it("keeps lexical search behavior without a duplicate FTS content table", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    try {
      expect(engine.recall({ query: "silver-cedar-17" })).toMatchObject({
        outcome: "matches",
        candidates: [{ excerpt: expect.stringContaining("silver-cedar-17") }],
      });
    } finally {
      engine.close();
    }
    const database = new DatabaseSync(join(f.stateDir, "index.sqlite"), { readOnly: true });
    try {
      expect(database.prepare("SELECT name FROM sqlite_schema WHERE name = 'evidence_fts_content'").get()).toBeUndefined();
      expect(database.prepare("SELECT name FROM sqlite_schema WHERE name = 'evidence_fts_data'").get()).toEqual({
        name: "evidence_fts_data",
      });
    } finally {
      database.close();
    }
  });

  it("centers bounded recall excerpts on the lexical match instead of a generic record prefix", async () => {
    const f = await fixture();
    const entries = (await readFile(f.source, "utf8")).trimEnd().split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const message = entries[1]!.message as Record<string, unknown>;
    message.content = `BEGIN-GENERIC-PREAMBLE\n${"Generic setup output without the answer.\n".repeat(60)}Useful matched context: excerpt-target-73 explains the actual decision.`;
    await writeFile(f.source, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
    const sourceDigest = await digest(f.source);
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    try {
      const candidate = engine.recall({ query: "excerpt-target-73" }).candidates[0]!;
      expect(candidate.excerpt).toContain("Useful matched context: excerpt-target-73");
      expect(candidate.excerpt).not.toContain("BEGIN-GENERIC-PREAMBLE");
      expect(candidate.omittedBytes).toBeGreaterThan(0);
      expect(engine.inspect({ evidenceId: candidate.evidenceId })).toMatchObject({
        outcome: "verified",
        target: { text: expect.stringContaining("Useful matched context: excerpt-target-73") },
      });
      expect(await digest(f.source)).toBe(sourceDigest);
    } finally {
      engine.close();
    }
  });

  it("incrementally admits a coherent append and rebuild restores full verification", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    try {
      expect(engine.status()).toMatchObject({ outcome: "ready", trustState: "full_verified", evidenceSpans: 2 });
      await appendFile(f.source, jsonLine({ type: "message", id: "entry-c", parentId: "entry-b", timestamp: "2030-01-01T00:00:03-05:00", message: { role: "user", content: "Incremental marker amber-river-29." } }));
      const appended = engine.recall({ query: "amber-river-29" });
      expect(appended).toMatchObject({
        outcome: "matches",
        trustState: "append_trusted",
      });
      expect(appended.candidates[0]!.evidenceId).toMatch(/^mooncite:pi:[a-f0-9]{24}:[a-f0-9]{24}:[a-f0-9]{24}:0$/u);
      expect(appended.candidates[0]).toMatchObject({
        eventTimestamp: "2030-01-01T05:00:03.000Z",
        recordProvenance: "original",
      });
      expect(engine.rebuild()).toMatchObject({ outcome: "ready", trustState: "full_verified", lastRebuildOutcome: "published" });
    } finally {
      engine.close();
    }
  });
  it("indexes Pi and OMP collisions independently and transactionally replaces OMP changes", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({
      sessionsRoot: f.sessionsRoot,
      ompSessionsRoot: f.ompSessionsRoot,
      stateDir: f.stateDir,
    });
    try {
      expect(engine.status()).toMatchObject({
        outcome: "ready",
        trustState: "full_verified",
        sourceFiles: 2,
        sourceFilesByOrigin: { pi: 1, omp: 1, "claude-code": 0, codex: 0, chatgpt: 0 },
        evidenceSpans: 4,
      });
      const piCandidate = engine.recall({ query: "silver-cedar-17" }).candidates[0]!;
      const ompCandidate = engine.recall({ query: "violet-orbit-41" }).candidates[0]!;
      expect(piCandidate.evidenceId).toMatch(/^mooncite:pi:[a-f0-9]{24}:[a-f0-9]{24}:[a-f0-9]{24}:0$/u);
      expect(piCandidate.evidenceUri).toMatch(/^mooncite:\/\/pi\/[a-f0-9]{24}\/session-moon\/entry-a\/0$/u);
      expect(piCandidate).toMatchObject({ sourceOrigin: "pi", eventTimestamp: "2030-01-01T00:00:01.000Z", recordProvenance: "original" });
      expect(piCandidate.sessionId).toMatch(/^pi:[a-f0-9]{64}:session-moon$/u);
      expect(ompCandidate.evidenceId).toMatch(/^mooncite:omp:[a-f0-9]{24}:[a-f0-9]{24}:[a-f0-9]{24}:0$/u);
      expect(ompCandidate.evidenceUri).toMatch(/^mooncite:\/\/omp\/[a-f0-9]{24}\/session-moon\/entry-a\/0$/u);
      expect(ompCandidate).toMatchObject({ sourceOrigin: "omp", eventTimestamp: "2030-01-02T00:00:01.000Z", recordProvenance: "original" });
      expect(ompCandidate.sessionId).toMatch(/^omp:[a-f0-9]{64}:session-moon$/u);
      expect(engine.recall({ query: "silver-cedar-17", sessionId: ompCandidate.sessionId }).outcome).toBe("no_match");
      expect(engine.inspect({ evidenceId: piCandidate.evidenceId })).toMatchObject({
        outcome: "verified",
        locator: { sourceOrigin: "pi" },
      });
      expect(engine.inspect({ evidenceId: ompCandidate.evidenceUri })).toMatchObject({
        outcome: "verified",
        locator: { sourceOrigin: "omp", relativePath: "-moon-project/session.jsonl" },
      });

      const originalOmp = await readFile(f.ompSource, "utf8");
      const titleEnd = originalOmp.indexOf("\n");
      const renamedOmp = ompTitleLine("Renamed project") + originalOmp.slice(titleEnd + 1);
      expect(Buffer.byteLength(renamedOmp)).toBe(Buffer.byteLength(originalOmp));
      await writeFile(f.ompSource, renamedOmp);
      const renamedDigest = await digest(f.ompSource);
      expect(engine.recall({ query: "violet-orbit-41" })).toMatchObject({
        outcome: "matches",
        trustState: "full_verified",
        candidates: [{ evidenceId: ompCandidate.evidenceId, sourceOrigin: "omp" }],
      });
      expect(engine.inspect({ evidenceId: ompCandidate.evidenceId })).toMatchObject({ outcome: "verified" });
      expect(await digest(f.ompSource)).toBe(renamedDigest);

      await appendFile(f.ompSource, jsonLine({
        type: "message",
        id: "entry-c",
        parentId: "entry-b",
        message: { role: "user", content: "OMP append marker cobalt-comet-63." },
      }));
      const appended = engine.recall({ query: "cobalt-comet-63" });
      expect(appended).toMatchObject({
        outcome: "matches",
        trustState: "full_verified",
        candidates: [{ sourceOrigin: "omp" }],
      });
      expect(appended.candidates[0]!.evidenceId).toMatch(/^mooncite:omp:[a-f0-9]{24}:[a-f0-9]{24}:[a-f0-9]{24}:0$/u);
      expect(engine.inspect({ evidenceId: appended.candidates[0]!.evidenceId })).toMatchObject({ outcome: "verified" });

      const beforeRewriteAppend = await readFile(f.ompSource, "utf8");
      const beforeRewriteMetadata = await stat(f.ompSource);
      const rewrittenPrefix = beforeRewriteAppend.replace("cobalt-comet-63", "magenta-moon-24");
      expect(rewrittenPrefix).not.toBe(beforeRewriteAppend);
      await writeFile(f.ompSource, rewrittenPrefix + jsonLine({
        type: "message",
        id: "entry-d",
        parentId: "entry-c",
        message: { role: "assistant", content: "OMP replacement marker topaz-cloud-75." },
      }));
      const afterRewriteMetadata = await stat(f.ompSource);
      expect(afterRewriteMetadata.dev).toBe(beforeRewriteMetadata.dev);
      expect(afterRewriteMetadata.ino).toBe(beforeRewriteMetadata.ino);
      expect(afterRewriteMetadata.size).toBeGreaterThan(beforeRewriteMetadata.size);
      expect(engine.recall({ query: "topaz-cloud-75" })).toMatchObject({
        outcome: "matches",
        trustState: "full_verified",
        candidates: [{ sourceOrigin: "omp" }],
      });
      expect(engine.recall({ query: "magenta-moon-24" }).outcome).toBe("matches");
      expect(engine.recall({ query: "cobalt-comet-63" }).outcome).toBe("no_match");
      expect(await digest(f.source)).toBe(f.sourceDigest);
    } finally {
      engine.close();
    }
  });

  it("indexes explicitly configured Claude Code and Codex adapters without admitting nested Claude copies", async () => {
    const f = await fixture();
    const claudeRoot = join(f.home, "claude-projects");
    const claudeProject = join(claudeRoot, "-receiver-project");
    const claudeSource = join(claudeProject, "claude-session.jsonl");
    const nestedClaude = join(claudeProject, "claude-session", "subagents", "agent-copy.jsonl");
    const codexRoot = join(f.home, "codex-sessions");
    const codexDirectory = join(codexRoot, "2030", "01", "01");
    const codexSource = join(codexDirectory, "rollout.jsonl");
    await mkdir(join(claudeProject, "claude-session", "subagents"), { recursive: true });
    await mkdir(codexDirectory, { recursive: true });
    const claudeContent =
      jsonLine({ type: "queue-operation", operation: "enqueue", sessionId: "claude-session", content: "ignored queue metadata" }) +
      jsonLine({ type: "user", timestamp: "2030-01-01T02:00:01+02:00", sessionId: "claude-session", uuid: "claude-entry-a", parentUuid: null, cwd: "/receiver/project", message: { role: "user", content: "Claude marker lucid-fern-52." } }) +
      jsonLine({ type: "assistant", timestamp: "2030-01-01T02:00:02+02:00", sessionId: "claude-session", uuid: "claude-entry-b", parentUuid: "claude-entry-a", cwd: "/receiver/project", message: { role: "assistant", content: [{ type: "thinking", thinking: "not indexed" }, { type: "text", text: "Claude answer quiet-brook-73." }] } });
    const codexContent =
      jsonLine({ type: "session_meta", timestamp: "2030-01-01T00:00:00Z", payload: { id: "codex-session", cwd: "/receiver/project" } }) +
      jsonLine({ type: "event_msg", timestamp: "2030-01-01T00:00:01Z", payload: { type: "user_message", message: "Codex marker bright-pine-64." } }) +
      jsonLine({ type: "response_item", timestamp: "2030-01-01T00:00:02Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "duplicate transport text is not indexed" }] } }) +
      jsonLine({ type: "event_msg", timestamp: "2030-01-01T00:00:03Z", payload: { type: "agent_message", message: "Codex answer misty-lake-85." } });
    await writeFile(claudeSource, claudeContent);
    await writeFile(nestedClaude, jsonLine({ type: "user", sessionId: "claude-session", uuid: "nested-entry", parentUuid: null, message: { role: "user", content: "Nested marker must-not-index-91." } }));
    await writeFile(codexSource, codexContent);
    const claudeBefore = await digest(claudeSource);
    const codexBefore = await digest(codexSource);
    const engine = new MoonciteEngine({
      sessionsRoot: f.sessionsRoot,
      ompSessionsRoot: f.ompSessionsRoot,
      optionalSources: [
        { origin: "claude-code", root: claudeRoot },
        { origin: "codex", root: codexRoot },
      ],
      stateDir: f.stateDir,
    });
    try {
      expect(engine.status()).toMatchObject({
        outcome: "ready",
        sourceFilesByOrigin: { pi: 1, omp: 1, "claude-code": 1, codex: 1, chatgpt: 0 },
      });
      expect(await digest(claudeSource)).toBe(claudeBefore);
      expect(await digest(codexSource)).toBe(codexBefore);
      expect(engine.recall({ query: "must-not-index-91" }).outcome).toBe("no_match");
      const claude = engine.recall({ query: "lucid-fern-52" }).candidates[0]!;
      expect(claude.evidenceId).toMatch(/^mooncite:claude-code:[a-f0-9]{24}:[a-f0-9]{24}:[a-f0-9]{24}:0$/u);
      expect(claude.evidenceUri).toMatch(/^mooncite:\/\/claude-code\/[a-f0-9]{24}\/claude-session\/claude-entry-a\/0$/u);
      expect(claude).toMatchObject({
        sourceOrigin: "claude-code",
        eventTimestamp: "2030-01-01T00:00:01.000Z",
        recordProvenance: "original",
      });
      expect(claude.sessionId).toMatch(/^claude-code:[a-f0-9]{64}:claude-session$/u);
      for (const locator of [claude.evidenceId, claude.evidenceUri]) {
        expect(engine.inspect({ evidenceId: locator, window: 0 })).toMatchObject({ outcome: "verified", locator: { sourceOrigin: "claude-code" } });
      }
      const codex = engine.recall({ query: "bright-pine-64" }).candidates[0]!;
      expect(codex.evidenceId).toMatch(/^mooncite:codex:[a-f0-9]{24}:[a-f0-9]{24}:[a-f0-9]{24}:0$/u);
      expect(codex.evidenceUri).toMatch(/^mooncite:\/\/codex\/[a-f0-9]{24}\/codex-session\/line-2-[a-f0-9]{16}\/0$/u);
      expect(codex).toMatchObject({
        eventTimestamp: "2030-01-01T00:00:01.000Z",
        recordProvenance: "original",
      });
      expect(engine.inspect({ evidenceId: codex.evidenceUri, window: 0 })).toMatchObject({ outcome: "verified", locator: { sourceOrigin: "codex" } });

      await writeFile(claudeSource, claudeContent.replace("lucid-fern-52", "lucid-fern-53"));
      expect(engine.recall({ query: "lucid-fern-53" })).toMatchObject({
        outcome: "matches",
        trustState: "full_verified",
        candidates: [{ sourceOrigin: "claude-code" }],
      });
      await appendFile(codexSource, jsonLine({ type: "event_msg", timestamp: "2030-01-01T00:00:04Z", payload: { type: "agent_message", message: "Codex append amber-field-26." } }));
      expect(engine.recall({ query: "amber-field-26" })).toMatchObject({
        outcome: "matches",
        trustState: "full_verified",
        candidates: [{ sourceOrigin: "codex" }],
      });
      expect(await digest(f.source)).toBe(f.sourceDigest);
    } finally {
      engine.close();
    }
  });

  it("follows optional source authorization changes without restarting", async () => {
    const f = await fixture();
    const configPath = join(f.home, ".config", "mooncite", "sources.json");
    const claudeRoot = join(f.home, "claude-projects");
    const claudeProject = join(claudeRoot, "-dynamic-project");
    const claudeSource = join(claudeProject, "dynamic-session.jsonl");
    await mkdir(claudeProject, { recursive: true });
    await writeFile(claudeSource, jsonLine({
      type: "user",
      sessionId: "dynamic-session",
      uuid: "dynamic-entry",
      parentUuid: null,
      cwd: "/dynamic/project",
      message: { role: "user", content: "Dynamic authorization marker copper-harbor-48." },
    }));
    const before = await digest(claudeSource);
    const engine = new MoonciteEngine({
      sessionsRoot: f.sessionsRoot,
      stateDir: f.stateDir,
      optionalSourcesProvider: () => loadSourceRegistrations(configPath),
    });
    try {
      expect(engine.recall({ query: "copper-harbor-48" }).outcome).toBe("no_match");
      addSourceRegistration(configPath, { origin: "claude-code", root: claudeRoot });
      expect(engine.recall({ query: "copper-harbor-48" })).toMatchObject({
        outcome: "matches",
        candidates: [{ sourceOrigin: "claude-code" }],
      });
      removeSourceRegistration(configPath, { origin: "claude-code", root: claudeRoot });
      expect(engine.recall({ query: "copper-harbor-48" }).outcome).toBe("no_match");
      expect(await digest(claudeSource)).toBe(before);
    } finally {
      engine.close();
    }
  });

  it("returns decision-oriented outcomes, match explanations, and copy-safe scopes", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    try {
      const exact = engine.recall({ query: "\"The launch marker is silver-cedar-17.\"" });
      expect(exact).toMatchObject({
        outcome: "matches",
        conclusive: true,
        next: { action: "call", target: "mooncite_inspect" },
        candidates: [{
          omittedBytes: 0,
          isEcho: false,
          match: {
            kind: "phrase_exact",
            band: "strong",
            missingTerms: [],
            termCoverage: 1,
          },
        }],
      });
      const candidate = exact.candidates[0]!;
      expect(engine.recall({
        query: "silver-cedar-17",
        project: candidate.project,
        sessionId: candidate.sessionId,
      })).toMatchObject({
        outcome: "matches",
        scope: { project: candidate.project, sessionId: candidate.sessionId, evidenceSpans: 2 },
      });
      expect(engine.recall({ query: "silver-cedar-17", sessionId: "session-moon" })).toMatchObject({
        outcome: "matches",
        scope: { sessionId: candidate.sessionId },
      });
      expect(engine.recall({ query: "silver-cedar-17 absent-vocabulary extraneous-term" })).toMatchObject({
        outcome: "weak_leads",
        conclusive: false,
        candidates: [{
          match: {
            band: "partial",
            matchedTerms: ["silver-cedar-17"],
            missingTerms: ["absent-vocabulary", "extraneous-term"],
          },
        }],
      });
      expect(engine.recall({ query: "definitely-absent-marker-9081" })).toMatchObject({
        outcome: "no_match",
        conclusive: true,
        candidates: [],
        next: null,
      });
      expect(engine.recall({ query: "silver-cedar-17", project: "/work/moon-project" })).toMatchObject({
        outcome: "invalid_scope",
        conclusive: false,
        next: { action: "call", target: "mooncite_recall" },
      });
      expect(engine.recall({ query: "silver-cedar-17", sessionId: "not-a-session" })).toMatchObject({
        outcome: "invalid_scope",
        conclusive: false,
      });
    } finally {
      engine.close();
    }
  });

  it("normalizes event time and applies inclusive filters with deterministic temporal ordering", async () => {
    const f = await fixture();
    await appendFile(
      f.source,
      jsonLine({
        type: "message",
        id: "timeline-old",
        parentId: "entry-b",
        timestamp: "2030-01-03T08:00:00-08:00",
        message: { role: "user", content: "chronology-signal old Pi event" },
      })
      + jsonLine({
        type: "message",
        id: "timeline-tie-assistant",
        parentId: "timeline-old",
        timestamp: "2030-01-04T00:00:00Z",
        message: { role: "assistant", content: "chronology-signal first tied Pi event" },
      })
      + jsonLine({
        type: "message",
        id: "timeline-tie-user",
        parentId: "timeline-tie-assistant",
        timestamp: "2030-01-04T00:00:00.000Z",
        message: { role: "user", content: "chronology-signal second tied Pi event" },
      })
      + jsonLine({
        type: "message",
        id: "timeline-untimed",
        parentId: "timeline-tie-user",
        message: { role: "user", content: "chronology-signal untimestamped Pi event" },
      }),
    );
    await appendFile(f.ompSource, jsonLine({
      type: "message",
      id: "timeline-omp",
      parentId: "entry-b",
      timestamp: "2030-01-05T00:00:00Z",
      message: { role: "user", content: "chronology-signal OMP event" },
    }));
    const engine = new MoonciteEngine({
      sessionsRoot: f.sessionsRoot,
      ompSessionsRoot: f.ompSessionsRoot,
      stateDir: f.stateDir,
    });
    try {
      const defaultOrder = engine.recall({ query: "chronology-signal", limit: 10 });
      const explicitRelevance = engine.recall({ query: "chronology-signal", limit: 10, order: "relevance" });
      expect(defaultOrder.candidates.map(({ evidenceId }) => evidenceId))
        .toEqual(explicitRelevance.candidates.map(({ evidenceId }) => evidenceId));

      const newest = engine.recall({ query: "chronology-signal", limit: 10, order: "newest" });
      expect(newest.candidates.map(({ entryId }) => entryId)).toEqual([
        "timeline-omp",
        "timeline-tie-assistant",
        "timeline-tie-user",
        "timeline-old",
        "timeline-untimed",
      ]);
      expect(newest.candidates[3]).toMatchObject({ eventTimestamp: "2030-01-03T16:00:00.000Z" });
      expect(newest.candidates[4]).toMatchObject({ eventTimestamp: null });

      const oldest = engine.recall({ query: "chronology-signal", limit: 10, order: "oldest" });
      expect(oldest.candidates.map(({ entryId }) => entryId)).toEqual([
        "timeline-old",
        "timeline-tie-assistant",
        "timeline-tie-user",
        "timeline-omp",
        "timeline-untimed",
      ]);

      const inclusive = engine.recall({
        query: "chronology-signal",
        limit: 10,
        sourceOrigin: "pi",
        after: "2030-01-04T00:00:00Z",
        before: "2030-01-04T00:00:00.000Z",
        order: "oldest",
      });
      expect(inclusive.candidates.map(({ entryId }) => entryId)).toEqual([
        "timeline-tie-assistant",
        "timeline-tie-user",
      ]);
      expect(inclusive.scope.evidenceSpans).toBe(2);
      expect(engine.recall({
        query: "chronology-signal",
        sourceOrigin: "pi",
        role: "user",
        after: "2030-01-04T00:00:00Z",
        before: "2030-01-04T00:00:00Z",
      }).candidates.map(({ entryId }) => entryId)).toEqual(["timeline-tie-user"]);
      expect(engine.recall({
        query: "chronology-signal",
        sourceOrigin: "omp",
        limit: 10,
      }).candidates.map(({ entryId }) => entryId)).toEqual(["timeline-omp"]);
      expect(engine.recall({ query: "chronology-signal", after: "not-a-timestamp" })).toMatchObject({
        outcome: "invalid_scope",
        candidates: [],
      });
      expect(engine.recall({
        query: "chronology-signal",
        after: "2030-01-05T00:00:00Z",
        before: "2030-01-04T00:00:00Z",
      })).toMatchObject({ outcome: "invalid_scope", candidates: [] });
    } finally {
      engine.close();
    }
  });

  it("suppresses recursive Mooncite renderings while preserving genuine source evidence", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    try {
      expect(engine.status().outcome).toBe("ready");
      await appendFile(
        f.source,
        jsonLine({
          type: "message",
          id: "entry-echo",
          parentId: "entry-b",
          message: {
            role: "assistant",
            content: "Nested transport wrapper: {\"content\":[{\"type\":\"text\",\"text\":\"Mooncite recall: matches; conclusive=true; recursive-origin-marker-77 was rendered by a prior Mooncite call.\\nTrust: full_verified\"}]}",
          },
        })
        + jsonLine({
          type: "message",
          id: "entry-genuine",
          parentId: "entry-echo",
          message: { role: "user", content: "The genuine event marker is recursive-origin-marker-77." },
        }),
      );
      const recalled = engine.recall({ query: "recursive-origin-marker-77", limit: 10 });
      expect(recalled).toMatchObject({
        outcome: "matches",
        conclusive: true,
        echoesSuppressed: 1,
        candidates: [{ entryId: "entry-genuine", isEcho: false, recordProvenance: "original" }],
      });
      expect(recalled.candidates).toHaveLength(1);
      expect(recalled.warnings).toContain("1 recursive Mooncite echo(es) suppressed.");
      expect(recalled.candidates[0]!.excerpt).toContain("genuine event marker");
      const echoIdParts = recalled.candidates[0]!.evidenceId.split(":");
      echoIdParts[4] = createHash("sha256").update("entry-echo").digest("hex").slice(0, 24);
      expect(engine.recall({ query: echoIdParts.join(":") })).toMatchObject({
        outcome: "matches",
        echoesSuppressed: 0,
        candidates: [{
          entryId: "entry-echo",
          isEcho: true,
          recordProvenance: "original",
        }],
      });
    } finally {
      engine.close();
    }
  });

  it("reports degraded and unavailable states without treating an incomplete miss as absence", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    try {
      const ready = engine.status();
      expect(ready).toMatchObject({
        outcome: "ready",
        searchUsable: true,
        next: null,
        lastSuccessfulRefreshAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
      });
      await chmod(f.source, 0o000);
      const missing = engine.recall({ query: "never-indexed-while-source-unreadable" });
      expect(missing).toMatchObject({
        outcome: "inconclusive",
        conclusive: false,
        coverage: "partial",
        next: { action: "run", target: "mooncite rebuild" },
      });
      expect(engine.status()).toMatchObject({
        outcome: "degraded",
        searchUsable: true,
        coverage: "partial",
        next: { action: "run", target: "mooncite rebuild" },
      });
      await chmod(f.source, 0o600);
    } finally {
      await chmod(f.source, 0o600).catch(() => undefined);
      engine.close();
    }

    const emptyRoot = join(f.home, "empty-sessions");
    const emptyState = join(f.home, "empty-state");
    await mkdir(emptyRoot);
    const empty = new MoonciteEngine({ sessionsRoot: emptyRoot, stateDir: emptyState });
    try {
      expect(empty.status()).toMatchObject({
        outcome: "unavailable",
        searchUsable: false,
        freshness: "unavailable",
        next: { action: "run", target: "mooncite rebuild" },
      });
      expect(empty.recall({ query: "anything" })).toMatchObject({
        outcome: "unavailable",
        conclusive: false,
        next: { action: "call", target: "mooncite_status" },
      });
    } finally {
      empty.close();
    }
  });

  it("reports refresh-time source configuration failures with stable safe diagnostics", async () => {
    const f = await fixture();
    let configurationAvailable = true;
    const optionalSourcesProvider = () => {
      if (!configurationAvailable) {
        throw new Error(`Do not expose ${f.source} or silver-cedar-17.`);
      }
      return [];
    };
    const options = {
      sessionsRoot: f.sessionsRoot,
      stateDir: f.stateDir,
      optionalSourcesProvider,
    };
    let engine: MoonciteEngine | null = new MoonciteEngine(options);
    let reopened: MoonciteEngine | null = null;
    const expectedGroup = {
      origin: "unknown",
      reason: "source_configuration_failure",
      count: 1,
      fatalCount: 1,
    };
    try {
      const generation = engine.status().generation;
      configurationAvailable = false;
      const failed = engine.status();
      expect(failed).toMatchObject({
        outcome: "degraded",
        freshness: "last_good",
        generation,
        errors: 1,
        errorGroups: [expectedGroup],
        next: {
          action: "run",
          target: "mooncite rebuild",
          reason: "Restore the authorized source root or configuration, then rebuild the derived index.",
        },
      });
      expect(JSON.stringify(failed)).not.toContain(f.home);
      expect(JSON.stringify(failed)).not.toContain("silver-cedar-17");
      expect(engine.status()).toMatchObject({
        generation,
        errors: 1,
        errorGroups: [expectedGroup],
      });
      engine.close();
      engine = null;

      configurationAvailable = true;
      reopened = new MoonciteEngine(options);
      configurationAvailable = false;
      expect(reopened.status()).toMatchObject({
        outcome: "degraded",
        freshness: "last_good",
        generation,
        errors: 1,
        errorGroups: [expectedGroup],
      });
    } finally {
      reopened?.close();
      engine?.close();
    }
  });

  it("reports a previously indexed root becoming unavailable without losing or inflating the group", async () => {
    const f = await fixture();
    const options = { sessionsRoot: f.sessionsRoot, stateDir: f.stateDir };
    let engine: MoonciteEngine | null = new MoonciteEngine(options);
    let reopened: MoonciteEngine | null = null;
    const expectedGroup = {
      origin: "pi",
      reason: "source_root_unavailable",
      count: 1,
      fatalCount: 1,
    };
    try {
      const generation = engine.status().generation;
      await rename(f.sessionsRoot, join(f.home, "unavailable-pi-root"));
      expect(engine.status()).toMatchObject({
        outcome: "degraded",
        freshness: "last_good",
        generation,
        errors: 1,
        errorGroups: [expectedGroup],
      });
      expect(engine.status()).toMatchObject({
        generation,
        errors: 1,
        errorGroups: [expectedGroup],
      });
      engine.close();
      engine = null;

      reopened = new MoonciteEngine(options);
      expect(reopened.status()).toMatchObject({
        outcome: "degraded",
        freshness: "last_good",
        generation,
        errors: 1,
        errorGroups: [expectedGroup],
      });
    } finally {
      reopened?.close();
      engine?.close();
    }
  });

  it("reports an unreadable discovery directory by origin across repeated status and reopen", async () => {
    const f = await fixture();
    const inaccessible = join(f.sessionsRoot, "inaccessible");
    await mkdir(inaccessible);
    const options = { sessionsRoot: f.sessionsRoot, stateDir: f.stateDir };
    let engine: MoonciteEngine | null = new MoonciteEngine(options);
    let reopened: MoonciteEngine | null = null;
    const expectedGroup = {
      origin: "pi",
      reason: "source_discovery_failure",
      count: 1,
      fatalCount: 1,
    };
    try {
      const generation = engine.status().generation;
      await chmod(inaccessible, 0o000);
      expect(engine.status()).toMatchObject({
        outcome: "degraded",
        freshness: "last_good",
        generation,
        errors: 1,
        errorGroups: [expectedGroup],
      });
      expect(engine.status()).toMatchObject({
        generation,
        errors: 1,
        errorGroups: [expectedGroup],
      });
      engine.close();
      engine = null;

      reopened = new MoonciteEngine(options);
      expect(reopened.status()).toMatchObject({
        outcome: "degraded",
        freshness: "last_good",
        generation,
        errors: 1,
        errorGroups: [expectedGroup],
      });
    } finally {
      reopened?.close();
      engine?.close();
      await chmod(inaccessible, 0o700).catch(() => undefined);
    }
  });

  it("reports a non-append Pi source change by origin across repeated status and reopen", async () => {
    const f = await fixture();
    const options = { sessionsRoot: f.sessionsRoot, stateDir: f.stateDir };
    let engine: MoonciteEngine | null = new MoonciteEngine(options);
    let reopened: MoonciteEngine | null = null;
    const expectedGroup = {
      origin: "pi",
      reason: "source_changed_during_refresh",
      count: 1,
      fatalCount: 1,
    };
    try {
      const generation = engine.status().generation;
      const original = await readFile(f.source, "utf8");
      await writeFile(f.source, original.replace("silver-cedar-17", "silver-cedar-18"));
      expect(engine.status()).toMatchObject({
        outcome: "degraded",
        freshness: "last_good",
        generation,
        errors: 1,
        errorGroups: [expectedGroup],
      });
      expect(engine.status()).toMatchObject({
        generation,
        errors: 1,
        errorGroups: [expectedGroup],
      });
      engine.close();
      engine = null;

      reopened = new MoonciteEngine(options);
      expect(reopened.status()).toMatchObject({
        outcome: "degraded",
        freshness: "last_good",
        generation,
        errors: 1,
        errorGroups: [expectedGroup],
      });
    } finally {
      reopened?.close();
      engine?.close();
    }
  });

  it("persists attributable source read-or-parse counts without promoting them to fatal", async () => {
    const f = await fixture();
    await appendFile(f.source, `malformed ${f.source} silver-cedar-17\n`);
    const options = { sessionsRoot: f.sessionsRoot, stateDir: f.stateDir };
    let engine: MoonciteEngine | null = new MoonciteEngine(options);
    let reopened: MoonciteEngine | null = null;
    const expectedGroup = {
      origin: "pi",
      reason: "source_read_or_parse_failure",
      count: 1,
      fatalCount: 0,
    };
    const expectedPersistedDiagnostics = {
      errors: 1,
      fatalErrors: 0,
      errorGroups: [expectedGroup],
    };
    try {
      const failed = engine.status();
      expect(failed).toMatchObject({
        outcome: "degraded",
        freshness: "current",
        errors: 1,
        malformed: 1,
        errorGroups: [expectedGroup],
      });
      expect(JSON.stringify(failed)).not.toContain(f.home);
      expect(JSON.stringify(failed)).not.toContain("silver-cedar-17");
      expect(engine.status()).toMatchObject({
        errors: 1,
        malformed: 1,
        errorGroups: [expectedGroup],
      });
      const database = new DatabaseSync(join(f.stateDir, "index.sqlite"), { readOnly: true });
      try {
        const row = database.prepare("SELECT value FROM metadata WHERE key = 'last_good'").get();
        expect(row).toBeDefined();
        const value = row?.value;
        expect(typeof value).toBe("string");
        if (typeof value !== "string") throw new Error("Expected metadata.last_good to contain serialized diagnostics.");
        expect(JSON.parse(value)).toMatchObject(expectedPersistedDiagnostics);
      } finally {
        database.close();
      }
      engine.close();
      engine = null;

      reopened = new MoonciteEngine(options);
      expect(reopened.status()).toMatchObject({
        outcome: "degraded",
        freshness: "current",
        errors: 1,
        malformed: 1,
        errorGroups: [expectedGroup],
      });
      const reopenedDatabase = new DatabaseSync(join(f.stateDir, "index.sqlite"), { readOnly: true });
      try {
        const row = reopenedDatabase.prepare("SELECT value FROM metadata WHERE key = 'last_good'").get();
        expect(row).toBeDefined();
        const value = row?.value;
        expect(typeof value).toBe("string");
        if (typeof value !== "string") throw new Error("Expected metadata.last_good to survive engine reopen.");
        expect(JSON.parse(value)).toMatchObject(expectedPersistedDiagnostics);
      } finally {
        reopenedDatabase.close();
      }
    } finally {
      reopened?.close();
      engine?.close();
    }
  });

  it("groups discovery-limit errors by origin without inflating or losing the count", async () => {
    const f = await fixture();
    const options = { sessionsRoot: f.sessionsRoot, stateDir: f.stateDir };
    let engine: MoonciteEngine | null = new MoonciteEngine(options);
    let reopened: MoonciteEngine | null = null;
    try {
      const generation = engine.status().generation;
      let nested = f.sessionsRoot;
      for (let depth = 0; depth < 66; depth++) {
        nested = join(nested, `deep-${depth}`);
        await mkdir(nested);
      }
      const expectedGroup = {
        origin: "pi",
        reason: "source_limit_exceeded",
        count: 1,
        fatalCount: 1,
      };
      expect(engine.status()).toMatchObject({
        outcome: "degraded",
        freshness: "last_good",
        generation,
        errors: 1,
        errorGroups: [expectedGroup],
        next: {
          action: "run",
          target: "mooncite rebuild",
          reason: "Mooncite hit a bounded source-discovery or ingestion limit. Rebuilding alone will repeat it until the authorized source set or supported limit changes.",
        },
      });
      expect(engine.status()).toMatchObject({
        generation,
        errors: 1,
        errorGroups: [expectedGroup],
      });
      engine.close();
      engine = null;

      reopened = new MoonciteEngine(options);
      expect(reopened.status()).toMatchObject({
        outcome: "degraded",
        freshness: "last_good",
        generation,
        errors: 1,
        errorGroups: [expectedGroup],
      });
    } finally {
      reopened?.close();
      engine?.close();
    }
  });

  it("rolls back every projection table when a first full refresh has one fatal source", async () => {
    const f = await fixture();
    const fatalProject = join(f.sessionsRoot, "zz-fatal-project");
    const fatalSource = join(fatalProject, "fatal-session.jsonl");
    await mkdir(fatalProject);
    await writeFile(fatalSource, "{\"type\":\"session\",\"version\":3", { mode: 0o600 });
    const fatalDigest = await digest(fatalSource);
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    try {
      expect(engine.status()).toMatchObject({
        outcome: "unavailable",
        freshness: "unavailable",
        generation: "empty",
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
          reason: "source_read_or_parse_failure",
          count: 1,
          fatalCount: 1,
        }],
      });
      expect(engine.recall({ query: "silver-cedar-17" })).toMatchObject({
        outcome: "unavailable",
        conclusive: false,
        generation: "empty",
        scope: { evidenceSpans: 0 },
        candidates: [],
      });
      const database = new DatabaseSync(join(f.stateDir, "index.sqlite"), { readOnly: true });
      try {
        expect(database.prepare("SELECT COUNT(*) AS count FROM evidence").get()).toEqual({ count: 0 });
        expect(database.prepare("SELECT COUNT(*) AS count FROM source_files").get()).toEqual({ count: 0 });
        expect(database.prepare("SELECT COUNT(*) AS count FROM source_records").get()).toEqual({ count: 0 });
        expect(database.prepare("SELECT value FROM metadata WHERE key = 'last_good'").get()).toBeUndefined();
      } finally {
        database.close();
      }
      expect(await Promise.all([digest(f.source), digest(fatalSource)]))
        .toEqual([f.sourceDigest, fatalDigest]);
    } finally {
      engine.close();
    }
  });

  it("retains a searchable last-good generation when a later full refresh has one fatal source", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({
      sessionsRoot: f.sessionsRoot,
      ompSessionsRoot: f.ompSessionsRoot,
      stateDir: f.stateDir,
    });
    try {
      expect(engine.status()).toMatchObject({
        outcome: "ready",
        freshness: "current",
        sourceFiles: 2,
        evidenceSpans: 4,
      });
      await writeFile(f.ompSource, "{\"type\":\"title\"", { mode: 0o600 });
      const fatalDigest = await digest(f.ompSource);
      expect(engine.rebuild()).toMatchObject({
        outcome: "degraded",
        freshness: "last_good",
        coverage: "partial",
        sourceFiles: 2,
        evidenceSpans: 4,
        searchUsable: true,
        lastRebuildOutcome: "retained_last_good",
        errorGroups: [{
          origin: "omp",
          reason: "source_read_or_parse_failure",
          count: 1,
          fatalCount: 1,
        }],
      });
      expect(engine.recall({ query: "violet-orbit-41" })).toMatchObject({
        outcome: "matches",
        conclusive: true,
        coverage: "partial",
        candidates: [{ sourceOrigin: "omp" }],
      });
      const database = new DatabaseSync(join(f.stateDir, "index.sqlite"), { readOnly: true });
      try {
        expect(database.prepare("SELECT COUNT(*) AS count FROM source_files").get()).toEqual({ count: 2 });
        expect(database.prepare("SELECT COUNT(*) AS count FROM evidence").get()).toEqual({ count: 4 });
        expect(database.prepare("SELECT value FROM metadata WHERE key = 'last_good'").get()).toBeDefined();
      } finally {
        database.close();
      }
      expect(await Promise.all([digest(f.source), digest(f.ompSource)]))
        .toEqual([f.sourceDigest, fatalDigest]);
    } finally {
      engine.close();
    }
  });

  it("automatically discovers standard local histories and honors the process opt-out", async () => {
    const f = await fixture();
    const claudeProject = join(f.home, ".config", "claude-sol", "projects", "-automatic");
    const claudeSource = join(claudeProject, "automatic.jsonl");
    const alternateClaudeProject = join(f.home, ".claude", "projects", "-automatic");
    const alternateClaudeSource = join(alternateClaudeProject, "automatic.jsonl");
    const codexDirectory = join(f.home, ".codex", "sessions", "2030", "01", "01");
    const codexSource = join(codexDirectory, "rollout.jsonl");
    const chatGptDirectory = join(f.home, "incoming", "chatgpt-share-archive", "automatic");
    const chatGptSource = join(chatGptDirectory, "conversation.json");
    await mkdir(claudeProject, { recursive: true });
    await mkdir(alternateClaudeProject, { recursive: true });
    await mkdir(codexDirectory, { recursive: true });
    await mkdir(chatGptDirectory, { recursive: true });
    await writeFile(claudeSource, jsonLine({
      type: "user",
      uuid: "automatic-claude-entry",
      parentUuid: null,
      message: { role: "user", content: "Automatic Claude marker coral-meadow-31." },
    }));
    await writeFile(alternateClaudeSource, jsonLine({
      type: "user",
      uuid: "automatic-claude-entry",
      parentUuid: null,
      message: { role: "user", content: "Alternate Claude marker harbor-birch-72." },
    }));
    await writeFile(codexSource,
      jsonLine({ type: "session_meta", payload: { id: "automatic-codex", cwd: "/automatic" } })
      + jsonLine({ type: "event_msg", payload: { type: "user_message", message: "Automatic Codex marker pine-summit-42." } }));
    await writeFile(chatGptSource, JSON.stringify(chatGptConversation(
      "automatic-chatgpt",
      "Automatic ChatGPT",
      "Automatic ChatGPT marker river-stone-53.",
      "Automatic ChatGPT answer cloud-garden-64.",
    ), null, 2));
    const sourceDigests = await Promise.all([claudeSource, alternateClaudeSource, codexSource, chatGptSource].map(digest));
    const autoEnv: NodeJS.ProcessEnv = { HOME: f.home };
    const configPath = join(f.home, ".config", "mooncite", "sources.json");
    const engine = new MoonciteEngine({
      sessionsRoot: f.sessionsRoot,
      ompSessionsRoot: f.ompSessionsRoot,
      optionalSourcesProvider: () => resolveSourceRegistrations(configPath, autoEnv),
      stateDir: f.stateDir,
    });
    try {
      expect(engine.status()).toMatchObject({
        sourceFilesByOrigin: { pi: 1, omp: 1, "claude-code": 2, codex: 1, chatgpt: 1 },
      });
      for (const [marker, origin] of [
        ["coral-meadow-31", "claude-code"],
        ["harbor-birch-72", "claude-code"],
        ["pine-summit-42", "codex"],
        ["river-stone-53", "chatgpt"],
      ] as const) {
        expect(engine.recall({ query: marker })).toMatchObject({
          outcome: "matches",
          candidates: [{ sourceOrigin: origin }],
        });
      }
      autoEnv.MOONCITE_AUTO_SOURCES = "0";
      expect(engine.recall({ query: "river-stone-53" }).outcome).toBe("no_match");
      expect(engine.status().sourceFilesByOrigin).toMatchObject({ "claude-code": 0, codex: 0, chatgpt: 0 });
      expect(await Promise.all([claudeSource, alternateClaudeSource, codexSource, chatGptSource].map(digest))).toEqual(sourceDigests);
    } finally {
      engine.close();
    }
  });

  it("refuses overlapping or symlinked source/state roots before creating state", async () => {
    const f = await fixture();
    expect(() => new MoonciteEngine({
      sessionsRoot: f.sessionsRoot,
      stateDir: join(f.sessionsRoot, "derived-state"),
    })).toThrow(/must be disjoint/u);
    expect(() => new MoonciteEngine({
      sessionsRoot: "/",
      stateDir: f.stateDir,
    })).toThrow(/must be disjoint/u);

    const physicalSourceRoot = join(f.home, "physical-source");
    const linkedSourceRoot = join(f.home, "linked-source");
    const nestedStateDir = join(physicalSourceRoot, "state");
    await mkdir(physicalSourceRoot);
    await symlink(physicalSourceRoot, linkedSourceRoot, "dir");
    expect(() => new MoonciteEngine({
      sessionsRoot: linkedSourceRoot,
      stateDir: nestedStateDir,
    })).toThrow(/symbolic-link/u);
    await expect(stat(nestedStateDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("indexes ChatGPT conversation arrays with conversation-backed locators and branch state", async () => {
    const f = await fixture();
    const chatGptRoot = join(f.home, "chatgpt-export");
    const chatGptSource = join(chatGptRoot, "conversations.json");
    await mkdir(chatGptRoot);
    await writeFile(chatGptSource, JSON.stringify([
      chatGptConversation("chat-one", "First chat", "ChatGPT marker amber-canvas-75.", "First answer quiet-willow-86.", "Alternate answer hidden-lantern-97."),
      chatGptConversation("chat-two", "Second chat", "Second marker silver-orchard-18.", "Second answer gentle-harbor-29."),
    ]));
    const before = await digest(chatGptSource);
    const engine = new MoonciteEngine({
      sessionsRoot: f.sessionsRoot,
      optionalSources: [{ origin: "chatgpt", root: chatGptRoot }],
      stateDir: f.stateDir,
    });
    try {
      expect(engine.status().sourceFilesByOrigin.chatgpt).toBe(1);
      const current = engine.recall({ query: "quiet-willow-86" }).candidates[0]!;
      expect(current.evidenceId).toMatch(/^mooncite:chatgpt:[a-f0-9]{24}:[a-f0-9]{24}:[a-f0-9]{24}:0$/u);
      expect(current.evidenceUri).toMatch(/^mooncite:\/\/chatgpt\/[a-f0-9]{24}\/chat-one\/chat-one-assistant\/0$/u);
      expect(current).toMatchObject({
        sourceOrigin: "chatgpt",
        sessionId: current.sessionId,
        branchState: "current",
        eventTimestamp: "2030-01-01T00:00:02.000Z",
        recordProvenance: "copy",
      });
      for (const locator of [current.evidenceId, current.evidenceUri]) {
        expect(engine.inspect({ evidenceId: locator, window: 1 })).toMatchObject({
          outcome: "verified",
          locator: { sourceOrigin: "chatgpt", sessionId: current.sessionId, entryId: "chat-one-assistant" },
          target: {
            eventTimestamp: "2030-01-01T00:00:02.000Z",
            recordProvenance: "copy",
          },
        });
      }
      expect(engine.recall({ query: "hidden-lantern-97" }).candidates[0]).toMatchObject({ branchState: "off_branch" });
      expect(engine.recall({ query: "silver-orchard-18" })).toMatchObject({
        outcome: "matches",
        candidates: [{ sourceOrigin: "chatgpt" }],
      });
      expect(engine.recall({ query: "silver-orchard-18" }).candidates[0]!.sessionId).toMatch(/^chatgpt:[a-f0-9]{64}:chat-two$/u);
      expect(await digest(chatGptSource)).toBe(before);
    } finally {
      engine.close();
    }
  });


  it("reports changed physical evidence as stale and leaves the changed source untouched", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    try {
      const evidenceId = engine.recall({ query: "silver-cedar-17" }).candidates[0]!.evidenceId;
      const original = await readFile(f.source, "utf8");
      const changed = original.replace("silver-cedar-17", "silver-cedar-18");
      await writeFile(f.source, changed);
      const changedDigest = await digest(f.source);
      expect(engine.inspect({ evidenceId })).toMatchObject({ outcome: "stale", evidenceId });
      expect(await digest(f.source)).toBe(changedDigest);
    } finally {
      engine.close();
    }
  });

  it("safely adopts a recognized pre-marker Mooncite index", async () => {
    const f = await fixture();
    const options = { sessionsRoot: f.sessionsRoot, stateDir: f.stateDir };
    const first = new MoonciteEngine(options);
    expect(first.recall({ query: "silver-cedar-17" }).outcome).toBe("matches");
    first.close();
    await rm(`${f.stateDir}/.mooncite-state`);
    const adopted = new MoonciteEngine(options);
    try {
      expect(adopted.recall({ query: "silver-cedar-17" }).outcome).toBe("matches");
      expect(await digest(f.source)).toBe(f.sourceDigest);
    } finally {
      adopted.close();
    }
  });

  it("refuses legacy state adoption when durable learned state lacks the owner marker", async () => {
    const f = await fixture();
    const options = { sessionsRoot: f.sessionsRoot, stateDir: f.stateDir };
    const first = new MoonciteEngine(options);
    first.close();
    const learnedPath = join(f.stateDir, "learned-memory.sqlite");
    await writeFile(learnedPath, "durable learned state", { mode: 0o600 });
    await rm(join(f.stateDir, ".mooncite-state"));

    expect(() => new MoonciteEngine(options)).toThrow(/not marked as Mooncite-owned/u);
    expect(await readFile(learnedPath, "utf8")).toBe("durable learned state");
  });

  it("removes verified stale engine locks before opening the index", async () => {
    const f = await fixture();
    const options = { sessionsRoot: f.sessionsRoot, stateDir: f.stateDir };
    const first = new MoonciteEngine(options);
    first.close();
    const staleName = ".engine-2147483647-00000000-0000-0000-0000-000000000000.lock";
    await writeFile(`${f.stateDir}/${staleName}`, "2147483647\n", { mode: 0o600 });
    const reopened = new MoonciteEngine(options);
    try {
      expect(await readdir(f.stateDir)).not.toContain(staleName);
    } finally {
      reopened.close();
    }
  });

  it("recovers corrupt derived SQLite state by rebuilding from unchanged source", async () => {
    const f = await fixture();
    const options = { sessionsRoot: f.sessionsRoot, stateDir: f.stateDir };
    const first = new MoonciteEngine(options);
    expect(first.recall({ query: "silver-cedar-17" }).outcome).toBe("matches");
    first.close();
    await writeFile(`${f.stateDir}/index.sqlite`, "not a sqlite database");
    await chmod(`${f.stateDir}/index.sqlite`, 0o600);
    const recovered = new MoonciteEngine(options);
    try {
      expect(recovered.recall({ query: "silver-cedar-17" }).outcome).toBe("matches");
      expect(await digest(f.source)).toBe(f.sourceDigest);
    } finally {
      recovered.close();
    }
  });
});
