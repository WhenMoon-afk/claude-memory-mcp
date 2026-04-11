import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContinuityStore } from "./store.js";

describe("continuity search and detail", () => {
  let dir: string;
  let store: ContinuityStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "continuity-search-"));
    store = new ContinuityStore(join(dir, "continuity.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("search returns compact rows without full body expansion", () => {
    store.saveArtifact({
      type: "snapshot",
      title: "JWT auth handoff",
      summary: "JWT auth flow is green and refresh edge cases remain.",
      project: "notes-api",
      body: { deep: "details" },
    });

    const results = store.searchArtifacts("auth");

    expect(results[0]).toMatchObject({
      id: expect.any(String),
      label: expect.any(String),
      preview: expect.any(String),
    });
    expect(results[0]).not.toHaveProperty("body");
    expect(results[0]).not.toHaveProperty("summary");
  });

  it("returns concise detail and persisted render modes", () => {
    const saved = store.saveArtifact({
      type: "snapshot",
      title: "JWT auth handoff",
      summary: "JWT auth flow is green and refresh edge cases remain.",
      project: "notes-api",
      next_steps: ["Test refresh edge cases"],
      body: { deep: "details" },
    });

    expect(store.getArtifactDetail(saved.id)).toEqual({
      id: saved.id,
      type: "snapshot",
      title: "JWT auth handoff",
      label: "JWT auth handoff",
      preview: "JWT auth flow is green and refresh edge cases remain.",
      summary: "JWT auth flow is green and refresh edge cases remain.",
      project_id: "project:notes-api",
      next_steps: ["Test refresh edge cases"],
      updated_at: saved.updated_at,
    });

    expect(store.getRender(saved.id, "raw")).toContain("snapshot: JWT auth handoff");
    expect(store.getRender(saved.id, "prompt")).toContain("Resume from JWT auth handoff.");
    expect(store.getRender(saved.id, "bridge")).toContain("Project: project:notes-api");
    expect(store.getRender(saved.id, "bundle")).toContain("Bundle: JWT auth handoff");
  });

  it("returns nearby artifacts for the same project only", () => {
    const anchor = store.saveArtifact({
      type: "snapshot",
      title: "JWT auth handoff",
      summary: "JWT auth flow is green and refresh edge cases remain.",
      project: "notes-api",
    });
    const nearby = store.saveArtifact({
      type: "decision",
      title: "Keep SQLite local-first",
      summary: "SQLite keeps the continuity graph inspectable and portable.",
      project: "notes-api",
    });
    store.saveArtifact({
      type: "snapshot",
      title: "Billing rollout handoff",
      summary: "Billing rollout is waiting on webhook retries.",
      project: "ceres-billing",
    });

    const rows = store.getNearbyArtifacts(anchor.id);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: nearby.id,
      type: "decision",
      label: "Keep SQLite local-f…",
      preview: "SQLite keeps the continuity graph inspectable and portable.",
      project_id: "project:notes-api",
    });
  });

  it("searches through linked entity and theme nodes", () => {
    const saved = store.saveArtifact({
      type: "snapshot",
      title: "Token rollout handoff",
      summary: "Middleware is green and rollout is staged.",
      project: "notes-api",
      themes: ["authentication"],
      entities: ["jwt"],
    });

    const entityResults = store.searchArtifacts("jwt");
    const themeResults = store.searchArtifacts("authentication");

    expect(entityResults.map((row) => row.id)).toContain(saved.id);
    expect(themeResults.map((row) => row.id)).toContain(saved.id);
  });

  it("returns neighbors connected by shared graph nodes across projects", () => {
    const snapshot = store.saveArtifact({
      type: "snapshot",
      title: "Token rollout handoff",
      summary: "Middleware is green and rollout is staged.",
      project: "notes-api",
      themes: ["authentication"],
      entities: ["jwt"],
    });
    const crossProjectDecision = store.saveArtifact({
      type: "decision",
      title: "JWT refresh policy",
      summary: "Refresh tokens rotate after re-authentication.",
      project: "ceres-billing",
      themes: ["authentication"],
      entities: ["jwt"],
    });

    const rows = store.getNeighbors(snapshot.id);

    expect(rows.map((row) => row.id)).toContain(crossProjectDecision.id);
  });
});
