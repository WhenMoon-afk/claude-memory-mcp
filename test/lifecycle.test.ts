import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createClientRegistrationAdapter,
  type ClientRegistrationAdapter,
  type CommandRunner,
  type RegistrationDiagnostics,
} from "../src/clients.js";
import { MOONCITE_PACKAGE_NAME, MOONCITE_VERSION } from "../src/identity.js";
import { installMooncite, purgeMooncite, uninstallMooncite, type InstallationOptions } from "../src/lifecycle.js";
import { createFixture, digest, type Fixture } from "./fixture.js";

const fixtures: Fixture[] = [];
afterEach(async () => {
  while (fixtures.length) await fixtures.pop()!.cleanup();
});

async function setup(): Promise<{ fixture: Fixture; options: InstallationOptions }> {
  const fixture = await createFixture();
  fixtures.push(fixture);
  const dataHome = join(fixture.home, ".local", "share");
  const installRoot = join(dataHome, "mooncite");
  const packageRoot = join(installRoot, "node_modules", "@whenmoon-afk", "mooncite");
  return {
    fixture,
    options: {
      home: fixture.home,
      piAgentDir: join(fixture.home, ".pi", "agent"),
      sessionsRoot: fixture.sessionsRoot,
      stateDir: fixture.stateDir,
      dataHome,
      installRoot,
      sourcePackageRoot: "/unused/bootstrap",
      packageRoot,
      cliPath: join(packageRoot, "dist", "cli.js"),
      nodePath: process.execPath,
    },
  };
}

function exactDiagnostics(): RegistrationDiagnostics {
  return { pi: "exact", omp: "exact", codex: "exact", claudeCode: "exact" };
}

function fakeRegistrations(): ClientRegistrationAdapter {
  return {
    diagnose: async () => exactDiagnostics(),
    configure: async () => exactDiagnostics(),
    disable: async () => ({ pi: "missing", omp: "missing", codex: "missing", claudeCode: "missing" }),
  };
}

async function stagePackage(targetRoot: string): Promise<void> {
  const root = join(targetRoot, "node_modules", "@whenmoon-afk", "mooncite");
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: MOONCITE_PACKAGE_NAME, version: MOONCITE_VERSION }));
  await writeFile(join(root, "dist", "cli.js"), "#!/usr/bin/env node\n");
}

describe("Mooncite lifecycle public seam", () => {
  it("installs a verified stable package and uninstalls it while retaining source and derived state", async () => {
    const { fixture, options } = await setup();
    const registrations = fakeRegistrations();
    const installed = await installMooncite(options, async () => ({ code: 1, stdout: "", stderr: "unused" }), registrations, stagePackage);
    expect(installed).toMatchObject({ outcome: "installed", version: "4.0.0", status: { outcome: "ready" } });
    expect(JSON.parse(await readFile(join(options.packageRoot, "package.json"), "utf8"))).toEqual({ name: MOONCITE_PACKAGE_NAME, version: MOONCITE_VERSION });
    const indexBefore = await stat(join(options.stateDir, "index.sqlite"));
    expect(indexBefore.isFile()).toBe(true);
    expect(await digest(fixture.source)).toBe(fixture.sourceDigest);

    const removed = await uninstallMooncite(options, undefined, registrations);
    expect(removed.outcome).toBe("uninstalled");
    await expect(stat(options.installRoot)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(join(options.stateDir, "index.sqlite"))).isFile()).toBe(true);
    expect(await digest(fixture.source)).toBe(fixture.sourceDigest);
  });

  it("requires confirmation and refuses unknown derived-state entries without deleting source", async () => {
    const { fixture, options } = await setup();
    await mkdir(options.stateDir, { recursive: true });
    await writeFile(join(options.stateDir, "index.sqlite"), "derived");
    expect(await purgeMooncite(options, false)).toMatchObject({ outcome: "confirmation_required" });
    await writeFile(join(options.stateDir, "notes.txt"), "not owned");
    await expect(purgeMooncite(options, true)).rejects.toThrow("unknown Mooncite state entry");
    expect(await digest(fixture.source)).toBe(fixture.sourceDigest);
  });

  it("configures and removes the same local server for Pi, OMP, Codex, and Claude Code", async () => {
    const { options } = await setup();
    await mkdir(options.piAgentDir, { recursive: true });
    await writeFile(join(options.piAgentDir, "settings.json"), JSON.stringify({ packages: [] }));
    const enabled = { pi: false, omp: false, codex: false, claudeCode: false };
    const runner: CommandRunner = async (command, args) => {
      if (command === "pi" && args[0] === "--version") return { code: 0, stdout: "1.0.0\n", stderr: "" };
      if (command === "pi" && args[0] === "install") {
        enabled.pi = true;
        await writeFile(join(options.piAgentDir, "settings.json"), JSON.stringify({ packages: [options.packageRoot] }));
        return { code: 0, stdout: "", stderr: "" };
      }
      if (command === "pi" && args[0] === "remove") {
        enabled.pi = false;
        await writeFile(join(options.piAgentDir, "settings.json"), JSON.stringify({ packages: [] }));
        return { code: 0, stdout: "", stderr: "" };
      }
      if (command === "omp" && args[0] === "plugin" && args[1] === "list") {
        return { code: 0, stdout: JSON.stringify({ local: enabled.omp ? [{ name: MOONCITE_PACKAGE_NAME, path: options.packageRoot }] : [] }), stderr: "" };
      }
      if (command === "omp" && args[1] === "link") { enabled.omp = true; return { code: 0, stdout: "", stderr: "" }; }
      if (command === "omp" && args[1] === "uninstall") { enabled.omp = false; return { code: 0, stdout: "", stderr: "" }; }
      if (command === "codex" && args[1] === "get") {
        return enabled.codex
          ? { code: 0, stdout: JSON.stringify({ name: "mooncite", transport: { type: "stdio", command: options.nodePath, args: [options.cliPath, "serve"] } }), stderr: "" }
          : { code: 1, stdout: "", stderr: "No MCP server named 'mooncite' found" };
      }
      if (command === "codex" && args[1] === "add") { enabled.codex = true; return { code: 0, stdout: "", stderr: "" }; }
      if (command === "codex" && args[1] === "remove") { enabled.codex = false; return { code: 0, stdout: "", stderr: "" }; }
      if (command === "claude" && args[1] === "get") {
        return enabled.claudeCode
          ? { code: 0, stdout: `${options.nodePath} ${options.cliPath} serve`, stderr: "" }
          : { code: 1, stdout: "", stderr: "No MCP server found" };
      }
      if (command === "claude" && args[1] === "add") { enabled.claudeCode = true; return { code: 0, stdout: "", stderr: "" }; }
      if (command === "claude" && args[1] === "remove") { enabled.claudeCode = false; return { code: 0, stdout: "", stderr: "" }; }
      return { code: 1, stdout: "", stderr: `unexpected ${command} ${args.join(" ")}` };
    };
    const adapter = createClientRegistrationAdapter(options, runner);
    expect(await adapter.configure()).toEqual(exactDiagnostics());
    expect(await adapter.disable()).toEqual({ pi: "missing", omp: "missing", codex: "missing", claudeCode: "missing" });
  });
});
