import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixtures, type ContinuityBenchmarkFixture } from "./benchmark.fixtures.js";
import { ContinuityStore } from "./store.js";

function runContinuityFixture(
  store: ContinuityStore,
  fixture: ContinuityBenchmarkFixture,
): { pass: boolean; detail: string } {
  if (fixture.mode === "search") {
    const rows = store.searchArtifacts(fixture.query ?? "");
    const ids = rows.map((row) => row.id);
    const types = [...new Set(rows.map((row) => row.type))];
    const idsPass =
      !fixture.expectedIds ||
      fixture.expectedIds.every((expectedId) => ids.includes(expectedId));
    const typesPass =
      !fixture.expectedTypes ||
      fixture.expectedTypes.every((expectedType) => types.includes(expectedType));

    return {
      pass: idsPass && typesPass,
      detail: `ids=${ids.join(",")} types=${types.join(",")}`,
    };
  }

  const bundle = store.buildBundle(fixture.project ?? "");
  const types = bundle.map((artifact) => artifact.type);
  const typesPass =
    !fixture.expectedTypes ||
    fixture.expectedTypes.every((expectedType) => types.includes(expectedType));

  return {
    pass: typesPass,
    detail: `types=${types.join(",")}`,
  };
}

describe("continuity benchmark fixtures", () => {
  let dir: string;
  let store: ContinuityStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "continuity-benchmark-"));
    store = new ContinuityStore(join(dir, "continuity.db"));

    store.saveArtifact({
      type: "project_state",
      title: "API orientation",
      summary: "Auth is active and billing is quiet.",
      project: "notes-api",
    });
    store.saveArtifact({
      type: "snapshot",
      title: "JWT auth handoff",
      summary: "JWT middleware is green and password reset is next.",
      project: "notes-api",
    });
    store.saveArtifact({
      type: "decision",
      title: "JWT expiration",
      summary: "24h expiration balances operational safety and support overhead.",
      project: "notes-api",
    });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it.each(fixtures)("matches continuity fixture $name", (fixture) => {
    const result = runContinuityFixture(store, fixture);
    expect(result.pass, result.detail).toBe(true);
  });
});
