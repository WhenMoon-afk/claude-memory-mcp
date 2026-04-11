import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContinuityStore } from "./store.js";

describe("continuity bundles", () => {
  let dir: string;
  let store: ContinuityStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "continuity-bundle-"));
    store = new ContinuityStore(join(dir, "continuity.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("assembles project_state, snapshot, decisions, and meta snapshots in wake-up order", () => {
    store.saveArtifact({
      type: "snapshot",
      title: "JWT auth handoff",
      summary: "JWT middleware is green and password reset is next.",
      project: "notes-api",
    });
    store.saveArtifact({
      type: "decision",
      title: "Keep SQLite local-first",
      summary: "SQLite keeps the continuity graph inspectable.",
      project: "notes-api",
    });
    store.saveArtifact({
      type: "project_state",
      title: "API orientation",
      summary: "Auth work is active and billing is quiet.",
      project: "notes-api",
    });
    store.saveArtifact({
      type: "decision",
      title: "JWT expires in 24h",
      summary: "24h expiry balances operational safety and support overhead.",
      project: "notes-api",
    });
    store.saveArtifact({
      type: "meta_snapshot",
      title: "Auth continuity",
      summary: "Auth work is stable enough to resume from a compact bundle.",
      project: "notes-api",
    });

    const bundle = store.buildBundle("notes-api");

    expect(bundle.map((artifact) => artifact.type)).toEqual([
      "project_state",
      "snapshot",
      "decision",
      "decision",
      "meta_snapshot",
    ]);
    expect(bundle[0]!.title).toBe("API orientation");
    expect(bundle[1]!.title).toBe("JWT auth handoff");
    expect(bundle[4]!.title).toBe("Auth continuity");

    const text = store.buildBundleText("notes-api");
    expect(text).toContain("project_state: API orientation");
    expect(text).toContain("snapshot: JWT auth handoff");
    expect(text).toContain("decision: JWT expires in 24h");
    expect(text).toContain("meta_snapshot: Auth continuity");
  });

  it("creates a meta_snapshot with typed summary and source ids", () => {
    const state = store.saveArtifact({
      type: "project_state",
      title: "API orientation",
      summary: "Auth work is active and billing is quiet.",
      project: "notes-api",
    });
    const snapshot = store.saveArtifact({
      type: "snapshot",
      title: "JWT auth handoff",
      summary: "JWT middleware is green and password reset is next.",
      project: "notes-api",
    });
    const decision = store.saveArtifact({
      type: "decision",
      title: "JWT expires in 24h",
      summary: "24h expiry balances operational safety and support overhead.",
      project: "notes-api",
    });

    const merged = store.mergeArtifacts(
      [state.id, snapshot.id, decision.id],
      "meta_snapshot",
      "Auth continuity",
    );

    expect(merged.type).toBe("meta_snapshot");
    expect(merged.body).toEqual({
      source_ids: [state.id, snapshot.id, decision.id],
    });
    expect(merged.summary).toContain("project_state:");
    expect(merged.summary).toContain("snapshot:");
    expect(merged.summary).toContain("decision:");
  });

  it("builds a recent bundle when no project is specified", () => {
    store.saveArtifact({
      type: "snapshot",
      title: "Token rollout handoff",
      summary: "Middleware is green and rollout is staged.",
    });
    store.saveArtifact({
      type: "decision",
      title: "JWT refresh policy",
      summary: "Refresh tokens rotate after re-authentication.",
    });

    const bundle = store.buildBundle();
    const text = store.buildBundleText();

    expect(bundle).toHaveLength(2);
    expect(text).toContain("Bundle for recent continuity");
    expect(text).toContain("decision: JWT refresh policy");
  });

  it("rejects merging fewer than two artifacts", () => {
    const snapshot = store.saveArtifact({
      type: "snapshot",
      title: "Token rollout handoff",
      summary: "Middleware is green and rollout is staged.",
    });

    expect(() =>
      store.mergeArtifacts([snapshot.id], "meta_snapshot", "Invalid merge"),
    ).toThrow("Need at least two artifacts to merge.");
  });
});
