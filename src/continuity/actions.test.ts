import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dispatchContinuityAction } from "./actions.js";
import { ContinuityStore } from "./store.js";

describe("continuity action dispatch", () => {
  let dir: string;
  let store: ContinuityStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "continuity-actions-"));
    store = new ContinuityStore(join(dir, "continuity.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("supports the continuity action surface end to end", async () => {
    const help = await dispatchContinuityAction(store, { action: "help" });
    expect(help.text).toContain("save");
    expect(help.text).toContain("merge");
    expect(help.text).toContain("node");
    expect(help.text).toContain("related");
    expect(help.text).toContain("doctor");

    const saved = await dispatchContinuityAction(store, {
      action: "save",
      type: "snapshot",
      title: "JWT auth pass",
      summary: "Middleware works",
      project: "notes-api",
      themes: ["authentication"],
      entities: ["jwt"],
      next_steps: ["Document refresh flow"],
    });
    expect(saved.text).toContain("snap-1");

    await dispatchContinuityAction(store, {
      action: "save",
      type: "decision",
      title: "Keep SQLite local-first",
      summary: "SQLite keeps the continuity graph inspectable.",
      project: "notes-api",
      themes: ["authentication"],
    });

    const list = await dispatchContinuityAction(store, { action: "list" });
    expect(list.text).toContain("JWT auth pass");

    const search = await dispatchContinuityAction(store, {
      action: "search",
      query: "auth",
    });
    expect(search.text).toContain("snap-1");

    const detail = await dispatchContinuityAction(store, {
      action: "get",
      id: "snap-1",
      detail: "full",
    });
    expect(detail.text).toContain("Summary: Middleware works");
    expect(detail.text).toContain("Document refresh flow");

    const compactDetail = await dispatchContinuityAction(store, {
      action: "get",
      id: "snap-1",
      detail: "compact",
    });
    expect(compactDetail.text).toContain("snap-1");
    expect(compactDetail.text).toContain("JWT auth pass");

    const standardDetail = await dispatchContinuityAction(store, {
      action: "get",
      id: "snap-1",
    });
    expect(standardDetail.text).toContain("snapshot: JWT auth pass");
    expect(standardDetail.text).toContain("Project: project:notes-api");

    const neighbors = await dispatchContinuityAction(store, {
      action: "neighbors",
      id: "snap-1",
    });
    expect(neighbors.text).toContain("dec-2");

    const node = await dispatchContinuityAction(store, {
      action: "node",
      id: "theme:authentication",
    });
    expect(node.text).toContain("Node: theme:authentication");
    expect(node.text).toContain("snap-1");

    const related = await dispatchContinuityAction(store, {
      action: "related",
      id: "snap-1",
      via: "nodes",
    });
    expect(related.text).toContain("shared theme:authentication");

    const doctor = await dispatchContinuityAction(store, {
      action: "doctor",
    });
    expect(doctor.text).toContain("schema_version");
    expect(doctor.text).toContain("\"integrity\": \"ok\"");

    const missingNode = await dispatchContinuityAction(store, {
      action: "node",
      id: "theme:missing",
    });
    expect(missingNode.text).toContain("Node not found: theme:missing");

    const bundle = await dispatchContinuityAction(store, {
      action: "bundle",
      project: "notes-api",
    });
    expect(bundle.text).toContain("Bundle for project: notes-api");
    expect(bundle.text).toContain("snapshot: JWT auth pass");
    expect(bundle.text).toContain("decision: Keep SQLite local-first");

    const merged = await dispatchContinuityAction(store, {
      action: "merge",
      ids: ["snap-1", "dec-2"],
      type: "meta_snapshot",
      title: "Auth continuity merge",
    });
    expect(merged.text).toContain("meta-3");

    const deleted = await dispatchContinuityAction(store, {
      action: "delete",
      id: "meta-3",
    });
    expect(deleted.text).toContain("Deleted meta-3");
  });

  it("reports missing deletes without claiming success", async () => {
    const deleted = await dispatchContinuityAction(store, {
      action: "delete",
      id: "missing-1",
    });

    expect(deleted.text).toContain("Artifact not found: missing-1");
    expect(deleted.text).not.toContain("Deleted missing-1");
  });
});
