import type { DispatchResult } from "../types.js";
import type { ContinuityStore } from "./store.js";
import type { CompactArtifactRow, RelatedArtifactRow } from "./types.js";
import type { ContinuityActionInput } from "./schema.js";

function formatCompactRows(rows: CompactArtifactRow[]): string {
  if (rows.length === 0) return "No continuity artifacts found.";

  return rows
    .map(
      (row) =>
        `${row.id} ${row.type} ${row.label} :: ${row.preview}${row.project_id ? ` [${row.project_id}]` : ""}`,
    )
    .join("\n");
}

function formatDetail(
  store: ContinuityStore,
  id: string,
  detail: "compact" | "standard" | "full",
): string {
  if (detail === "compact") {
    const compact = store.listArtifacts().find((row) => row.id === id);
    if (!compact) return `Artifact not found: ${id}`;
    return `${compact.id} ${compact.label} :: ${compact.preview}`;
  }

  if (detail === "full") {
    const artifact = store.getArtifact(id);
    if (!artifact) return `Artifact not found: ${id}`;
    return [
      `${artifact.type}: ${artifact.title}`,
      `Summary: ${artifact.summary}`,
      `Project: ${artifact.project_id ?? "global"}`,
      `Next: ${artifact.next_steps.join("; ") || "none"}`,
      `Body: ${JSON.stringify(artifact.body, null, 2)}`,
    ].join("\n");
  }

  const artifact = store.getArtifactDetail(id);
  if (!artifact) return `Artifact not found: ${id}`;
  return [
    `${artifact.type}: ${artifact.title}`,
    `Summary: ${artifact.summary}`,
    `Project: ${artifact.project_id ?? "global"}`,
    `Next: ${artifact.next_steps.join("; ") || "none"}`,
  ].join("\n");
}

function formatRelatedRows(rows: RelatedArtifactRow[]): string {
  if (rows.length === 0) return "No related artifacts found.";

  return rows
    .map(
      (row) =>
        `${row.id} ${row.type} ${row.label} :: ${row.preview}${row.project_id ? ` [${row.project_id}]` : ""} [${row.reasons.join(", ")}]`,
    )
    .join("\n");
}

function formatNodeDetail(store: ContinuityStore, id: string): string {
  const node = store.getNode(id);
  if (!node) return `Node not found: ${id}`;

  const linked = store.getNodeArtifacts(id);
  return [
    `Node: ${node.id}`,
    `Kind: ${node.kind}`,
    `Label: ${node.label}`,
    "Linked artifacts:",
    linked.length === 0 ? "No continuity artifacts found." : formatCompactRows(linked),
  ].join("\n");
}

export async function dispatchContinuityAction(
  store: ContinuityStore,
  input: ContinuityActionInput,
): Promise<DispatchResult> {
  switch (input.action) {
    case "help":
      return {
        text: "Actions: help, save, list, search, get, neighbors, node, related, doctor, bundle, merge, delete",
      };
    case "save": {
      const saved = store.saveArtifact({
        type: input.type,
        title: input.title,
        summary: input.summary,
        ...(input.project ? { project: input.project } : {}),
        ...(input.themes ? { themes: input.themes } : {}),
        ...(input.entities ? { entities: input.entities } : {}),
        ...(input.next_steps ? { next_steps: input.next_steps } : {}),
        ...(input.body ? { body: input.body } : {}),
      });
      return { text: `Saved ${saved.id} (${saved.label})` };
    }
    case "list":
      return { text: formatCompactRows(store.listArtifacts(input.project)) };
    case "search":
      return { text: formatCompactRows(store.searchArtifacts(input.query)) };
    case "get":
      return { text: formatDetail(store, input.id, input.detail ?? "standard") };
    case "neighbors":
      return { text: formatCompactRows(store.getNeighbors(input.id)) };
    case "node":
      return { text: formatNodeDetail(store, input.id) };
    case "related":
      return {
        text: formatRelatedRows(
          store.getRelatedArtifacts(input.id, input.via ?? "all"),
        ),
      };
    case "doctor":
      return { text: JSON.stringify(store.getDoctorReport(), null, 2) };
    case "bundle":
      return { text: store.buildBundleText(input.project) };
    case "merge": {
      const merged = store.mergeArtifacts(input.ids, input.type, input.title);
      return { text: `Saved ${merged.id} (${merged.label})` };
    }
    case "delete":
      return {
        text: store.deleteArtifact(input.id)
          ? `Deleted ${input.id}`
          : `Artifact not found: ${input.id}`,
      };
  }
}
