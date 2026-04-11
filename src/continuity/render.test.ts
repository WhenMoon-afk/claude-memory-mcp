import { describe, expect, it } from "vitest";
import { renderBridge, renderBundle, renderPrompt, renderRaw } from "./render.js";
import type { CompactArtifactRow, ContinuityArtifact } from "./types.js";

const artifact: ContinuityArtifact = {
  seq: 1,
  id: "snap-1",
  type: "snapshot",
  title: "JWT auth handoff",
  label: "JWT auth handoff",
  preview: "JWT middleware is green and password reset is next.",
  summary: "JWT middleware is green and password reset is next.",
  body: { status: "green" },
  project_id: "project:notes-api",
  next_steps: ["Add password reset", "Document refresh tokens"],
  source_refs: [],
  created_at: "2026-04-10T00:00:00.000Z",
  updated_at: "2026-04-10T00:00:00.000Z",
};

const nearby: CompactArtifactRow[] = [
  {
    id: "dec-2",
    type: "decision",
    label: "Use SQLite for cont…",
    preview: "SQLite keeps the storage local-first and inspectable.",
    project_id: "project:notes-api",
  },
];

describe("continuity renders", () => {
  it("renders raw continuity text", () => {
    expect(renderRaw(artifact)).toContain("snapshot: JWT auth handoff");
    expect(renderRaw(artifact)).toContain(artifact.summary);
  });

  it("renders prompt continuity text", () => {
    const prompt = renderPrompt(artifact);
    expect(prompt).toContain("Resume from JWT auth handoff.");
    expect(prompt).toContain("Add password reset");
  });

  it("renders bridge continuity text with nearby artifacts", () => {
    const bridge = renderBridge(artifact, nearby);
    expect(bridge).toContain("Restore continuity from JWT auth handoff.");
    expect(bridge).toContain("Nearby: dec-2 Use SQLite for cont…");
  });

  it("renders bundle continuity text", () => {
    const bundle = renderBundle(artifact, nearby);
    expect(bundle).toContain("Bundle: JWT auth handoff");
    expect(bundle).toContain("Nearby artifacts: 1");
  });
});
