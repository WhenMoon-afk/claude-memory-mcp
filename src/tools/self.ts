import type { ObservationStore } from '../observations.js';
import type { IdentityManager } from '../identity.js';
import type { ToolResult } from '../types.js';

export async function handleSelf(
  _input: Record<string, never>,
  store: ObservationStore,
  identity: IdentityManager
): Promise<ToolResult> {
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

  // Add observation stats
  const allObs = store.all();
  const entries = Object.entries(allObs);
  if (entries.length > 0) {
    const scored = entries
      .map(([concept]) => ({ concept, score: store.score(concept) }))
      .sort((a, b) => b.score - a.score);

    sections.push('## Observed Patterns\n');
    for (const { concept, score } of scored) {
      const obs = allObs[concept]!;
      sections.push(
        `- **${concept}** (score: ${score.toFixed(1)}, recalls: ${obs.total_recalls}, days: ${obs.distinct_days})`
      );
    }
  }

  return {
    content: [{ type: 'text', text: sections.join('\n\n') }],
  };
}
