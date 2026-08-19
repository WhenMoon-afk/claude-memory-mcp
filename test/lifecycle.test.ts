import { chmod, link, lstat, mkdir, readFile, readlink, stat, symlink, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
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
    expect(installed).toMatchObject({ outcome: "installed", version: MOONCITE_VERSION, status: { outcome: "ready" } });
    expect(JSON.parse(await readFile(join(options.packageRoot, "package.json"), "utf8"))).toEqual({ name: MOONCITE_PACKAGE_NAME, version: MOONCITE_VERSION });
    const launcherPath = join(fixture.home, ".local", "bin", "mooncite");
    expect(await readlink(launcherPath)).toBe(options.cliPath);
    const indexBefore = await stat(join(options.stateDir, "index.sqlite"));
    expect(indexBefore.isFile()).toBe(true);
    expect(await digest(fixture.source)).toBe(fixture.sourceDigest);

    const removed = await uninstallMooncite(options, undefined, registrations);
    expect(removed.outcome).toBe("uninstalled");
    await expect(stat(options.installRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(launcherPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(join(options.stateDir, "index.sqlite"))).isFile()).toBe(true);
    expect(await digest(fixture.source)).toBe(fixture.sourceDigest);
  });

  it("refuses to replace an existing local command", async () => {
    const { fixture, options } = await setup();
    const launcherPath = join(fixture.home, ".local", "bin", "mooncite");
    await mkdir(join(fixture.home, ".local", "bin"), { recursive: true, mode: 0o700 });
    await writeFile(launcherPath, "owner command\n", { mode: 0o700 });

    await expect(installMooncite(options, undefined, fakeRegistrations(), stagePackage))
      .rejects.toThrow(/existing non-Mooncite command/u);
    expect(await readFile(launcherPath, "utf8")).toBe("owner command\n");
    await expect(stat(options.installRoot)).rejects.toMatchObject({ code: "ENOENT" });
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

  it("retains ownership when a pre-existing exact client becomes unavailable during install", async () => {
    const { options } = await setup();
    let diagnosed = false;
    let disabled = false;
    const unavailable = {
      pi: "unavailable" as const,
      omp: "unavailable" as const,
      codex: "unavailable" as const,
      claudeCode: "unavailable" as const,
    };
    const registrations: ClientRegistrationAdapter = {
      diagnose: async () => {
        if (diagnosed) return unavailable;
        diagnosed = true;
        return { ...unavailable, pi: "exact" };
      },
      configure: async () => unavailable,
      disable: async () => {
        disabled = true;
        return unavailable;
      },
    };

    await installMooncite(options, undefined, registrations, stagePackage);
    expect(JSON.parse(await readFile(join(options.installRoot, ".mooncite-registrations.json"), "utf8"))).toEqual({
      version: 1,
      clients: ["pi"],
    });
    await expect(uninstallMooncite(options, undefined, registrations)).rejects.toThrow(/state is unavailable/u);
    expect(disabled).toBe(false);
    expect((await stat(options.packageRoot)).isDirectory()).toBe(true);
  });

  it("refuses to guess missing registration ownership while clients are unavailable", async () => {
    const { fixture, options } = await setup();
    await stagePackage(options.installRoot);
    let configured = false;
    const unavailable: RegistrationDiagnostics = {
      pi: "unavailable",
      omp: "unavailable",
      codex: "unavailable",
      claudeCode: "unavailable",
    };
    const registrations: ClientRegistrationAdapter = {
      diagnose: async () => unavailable,
      configure: async () => {
        configured = true;
        return unavailable;
      },
      disable: async () => unavailable,
    };

    await expect(installMooncite(options, undefined, registrations, stagePackage)).rejects.toThrow(/ownership cannot be repaired/u);
    expect(configured).toBe(false);
    await expect(lstat(join(fixture.home, ".local", "bin", "mooncite"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(options.packageRoot)).isDirectory()).toBe(true);
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

  it("rolls back registrations when a fresh install cannot persist their ownership", async () => {
    const { fixture, options } = await setup();
    let piRegistered = false;
    let disabledClients: readonly string[] = [];
    const diagnostics = (): RegistrationDiagnostics => ({
      pi: piRegistered ? "exact" : "missing",
      omp: "unavailable",
      codex: "unavailable",
      claudeCode: "unavailable",
    });
    const registrations: ClientRegistrationAdapter = {
      diagnose: async () => diagnostics(),
      configure: async () => {
        piRegistered = true;
        await mkdir(join(options.installRoot, ".mooncite-registrations.json"));
        return diagnostics();
      },
      disable: async (clients) => {
        disabledClients = clients ?? [];
        piRegistered = false;
        return diagnostics();
      },
    };

    await expect(installMooncite(options, undefined, registrations, stagePackage)).rejects.toThrow(/state entry/u);
    expect(disabledClients).toEqual(["pi"]);
    expect(piRegistered).toBe(false);
    await expect(lstat(join(fixture.home, ".local", "bin", "mooncite"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(options.installRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to remove a package that an unowned conflicting registration may target", async () => {
    const { options } = await setup();
    await stagePackage(options.installRoot);
    await writeRegistrationOwners(options, []);
    let disabled = false;
    const registrations: ClientRegistrationAdapter = {
      diagnose: async () => ({ pi: "missing", omp: "missing", codex: "conflict", claudeCode: "missing" }),
      configure: async () => exactDiagnostics(),
      disable: async () => {
        disabled = true;
        return { pi: "missing", omp: "missing", codex: "missing", claudeCode: "missing" };
      },
    };

    await expect(uninstallMooncite(options, undefined, registrations)).rejects.toThrow(/unowned client registration/u);
    expect(disabled).toBe(false);
    expect((await stat(options.packageRoot)).isDirectory()).toBe(true);
  });

  it("rechecks unowned registrations after owned client cleanup", async () => {
    const { options } = await setup();
    await stagePackage(options.installRoot);
    await writeRegistrationOwners(options, ["pi"]);
    const registrations: ClientRegistrationAdapter = {
      diagnose: async () => ({ pi: "exact", omp: "missing", codex: "missing", claudeCode: "missing" }),
      configure: async () => exactDiagnostics(),
      disable: async () => ({ pi: "missing", omp: "missing", codex: "exact", claudeCode: "missing" }),
    };

    await expect(uninstallMooncite(options, undefined, registrations)).rejects.toThrow(/unowned client registration/u);
    expect((await stat(options.packageRoot)).isDirectory()).toBe(true);
  });

  it("refuses purge when the filesystem root contains derived state", async () => {
    const { options } = await setup();
    await expect(purgeMooncite({ ...options, sessionsRoot: "/" }, true)).rejects.toThrow(/overlapping/u);
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

  it("refuses to purge a source root that aliases the derived-state directory", async () => {
    const { fixture, options } = await setup();
    const engine = new MoonciteEngine({ sessionsRoot: options.sessionsRoot, stateDir: options.stateDir });
    engine.close();
    const sourceAlias = join(fixture.home, "source-alias");
    await symlink(options.stateDir, sourceAlias, "dir");

    await expect(purgeMooncite({ ...options, sessionsRoot: sourceAlias }, true)).rejects.toThrow(/overlapping/u);
    expect((await stat(join(options.stateDir, "index.sqlite"))).isFile()).toBe(true);
  });

  it("previews stale engine locks without removing them before confirmation", async () => {
    const { options } = await setup();
    const engine = new MoonciteEngine({ sessionsRoot: options.sessionsRoot, stateDir: options.stateDir });
    engine.close();
    const staleLock = join(options.stateDir, ".engine-10000000-dead-beef.lock");
    await writeFile(staleLock, "10000000\n", { mode: 0o600 });

    const preview = await purgeMooncite(options, false);
    expect(preview).toMatchObject({ outcome: "confirmation_required" });
    expect(preview.ownedPaths).toContain(staleLock);
    expect((await stat(staleLock)).isFile()).toBe(true);

    await expect(purgeMooncite(options, true)).resolves.toMatchObject({ outcome: "purged" });
    await expect(stat(options.stateDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("configures and removes the same local server for Pi, OMP, Codex, and Claude Code", async () => {
    const { options } = await setup();
    await mkdir(options.piAgentDir, { recursive: true });
    await writeFile(join(options.piAgentDir, "settings.json"), JSON.stringify({ packages: [] }));
    const enabled = { pi: false, omp: false, codex: false, claudeCode: false };
    let ompShimDir: string | null = null;
    const runner: CommandRunner = async (command, args, env) => {
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
      if (command === "omp" && args[1] === "uninstall") {
        ompShimDir = (env?.PATH ?? "").split(delimiter)[0] ?? null;
        expect(await readFile(join(ompShimDir!, "bun"), "utf8")).toContain("MOONCITE_NPM_COMMAND");
        enabled.omp = false;
        return { code: 0, stdout: "", stderr: "" };
      }
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
          : { code: 1, stdout: "", stderr: "No MCP server named \"mooncite\". Run `claude mcp add` to add one." };
      }
      if (command === "claude" && args[1] === "add") { enabled.claudeCode = true; return { code: 0, stdout: "", stderr: "" }; }
      if (command === "claude" && args[1] === "remove") { enabled.claudeCode = false; return { code: 0, stdout: "", stderr: "" }; }
      return { code: 1, stdout: "", stderr: `unexpected ${command} ${args.join(" ")}` };
    };
    const adapter = createClientRegistrationAdapter(options, runner);
    expect(await adapter.configure()).toEqual(exactDiagnostics());
    expect(await adapter.disable()).toEqual({ pi: "missing", omp: "missing", codex: "missing", claudeCode: "missing" });
    expect(ompShimDir).not.toBeNull();
    await expect(stat(ompShimDir!)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not mistake unrelated client not-found errors for missing registrations", async () => {
    const { options } = await setup();
    const runner: CommandRunner = async (command, args) => {
      if ((command === "codex" || command === "claude") && args[1] === "get") {
        return { code: 1, stdout: "", stderr: "Configuration file not found" };
      }
      return { code: 1, stdout: "", stderr: "client unavailable" };
    };

    const adapter = createClientRegistrationAdapter(options, runner);
    expect(await adapter.diagnose()).toEqual({
      pi: "unavailable",
      omp: "unavailable",
      codex: "unavailable",
      claudeCode: "unavailable",
    });
  });

  it("rolls back a client command that mutates its registration before failing", async () => {
    const { options } = await setup();
    await mkdir(options.piAgentDir, { recursive: true });
    await writeFile(join(options.piAgentDir, "settings.json"), JSON.stringify({ packages: [] }));
    let removals = 0;
    const runner: CommandRunner = async (command, args) => {
      if (command === "pi" && args[0] === "--version") return { code: 0, stdout: "1.0.0\n", stderr: "" };
      if (command === "pi" && args[0] === "install") {
        await writeFile(join(options.piAgentDir, "settings.json"), JSON.stringify({ packages: [options.packageRoot] }));
        return { code: 1, stdout: "", stderr: "install failed after writing settings" };
      }
      if (command === "pi" && args[0] === "remove") {
        removals++;
        await writeFile(join(options.piAgentDir, "settings.json"), JSON.stringify({ packages: [] }));
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "client unavailable" };
    };

    const adapter = createClientRegistrationAdapter(options, runner);
    await expect(adapter.configure()).rejects.toThrow(/install failed after writing settings/u);
    expect(removals).toBe(1);
    expect(JSON.parse(await readFile(join(options.piAgentDir, "settings.json"), "utf8"))).toEqual({ packages: [] });
  });

  it("rejects a successful no-op client registration", async () => {
    const { options } = await setup();
    await mkdir(options.piAgentDir, { recursive: true });
    await writeFile(join(options.piAgentDir, "settings.json"), JSON.stringify({ packages: [] }));
    const runner: CommandRunner = async (command, args) => {
      if (command === "pi" && args[0] === "--version") return { code: 0, stdout: "1.0.0\n", stderr: "" };
      if (command === "pi" && args[0] === "install") return { code: 0, stdout: "", stderr: "" };
      return { code: 1, stdout: "", stderr: "client unavailable" };
    };

    const adapter = createClientRegistrationAdapter(options, runner);
    await expect(adapter.configure()).rejects.toThrow(/registration could not be verified for: pi=missing/u);
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
