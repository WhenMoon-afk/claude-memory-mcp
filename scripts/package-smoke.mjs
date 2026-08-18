import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

const root = new URL("..", import.meta.url).pathname;
const receiver = await mkdtemp(join(process.env.MOONCITE_SMOKE_TMPDIR ?? dirname(root), "mooncite-packed-receiver-"));
const run = async (command, args, options = {}) => {
  const { promise, resolve, reject } = Promise.withResolvers();
  const child = spawn(command, args, { cwd: options.cwd ?? receiver, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.once("error", reject);
  child.once("close", (code) => {
    if ((options.allow ?? [0]).includes(code)) resolve({ code, stdout, stderr });
    else reject(new Error(`${command} ${args.join(" ")} failed (${code}): ${stderr || stdout}`));
  });
  return promise;
};
const rpc = async (command, args, request, options = {}) => {
  const child = spawn(command, args, { cwd: options.cwd ?? receiver, env: options.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
  try {
    child.stdin.write(`${JSON.stringify(request)}\n`);
    while (true) {
      const next = await lines.next();
      if (next.done) throw new Error(`${command} RPC closed before response: ${stderr}`);
      let frame;
      try { frame = JSON.parse(next.value); } catch { continue; }
      if (frame.id !== request.id || frame.type !== "response") continue;
      if (!frame.success) throw new Error(`${command} RPC failed: ${JSON.stringify(frame)}`);
      return frame;
    }
  } finally {
    clearTimeout(timeout);
    child.kill("SIGTERM");
  }
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
  await run("npm", ["install", "--prefix", bootstrap, "--omit=dev", "--ignore-scripts", archive]);
  const bootstrapCli = join(bootstrap, "node_modules", "@whenmoon-afk", "mooncite", "dist", "cli.js");

  const home = join(receiver, "home");
  const agent = join(home, ".pi", "agent");
  const sessions = join(agent, "sessions", "--receiver--");
  const ompAgent = join(home, ".omp", "agent");
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
let state = {};
try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch {}
const save = () => writeFileSync(statePath, JSON.stringify(state));
if (client === "pi") {
  if (args[0] === "--version") { console.log("1.0.0"); process.exit(0); }
  if (args[0] === "install") { state.pi = args[1]; mkdirSync(process.env.PI_AGENT_DIR, { recursive: true }); writeFileSync(join(process.env.PI_AGENT_DIR, "settings.json"), JSON.stringify({ packages: [args[1]] })); save(); process.exit(0); }
  if (args[0] === "remove") { delete state.pi; writeFileSync(join(process.env.PI_AGENT_DIR, "settings.json"), JSON.stringify({ packages: [] })); save(); process.exit(0); }
}
if (client === "codex") {
  if (args[0] === "mcp" && args[1] === "get") { if (!state.codex) { console.error("No MCP server named 'mooncite' found"); process.exit(1); } console.log(JSON.stringify({ name: "mooncite", transport: { type: "stdio", command: state.codex[0], args: state.codex.slice(1) } })); process.exit(0); }
  if (args[0] === "mcp" && args[1] === "add") { state.codex = args.slice(args.indexOf("--") + 1); save(); process.exit(0); }
  if (args[0] === "mcp" && args[1] === "remove") { delete state.codex; save(); process.exit(0); }
}
if (client === "claude") {
  if (args[0] === "mcp" && args[1] === "get") { if (!state.claude) { console.error("No MCP server found"); process.exit(1); } console.log(\`mooncite:\\n  Scope: User config (available in all your projects)\\n  Status: Connected\\n  Type: stdio\\n  Command: \${state.claude[0]}\\n  Args: \${state.claude.slice(1).join(" ")}\\n  Environment:\\n\`); process.exit(0); }
  if (args[0] === "mcp" && args[1] === "add") { state.claude = args.slice(args.indexOf("--") + 1); save(); process.exit(0); }
  if (args[0] === "mcp" && args[1] === "remove") { delete state.claude; save(); process.exit(0); }
}
console.error("unexpected", client, args.join(" "));
process.exit(1);
`);
  await chmod(fakeClient, 0o755);
  const fakeBin = join(receiver, "clients");
  await mkdir(fakeBin);
  for (const name of ["pi", "codex", "claude"]) {
    await copyFile(fakeClient, join(fakeBin, name));
    await chmod(join(fakeBin, name), 0o755);
  }
  const bunShim = join(fakeBin, "bun");
  await writeFile(bunShim, `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const result = spawnSync("npm", process.argv.slice(2), { stdio: "inherit" });
process.exit(result.status ?? 1);
`);
  await chmod(bunShim, 0o755);

  const dataHome = join(home, ".local", "share");
  const stateHome = join(home, ".local", "state");
  const realOmp = process.env.MOONCITE_REAL_OMP ?? "omp";
  const env = {
    ...process.env,
    PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
    HOME: home,
    PI_AGENT_DIR: agent,
    PI_CODING_AGENT_DIR: ompAgent,
    XDG_DATA_HOME: dataHome,
    XDG_STATE_HOME: stateHome,
    MOONCITE_PI_COMMAND: join(fakeBin, "pi"),
    MOONCITE_OMP_COMMAND: realOmp,
    MOONCITE_CODEX_COMMAND: join(fakeBin, "codex"),
    MOONCITE_CLAUDE_COMMAND: join(fakeBin, "claude"),
    MOONCITE_SMOKE_CLIENT_STATE: join(receiver, "client-state.json"),
  };
  const initialSources = JSON.parse((await run(process.execPath, [bootstrapCli, "source", "list"], { env })).stdout);
  if (initialSources.configured.length !== 0 || initialSources.automatic.length !== 4) throw new Error("packed automatic source registry was not initialized");
  await run(process.execPath, [bootstrapCli, "source", "add", "claude-code", claudeRoot], { env });
  await run(process.execPath, [bootstrapCli, "source", "add", "codex", codexRoot], { env });
  await run(process.execPath, [bootstrapCli, "source", "add", "chatgpt", chatGptRoot], { env });
  const configuredSources = JSON.parse((await run(process.execPath, [bootstrapCli, "source", "list"], { env })).stdout);
  if (configuredSources.configured.length !== 3 || configuredSources.sources.length !== 3) throw new Error("packed source registry did not retain optional adapters");
  const npxHelp = await run("npx", ["--yes", "--package", archive, "mooncite", "help"], { env });
  if (!npxHelp.stdout.includes("Mooncite commands:")) throw new Error("npx did not dispatch the packed Mooncite executable");
  const installed = JSON.parse((await run(process.execPath, [bootstrapCli, "install"], { env })).stdout);
  if (installed.outcome !== "installed" || installed.version !== packageVersion) throw new Error("fresh packed install did not complete");
  const stablePackageRoot = join(dataHome, "mooncite", "node_modules", "@whenmoon-afk", "mooncite");
  const stableCli = join(stablePackageRoot, "dist", "cli.js");
  if (!(await stat(stableCli)).isFile()) throw new Error("stable CLI missing");
  const installedSkill = await readFile(join(stablePackageRoot, "skills", "mooncite", "SKILL.md"), "utf8");
  if (!installedSkill.includes("name: mooncite") || !installedSkill.includes("mooncite_recall") || !installedSkill.includes("mooncite_inspect")) {
    throw new Error("stable package did not install the Mooncite skill");
  }
  const pluginList = JSON.parse((await run(realOmp, ["plugin", "list", "--json"], { env })).stdout);
  const ompPlugin = pluginList.npm?.find((entry) => entry.name === "@whenmoon-afk/mooncite");
  if (!ompPlugin || await realpath(ompPlugin.path) !== await realpath(stablePackageRoot)) {
    throw new Error(`real OMP plugin discovery did not resolve the stable Mooncite package: ${JSON.stringify(pluginList)}`);
  }
  const clientProbeEnv = {
    ...env,
    PATH: process.env.PATH ?? "",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "mooncite-package-smoke-not-used",
  };
  const piCommands = (await rpc(
    process.env.MOONCITE_REAL_PI ?? "pi",
    ["--mode", "rpc", "--no-session"],
    { id: "mooncite-skill-pi", type: "get_commands" },
    { env: { ...clientProbeEnv, PI_CODING_AGENT_DIR: agent } },
  )).data?.commands;
  const ompCommands = (await rpc(
    realOmp,
    ["--mode", "rpc", "--no-session"],
    { id: "mooncite-skill-omp", type: "get_available_commands" },
    { env: clientProbeEnv },
  )).data?.commands;
  const hasMoonciteSkill = (commands) => Array.isArray(commands) && commands.some((command) =>
    command?.name === "skill:mooncite" && (command.source === "skill" || command.sourceInfo?.source === "skill"));
  if (!hasMoonciteSkill(piCommands) || !hasMoonciteSkill(ompCommands)) {
    throw new Error(`native Pi or OMP skill discovery did not expose skill:mooncite: ${JSON.stringify({ piCommands, ompCommands })}`);
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
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();
  let id = 0;
  const request = async (method, params) => {
    const requestId = ++id;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, ...(params ? { params } : {}) })}\n`);
    while (true) {
      const next = await lines.next();
      if (next.done) throw new Error("MCP server closed before response");
      const response = JSON.parse(next.value);
      if (response.id !== requestId) continue;
      if (response.error) throw new Error(response.error.message);
      return response.result;
    }
  };
  await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "packed-receiver", version: "1" } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const listed = await request("tools/list");
  const names = listed.tools.map((tool) => tool.name).sort();
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
  child.kill("SIGTERM");
  await run(process.execPath, [bootstrapCli, "source", "remove", "claude-code"], { env });
  await run(process.execPath, [bootstrapCli, "source", "remove", "codex"], { env });
  await run(process.execPath, [bootstrapCli, "source", "remove", "chatgpt"], { env });
  const removedSources = JSON.parse((await run(process.execPath, [bootstrapCli, "source", "list"], { env })).stdout);
  if (removedSources.configured.length !== 0 || removedSources.automatic.length !== 4) throw new Error("packed source registry did not remove explicit adapters");

  await run(process.execPath, [bootstrapCli, "rebuild"], { env });
  await run(process.execPath, [bootstrapCli, "disable"], { env });
  await run(process.execPath, [bootstrapCli, "install"], { env });
  await run(process.execPath, [bootstrapCli, "uninstall"], { env });
  await stat(join(stateHome, "mooncite", "index.sqlite"));
  await run(process.execPath, [bootstrapCli, "purge"], { env, allow: [2] });
  await run(process.execPath, [bootstrapCli, "purge", "--yes"], { env });
  if (await digest(source) !== before) throw new Error("packed receiver flow changed source history");
  if (await digest(ompSource) !== ompBefore) throw new Error("packed receiver flow changed OMP source history");
  if (await digest(claudeSource) !== claudeBefore) throw new Error("packed receiver flow changed Claude source history");
  if (await digest(codexSource) !== codexBefore) throw new Error("packed receiver flow changed Codex source history");
  if (await digest(chatGptSource) !== chatGptBefore) throw new Error("packed receiver flow changed ChatGPT source history");
  try { await stat(join(dataHome, "mooncite")); throw new Error("uninstall retained the stable package"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  console.log(JSON.stringify({
    outcome: "passed",
    package: `@whenmoon-afk/mooncite@${packageVersion}`,
    npxBootstrap: true,
    ompPluginDiscovered: true,
    skillInstalled: true,
    ompMcpManifest: ".mcp.json",
    resolvedMcpCommand: [resolvedServer.command, ...resolvedServer.args],
    tools: names,
    sourceUnchanged: true,
  }));
} finally {
  await rm(receiver, { recursive: true, force: true });
}
