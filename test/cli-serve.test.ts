import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isDirectCliExecution } from "../src/cli.js";
import { createFixture, type Fixture } from "./fixture.js";

const diagnose = vi.fn(async () => ({
  pi: "exact" as const,
  omp: "exact" as const,
  codex: "exact" as const,
  claudeCode: "exact" as const,
}));

vi.mock("@modelcontextprotocol/server/stdio", () => ({
  serveStdio: (factory: () => unknown) => {
    factory();
    return { close: async () => undefined };
  },
}));

const fixtures: Fixture[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  while (fixtures.length) await fixtures.pop()!.cleanup();
});

describe("CLI entry", () => {
  it("treats a symlink to the CLI file as direct execution", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mooncite-cli-link-"));
    const target = join(directory, "cli.js");
    const link = join(directory, "mooncite");
    await writeFile(target, "#!/usr/bin/env node\n", { mode: 0o600 });
    await symlink(target, link);
    expect(isDirectCliExecution(link, pathToFileURL(target).href)).toBe(true);
    expect(isDirectCliExecution(join(directory, "missing.js"), pathToFileURL(target).href)).toBe(false);
  });
});

describe("mooncite serve", () => {
  it("does not probe client CLIs when the MCP server starts", async () => {
    const fixture = await createFixture();
    fixtures.push(fixture);
    const { runServeCommand } = await import("../src/cli.js");
    const stdin = process.stdin;
    const end = Promise.resolve();
    const once = stdin.once.bind(stdin) as (event: string, listener: (...args: unknown[]) => void) => unknown;
    vi.spyOn(stdin, "once").mockImplementation((event: string, listener: (...args: unknown[]) => void) => {
      if (event === "end" || event === "close") queueMicrotask(() => (listener as () => void)());
      else once(event, listener);
      return stdin;
    });
    await runServeCommand({
      args: ["serve"],
      engineOptions: { sessionsRoot: fixture.sessionsRoot, stateDir: fixture.stateDir },
      installation: {
        home: fixture.home,
        piAgentDir: fixture.sessionsRoot,
        sessionsRoot: fixture.sessionsRoot,
        stateDir: fixture.stateDir,
        dataHome: fixture.home,
        installRoot: fixture.home,
        sourcePackageRoot: fixture.home,
        packageRoot: fixture.home,
        cliPath: "cli.js",
        nodePath: process.execPath,
      },
      registrations: {
        diagnose,
        configure: async () => diagnose(),
        disable: async () => diagnose(),
      },
    });
    expect(diagnose).not.toHaveBeenCalled();
    await end;
  });
});
