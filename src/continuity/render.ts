import type { CompactArtifactRow, ContinuityArtifact } from "./types.js";

export type RenderMode = "raw" | "prompt" | "bridge" | "bundle";

export function renderRaw(artifact: ContinuityArtifact): string {
  return [`${artifact.type}: ${artifact.title}`, "", artifact.summary].join("\n");
}

export function renderPrompt(artifact: ContinuityArtifact): string {
  return [
    `Resume from ${artifact.title}.`,
    `Summary: ${artifact.summary}`,
    `Next: ${artifact.next_steps.join("; ") || "Review nearby nodes before proceeding."}`,
  ].join("\n");
}

export function renderBridge(
  artifact: ContinuityArtifact,
  nearby: CompactArtifactRow[],
): string {
  return [
    `Restore continuity from ${artifact.title}.`,
    `Project: ${artifact.project_id ?? "global"}`,
    `Summary: ${artifact.summary}`,
    `Nearby: ${nearby.map((row) => `${row.id} ${row.label}`).join(", ") || "none"}`,
  ].join("\n");
}

export function renderBundle(
  artifact: ContinuityArtifact,
  nearby: CompactArtifactRow[],
): string {
  return [
    `Bundle: ${artifact.title}`,
    `Project: ${artifact.project_id ?? "global"}`,
    `Summary: ${artifact.summary}`,
    `Next: ${artifact.next_steps.join("; ") || "none"}`,
    `Nearby artifacts: ${nearby.length}`,
  ].join("\n");
}
