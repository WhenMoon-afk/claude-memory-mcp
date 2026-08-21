import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addSourceRegistration,
  discoverAutomaticSourceRegistrations,
  loadSourceRegistrations,
  removeSourceRegistration,
  resolveSourceRegistrations,
} from "../src/source-config.js";
import { createFixture, type Fixture } from "./fixture.js";

const fixtures: Fixture[] = [];
afterEach(async () => {
  while (fixtures.length) await fixtures.pop()!.cleanup();
});

async function fixture(): Promise<Fixture> {
  const value = await createFixture();
  fixtures.push(value);
  return value;
}

describe("Mooncite optional source registry", () => {
  it("stores multiple roots per origin and removes only the selected root", async () => {
    const f = await fixture();
    const configPath = join(f.home, ".config", "mooncite", "sources.json");
    const firstClaudeRoot = join(f.home, "a-claude-projects");
    const secondClaudeRoot = join(f.home, "b-claude-projects");
    const codexRoot = join(f.home, "codex-sessions");
    await mkdir(firstClaudeRoot, { recursive: true });
    await mkdir(secondClaudeRoot, { recursive: true });
    await mkdir(codexRoot, { recursive: true });

    expect(loadSourceRegistrations(configPath)).toEqual([]);
    expect(addSourceRegistration(configPath, { origin: "claude-code", root: secondClaudeRoot })).toEqual({
      added: true,
      source: { origin: "claude-code", root: secondClaudeRoot },
    });
    expect(addSourceRegistration(configPath, { origin: "claude-code", root: secondClaudeRoot }).added).toBe(false);
    expect(addSourceRegistration(configPath, { origin: "claude-code", root: firstClaudeRoot }).added).toBe(true);
    expect(addSourceRegistration(configPath, { origin: "codex", root: codexRoot }).added).toBe(true);
    expect(loadSourceRegistrations(configPath)).toEqual([
      { origin: "claude-code", root: firstClaudeRoot },
      { origin: "claude-code", root: secondClaudeRoot },
      { origin: "codex", root: codexRoot },
    ]);
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    expect((await stat(join(f.home, ".config", "mooncite"))).mode & 0o777).toBe(0o700);

    await rm(firstClaudeRoot, { recursive: true });
    expect(loadSourceRegistrations(configPath)[0]).toEqual({ origin: "claude-code", root: firstClaudeRoot });
    expect(removeSourceRegistration(configPath, { origin: "claude-code", root: firstClaudeRoot })).toEqual({
      removed: true,
      origin: "claude-code",
      root: firstClaudeRoot,
    });
    expect(removeSourceRegistration(configPath, { origin: "claude-code", root: firstClaudeRoot })).toEqual({
      removed: false,
      origin: "claude-code",
      root: firstClaudeRoot,
    });
    expect(loadSourceRegistrations(configPath)).toEqual([
      { origin: "claude-code", root: secondClaudeRoot },
      { origin: "codex", root: codexRoot },
    ]);
  });

  it("keeps unrelated automatic roots and suppresses only an exact configured registration", async () => {
    const f = await fixture();
    const configPath = join(f.home, ".config", "mooncite", "sources.json");
    const env = { HOME: f.home };
    const automaticCodex = join(f.home, ".codex", "sessions");
    const customCodex = join(f.home, "custom-codex");
    expect(discoverAutomaticSourceRegistrations(env)).toEqual([
      { origin: "claude-code", root: join(f.home, ".claude", "projects"), discovery: "automatic" },
      { origin: "claude-code", root: join(f.home, ".config", "claude-sol", "projects"), discovery: "automatic" },
      { origin: "codex", root: automaticCodex, discovery: "automatic" },
      { origin: "chatgpt", root: join(f.home, "incoming", "chatgpt-share-archive"), discovery: "automatic" },
    ]);

    await mkdir(automaticCodex, { recursive: true });
    await mkdir(customCodex);
    addSourceRegistration(configPath, { origin: "codex", root: customCodex });
    addSourceRegistration(configPath, { origin: "codex", root: automaticCodex });
    expect(resolveSourceRegistrations(configPath, env)).toEqual([
      { origin: "codex", root: automaticCodex },
      { origin: "codex", root: customCodex },
      { origin: "claude-code", root: join(f.home, ".claude", "projects"), discovery: "automatic" },
      { origin: "claude-code", root: join(f.home, ".config", "claude-sol", "projects"), discovery: "automatic" },
      { origin: "chatgpt", root: join(f.home, "incoming", "chatgpt-share-archive"), discovery: "automatic" },
    ]);
    expect(resolveSourceRegistrations(configPath, { ...env, MOONCITE_AUTO_SOURCES: "0" })).toEqual([
      { origin: "codex", root: automaticCodex },
      { origin: "codex", root: customCodex },
    ]);
  });

  it("preserves a pre-existing temporary file when configuration publication collides", async () => {
    const f = await fixture();
    const configDirectory = join(f.home, ".config", "mooncite");
    const configPath = join(configDirectory, "sources.json");
    const temporaryPath = `${configPath}.${process.pid}.tmp`;
    const codexRoot = join(f.home, "codex-sessions");
    await mkdir(configDirectory, { recursive: true, mode: 0o700 });
    await mkdir(codexRoot);
    await writeFile(temporaryPath, "foreign temporary file", { mode: 0o600 });

    expect(() => addSourceRegistration(configPath, { origin: "codex", root: codexRoot })).toThrow(/exist/iu);
    expect(await readFile(temporaryPath, "utf8")).toBe("foreign temporary file");
    await expect(stat(configPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses duplicate, symbolic-link, and malformed source registrations", async () => {
    const f = await fixture();
    const configPath = join(f.home, ".config", "mooncite", "sources.json");
    const first = join(f.home, "first-claude");
    const second = join(f.home, "second-claude");
    const link = join(f.home, "linked-claude");
    await mkdir(first);
    await mkdir(second);
    await symlink(second, link, "dir");
    addSourceRegistration(configPath, { origin: "claude-code", root: first });
    expect(addSourceRegistration(configPath, { origin: "claude-code", root: second }).added).toBe(true);
    expect(() => addSourceRegistration(join(f.home, "other", "sources.json"), { origin: "codex", root: link })).toThrow(/symbolic-link/u);

    await writeFile(configPath, JSON.stringify({
      version: 1,
      sources: [
        { origin: "claude-code", root: first },
        { origin: "claude-code", root: first },
      ],
    }));
    expect(() => loadSourceRegistrations(configPath)).toThrow(/registered more than once/u);

    await writeFile(configPath, JSON.stringify({
      version: 1,
      sources: [
        { origin: "claude-code", root: first },
        { origin: "claude-code", root: `${first}/../first-claude` },
      ],
    }));
    expect(() => loadSourceRegistrations(configPath)).toThrow(/absolute normalized path/u);

    await writeFile(configPath, JSON.stringify({ version: 1, sources: [{ origin: "unknown", root: first }] }));
    expect(() => loadSourceRegistrations(configPath)).toThrow(/invalid/u);
  });
});
