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
  for (const concept of input.concepts) {
    store.record(concept.name, concept.context);
  }
  store.save();

  if (input.session_summary) {
    identity.writeSelfState(`# Self-State\n\n${input.session_summary}`);
  }

  const promotable = store.getPromotable(PROMOTION_THRESHOLD);

  const lines: string[] = [];
  lines.push(`${input.concepts.length} concepts recorded.`);

  if (input.auto_promote && promotable.length > 0) {
    for (const p of promotable) {
      store.markPromoted(p.concept);
      identity.appendAnchor(p.concept);
    }
    store.save();
    lines.push(
      `${promotable.length} concept(s) promoted: ${promotable.map((p) => p.concept).join(", ")}`,
    );
  } else if (promotable.length > 0) {
    lines.push(
      `${promotable.length} promotable concept(s): ${promotable.map((p) => `${p.concept} (score: ${p.score.toFixed(1)})`).join(", ")}`,
    );
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}
