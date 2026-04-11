import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { getSetupInstructions, runContinuityCli } from "./cli.js";
import { ContinuityStore } from "./continuity/store.js";

describe("cli", () => {
  let dir: string;
  let store: ContinuityStore;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cli-test-"));
    dbPath = join(dir, "continuity.db");
    store = new ContinuityStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("getSetupInstructions", () => {
    it("includes Claude Code setup command", () => {
      const output = getSetupInstructions();
      expect(output).toContain("claude mcp add");
      expect(output).toContain("continuity");
      expect(output).toContain("@whenmoon-afk/memory-mcp");
      expect(output).toContain("claude-memory-mcp");
    });

    it("includes Desktop config example", () => {
      const output = getSetupInstructions();
      expect(output).toContain("claude_desktop_config.json");
      expect(output).toContain("continuity");
    });

    it("includes npx command in Desktop config", () => {
      const output = getSetupInstructions();
      expect(output).toContain("npx");
    });

    it("leads with a generic stdio command for any MCP client", () => {
      const output = getSetupInstructions();
      expect(output).toContain("## Any MCP Client");
      expect(output).toContain("stdio command");
      expect(output).toContain("npx -y @whenmoon-afk/memory-mcp");
    });
  });

  describe("runContinuityCli", () => {
    it("supports save, list, search, get, and neighbors", async () => {
      const saved = await runContinuityCli(
        [
          "save",
          "--type",
          "snapshot",
          "--title",
          "JWT auth pass",
          "--summary",
          "Middleware works",
          "--project",
          "notes-api",
          "--next",
          "Document refresh flow",
        ],
        store,
      );
      expect(saved).toContain("snap-1");

      await runContinuityCli(
        [
          "save",
          "--type",
          "decision",
          "--title",
          "Keep SQLite local-first",
          "--summary",
          "SQLite keeps the continuity graph inspectable.",
          "--project",
          "notes-api",
        ],
        store,
      );

      expect(await runContinuityCli(["list"], store)).toContain("JWT auth pass");
      expect(await runContinuityCli(["search", "auth"], store)).toContain("snap-1");
      expect(await runContinuityCli(["get", "snap-1", "--full"], store)).toContain(
        "Document refresh flow",
      );
      expect(await runContinuityCli(["neighbors", "snap-1"], store)).toContain(
        "dec-2",
      );
    });

    it("accepts theme and entity flags for graph-aware saves", async () => {
      await runContinuityCli(
        [
          "save",
          "--type",
          "snapshot",
          "--title",
          "Token rollout handoff",
          "--summary",
          "Middleware is green and rollout is staged.",
          "--theme",
          "authentication",
          "--entity",
          "jwt",
        ],
        store,
      );
      await runContinuityCli(
        [
          "save",
          "--type",
          "decision",
          "--title",
          "JWT refresh policy",
          "--summary",
          "Refresh tokens rotate after re-authentication.",
          "--theme",
          "authentication",
          "--entity",
          "jwt",
        ],
        store,
      );

      expect(await runContinuityCli(["search", "jwt"], store)).toContain("snap-1");
      expect(await runContinuityCli(["search", "authentication"], store)).toContain(
        "snap-1",
      );
      expect(
        await runContinuityCli(["node", "theme:authentication"], store),
      ).toContain("Node: theme:authentication");
      expect(
        await runContinuityCli(["related", "snap-1", "--via", "nodes"], store),
      ).toContain("shared theme:authentication");
    });

    it("supports doctor, export, and import operational commands", async () => {
      await runContinuityCli(
        [
          "save",
          "--type",
          "snapshot",
          "--title",
          "JWT auth pass",
          "--summary",
          "Middleware works",
          "--project",
          "notes-api",
          "--theme",
          "authentication",
        ],
        store,
      );

      const doctor = await runContinuityCli(["doctor"], store);
      expect(doctor).toContain("schema_version");

      const exported = await runContinuityCli(["export"], store);
      expect(exported).toContain("\"format\": \"claude-memory-continuity-export\"");

      const exportPath = join(dir, "continuity-export.json");
      writeFileSync(exportPath, exported);

      const importedStore = new ContinuityStore(join(dir, "imported.db"));
      const imported = await runContinuityCli(
        ["import", "--file", exportPath],
        importedStore,
      );

      expect(imported).toContain("Imported 1 artifacts");
      expect(await runContinuityCli(["list"], importedStore)).toContain("snap-1");
      expect(readFileSync(exportPath, "utf8")).toContain("JWT auth pass");

      importedStore.close();
    });

    it("supports file backups and import dry runs", async () => {
      await runContinuityCli(
        [
          "save",
          "--type",
          "decision",
          "--title",
          "Publish contract",
          "--summary",
          "Document the continuity contract before release.",
        ],
        store,
      );
      const backupPath = join(dir, "backup.json");

      const backedUp = await runContinuityCli(
        ["backup", "--file", backupPath],
        store,
      );
      expect(backedUp).toContain("Backed up 1 artifacts");
      expect(readFileSync(backupPath, "utf8")).toContain(
        "\"format\": \"claude-memory-continuity-export\"",
      );

      const dryRun = await runContinuityCli(
        ["import", "--file", backupPath, "--dry-run"],
        store,
      );
      expect(dryRun).toContain("Validated 1 artifacts");
      expect(await runContinuityCli(["list"], store)).toContain("dec-1");
    });

    it("returns help for unknown commands", async () => {
      const output = await runContinuityCli(["wat"], store);
      expect(output).toContain("Commands:");
      expect(output).toContain("save");
      expect(output).toContain("merge");
      expect(output).toContain("doctor");
      expect(output).toContain("export");
      expect(output).toContain("backup");
      expect(output).toContain("import");
    });

    it("keeps the save graph surface to project, theme, and entity nodes", async () => {
      await runContinuityCli(
        [
          "save",
          "--type",
          "snapshot",
          "--title",
          "Simple local memory",
          "--summary",
          "Store the handoff as a local continuity artifact.",
          "--project",
          "notes-api",
          "--theme",
          "handoff",
          "--entity",
          "sqlite",
        ],
        store,
      );

      expect(store.getNode("project:notes-api")).not.toBeNull();
      expect(store.getNode("theme:handoff")).not.toBeNull();
      expect(store.getNode("entity:sqlite")).not.toBeNull();
    });
  });

  describe("CLI entry point argument parsing", () => {
    it("save subcommand captures multi-word title and summary from flags", () => {
      const output = execFileSync(
        "npx",
        [
          "tsx",
          "src/index.ts",
          "save",
          "--type",
          "snapshot",
          "--title",
          "JWT auth pass",
          "--summary",
          "Middleware works",
          "--project",
          "notes-api",
        ],
        {
          cwd: join(import.meta.dirname!, ".."),
          env: { ...process.env, CLAUDE_MEMORY_DB_PATH: dbPath },
          encoding: "utf-8",
          timeout: 10000,
        },
      );

      expect(output).toContain("Saved snap-1");
    });

    it("rejects deprecated identity subcommands", () => {
      const result = spawnSync(
        "npx",
        ["tsx", "src/index.ts", "reflect", "{}"],
        {
          cwd: join(import.meta.dirname!, ".."),
          env: { ...process.env, CLAUDE_MEMORY_DB_PATH: dbPath },
          encoding: "utf-8",
          timeout: 10000,
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "replaces self/reflect/anchor with the continuity surface",
      );
    });
  });
});
