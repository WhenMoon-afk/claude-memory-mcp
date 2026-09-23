import { afterEach, describe, expect, it, vi } from "vitest";
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
