import { describe, expect, it } from "vitest";
import { compactLabel, compactPreview } from "./text.js";

describe("continuity text compaction", () => {
  it("caps labels at 20 characters", () => {
    expect(compactLabel("Implement long auth continuity handoff")).toHaveLength(
      20,
    );
  });

  it("caps previews at 80 characters", () => {
    expect(compactPreview("x".repeat(160))).toHaveLength(80);
  });

  it("normalizes repeated whitespace before truncating", () => {
    expect(compactLabel("  auth    handoff   notes  ")).toBe("auth handoff notes");
  });
});
