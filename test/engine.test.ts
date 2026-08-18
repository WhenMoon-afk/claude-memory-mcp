import { appendFile, readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { MoonciteEngine } from "../src/engine.js";
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

describe("Mooncite engine public seam", () => {
  it("recalls a stable source-qualified citation and physically inspects both rendered locators without changing source", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    try {
      const recalled = engine.recall({ query: "silver-cedar-17" });
      expect(recalled.outcome).toBe("matches");
      expect(recalled.candidates).toHaveLength(1);
      const candidate = recalled.candidates[0]!;
      expect(candidate.evidenceId).toBe("mooncite:pi:session-moon:entry-a:0");
      expect(candidate.evidenceUri).toBe("mooncite://pi/session-moon/entry-a/0");
      for (const locator of [candidate.evidenceId, candidate.evidenceUri]) {
        const inspected = engine.inspect({ evidenceId: locator, window: 1 });
        expect(inspected.outcome).toBe("verified");
        expect(inspected.target?.text).toContain("silver-cedar-17");
        expect(inspected.window.map((span) => span.relation)).toEqual(["target", "after"]);
      }
      expect(await digest(f.source)).toBe(f.sourceDigest);
    } finally {
      engine.close();
    }
  });

  it("incrementally admits a coherent append and rebuild restores full verification", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    try {
      expect(engine.status()).toMatchObject({ outcome: "ready", trustState: "full_verified", evidenceSpans: 2 });
      await appendFile(f.source, jsonLine({ type: "message", id: "entry-c", parentId: "entry-b", message: { role: "user", content: "Incremental marker amber-river-29." } }));
      expect(engine.recall({ query: "amber-river-29" })).toMatchObject({
        outcome: "matches",
        trustState: "append_trusted",
        candidates: [{ evidenceId: "mooncite:pi:session-moon:entry-c:0" }],
      });
      expect(engine.rebuild()).toMatchObject({ outcome: "ready", trustState: "full_verified", lastRebuildOutcome: "published" });
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

  it("recovers corrupt derived SQLite state by rebuilding from unchanged source", async () => {
    const f = await fixture();
    const options = { sessionsRoot: f.sessionsRoot, stateDir: f.stateDir };
    const first = new MoonciteEngine(options);
    expect(first.recall({ query: "silver-cedar-17" }).outcome).toBe("matches");
    first.close();
    await writeFile(`${f.stateDir}/index.sqlite`, "not a sqlite database");
    const recovered = new MoonciteEngine(options);
    try {
      expect(recovered.recall({ query: "silver-cedar-17" }).outcome).toBe("matches");
      expect(await digest(f.source)).toBe(f.sourceDigest);
    } finally {
      recovered.close();
    }
  });
});
