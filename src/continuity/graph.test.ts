import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContinuityStore } from "./store.js";

describe("continuity graph surface", () => {
  let dir: string;
  let store: ContinuityStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "continuity-graph-"));
    store = new ContinuityStore(join(dir, "continuity.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns node detail with linked artifacts", () => {
    const snapshot = store.saveArtifact({
      type: "snapshot",
      title: "Token rollout handoff",
      summary: "Middleware is green and rollout is staged.",
      project: "notes-api",
      themes: ["authentication"],
      entities: ["jwt"],
    });
    const decision = store.saveArtifact({
      type: "decision",
      title: "JWT refresh policy",
      summary: "Refresh tokens rotate after re-authentication.",
      project: "ceres-billing",
      themes: ["authentication"],
    });

    const node = store.getNode("theme:authentication");
    const linked = store.getNodeArtifacts("theme:authentication");

    expect(node).toEqual({
      id: "theme:authentication",
      kind: "theme",
      label: "authentication",
      preview: "theme authentication",
    });
    expect(linked.map((row) => row.id)).toEqual([decision.id, snapshot.id]);
  });

  it("returns related artifacts with graph reasons", () => {
    const snapshot = store.saveArtifact({
      type: "snapshot",
      title: "Token rollout handoff",
      summary: "Middleware is green and rollout is staged.",
      project: "notes-api",
      themes: ["authentication"],
      entities: ["jwt"],
    });
    const decision = store.saveArtifact({
      type: "decision",
      title: "JWT refresh policy",
      summary: "Refresh tokens rotate after re-authentication.",
      project: "ceres-billing",
      themes: ["authentication"],
      entities: ["jwt"],
    });
    const merged = store.mergeArtifacts(
      [snapshot.id, decision.id],
      "meta_snapshot",
      "Auth continuity",
    );

    const related = store.getRelatedArtifacts(snapshot.id, "all");

    expect(related).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: decision.id,
          reasons: expect.arrayContaining([
            "shared theme:authentication",
            "shared entity:jwt",
          ]),
        }),
        expect.objectContaining({
          id: merged.id,
          reasons: expect.arrayContaining(["edge merges"]),
        }),
      ]),
    );
  });

  it("links project nodes for direct inspection", () => {
    store.saveArtifact({
      type: "snapshot",
      title: "Project handoff",
      summary: "SQLite continuity is ready for local project handoffs.",
      project: "notes-api",
    });

    expect(store.getNode("project:notes-api")).toEqual({
      id: "project:notes-api",
      kind: "project",
      label: "notes-api",
      preview: "project notes-api",
    });
    expect(store.getNodeArtifacts("project:notes-api").map((row) => row.id)).toEqual([
      "snap-1",
    ]);
  });
});
