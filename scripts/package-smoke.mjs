import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const receiver = await mkdtemp(join(process.env.MOONCITE_SMOKE_TMPDIR ?? tmpdir(), "mooncite-packed-receiver-"));
const run = async (command, args, options = {}) => {
  const { promise, resolve, reject } = Promise.withResolvers();
  const child = spawn(command, args, { cwd: options.cwd ?? receiver, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
    reject(new Error(`${command} ${args.join(" ")} timed out`));
  }, options.timeout ?? 120_000);
  child.once("error", (error) => {
    clearTimeout(timeout);
    reject(error);
  });
  child.once("close", (code) => {
    clearTimeout(timeout);
    if ((options.allow ?? [0]).includes(code)) resolve({ code, stdout, stderr });
    else reject(new Error(`${command} ${args.join(" ")} failed (${code}): ${stderr || stdout}`));
  });
  return promise;
};
const line = (value) => `${JSON.stringify(value)}\n`;
const digest = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const ompTitleLine = (title) => {
  const unpadded = JSON.stringify({ type: "title", v: 1, title, source: "auto", pad: "" });
  const padding = 256 - Buffer.byteLength(unpadded);
  if (padding < 0) throw new Error("packed OMP title exceeds its fixed-width record");
  return line({ type: "title", v: 1, title, source: "auto", pad: " ".repeat(padding) });
};
const packageVersion = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;

try {
  const packed = JSON.parse((await run("npm", ["pack", root, "--ignore-scripts", "--json", "--pack-destination", receiver])).stdout);
  const archive = join(receiver, packed[0].filename);
  const bootstrap = join(receiver, "bootstrap");
  await run("npm", ["install", "--prefix", bootstrap, "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", archive]);
  const bootstrapCli = join(bootstrap, "node_modules", "@whenmoon-afk", "mooncite", "dist", "cli.js");

  const home = join(receiver, "home");
  const agent = join(receiver, "pi-agent");
  const sessions = join(agent, "sessions", "--receiver--");
  const ompAgent = join(receiver, "omp-agent");
  const ompSessions = join(ompAgent, "sessions", "-receiver");
  await mkdir(sessions, { recursive: true });
  await mkdir(ompSessions, { recursive: true });
  const claudeRoot = join(home, "histories", "claude");
  const claudeProject = join(claudeRoot, "-receiver-project");
  const codexRoot = join(home, "histories", "codex");
  const codexProject = join(codexRoot, "2030", "01", "01");
  const chatGptRoot = join(home, "histories", "chatgpt");
  await mkdir(claudeProject, { recursive: true });
  await mkdir(codexProject, { recursive: true });
  await mkdir(chatGptRoot, { recursive: true });
  const source = join(sessions, "receiver.jsonl");
  const ompSource = join(ompSessions, "receiver.jsonl");
  const claudeSource = join(claudeProject, "packed-session.jsonl");
  const codexSource = join(codexProject, "rollout.jsonl");
  const chatGptSource = join(chatGptRoot, "conversations.json");
  await writeFile(source,
    line({ type: "session", version: 3, id: "packed-session", cwd: "/receiver/project" }) +
    line({ type: "message", id: "packed-entry", parentId: null, message: { role: "user", content: "Packed Pi receiver marker violet-orbit-41." } }),
  );
  await writeFile(ompSource,
    ompTitleLine("Packed OMP receiver") +
    line({ type: "session", version: 3, id: "packed-session", cwd: "/receiver/project" }) +
    line({ type: "message", id: "packed-entry", parentId: null, message: { role: "user", content: "Packed OMP receiver marker cobalt-comet-63." } }),
  );
  await writeFile(claudeSource,
    line({ type: "user", sessionId: "packed-session", uuid: "packed-entry", parentUuid: null, cwd: "/receiver/project", message: { role: "user", content: "Packed Claude receiver marker lucid-fern-52." } }) +
    line({ type: "assistant", sessionId: "packed-session", uuid: "claude-answer", parentUuid: "packed-entry", cwd: "/receiver/project", message: { role: "assistant", content: [{ type: "text", text: "Packed Claude answer quiet-brook-73." }] } }),
  );
  await writeFile(codexSource,
    line({ type: "session_meta", timestamp: "2030-01-01T00:00:00Z", payload: { id: "packed-session", cwd: "/receiver/project" } }) +
    line({ type: "event_msg", timestamp: "2030-01-01T00:00:01Z", payload: { type: "user_message", message: "Packed Codex receiver marker bright-pine-64." } }) +
    line({ type: "event_msg", timestamp: "2030-01-01T00:00:02Z", payload: { type: "agent_message", message: "Packed Codex answer misty-lake-85." } }),
  );
  await writeFile(chatGptSource, JSON.stringify([{
    title: "Packed ChatGPT receiver",
    conversation_id: "packed-chatgpt-session",
    current_node: "packed-chatgpt-answer",
    mapping: {
      "packed-chatgpt-entry": {
        id: "packed-chatgpt-entry",
        parent: null,
        children: ["packed-chatgpt-answer"],
        message: {
          id: "packed-chatgpt-entry",
          author: { role: "user" },
          content: { content_type: "text", parts: ["Packed ChatGPT receiver marker amber-canvas-75."] },
        },
      },
      "packed-chatgpt-answer": {
        id: "packed-chatgpt-answer",
        parent: "packed-chatgpt-entry",
        children: [],
        message: {
          id: "packed-chatgpt-answer",
          author: { role: "assistant" },
          content: { content_type: "text", parts: ["Packed ChatGPT answer gentle-harbor-29."] },
        },
      },
    },
  }]));
  await writeFile(join(agent, "settings.json"), JSON.stringify({ packages: [] }));
  const before = await digest(source);
  const ompBefore = await digest(ompSource);
  const claudeBefore = await digest(claudeSource);
  const codexBefore = await digest(codexSource);
  const chatGptBefore = await digest(chatGptSource);

  const fakeClient = join(receiver, "fake-client.mjs");
  await writeFile(fakeClient, `#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
const client = basename(process.argv[1]);
const args = process.argv.slice(2);
const statePath = process.env.MOONCITE_SMOKE_CLIENT_STATE;
const packageRoot = process.env.MOONCITE_SMOKE_STABLE_PACKAGE;
const server = [process.env.MOONCITE_SMOKE_NODE, process.env.MOONCITE_SMOKE_CLI, "serve"];
const matches = (expected) => args.length === expected.length && args.every((arg, index) => arg === expected[index]);
let state = {};
try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch {}
const save = () => writeFileSync(statePath, JSON.stringify(state));
if (client === "pi") {
  if (matches(["--version"])) { console.log("1.0.0"); process.exit(0); }
  if (matches(["install", packageRoot])) {
    state.pi = packageRoot;
    mkdirSync(process.env.PI_AGENT_DIR, { recursive: true });
    writeFileSync(join(process.env.PI_AGENT_DIR, "settings.json"), JSON.stringify({ packages: [packageRoot] }));
    save();
    process.exit(0);
  }
  if (matches(["remove", packageRoot])) {
    delete state.pi;
    writeFileSync(join(process.env.PI_AGENT_DIR, "settings.json"), JSON.stringify({ packages: [] }));
    save();
    process.exit(0);
  }
}
if (client === "omp") {
  if (matches(["plugin", "list", "--json"])) {
    console.log(JSON.stringify({ npm: state.omp ? [{ name: "@whenmoon-afk/mooncite", path: state.omp }] : [] }));
    process.exit(0);
  }
  if (matches(["plugin", "link", packageRoot])) { state.omp = packageRoot; save(); process.exit(0); }
  if (matches(["plugin", "uninstall", "@whenmoon-afk/mooncite"])) { delete state.omp; save(); process.exit(0); }
}
if (client === "codex") {
  if (matches(["mcp", "get", "mooncite", "--json"])) {
    if (!state.codex) { console.error("No MCP server named 'mooncite' found"); process.exit(1); }
    console.log(JSON.stringify({ name: "mooncite", transport: { type: "stdio", command: state.codex[0], args: state.codex.slice(1) } }));
    process.exit(0);
  }
  if (matches(["mcp", "add", "mooncite", "--", ...server])) { state.codex = server; save(); process.exit(0); }
  if (matches(["mcp", "remove", "mooncite"])) { delete state.codex; save(); process.exit(0); }
}
if (client === "claude") {
  if (matches(["mcp", "get", "mooncite"])) {
    if (!state.claude) { console.error("No MCP server found"); process.exit(1); }
    console.log(["mooncite:", "  Scope: User config (available in all your projects)", "  Status: Connected", "  Type: stdio", "  Command: " + state.claude[0], "  Args: " + state.claude.slice(1).join(" "), "  Environment:"].join("\\n"));
    process.exit(0);
  }
  if (matches(["mcp", "add", "--scope", "user", "mooncite", "--", ...server])) { state.claude = server; save(); process.exit(0); }
  if (matches(["mcp", "remove", "--scope", "user", "mooncite"])) { delete state.claude; save(); process.exit(0); }
}
console.error("unexpected", client, args.join(" "));
process.exit(1);
`);
  await chmod(fakeClient, 0o755);
  const fakeBin = join(receiver, "clients");
  await mkdir(fakeBin);
  for (const name of ["pi", "omp", "codex", "claude"]) {
    await copyFile(fakeClient, join(fakeBin, name));
    await chmod(join(fakeBin, name), 0o755);
  }

  const dataHome = join(receiver, "xdg-data");
  const stateHome = join(receiver, "xdg-state");
  const configHome = join(receiver, "xdg-config");
  const codexHome = join(receiver, "codex-home");
  const localBin = join(home, ".local", "bin");
  const stablePackageRoot = join(dataHome, "mooncite", "node_modules", "@whenmoon-afk", "mooncite");
  const stableCli = join(stablePackageRoot, "dist", "cli.js");
  const stableLauncher = join(localBin, "mooncite");
  const env = {
    ...process.env,
    PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
    HOME: home,
    PI_AGENT_DIR: agent,
    PI_CODING_AGENT_DIR: ompAgent,
    CODEX_HOME: codexHome,
    XDG_CONFIG_HOME: configHome,
    XDG_DATA_HOME: dataHome,
    XDG_STATE_HOME: stateHome,
    MOONCITE_AUTO_SOURCES: "1",
    MOONCITE_NPM_COMMAND: "npm",
    MOONCITE_PI_COMMAND: join(fakeBin, "pi"),
    MOONCITE_OMP_COMMAND: join(fakeBin, "omp"),
    MOONCITE_CODEX_COMMAND: join(fakeBin, "codex"),
    MOONCITE_CLAUDE_COMMAND: join(fakeBin, "claude"),
    MOONCITE_SMOKE_CLIENT_STATE: join(receiver, "client-state.json"),
    MOONCITE_SMOKE_STABLE_PACKAGE: stablePackageRoot,
    MOONCITE_SMOKE_NODE: process.execPath,
    MOONCITE_SMOKE_CLI: stableCli,
  };
  const initialSources = JSON.parse((await run(process.execPath, [bootstrapCli, "source", "list"], { env })).stdout);
  if (initialSources.configured.length !== 0
    || initialSources.automatic.length !== 4
    || !initialSources.automatic.some((source) => source.origin === "codex" && source.root === join(codexHome, "sessions"))) {
    throw new Error("packed automatic source registry did not honor the isolated receiver environment");
  }
  await run(process.execPath, [bootstrapCli, "source", "add", "claude-code", claudeRoot], { env });
  await run(process.execPath, [bootstrapCli, "source", "add", "codex", codexRoot], { env });
  await run(process.execPath, [bootstrapCli, "source", "add", "chatgpt", chatGptRoot], { env });
  if (!(await stat(join(configHome, "mooncite", "sources.json"))).isFile()) {
    throw new Error("packed source registry did not use the isolated XDG config home");
  }
  const configuredSources = JSON.parse((await run(process.execPath, [bootstrapCli, "source", "list"], { env })).stdout);
  if (configuredSources.configured.length !== 3 || configuredSources.sources.length !== 3) throw new Error("packed source registry did not retain optional adapters");
  let helpText;
  for (const helpArgs of [[], ["help"], ["--help"], ["-h"], ["install", "--help"]]) {
    const result = await run(process.execPath, [bootstrapCli, ...helpArgs], { env, timeout: 5_000 });
    if (!result.stdout.includes("Mooncite commands:")) throw new Error(`packed CLI did not render help for: ${helpArgs.join(" ") || "<no arguments>"}`);
    if (helpText !== undefined && result.stdout !== helpText) throw new Error("packed CLI help aliases rendered different output");
    helpText = result.stdout;
  }
  const npxHelp = await run("npx", ["--yes", "--package", archive, "mooncite", "help"], { env });
  if (npxHelp.stdout !== helpText) throw new Error("npx did not dispatch the packed Mooncite executable");
  const installed = JSON.parse((await run(process.execPath, [bootstrapCli, "install"], { env })).stdout);
  if (installed.outcome !== "installed" || installed.version !== packageVersion) throw new Error("fresh packed install did not complete");
  if (!(await stat(stableCli)).isFile()) throw new Error("stable CLI missing");
  const absoluteStatus = JSON.parse((await run(stableLauncher, ["status"], { env })).stdout);
  const launcherEnv = { ...env, PATH: `${fakeBin}${delimiter}${localBin}${delimiter}${process.env.PATH ?? ""}` };
  const pathStatus = JSON.parse((await run("mooncite", ["status"], { env: launcherEnv })).stdout);
  if (absoluteStatus.outcome !== "ready" || pathStatus.outcome !== "ready") {
    throw new Error("installed Mooncite launcher did not report ready by absolute path and explicit PATH");
  }
  const clientState = JSON.parse(await readFile(env.MOONCITE_SMOKE_CLIENT_STATE, "utf8"));
  const expectedServer = [process.execPath, stableCli, "serve"];
  if (clientState.pi !== stablePackageRoot
    || clientState.omp !== stablePackageRoot
    || JSON.stringify(clientState.codex) !== JSON.stringify(expectedServer)
    || JSON.stringify(clientState.claude) !== JSON.stringify(expectedServer)) {
    throw new Error(`client registrations did not retain the stable package and server command: ${JSON.stringify(clientState)}`);
  }
  const installedManifest = JSON.parse(await readFile(join(stablePackageRoot, "package.json"), "utf8"));
  if (JSON.stringify(installedManifest.pi?.extensions) !== JSON.stringify(["./dist/pi/extension.js"])) {
    throw new Error("stable package manifest did not declare exactly the Pi extension entry");
  }
  const piExtensionPath = join(stablePackageRoot, "dist", "pi", "extension.js");
  if (!(await stat(piExtensionPath)).isFile()) throw new Error("stable package Pi extension entry is missing");
  const piExtension = await import(pathToFileURL(piExtensionPath).href);
  if (typeof piExtension.default !== "function") throw new Error("stable package Pi extension did not import its default entry");
  const installedSkill = await readFile(join(stablePackageRoot, "skills", "mooncite", "SKILL.md"), "utf8");
  if (!installedSkill.includes("name: mooncite") || !installedSkill.includes("mooncite_recall") || !installedSkill.includes("mooncite_inspect")) {
    throw new Error("stable package did not install the Mooncite skill");
  }
  const pluginList = JSON.parse((await run(env.MOONCITE_OMP_COMMAND, ["plugin", "list", "--json"], { env })).stdout);
  const ompPlugin = pluginList.npm?.find((entry) => entry.name === "@whenmoon-afk/mooncite");
  if (!ompPlugin || await realpath(ompPlugin.path) !== await realpath(stablePackageRoot)) {
    throw new Error(`isolated OMP registration did not resolve the stable Mooncite package: ${JSON.stringify(pluginList)}`);
  }
  const pluginPackageRoot = ompPlugin.path;
  const packagedMcp = JSON.parse(await readFile(join(pluginPackageRoot, ".mcp.json"), "utf8"));
  const declaredServer = packagedMcp.mcpServers?.mooncite;
  if (declaredServer?.command !== "node" || declaredServer.cwd !== "." || JSON.stringify(declaredServer.args) !== JSON.stringify(["dist/cli.js", "serve"])) {
    throw new Error("packed OMP MCP declaration is missing or not package-root-safe");
  }
  const resolvedServer = {
    command: declaredServer.command,
    args: declaredServer.args,
    cwd: resolve(pluginPackageRoot, declaredServer.cwd),
  };

  const child = spawn(resolvedServer.command, resolvedServer.args, { cwd: resolvedServer.cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  let serverStderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => { serverStderr += chunk; });
  const serverClosed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const serverTimeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();
  let id = 0;
  const request = async (method, params) => {
    const requestId = ++id;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, ...(params ? { params } : {}) })}\n`);
    while (true) {
      const next = await lines.next();
      if (next.done) throw new Error(`MCP server closed before response: ${serverStderr}`);
      const response = JSON.parse(next.value);
      if (response.id !== requestId) continue;
      if (response.error) throw new Error(response.error.message);
      return response.result;
    }
  };
  let names = [];
  try {
    await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "packed-receiver", version: "1" } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const listed = await request("tools/list");
    names = listed.tools.map((tool) => tool.name).sort();
    if (JSON.stringify(names) !== JSON.stringify(["mooncite_inspect", "mooncite_recall", "mooncite_status"])) throw new Error(`unexpected tools: ${names}`);
    const recallQueries = [
      ["violet-orbit-41", "pi"],
      ["cobalt-comet-63", "omp"],
      ["lucid-fern-52", "claude-code"],
      ["bright-pine-64", "codex"],
      ["amber-canvas-75", "chatgpt"],
    ];
    const candidates = [];
    for (const [query, origin] of recallQueries) {
      const recalled = await request("tools/call", { name: "mooncite_recall", arguments: { query } });
      const candidate = recalled.structuredContent.candidates[0];
      if (!candidate?.evidenceId?.startsWith(`mooncite:${origin}:`) || candidate.sourceOrigin !== origin) {
        throw new Error(`recall did not return the ${origin} source adapter`);
      }
      candidates.push(candidate);
    }
    for (const candidate of candidates) {
      if (!candidate?.evidenceId || !candidate?.evidenceUri) throw new Error("recall did not render both locator forms");
      for (const evidence_id of [candidate.evidenceId, candidate.evidenceUri]) {
        const inspected = await request("tools/call", { name: "mooncite_inspect", arguments: { evidence_id, window: 0 } });
        if (inspected.structuredContent.outcome !== "verified") throw new Error(`inspect failed for ${evidence_id}`);
      }
    }
    const status = await request("tools/call", { name: "mooncite_status", arguments: {} });
    if (status.structuredContent.outcome !== "ready" || Object.values(status.structuredContent.registrations).some((value) => value !== "exact")) throw new Error("status was not ready and exact");
    if (status.structuredContent.sourceFilesByOrigin?.pi !== 1
      || status.structuredContent.sourceFilesByOrigin?.omp !== 1
      || status.structuredContent.sourceFilesByOrigin?.["claude-code"] !== 1
      || status.structuredContent.sourceFilesByOrigin?.codex !== 1
      || status.structuredContent.sourceFilesByOrigin?.chatgpt !== 1) throw new Error("status did not report all source origins");
  } finally {
    child.kill("SIGTERM");
    try {
      await serverClosed;
    } finally {
      clearTimeout(serverTimeout);
    }
  }
  if ((await readdir(join(stateHome, "mooncite"))).some((name) => name.startsWith(".engine-"))) {
    throw new Error("packed MCP server left an engine lock after shutdown");
  }
  await run(process.execPath, [bootstrapCli, "source", "remove", "claude-code"], { env });
  await run(process.execPath, [bootstrapCli, "source", "remove", "codex"], { env });
  await run(process.execPath, [bootstrapCli, "source", "remove", "chatgpt"], { env });
  const removedSources = JSON.parse((await run(process.execPath, [bootstrapCli, "source", "list"], { env })).stdout);
  if (removedSources.configured.length !== 0 || removedSources.automatic.length !== 4) throw new Error("packed source registry did not remove explicit adapters");

  await run(process.execPath, [bootstrapCli, "rebuild"], { env });
  const disabled = JSON.parse((await run(process.execPath, [bootstrapCli, "disable"], { env })).stdout);
  if (Object.values(disabled.registrations).some((value) => value !== "missing")) throw new Error("disable retained a client registration");
  if (!(await stat(stablePackageRoot)).isDirectory()) throw new Error("disable removed the stable package");
  if (!(await lstat(stableLauncher)).isSymbolicLink()
    || await realpath(stableLauncher) !== await realpath(stableCli)) {
    throw new Error("disable removed or replaced the exact stable launcher");
  }
  const reinstalled = JSON.parse((await run(process.execPath, [bootstrapCli, "install"], { env })).stdout);
  if (reinstalled.outcome !== "already_installed"
    || Object.values(reinstalled.registrations).some((value) => value !== "exact")) {
    throw new Error("repeated install did not reuse the verified package and restore every client registration");
  }
  const uninstalled = JSON.parse((await run(process.execPath, [bootstrapCli, "uninstall"], { env })).stdout);
  if (uninstalled.outcome !== "uninstalled") throw new Error("packed uninstall did not complete");
  await stat(join(stateHome, "mooncite", "index.sqlite"));
  const purgePreview = JSON.parse((await run(process.execPath, [bootstrapCli, "purge"], { env, allow: [2] })).stdout);
  if (purgePreview.outcome !== "confirmation_required" || purgePreview.ownedPaths.length === 0) {
    throw new Error("purge did not return a non-destructive confirmation preview");
  }
  await stat(join(stateHome, "mooncite", "index.sqlite"));
  const purged = JSON.parse((await run(process.execPath, [bootstrapCli, "purge", "--yes"], { env })).stdout);
  if (purged.outcome !== "purged") throw new Error("confirmed purge did not complete");
  if (await digest(source) !== before) throw new Error("packed receiver flow changed source history");
  if (await digest(ompSource) !== ompBefore) throw new Error("packed receiver flow changed OMP source history");
  if (await digest(claudeSource) !== claudeBefore) throw new Error("packed receiver flow changed Claude source history");
  if (await digest(codexSource) !== codexBefore) throw new Error("packed receiver flow changed Codex source history");
  if (await digest(chatGptSource) !== chatGptBefore) throw new Error("packed receiver flow changed ChatGPT source history");
  try { await stat(join(dataHome, "mooncite")); throw new Error("uninstall retained the stable package"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  try { await lstat(stableLauncher); throw new Error("uninstall retained the Mooncite command"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  console.log(JSON.stringify({
    outcome: "passed",
    package: `@whenmoon-afk/mooncite@${packageVersion}`,
    npxBootstrap: true,
    clientRegistrationsVerified: true,
    installedCommand: stableLauncher,
    skillInstalled: true,
    piExtensionImported: true,
    ompMcpManifest: ".mcp.json",
    resolvedMcpCommand: [resolvedServer.command, ...resolvedServer.args],
    tools: names,
    sourceUnchanged: true,
  }));
} finally {
  await rm(receiver, { recursive: true, force: true });
}
