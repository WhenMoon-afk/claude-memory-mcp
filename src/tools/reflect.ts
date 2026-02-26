import type { ObservationStore } from "../observations.js";
import type { IdentityManager } from "../identity.js";
import type { ToolResult } from "../types.js";

interface ConceptInput {
  name: string;
  context: string;
}

interface ReflectInput {
  concepts: ConceptInput[];
  session_summary?: string | undefined;
  auto_promote?: boolean | undefined;
}

const PROMOTION_THRESHOLD = 5.0;

export async function handleReflect(
  input: ReflectInput,
  store: ObservationStore,
  identity: IdentityManager,
): Promise<ToolResult> {
  try {
    // Track which concepts are new vs updated
    const newConcepts: string[] = [];
    const updatedConcepts: string[] = [];
    for (const concept of input.concepts) {
      if (!concept.name.trim()) continue;
      const existing = store.get(concept.name);
      if (existing) {
        updatedConcepts.push(concept.name);
      } else {
        newConcepts.push(concept.name);
      }
      store.record(concept.name, concept.context);
    }
    // Prune stale single-observation noise (>30 days old)
    const pruned = store.pruneStale();
    store.save();

    if (input.session_summary?.trim()) {
      identity.appendSelfStateEntry(input.session_summary);
    }

    const promotable = store.getPromotable(PROMOTION_THRESHOLD);

    const recordedCount = newConcepts.length + updatedConcepts.length;
    const lines: string[] = [];

    // Summary line
    if (recordedCount === 0) {
      lines.push("Recorded 0 concepts.");
    } else {
      const parts: string[] = [];
      if (newConcepts.length > 0) parts.push(`${newConcepts.length} new`);
      if (updatedConcepts.length > 0)
        parts.push(`${updatedConcepts.length} updated`);
      lines.push(`Recorded ${parts.join(", ")} concept(s).`);

      // Show scores for recorded concepts only (skip empty names that were filtered)
      const recorded = [...newConcepts, ...updatedConcepts];
      lines.push(
        recorded
          .map((name) => `  ${name}: ${store.score(name).toFixed(1)}`)
          .join("\n"),
      );
    }

    if (input.auto_promote && promotable.length > 0) {
      const promoted: string[] = [];
      try {
        for (const p of promotable) {
          store.markPromoted(p.concept);
          identity.appendAnchor(p.concept);
          promoted.push(p.concept);
        }
        store.save();
      } catch (err) {
        // Roll back in-memory promoted flags for all concepts we touched
        for (const p of promotable) {
          const obs = store.get(p.concept);
          if (obs) obs.promoted = false;
        }
        throw err;
      }
      lines.push(`Promoted ${promoted.length}: ${promoted.join(", ")}`);
    } else if (promotable.length > 0) {
      lines.push(
        `Promotable (>=${PROMOTION_THRESHOLD.toFixed(0)}): ${promotable.map((p) => `${p.concept} (${p.score.toFixed(1)})`).join(", ")}`,
      );
    } else if (input.auto_promote) {
      lines.push(
        `No concepts crossed promotion threshold (${PROMOTION_THRESHOLD.toFixed(1)}). Concepts need more observations across multiple days to promote.`,
      );
    }

    if (pruned > 0) {
      lines.push(`Pruned ${pruned} stale concept(s).`);
    }

    if (input.session_summary?.trim()) {
      lines.push("Session summary saved to self-state.");
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error in reflect: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}
