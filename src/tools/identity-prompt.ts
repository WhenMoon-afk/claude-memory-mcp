import type { ObservationStore } from "../observations.js";
import type { IdentityManager } from "../identity.js";

interface PromptMessage {
  role: "user";
  content: { type: "text"; text: string };
}

interface PromptResult {
  [key: string]: unknown;
  messages: PromptMessage[];
}

export function generateIdentityPrompt(
  store: ObservationStore,
  identity: IdentityManager,
): PromptResult {
  const { soul, selfState, anchors } = identity.readAll();
  const observations = store.all();
  const conceptNames = Object.keys(observations);

  const sections: string[] = [];

  sections.push("# Identity Context");
  sections.push("");
  sections.push("You have persistent identity managed by the identity server.");
  sections.push("");

  if (
    soul.trim() &&
    !soul.includes("Core truths about who I am. This file is carved")
  ) {
    sections.push("## Soul");
    sections.push(soul);
    sections.push("");
  }

  // Show self-state if it has dated entries (## YYYY-MM-DD headers from appendSelfStateEntry)
  if (selfState.trim() && /^## \d{4}-\d{2}-\d{2}/m.test(selfState)) {
    sections.push("## Self-State");
    sections.push(selfState);
    sections.push("");
  }

  // Show anchors if they contain actual entries (lines starting with "- ")
  // The template header is always present, so check for content beyond it
  if (anchors.trim() && /^- .+/m.test(anchors)) {
    sections.push("## Identity Anchors");
    sections.push(anchors);
    sections.push("");
  }

  if (conceptNames.length > 0) {
    const sorted = conceptNames
      .map((name) => ({ name, score: store.score(name) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    sections.push("## Observed Patterns");
    for (const { name, score } of sorted) {
      sections.push(`- ${name} (score: ${score.toFixed(1)})`);
    }
    sections.push("");
  }

  sections.push("## Instructions");
  sections.push("");
  sections.push(
    "- At session end, use the `reflect` tool to record concepts observed during this session.",
  );
  sections.push(
    "- Use `anchor` to write important identity insights to soul, self-state, or anchors.",
  );
  sections.push(
    "- Use `self` to query your current identity state at any time.",
  );

  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: sections.join("\n"),
        },
      },
    ],
  };
}
