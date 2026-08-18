import { chmod, link, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createClientRegistrationAdapter,
  type ClientRegistrationAdapter,
  type CommandRunner,
  type RegistrationDiagnostics,
} from "../src/clients.js";
import { MOONCITE_PACKAGE_NAME, MOONCITE_STATE_MARKER_CONTENT, MOONCITE_STATE_MARKER_NAME, MOONCITE_VERSION } from "../src/identity.js";
import { MoonciteEngine } from "../src/engine.js";
import { disableMooncite, installMooncite, purgeMooncite, uninstallMooncite, type InstallationOptions } from "../src/lifecycle.js";
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
  await mkdir(join(root, "dist"), { recursive: true, mode: 0o700 });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: MOONCITE_PACKAGE_NAME, version: MOONCITE_VERSION }));
  await writeFile(join(root, "dist", "cli.js"), "#!/usr/bin/env node\n");
}

async function writeRegistrationOwners(options: InstallationOptions, clients: string[]): Promise<void> {
  await writeFile(
    join(options.installRoot, ".mooncite-registrations.json"),
    `${JSON.stringify({ version: 1, clients })}\n`,
    { mode: 0o600 },
  );
}

describe("Mooncite lifecycle public seam", () => {
  it("installs a verified stable package and uninstalls it while retaining source and derived state", async () => {
    const { fixture, options } = await setup();
    const registrations = fakeRegistrations();
    const installed = await installMooncite(options, async () => ({ code: 1, stdout: "", stderr: "unused" }), registrations, stagePackage);
    expect(installed).toMatchObject({ outcome: "installed", version: "4.0.3", status: { outcome: "ready" } });
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

  it("installs beneath an owner primary-group-writable XDG data directory", async () => {
    const { options } = await setup();
    await mkdir(options.dataHome, { recursive: true, mode: 0o700 });
    await chmod(options.dataHome, 0o770);
    const installed = await installMooncite(options, undefined, fakeRegistrations(), stagePackage);
    expect(installed.outcome).toBe("installed");
    expect((await stat(options.installRoot)).mode & 0o077).toBe(0);
  });

  it("uninstalls with unavailable clients that were never registered by Mooncite", async () => {
    const { options } = await setup();
    let piExact = false;
    let removedClients: readonly string[] = [];
    const diagnostics = () => ({
      pi: piExact ? "exact" as const : "missing" as const,
      omp: "unavailable" as const,
      codex: "unavailable" as const,
      claudeCode: "unavailable" as const,
    });
    const registrations: ClientRegistrationAdapter = {
      diagnose: async () => diagnostics(),
      configure: async () => {
        piExact = true;
        return diagnostics();
      },
      disable: async (clients) => {
        removedClients = clients ?? [];
        piExact = false;
        return diagnostics();
      },
    };
    await installMooncite(options, undefined, registrations, stagePackage);
    expect((await uninstallMooncite(options, undefined, registrations)).outcome).toBe("uninstalled");
    expect(removedClients).toEqual(["pi"]);
  });

  it("retains the stable package when registration cleanup cannot be verified", async () => {
    const { options } = await setup();
    await stagePackage(options.installRoot);
    await writeRegistrationOwners(options, ["pi", "omp", "codex", "claudeCode"]);
    const registrations: ClientRegistrationAdapter = {
      diagnose: async () => exactDiagnostics(),
      configure: async () => exactDiagnostics(),
      disable: async () => ({ pi: "missing", omp: "missing", codex: "unavailable", claudeCode: "missing" }),
    };
    await expect(uninstallMooncite(options, undefined, registrations)).rejects.toThrow(/cleanup is unverified/u);
    expect((await stat(options.packageRoot)).isDirectory()).toBe(true);
  });

  it("retains the package when any owned client registration state is unavailable", async () => {
    const { options } = await setup();
    await stagePackage(options.installRoot);
    await writeRegistrationOwners(options, ["codex"]);
    let disabled = false;
    const registrations: ClientRegistrationAdapter = {
      diagnose: async () => ({ pi: "missing", omp: "missing", codex: "unavailable", claudeCode: "missing" }),
      configure: async () => exactDiagnostics(),
      disable: async () => {
        disabled = true;
        return { pi: "missing", omp: "missing", codex: "missing", claudeCode: "missing" };
      },
    };
    await expect(uninstallMooncite(options, undefined, registrations)).rejects.toThrow(/state is unavailable/u);
    expect(disabled).toBe(false);
    expect((await stat(options.packageRoot)).isDirectory()).toBe(true);
  });

  it("retains owned registration state when disable cleanup is unverified", async () => {
    const { options } = await setup();
    await stagePackage(options.installRoot);
    await writeRegistrationOwners(options, ["codex"]);
    const registrations: ClientRegistrationAdapter = {
      diagnose: async () => ({ pi: "missing", omp: "missing", codex: "exact", claudeCode: "missing" }),
      configure: async () => exactDiagnostics(),
      disable: async () => ({ pi: "missing", omp: "missing", codex: "unavailable", claudeCode: "missing" }),
    };
    await expect(disableMooncite(options, undefined, registrations)).rejects.toThrow(/unverified cleanup/u);
    expect(JSON.parse(await readFile(join(options.installRoot, ".mooncite-registrations.json"), "utf8"))).toEqual({
      version: 1,
      clients: ["codex"],
    });
  });

  it("does not remove pre-existing exact registrations when a fresh install rolls back", async () => {
    const { options } = await setup();
    await mkdir(options.stateDir, { recursive: true, mode: 0o700 });
    await writeFile(join(options.stateDir, "unclaimed"), "not Mooncite");
    let disabled = false;
    const registrations: ClientRegistrationAdapter = {
      diagnose: async () => exactDiagnostics(),
      configure: async () => exactDiagnostics(),
      disable: async () => {
        disabled = true;
        return { pi: "missing", omp: "missing", codex: "missing", claudeCode: "missing" };
      },
    };
    await expect(installMooncite(options, undefined, registrations, stagePackage)).rejects.toThrow(/not marked as Mooncite-owned/u);
    expect(disabled).toBe(false);
    await expect(stat(options.installRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires confirmation and refuses unknown derived-state entries without deleting source", async () => {
    const { fixture, options } = await setup();
    await mkdir(options.stateDir, { recursive: true, mode: 0o700 });
    await writeFile(join(options.stateDir, MOONCITE_STATE_MARKER_NAME), MOONCITE_STATE_MARKER_CONTENT, { mode: 0o600 });
    await writeFile(join(options.stateDir, "index.sqlite"), "derived", { mode: 0o600 });
    expect(await purgeMooncite(options, false)).toMatchObject({ outcome: "confirmation_required" });
    await writeFile(join(options.stateDir, "notes.txt"), "not owned");
    await expect(purgeMooncite(options, true)).rejects.toThrow("unknown Mooncite state entry");
    expect(await digest(fixture.source)).toBe(fixture.sourceDigest);
  });

  it("refuses unmarked and hard-linked derived state without touching the linked file", async () => {
    const { fixture, options } = await setup();
    await mkdir(options.stateDir, { recursive: true, mode: 0o700 });
    await writeFile(join(options.stateDir, "index.sqlite"), "unclaimed", { mode: 0o600 });
    await expect(purgeMooncite(options, true)).rejects.toThrow(/state marker/u);
    await writeFile(join(options.stateDir, MOONCITE_STATE_MARKER_NAME), MOONCITE_STATE_MARKER_CONTENT, { mode: 0o600 });
    const external = join(fixture.home, "external.sqlite");
    await writeFile(external, "external", { mode: 0o600 });
    await writeFile(join(options.stateDir, "index.sqlite"), "", { mode: 0o600 });
    await link(external, join(options.stateDir, "index.sqlite-wal"));
    await expect(purgeMooncite(options, true)).rejects.toThrow(/non-owned Mooncite state entry/u);
    expect(await readFile(external, "utf8")).toBe("external");
  });

  it("refuses purge while a live engine owns the derived index", async () => {
    const { options } = await setup();
    const engine = new MoonciteEngine({ sessionsRoot: options.sessionsRoot, stateDir: options.stateDir });
    try {
      await expect(purgeMooncite(options, true)).rejects.toThrow(/live engine/u);
    } finally {
      engine.close();
    }
    expect(await purgeMooncite(options, false)).toMatchObject({ outcome: "confirmation_required" });
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
          ? { code: 0, stdout: `mooncite:\n  Scope: User config (available in all your projects)\n  Status: Connected\n  Type: stdio\n  Command: ${options.nodePath}\n  Args: ${options.cliPath} serve\n  Environment:\n`, stderr: "" }
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

  it("rejects a successful no-op client removal", async () => {
    const { options } = await setup();
    const runner: CommandRunner = async (command, args) => {
      if (command === "pi" && args[0] === "--version") return { code: 0, stdout: "1.0.0\n", stderr: "" };
      if (command === "omp" && args[0] === "plugin" && args[1] === "list") return { code: 0, stdout: "{}", stderr: "" };
      if (command === "codex" && args[1] === "get") return { code: 1, stdout: "", stderr: "No MCP server found" };
      if (command === "claude" && args[1] === "get") {
        return {
          code: 0,
          stdout: `mooncite:\n  Scope: User config\n  Type: stdio\n  Command: ${options.nodePath}\n  Args: ${options.cliPath} serve\n`,
          stderr: "",
        };
      }
      if (command === "claude" && args[1] === "remove") return { code: 0, stdout: "", stderr: "" };
      return { code: 1, stdout: "", stderr: "unavailable" };
    };
    const adapter = createClientRegistrationAdapter(options, runner);
    await expect(adapter.disable()).rejects.toThrow(/removal could not be verified/u);
  });

  it("refuses to remove a conflicting Claude server whose output only contains Mooncite command substrings", async () => {
    const { options } = await setup();
    let removed = false;
    const runner: CommandRunner = async (command, args) => {
      if (command === "pi" && args[0] === "--version") return { code: 0, stdout: "1.0.0\n", stderr: "" };
      if (command === "omp" && args[0] === "plugin" && args[1] === "list") return { code: 0, stdout: "{}", stderr: "" };
      if (command === "codex" && args[1] === "get") return { code: 1, stdout: "", stderr: "No MCP server found" };
      if (command === "claude" && args[1] === "get") {
        return {
          code: 0,
          stdout: `mooncite:\n  Scope: Local config\n  Type: http\n  Command: echo\n  Args: ${options.nodePath} ${options.cliPath} serve\n`,
          stderr: "",
        };
      }
      if (command === "claude" && args[1] === "remove") {
        removed = true;
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "unavailable" };
    };
    const adapter = createClientRegistrationAdapter(options, runner);
    expect((await adapter.diagnose()).claudeCode).toBe("conflict");
    await expect(adapter.disable()).rejects.toThrow(/conflicting claudeCode registration/u);
    expect(removed).toBe(false);
  });
});
