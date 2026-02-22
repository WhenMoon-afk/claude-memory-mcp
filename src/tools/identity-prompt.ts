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
  sections.push(
    "You have persistent identity managed by the memory-mcp server.",
  );
  sections.push("");

  if (
    soul.trim() &&
    !soul.includes("Core truths about who I am. This file is carved")
  ) {
    sections.push("## Soul");
    sections.push(soul);
    sections.push("");
  }

  if (
    selfState.trim() &&
    !selfState.includes("Current state. Updated each session.")
  ) {
    sections.push("## Self-State");
    sections.push(selfState);
    sections.push("");
  }

  if (
    anchors.trim() &&
    !anchors.includes("Patterns that have been observed consistently")
  ) {
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
