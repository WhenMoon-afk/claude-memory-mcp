import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { MoonciteEngine } from "../src/engine.js";
import {
  LearnedMemoryStore,
  learnedMemoryDatabaseRetained,
  loadLearnedMemoryMode,
  resolveLearnedMemoryConfigPath,
  setLearnedMemoryEnabled,
} from "../src/learned-memory.js";
import { createFixture, digest, jsonLine, type Fixture } from "./fixture.js";

const fixtures: Fixture[] = [];
afterEach(async () => {
  while (fixtures.length) await fixtures.pop()!.cleanup();
});

async function fixture(): Promise<Fixture> {
  const value = await createFixture();
  fixtures.push(value);
  return value;
}

describe("optional learned-memory vertical", () => {
  it("is strictly default-off and creates no learned database", async () => {
    const f = await fixture();
    const configPath = join(f.home, ".config", "mooncite", "learned-memory.json");
    expect(resolveLearnedMemoryConfigPath({
      HOME: f.home,
      XDG_CONFIG_HOME: join(f.home, "private-config"),
    })).toBe(join(f.home, "private-config", "mooncite", "learned-memory.json"));
    expect(loadLearnedMemoryMode(configPath)).toEqual({ version: 1, enabled: false, configured: false });

    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    try {
      expect(engine.recall({ query: "silver-cedar-17" }).outcome).toBe("matches");
    } finally {
      engine.close();
    }
    expect(await readdir(f.stateDir)).not.toContain("learned-memory.sqlite");
    expect(learnedMemoryDatabaseRetained(f.stateDir)).toBe(false);

    expect(setLearnedMemoryEnabled(configPath, true)).toEqual({ version: 1, enabled: true, configured: true });
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({ version: 1, enabled: true });
    expect(setLearnedMemoryEnabled(configPath, false)).toEqual({ version: 1, enabled: false, configured: true });
    expect(learnedMemoryDatabaseRetained(f.stateDir)).toBe(false);

    await writeFile(configPath, JSON.stringify({ version: 1, enabled: false, unexpected: true }), { mode: 0o600 });
    expect(() => loadLearnedMemoryMode(configPath)).toThrow(/configuration is invalid/u);
  });

  it("creates, recalls, fully inspects, revises, rebuilds, and deletes without touching evidence", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({
      sessionsRoot: f.sessionsRoot,
      ompSessionsRoot: f.ompSessionsRoot,
      stateDir: f.stateDir,
    });
    const store = new LearnedMemoryStore(engine, { stateDir: f.stateDir });
    try {
      const source = engine.recall({ query: "silver-cedar-17" }).candidates[0]!;
      const created = store.write({
        interpretation: "The project launch marker is silver cedar.",
        evidenceIds: [source.evidenceUri],
      });
      expect(created).toMatchObject({
        kind: "derived_memory_write",
        outcome: "created",
        revision: 1,
        provenanceOutcome: "verified",
        scope: { kind: "project" },
        evidenceIds: [source.evidenceId],
      });
      expect(await digest(f.source)).toBe(f.sourceDigest);

      expect(store.recall({ query: "launch marker" })).toMatchObject({
        kind: "derived_memory_recall",
        outcome: "matches",
        candidates: [{
          kind: "derived_memory",
          memoryId: created.memoryId,
          revision: 1,
          provenanceState: "indexed",
          quarantined: false,
        }],
      });
      expect(store.recall({ query: created.memoryId }).candidates[0]).toMatchObject({
        relevance: { kind: "exact_id" },
      });
      expect(store.inspect({ memoryId: created.memoryId, window: 1 })).toMatchObject({
        kind: "derived_memory",
        revision: 1,
        currentRevision: 1,
        provenanceOutcome: "verified",
        anchors: [{
          kind: "source_evidence_anchor",
          evidenceId: source.evidenceId,
          state: "indexed",
          inspection: { outcome: "verified" },
        }],
      });

      expect(() => store.write({
        memoryId: created.memoryId,
        expectedRevision: 2,
        interpretation: "A stale correction must not commit.",
        evidenceIds: [source.evidenceId],
      })).toThrow(/expected revision 2, current revision 1/u);
      const revised = store.write({
        memoryId: created.memoryId,
        expectedRevision: 1,
        interpretation: "The verified project launch marker remains silver cedar.",
        evidenceIds: [source.evidenceId],
      });
      expect(revised).toMatchObject({ outcome: "revised", memoryId: created.memoryId, revision: 2 });
      expect(store.inspect({ memoryId: created.memoryId, revision: 1 })).toMatchObject({
        revision: 1,
        currentRevision: 2,
        isCurrent: false,
        interpretation: "The project launch marker is silver cedar.",
      });

      const ompSource = engine.recall({ query: "violet-orbit-41" }).candidates[0]!;
      const global = store.write({
        interpretation: "Silver cedar is available as an explicitly global interpretation.",
        evidenceIds: [source.evidenceId, ompSource.evidenceUri],
        scope: { kind: "global" },
      });
      expect(store.recall({ query: "explicitly global", project: "project:unrelated-0000000000000000" })).toMatchObject({
        candidates: [{ memoryId: global.memoryId, scope: { kind: "global" } }],
      });
      const globalInspection = store.inspect({ memoryId: global.memoryId });
      expect(globalInspection.anchors).toHaveLength(2);
      expect(globalInspection.anchors.every((anchor) => anchor.inspection.outcome === "verified")).toBe(true);

      expect(engine.rebuild()).toMatchObject({ outcome: "ready" });
      expect(store.recall({ query: created.memoryId }).candidates[0]).toMatchObject({ revision: 2, provenanceState: "indexed" });
      expect(learnedMemoryDatabaseRetained(f.stateDir)).toBe(true);

      expect(store.delete({ memoryId: created.memoryId, expectedRevision: 2 })).toEqual({
        kind: "derived_memory_delete",
        outcome: "deleted",
        memoryId: created.memoryId,
        deletedRevisions: 2,
      });
      const configPath = join(f.home, ".config", "mooncite", "learned-memory.json");
      setLearnedMemoryEnabled(configPath, true);
      setLearnedMemoryEnabled(configPath, false);
      expect(loadLearnedMemoryMode(configPath)).toMatchObject({ enabled: false });
      expect(learnedMemoryDatabaseRetained(f.stateDir)).toBe(true);
      expect(store.recall({ query: created.memoryId, includeInvalid: true }).outcome).toBe("no_match");
      expect(engine.recall({ query: "silver-cedar-17" }).outcome).toBe("matches");
      expect(await digest(f.source)).toBe(f.sourceDigest);
      expect(await digest(f.ompSource)).toBe(f.ompSourceDigest);
    } finally {
      store.close();
      engine.close();
    }
  });

  it("quarantines a stable locator after physical content changes and can reactivate exact restored evidence", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    const store = new LearnedMemoryStore(engine, { stateDir: f.stateDir });
    try {
      const original = await readFile(f.source, "utf8");
      const source = engine.recall({ query: "silver-cedar-17" }).candidates[0]!;
      const created = store.write({
        interpretation: "The retained launch token is silver cedar.",
        evidenceIds: [source.evidenceId],
      });

      const changed = original.replace("silver-cedar-17", "bronze-cedar-17");
      expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(original));
      await writeFile(f.source, changed, { mode: 0o600 });
      expect(store.inspect({ memoryId: created.memoryId })).toMatchObject({
        provenanceOutcome: "quarantined",
        provenanceState: "content_mismatch",
        anchors: [{ inspection: { outcome: "stale" } }],
      });

      engine.rebuild();
      const changedSource = engine.recall({ query: "bronze-cedar-17" }).candidates[0]!;
      expect(changedSource.evidenceId).toBe(source.evidenceId);
      expect(store.recall({ query: "retained launch token" })).toMatchObject({ outcome: "no_match", candidates: [] });
      expect(store.recall({ query: "retained launch token", includeInvalid: true })).toMatchObject({
        outcome: "matches",
        candidates: [{ memoryId: created.memoryId, provenanceState: "content_mismatch", quarantined: true }],
      });

      await writeFile(f.source, original, { mode: 0o600 });
      engine.rebuild();
      expect(store.recall({ query: created.memoryId })).toMatchObject({
        outcome: "matches",
        candidates: [{ provenanceState: "indexed", quarantined: false }],
      });
    } finally {
      store.close();
      engine.close();
    }
  });

  it("quarantines deauthorized anchors without deleting them and reactivates exact authorization", async () => {
    const f = await fixture();
    const claudeRoot = join(f.home, "claude-projects");
    const claudeProject = join(claudeRoot, "-learned-project");
    const claudeSource = join(claudeProject, "learned-session.jsonl");
    await mkdir(claudeProject, { recursive: true });
    await writeFile(claudeSource, jsonLine({
      type: "user",
      sessionId: "learned-session",
      uuid: "learned-entry",
      parentUuid: null,
      cwd: "/learned/project",
      message: { role: "user", content: "Authorization marker lucid-maple-31." },
    }), { mode: 0o600 });
    let authorized: Array<{ origin: "claude-code"; root: string }> = [{ origin: "claude-code", root: claudeRoot }];
    const engine = new MoonciteEngine({
      sessionsRoot: f.sessionsRoot,
      optionalSourcesProvider: () => authorized,
      stateDir: f.stateDir,
    });
    const store = new LearnedMemoryStore(engine, { stateDir: f.stateDir });
    try {
      const source = engine.recall({ query: "lucid-maple-31" }).candidates[0]!;
      const piSource = engine.recall({ query: "silver-cedar-17" }).candidates[0]!;
      expect(() => store.write({
        interpretation: "Mixed projects need an explicit global scope.",
        evidenceIds: [source.evidenceId, piSource.evidenceId],
      })).toThrow(/Mixed-project learned memory requires an explicit global scope/u);
      const created = store.write({
        interpretation: "The authorized optional-source marker is lucid maple.",
        evidenceIds: [source.evidenceId],
      });
      authorized = [];
      expect(store.recall({ query: "optional-source marker" })).toMatchObject({ outcome: "no_match", candidates: [] });
      expect(store.recall({ query: "optional-source marker", includeInvalid: true })).toMatchObject({
        candidates: [{ memoryId: created.memoryId, provenanceState: "deauthorized", quarantined: true }],
      });
      expect(store.inspect({ memoryId: created.memoryId })).toMatchObject({
        provenanceOutcome: "quarantined",
        provenanceState: "deauthorized",
      });

      authorized = [{ origin: "claude-code", root: claudeRoot }];
      expect(store.recall({ query: created.memoryId })).toMatchObject({
        outcome: "matches",
        candidates: [{ provenanceState: "indexed", quarantined: false }],
      });
      expect(await readFile(claudeSource, "utf8")).toContain("lucid-maple-31");
    } finally {
      store.close();
      engine.close();
    }
  });

  it("refuses recursive Mooncite output and keeps learned-store corruption independent from evidence", async () => {
    const f = await fixture();
    const entries = (await readFile(f.source, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    entries.push({
      type: "message",
      id: "entry-tool",
      parentId: "entry-b",
      message: {
        role: "toolResult",
        content: "Derived memory mooncite-memory:00000000-0000-4000-8000-000000000000 revision 1: verified provenance.\nInterpretation (derived_memory, not source evidence): recursive marker",
      },
    });
    await writeFile(f.source, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, { mode: 0o600 });
    const options = { sessionsRoot: f.sessionsRoot, stateDir: f.stateDir };
    const engine = new MoonciteEngine(options);
    const store = new LearnedMemoryStore(engine, { stateDir: f.stateDir });
    engine.status();
    const index = new DatabaseSync(join(f.stateDir, "index.sqlite"), { readOnly: true });
    const row = index.prepare("SELECT evidence_id FROM evidence WHERE entry_id = ?").get("entry-tool") as { evidence_id: string };
    index.close();
    const rendering = engine.recall({ query: row.evidence_id }).candidates[0]!;
    expect(engine.resolveEvidenceAnchors([{ locator: rendering.evidenceId }])[0]).toMatchObject({
      outcome: "resolved",
      anchor: { isMoonciteRendering: true },
    });
    expect(rendering.isEcho).toBe(true);
    expect(() => store.write({
      interpretation: "Recursive memory must not be retained.",
      evidenceIds: [rendering.evidenceId],
    })).toThrow(/tool renderings cannot be retained/u);
    store.close();
    engine.close();

    const learnedPath = join(f.stateDir, "learned-memory.sqlite");
    await writeFile(learnedPath, "not a sqlite database", { mode: 0o600 });
    await chmod(learnedPath, 0o600);
    const evidenceOnly = new MoonciteEngine(options);
    try {
      expect(() => new LearnedMemoryStore(evidenceOnly, { stateDir: f.stateDir })).toThrow();
      expect(evidenceOnly.recall({ query: "silver-cedar-17" }).outcome).toBe("matches");
      expect(await readFile(learnedPath, "utf8")).toBe("not a sqlite database");
    } finally {
      evidenceOnly.close();
    }
  });
});
