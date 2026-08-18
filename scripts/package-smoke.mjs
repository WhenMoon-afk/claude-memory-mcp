import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
const line = (value) => `${JSON.stringify(value)}\n`;
const digest = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");

try {
  const packed = JSON.parse((await run("npm", ["pack", root, "--ignore-scripts", "--json", "--pack-destination", receiver])).stdout);
  const archive = join(receiver, packed[0].filename);
  const bootstrap = join(receiver, "bootstrap");
  await run("npm", ["install", "--prefix", bootstrap, "--omit=dev", "--ignore-scripts", archive]);
  const bootstrapCli = join(bootstrap, "node_modules", "@whenmoon-afk", "mooncite", "dist", "cli.js");

  const home = join(receiver, "home");
  const agent = join(home, ".pi", "agent");
  const sessions = join(agent, "sessions", "--receiver--");
  await mkdir(sessions, { recursive: true });
  const source = join(sessions, "receiver.jsonl");
  await writeFile(source,
    line({ type: "session", version: 3, id: "packed-session", cwd: "/receiver/project" }) +
    line({ type: "message", id: "packed-entry", parentId: null, message: { role: "user", content: "Packed receiver marker violet-orbit-41." } }),
  );
  await writeFile(join(agent, "settings.json"), JSON.stringify({ packages: [] }));
  const before = await digest(source);

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
if (client === "omp") {
  if (args[0] === "plugin" && args[1] === "list") { console.log(JSON.stringify({ local: state.omp ? [{ name: "@whenmoon-afk/mooncite", path: state.omp }] : [] })); process.exit(0); }
  if (args[0] === "plugin" && args[1] === "link") { state.omp = args[2]; save(); process.exit(0); }
  if (args[0] === "plugin" && args[1] === "uninstall") { delete state.omp; save(); process.exit(0); }
}
if (client === "codex") {
  if (args[0] === "mcp" && args[1] === "get") { if (!state.codex) { console.error("No MCP server named 'mooncite' found"); process.exit(1); } console.log(JSON.stringify({ name: "mooncite", transport: { type: "stdio", command: state.codex[0], args: state.codex.slice(1) } })); process.exit(0); }
  if (args[0] === "mcp" && args[1] === "add") { state.codex = args.slice(args.indexOf("--") + 1); save(); process.exit(0); }
  if (args[0] === "mcp" && args[1] === "remove") { delete state.codex; save(); process.exit(0); }
}
if (client === "claude") {
  if (args[0] === "mcp" && args[1] === "get") { if (!state.claude) { console.error("No MCP server found"); process.exit(1); } console.log(state.claude.join(" ")); process.exit(0); }
  if (args[0] === "mcp" && args[1] === "add") { state.claude = args.slice(args.indexOf("--") + 1); save(); process.exit(0); }
  if (args[0] === "mcp" && args[1] === "remove") { delete state.claude; save(); process.exit(0); }
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

  const dataHome = join(home, ".local", "share");
  const stateHome = join(home, ".local", "state");
  const env = {
    ...process.env,
    HOME: home,
    PI_AGENT_DIR: agent,
    XDG_DATA_HOME: dataHome,
    XDG_STATE_HOME: stateHome,
    MOONCITE_PI_COMMAND: join(fakeBin, "pi"),
    MOONCITE_OMP_COMMAND: join(fakeBin, "omp"),
    MOONCITE_CODEX_COMMAND: join(fakeBin, "codex"),
    MOONCITE_CLAUDE_COMMAND: join(fakeBin, "claude"),
    MOONCITE_SMOKE_CLIENT_STATE: join(receiver, "client-state.json"),
  };
  const installed = JSON.parse((await run(process.execPath, [bootstrapCli, "install"], { env })).stdout);
  if (installed.outcome !== "installed" || installed.version !== "4.0.0") throw new Error("fresh packed install did not complete");
  const stableCli = join(dataHome, "mooncite", "node_modules", "@whenmoon-afk", "mooncite", "dist", "cli.js");
  if (!(await stat(stableCli)).isFile()) throw new Error("stable CLI missing");

  const child = spawn(process.execPath, [stableCli, "serve"], { env, stdio: ["pipe", "pipe", "pipe"] });
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
  const recalled = await request("tools/call", { name: "mooncite_recall", arguments: { query: "violet-orbit-41" } });
  const candidate = recalled.structuredContent.candidates[0];
  if (!candidate?.evidenceId || !candidate?.evidenceUri) throw new Error("recall did not render both locator forms");
  for (const evidence_id of [candidate.evidenceId, candidate.evidenceUri]) {
    const inspected = await request("tools/call", { name: "mooncite_inspect", arguments: { evidence_id, window: 0 } });
    if (inspected.structuredContent.outcome !== "verified") throw new Error(`inspect failed for ${evidence_id}`);
  }
  const status = await request("tools/call", { name: "mooncite_status", arguments: {} });
  if (status.structuredContent.outcome !== "ready" || Object.values(status.structuredContent.registrations).some((value) => value !== "exact")) throw new Error("status was not ready and exact");
  child.kill("SIGTERM");

  await run(process.execPath, [bootstrapCli, "rebuild"], { env });
  await run(process.execPath, [bootstrapCli, "disable"], { env });
  await run(process.execPath, [bootstrapCli, "install"], { env });
  await run(process.execPath, [bootstrapCli, "uninstall"], { env });
  await stat(join(stateHome, "mooncite", "index.sqlite"));
  await run(process.execPath, [bootstrapCli, "purge"], { env, allow: [2] });
  await run(process.execPath, [bootstrapCli, "purge", "--yes"], { env });
  if (await digest(source) !== before) throw new Error("packed receiver flow changed source history");
  try { await stat(join(dataHome, "mooncite")); throw new Error("uninstall retained the stable package"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  console.log(JSON.stringify({ outcome: "passed", package: "@whenmoon-afk/mooncite@4.0.0", tools: names, sourceUnchanged: true }));
} finally {
  await rm(receiver, { recursive: true, force: true });
}
