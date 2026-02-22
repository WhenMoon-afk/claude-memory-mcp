import { describe, it, expect } from "vitest";
import { getSetupInstructions } from "./cli.js";

describe("cli", () => {
  describe("getSetupInstructions", () => {
    it("includes Claude Code setup command", () => {
      const output = getSetupInstructions();
      expect(output).toContain("claude mcp add");
      expect(output).toContain("@whenmoon-afk/memory-mcp");
    });

    it("includes Desktop config example", () => {
      const output = getSetupInstructions();
      expect(output).toContain("claude_desktop_config.json");
      expect(output).toContain("memory-mcp");
    });

    it("includes npx command in Desktop config", () => {
      const output = getSetupInstructions();
      expect(output).toContain("npx");
    });
  });
});
