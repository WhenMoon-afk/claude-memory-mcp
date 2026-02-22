import type { IdentityManager } from "../identity.js";
import type { ToolResult } from "../types.js";

interface AnchorInput {
  target: "soul" | "self-state" | "anchors";
  content: string;
}

export async function handleAnchor(
  input: AnchorInput,
  identity: IdentityManager,
): Promise<ToolResult> {
  try {
    switch (input.target) {
      case "soul":
        identity.writeSoul(input.content);
        return { content: [{ type: "text", text: "Updated soul.md" }] };

      case "self-state":
        identity.writeSelfState(input.content);
        return { content: [{ type: "text", text: "Updated self-state.md" }] };

      case "anchors":
        identity.appendAnchor(input.content);
        return {
          content: [
            { type: "text", text: "Appended to identity-anchors.md (anchors)" },
          ],
        };

      default:
        return {
          content: [
            {
              type: "text",
              text: `Invalid target: ${input.target as string}. Use soul, self-state, or anchors.`,
            },
          ],
          isError: true,
        };
    }
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error in anchor: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}
