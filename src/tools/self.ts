import type { ObservationStore } from "../observations.js";
import type { IdentityManager } from "../identity.js";
import type { ToolResult } from "../types.js";

export async function handleSelf(
  _input: Record<string, never>,
  store: ObservationStore,
  identity: IdentityManager,
): Promise<ToolResult> {
  try {
    const { soul, selfState, anchors } = identity.readAll();

    const sections: string[] = [];

    if (soul) {
      sections.push(soul);
    }

    if (selfState) {
      sections.push(selfState);
    }

    if (anchors) {
      sections.push(anchors);
    }

    // Add observation stats — show top 10 by score
    const allObs = store.all();
    const entries = Object.entries(allObs);
    if (entries.length > 0) {
      const scored = entries
        .map(([concept]) => ({ concept, score: store.score(concept) }))
        .sort((a, b) => b.score - a.score);

      const TOP_N = 10;
      const shown = scored.slice(0, TOP_N);
      const remaining = scored.length - shown.length;

      sections.push("## Observed Patterns\n");
      for (const { concept, score } of shown) {
        const obs = allObs[concept]!;
        sections.push(
          `- **${concept}** (score: ${score.toFixed(1)}, recalls: ${obs.total_recalls}, days: ${obs.distinct_days})`,
        );
      }
      if (remaining > 0) {
        sections.push(`\n_...and ${remaining} more patterns below threshold_`);
      }
    }

    return {
      content: [{ type: "text", text: sections.join("\n\n") }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error in self: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}
