import { appendFile, chmod, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MoonciteEngine } from "../src/engine.js";
import { addSourceRegistration, loadSourceRegistrations, removeSourceRegistration, resolveSourceRegistrations } from "../src/source-config.js";
import { createFixture, digest, jsonLine, ompTitleLine, type Fixture } from "./fixture.js";

const fixtures: Fixture[] = [];
afterEach(async () => {
  while (fixtures.length) await fixtures.pop()!.cleanup();
});

async function fixture(): Promise<Fixture> {
  const value = await createFixture();
  fixtures.push(value);
  return value;
}

function chatGptConversation(
  sessionId: string,
  title: string,
  userMarker: string,
  assistantMarker: string,
  alternateMarker = "unused alternate branch",
): Record<string, unknown> {
  const userId = `${sessionId}-user`;
  const assistantId = `${sessionId}-assistant`;
  const alternateId = `${sessionId}-alternate`;
  return {
    title,
    conversation_id: sessionId,
    current_node: assistantId,
    mapping: {
      root: { id: "root", parent: null, children: [userId], message: null },
      [userId]: {
        id: userId,
        parent: "root",
        children: [assistantId, alternateId],
        message: {
          id: userId,
          author: { role: "user" },
          content: { content_type: "text", parts: [userMarker] },
        },
      },
      [assistantId]: {
        id: assistantId,
        parent: userId,
        children: [],
        message: {
          id: assistantId,
          author: { role: "assistant" },
          content: { content_type: "text", parts: [assistantMarker] },
        },
      },
      [alternateId]: {
        id: alternateId,
        parent: userId,
        children: [],
        message: {
          id: alternateId,
          author: { role: "assistant" },
          content: { content_type: "text", parts: [alternateMarker] },
        },
      },
    },
  };
}

describe("Mooncite engine public seam", () => {
  it("recalls a stable source-qualified citation and physically inspects both rendered locators without changing source", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    try {
      const recalled = engine.recall({ query: "silver-cedar-17" });
      expect(recalled.outcome).toBe("matches");
      expect(recalled.candidates).toHaveLength(1);
      const candidate = recalled.candidates[0]!;
      expect(candidate.evidenceId).toMatch(/^mooncite:pi:[a-f0-9]{24}:[a-f0-9]{24}:[a-f0-9]{24}:0$/u);
      expect(candidate.evidenceUri).toMatch(/^mooncite:\/\/pi\/[a-f0-9]{24}\/session-moon\/entry-a\/0$/u);
      for (const locator of [candidate.evidenceId, candidate.evidenceUri]) {
        const inspected = engine.inspect({ evidenceId: locator, window: 1 });
        expect(inspected.outcome).toBe("verified");
        expect(inspected.target?.text).toContain("silver-cedar-17");
        expect(inspected.window.map((span) => span.relation)).toEqual(["target", "after"]);
      }
      expect(await digest(f.source)).toBe(f.sourceDigest);
    } finally {
      engine.close();
    }
  });

  it("incrementally admits a coherent append and rebuild restores full verification", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    try {
      expect(engine.status()).toMatchObject({ outcome: "ready", trustState: "full_verified", evidenceSpans: 2 });
      await appendFile(f.source, jsonLine({ type: "message", id: "entry-c", parentId: "entry-b", message: { role: "user", content: "Incremental marker amber-river-29." } }));
      const appended = engine.recall({ query: "amber-river-29" });
      expect(appended).toMatchObject({
        outcome: "matches",
        trustState: "append_trusted",
      });
      expect(appended.candidates[0]!.evidenceId).toMatch(/^mooncite:pi:[a-f0-9]{24}:[a-f0-9]{24}:[a-f0-9]{24}:0$/u);
      expect(engine.rebuild()).toMatchObject({ outcome: "ready", trustState: "full_verified", lastRebuildOutcome: "published" });
    } finally {
      engine.close();
    }
  });
  it("indexes Pi and OMP collisions independently and transactionally replaces OMP changes", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({
      sessionsRoot: f.sessionsRoot,
      ompSessionsRoot: f.ompSessionsRoot,
      stateDir: f.stateDir,
    });
    try {
      expect(engine.status()).toMatchObject({
        outcome: "ready",
        trustState: "full_verified",
        sourceFiles: 2,
        sourceFilesByOrigin: { pi: 1, omp: 1, "claude-code": 0, codex: 0, chatgpt: 0 },
        evidenceSpans: 4,
      });
      const piCandidate = engine.recall({ query: "silver-cedar-17" }).candidates[0]!;
      const ompCandidate = engine.recall({ query: "violet-orbit-41" }).candidates[0]!;
      expect(piCandidate.evidenceId).toMatch(/^mooncite:pi:[a-f0-9]{24}:[a-f0-9]{24}:[a-f0-9]{24}:0$/u);
      expect(piCandidate.evidenceUri).toMatch(/^mooncite:\/\/pi\/[a-f0-9]{24}\/session-moon\/entry-a\/0$/u);
      expect(piCandidate).toMatchObject({ sourceOrigin: "pi" });
      expect(piCandidate.sessionId).toMatch(/^pi:[a-f0-9]{64}:session-moon$/u);
      expect(ompCandidate.evidenceId).toMatch(/^mooncite:omp:[a-f0-9]{24}:[a-f0-9]{24}:[a-f0-9]{24}:0$/u);
      expect(ompCandidate.evidenceUri).toMatch(/^mooncite:\/\/omp\/[a-f0-9]{24}\/session-moon\/entry-a\/0$/u);
      expect(ompCandidate).toMatchObject({ sourceOrigin: "omp" });
      expect(ompCandidate.sessionId).toMatch(/^omp:[a-f0-9]{64}:session-moon$/u);
      expect(engine.recall({ query: "silver-cedar-17", sessionId: ompCandidate.sessionId }).outcome).toBe("no_match");
      expect(engine.inspect({ evidenceId: piCandidate.evidenceId })).toMatchObject({
        outcome: "verified",
        locator: { sourceOrigin: "pi" },
      });
      expect(engine.inspect({ evidenceId: ompCandidate.evidenceUri })).toMatchObject({
        outcome: "verified",
        locator: { sourceOrigin: "omp", relativePath: "-moon-project/session.jsonl" },
      });

      const originalOmp = await readFile(f.ompSource, "utf8");
      const titleEnd = originalOmp.indexOf("\n");
      const renamedOmp = ompTitleLine("Renamed project") + originalOmp.slice(titleEnd + 1);
      expect(Buffer.byteLength(renamedOmp)).toBe(Buffer.byteLength(originalOmp));
      await writeFile(f.ompSource, renamedOmp);
      const renamedDigest = await digest(f.ompSource);
      expect(engine.recall({ query: "violet-orbit-41" })).toMatchObject({
        outcome: "matches",
        trustState: "full_verified",
        candidates: [{ evidenceId: ompCandidate.evidenceId, sourceOrigin: "omp" }],
      });
      expect(engine.inspect({ evidenceId: ompCandidate.evidenceId })).toMatchObject({ outcome: "verified" });
      expect(await digest(f.ompSource)).toBe(renamedDigest);

      await appendFile(f.ompSource, jsonLine({
        type: "message",
        id: "entry-c",
        parentId: "entry-b",
        message: { role: "user", content: "OMP append marker cobalt-comet-63." },
      }));
      const appended = engine.recall({ query: "cobalt-comet-63" });
      expect(appended).toMatchObject({
        outcome: "matches",
        trustState: "full_verified",
        candidates: [{ sourceOrigin: "omp" }],
      });
      expect(appended.candidates[0]!.evidenceId).toMatch(/^mooncite:omp:[a-f0-9]{24}:[a-f0-9]{24}:[a-f0-9]{24}:0$/u);
      expect(engine.inspect({ evidenceId: appended.candidates[0]!.evidenceId })).toMatchObject({ outcome: "verified" });

      const beforeRewriteAppend = await readFile(f.ompSource, "utf8");
      const beforeRewriteMetadata = await stat(f.ompSource);
      const rewrittenPrefix = beforeRewriteAppend.replace("cobalt-comet-63", "magenta-moon-24");
      expect(rewrittenPrefix).not.toBe(beforeRewriteAppend);
      await writeFile(f.ompSource, rewrittenPrefix + jsonLine({
        type: "message",
        id: "entry-d",
        parentId: "entry-c",
        message: { role: "assistant", content: "OMP replacement marker topaz-cloud-75." },
      }));
      const afterRewriteMetadata = await stat(f.ompSource);
      expect(afterRewriteMetadata.dev).toBe(beforeRewriteMetadata.dev);
      expect(afterRewriteMetadata.ino).toBe(beforeRewriteMetadata.ino);
      expect(afterRewriteMetadata.size).toBeGreaterThan(beforeRewriteMetadata.size);
      expect(engine.recall({ query: "topaz-cloud-75" })).toMatchObject({
        outcome: "matches",
        trustState: "full_verified",
        candidates: [{ sourceOrigin: "omp" }],
      });
      expect(engine.recall({ query: "magenta-moon-24" }).outcome).toBe("matches");
      expect(engine.recall({ query: "cobalt-comet-63" }).outcome).toBe("no_match");
      expect(await digest(f.source)).toBe(f.sourceDigest);
    } finally {
      engine.close();
    }
  });

  it("indexes explicitly configured Claude Code and Codex adapters without admitting nested Claude copies", async () => {
    const f = await fixture();
    const claudeRoot = join(f.home, "claude-projects");
    const claudeProject = join(claudeRoot, "-receiver-project");
    const claudeSource = join(claudeProject, "claude-session.jsonl");
    const nestedClaude = join(claudeProject, "claude-session", "subagents", "agent-copy.jsonl");
    const codexRoot = join(f.home, "codex-sessions");
    const codexDirectory = join(codexRoot, "2030", "01", "01");
    const codexSource = join(codexDirectory, "rollout.jsonl");
    await mkdir(join(claudeProject, "claude-session", "subagents"), { recursive: true });
    await mkdir(codexDirectory, { recursive: true });
    const claudeContent =
      jsonLine({ type: "queue-operation", operation: "enqueue", sessionId: "claude-session", content: "ignored queue metadata" }) +
      jsonLine({ type: "user", sessionId: "claude-session", uuid: "claude-entry-a", parentUuid: null, cwd: "/receiver/project", message: { role: "user", content: "Claude marker lucid-fern-52." } }) +
      jsonLine({ type: "assistant", sessionId: "claude-session", uuid: "claude-entry-b", parentUuid: "claude-entry-a", cwd: "/receiver/project", message: { role: "assistant", content: [{ type: "thinking", thinking: "not indexed" }, { type: "text", text: "Claude answer quiet-brook-73." }] } });
    const codexContent =
      jsonLine({ type: "session_meta", timestamp: "2030-01-01T00:00:00Z", payload: { id: "codex-session", cwd: "/receiver/project" } }) +
      jsonLine({ type: "event_msg", timestamp: "2030-01-01T00:00:01Z", payload: { type: "user_message", message: "Codex marker bright-pine-64." } }) +
      jsonLine({ type: "response_item", timestamp: "2030-01-01T00:00:02Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "duplicate transport text is not indexed" }] } }) +
      jsonLine({ type: "event_msg", timestamp: "2030-01-01T00:00:03Z", payload: { type: "agent_message", message: "Codex answer misty-lake-85." } });
    await writeFile(claudeSource, claudeContent);
    await writeFile(nestedClaude, jsonLine({ type: "user", sessionId: "claude-session", uuid: "nested-entry", parentUuid: null, message: { role: "user", content: "Nested marker must-not-index-91." } }));
    await writeFile(codexSource, codexContent);
    const claudeBefore = await digest(claudeSource);
    const codexBefore = await digest(codexSource);
    const engine = new MoonciteEngine({
      sessionsRoot: f.sessionsRoot,
      ompSessionsRoot: f.ompSessionsRoot,
      optionalSources: [
        { origin: "claude-code", root: claudeRoot },
        { origin: "codex", root: codexRoot },
      ],
      stateDir: f.stateDir,
    });
    try {
      expect(engine.status()).toMatchObject({
        outcome: "ready",
        sourceFilesByOrigin: { pi: 1, omp: 1, "claude-code": 1, codex: 1, chatgpt: 0 },
      });
      expect(await digest(claudeSource)).toBe(claudeBefore);
      expect(await digest(codexSource)).toBe(codexBefore);
      expect(engine.recall({ query: "must-not-index-91" }).outcome).toBe("no_match");
      const claude = engine.recall({ query: "lucid-fern-52" }).candidates[0]!;
      expect(claude.evidenceId).toMatch(/^mooncite:claude-code:[a-f0-9]{24}:[a-f0-9]{24}:[a-f0-9]{24}:0$/u);
      expect(claude.evidenceUri).toMatch(/^mooncite:\/\/claude-code\/[a-f0-9]{24}\/claude-session\/claude-entry-a\/0$/u);
      expect(claude).toMatchObject({ sourceOrigin: "claude-code" });
      expect(claude.sessionId).toMatch(/^claude-code:[a-f0-9]{64}:claude-session$/u);
      for (const locator of [claude.evidenceId, claude.evidenceUri]) {
        expect(engine.inspect({ evidenceId: locator, window: 0 })).toMatchObject({ outcome: "verified", locator: { sourceOrigin: "claude-code" } });
      }
      const codex = engine.recall({ query: "bright-pine-64" }).candidates[0]!;
      expect(codex.evidenceId).toMatch(/^mooncite:codex:[a-f0-9]{24}:[a-f0-9]{24}:[a-f0-9]{24}:0$/u);
      expect(codex.evidenceUri).toMatch(/^mooncite:\/\/codex\/[a-f0-9]{24}\/codex-session\/line-2-[a-f0-9]{16}\/0$/u);
      expect(engine.inspect({ evidenceId: codex.evidenceUri, window: 0 })).toMatchObject({ outcome: "verified", locator: { sourceOrigin: "codex" } });

      await writeFile(claudeSource, claudeContent.replace("lucid-fern-52", "lucid-fern-53"));
      expect(engine.recall({ query: "lucid-fern-53" })).toMatchObject({
        outcome: "matches",
        trustState: "full_verified",
        candidates: [{ sourceOrigin: "claude-code" }],
      });
      await appendFile(codexSource, jsonLine({ type: "event_msg", timestamp: "2030-01-01T00:00:04Z", payload: { type: "agent_message", message: "Codex append amber-field-26." } }));
      expect(engine.recall({ query: "amber-field-26" })).toMatchObject({
        outcome: "matches",
        trustState: "full_verified",
        candidates: [{ sourceOrigin: "codex" }],
      });
      expect(await digest(f.source)).toBe(f.sourceDigest);
    } finally {
      engine.close();
    }
  });

  it("follows optional source authorization changes without restarting", async () => {
    const f = await fixture();
    const configPath = join(f.home, ".config", "mooncite", "sources.json");
    const claudeRoot = join(f.home, "claude-projects");
    const claudeProject = join(claudeRoot, "-dynamic-project");
    const claudeSource = join(claudeProject, "dynamic-session.jsonl");
    await mkdir(claudeProject, { recursive: true });
    await writeFile(claudeSource, jsonLine({
      type: "user",
      sessionId: "dynamic-session",
      uuid: "dynamic-entry",
      parentUuid: null,
      cwd: "/dynamic/project",
      message: { role: "user", content: "Dynamic authorization marker copper-harbor-48." },
    }));
    const before = await digest(claudeSource);
    const engine = new MoonciteEngine({
      sessionsRoot: f.sessionsRoot,
      stateDir: f.stateDir,
      optionalSourcesProvider: () => loadSourceRegistrations(configPath),
    });
    try {
      expect(engine.recall({ query: "copper-harbor-48" }).outcome).toBe("no_match");
      addSourceRegistration(configPath, { origin: "claude-code", root: claudeRoot });
      expect(engine.recall({ query: "copper-harbor-48" })).toMatchObject({
        outcome: "matches",
        candidates: [{ sourceOrigin: "claude-code" }],
      });
      removeSourceRegistration(configPath, "claude-code");
      expect(engine.recall({ query: "copper-harbor-48" }).outcome).toBe("no_match");
      expect(await digest(claudeSource)).toBe(before);
    } finally {
      engine.close();
    }
  });

  it("automatically discovers standard local histories and honors the process opt-out", async () => {
    const f = await fixture();
    const claudeProject = join(f.home, ".config", "claude-sol", "projects", "-automatic");
    const claudeSource = join(claudeProject, "automatic.jsonl");
    const alternateClaudeProject = join(f.home, ".claude", "projects", "-automatic");
    const alternateClaudeSource = join(alternateClaudeProject, "automatic.jsonl");
    const codexDirectory = join(f.home, ".codex", "sessions", "2030", "01", "01");
    const codexSource = join(codexDirectory, "rollout.jsonl");
    const chatGptDirectory = join(f.home, "incoming", "chatgpt-share-archive", "automatic");
    const chatGptSource = join(chatGptDirectory, "conversation.json");
    await mkdir(claudeProject, { recursive: true });
    await mkdir(alternateClaudeProject, { recursive: true });
    await mkdir(codexDirectory, { recursive: true });
    await mkdir(chatGptDirectory, { recursive: true });
    await writeFile(claudeSource, jsonLine({
      type: "user",
      uuid: "automatic-claude-entry",
      parentUuid: null,
      message: { role: "user", content: "Automatic Claude marker coral-meadow-31." },
    }));
    await writeFile(alternateClaudeSource, jsonLine({
      type: "user",
      uuid: "automatic-claude-entry",
      parentUuid: null,
      message: { role: "user", content: "Alternate Claude marker harbor-birch-72." },
    }));
    await writeFile(codexSource,
      jsonLine({ type: "session_meta", payload: { id: "automatic-codex", cwd: "/automatic" } })
      + jsonLine({ type: "event_msg", payload: { type: "user_message", message: "Automatic Codex marker pine-summit-42." } }));
    await writeFile(chatGptSource, JSON.stringify(chatGptConversation(
      "automatic-chatgpt",
      "Automatic ChatGPT",
      "Automatic ChatGPT marker river-stone-53.",
      "Automatic ChatGPT answer cloud-garden-64.",
    ), null, 2));
    const sourceDigests = await Promise.all([claudeSource, alternateClaudeSource, codexSource, chatGptSource].map(digest));
    const autoEnv: NodeJS.ProcessEnv = { HOME: f.home };
    const configPath = join(f.home, ".config", "mooncite", "sources.json");
    const engine = new MoonciteEngine({
      sessionsRoot: f.sessionsRoot,
      ompSessionsRoot: f.ompSessionsRoot,
      optionalSourcesProvider: () => resolveSourceRegistrations(configPath, autoEnv),
      stateDir: f.stateDir,
    });
    try {
      expect(engine.status()).toMatchObject({
        sourceFilesByOrigin: { pi: 1, omp: 1, "claude-code": 2, codex: 1, chatgpt: 1 },
      });
      for (const [marker, origin] of [
        ["coral-meadow-31", "claude-code"],
        ["harbor-birch-72", "claude-code"],
        ["pine-summit-42", "codex"],
        ["river-stone-53", "chatgpt"],
      ] as const) {
        expect(engine.recall({ query: marker })).toMatchObject({
          outcome: "matches",
          candidates: [{ sourceOrigin: origin }],
        });
      }
      autoEnv.MOONCITE_AUTO_SOURCES = "0";
      expect(engine.recall({ query: "river-stone-53" }).outcome).toBe("no_match");
      expect(engine.status().sourceFilesByOrigin).toMatchObject({ "claude-code": 0, codex: 0, chatgpt: 0 });
      expect(await Promise.all([claudeSource, alternateClaudeSource, codexSource, chatGptSource].map(digest))).toEqual(sourceDigests);
    } finally {
      engine.close();
    }
  });

  it("refuses overlapping or symlinked source/state roots before creating state", async () => {
    const f = await fixture();
    expect(() => new MoonciteEngine({
      sessionsRoot: f.sessionsRoot,
      stateDir: join(f.sessionsRoot, "derived-state"),
    })).toThrow(/must be disjoint/u);
    expect(() => new MoonciteEngine({
      sessionsRoot: "/",
      stateDir: f.stateDir,
    })).toThrow(/must be disjoint/u);

    const physicalSourceRoot = join(f.home, "physical-source");
    const linkedSourceRoot = join(f.home, "linked-source");
    const nestedStateDir = join(physicalSourceRoot, "state");
    await mkdir(physicalSourceRoot);
    await symlink(physicalSourceRoot, linkedSourceRoot, "dir");
    expect(() => new MoonciteEngine({
      sessionsRoot: linkedSourceRoot,
      stateDir: nestedStateDir,
    })).toThrow(/symbolic-link/u);
    await expect(stat(nestedStateDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("indexes ChatGPT conversation arrays with conversation-backed locators and branch state", async () => {
    const f = await fixture();
    const chatGptRoot = join(f.home, "chatgpt-export");
    const chatGptSource = join(chatGptRoot, "conversations.json");
    await mkdir(chatGptRoot);
    await writeFile(chatGptSource, JSON.stringify([
      chatGptConversation("chat-one", "First chat", "ChatGPT marker amber-canvas-75.", "First answer quiet-willow-86.", "Alternate answer hidden-lantern-97."),
      chatGptConversation("chat-two", "Second chat", "Second marker silver-orchard-18.", "Second answer gentle-harbor-29."),
    ]));
    const before = await digest(chatGptSource);
    const engine = new MoonciteEngine({
      sessionsRoot: f.sessionsRoot,
      optionalSources: [{ origin: "chatgpt", root: chatGptRoot }],
      stateDir: f.stateDir,
    });
    try {
      expect(engine.status().sourceFilesByOrigin.chatgpt).toBe(1);
      const current = engine.recall({ query: "quiet-willow-86" }).candidates[0]!;
      expect(current.evidenceId).toMatch(/^mooncite:chatgpt:[a-f0-9]{24}:[a-f0-9]{24}:[a-f0-9]{24}:0$/u);
      expect(current.evidenceUri).toMatch(/^mooncite:\/\/chatgpt\/[a-f0-9]{24}\/chat-one\/chat-one-assistant\/0$/u);
      expect(current).toMatchObject({
        sourceOrigin: "chatgpt",
        sessionId: current.sessionId,
        branchState: "current",
      });
      for (const locator of [current.evidenceId, current.evidenceUri]) {
        expect(engine.inspect({ evidenceId: locator, window: 1 })).toMatchObject({
          outcome: "verified",
          locator: { sourceOrigin: "chatgpt", sessionId: current.sessionId, entryId: "chat-one-assistant" },
        });
      }
      expect(engine.recall({ query: "hidden-lantern-97" }).candidates[0]).toMatchObject({ branchState: "off_branch" });
      expect(engine.recall({ query: "silver-orchard-18" })).toMatchObject({
        outcome: "matches",
        candidates: [{ sourceOrigin: "chatgpt" }],
      });
      expect(engine.recall({ query: "silver-orchard-18" }).candidates[0]!.sessionId).toMatch(/^chatgpt:[a-f0-9]{64}:chat-two$/u);
      expect(await digest(chatGptSource)).toBe(before);
    } finally {
      engine.close();
    }
  });


  it("reports changed physical evidence as stale and leaves the changed source untouched", async () => {
    const f = await fixture();
    const engine = new MoonciteEngine({ sessionsRoot: f.sessionsRoot, stateDir: f.stateDir });
    try {
      const evidenceId = engine.recall({ query: "silver-cedar-17" }).candidates[0]!.evidenceId;
      const original = await readFile(f.source, "utf8");
      const changed = original.replace("silver-cedar-17", "silver-cedar-18");
      await writeFile(f.source, changed);
      const changedDigest = await digest(f.source);
      expect(engine.inspect({ evidenceId })).toMatchObject({ outcome: "stale", evidenceId });
      expect(await digest(f.source)).toBe(changedDigest);
    } finally {
      engine.close();
    }
  });

  it("safely adopts a recognized pre-marker Mooncite index", async () => {
    const f = await fixture();
    const options = { sessionsRoot: f.sessionsRoot, stateDir: f.stateDir };
    const first = new MoonciteEngine(options);
    expect(first.recall({ query: "silver-cedar-17" }).outcome).toBe("matches");
    first.close();
    await rm(`${f.stateDir}/.mooncite-state`);
    const adopted = new MoonciteEngine(options);
    try {
      expect(adopted.recall({ query: "silver-cedar-17" }).outcome).toBe("matches");
      expect(await digest(f.source)).toBe(f.sourceDigest);
    } finally {
      adopted.close();
    }
  });

  it("removes verified stale engine locks before opening the index", async () => {
    const f = await fixture();
    const options = { sessionsRoot: f.sessionsRoot, stateDir: f.stateDir };
    const first = new MoonciteEngine(options);
    first.close();
    const staleName = ".engine-2147483647-00000000-0000-0000-0000-000000000000.lock";
    await writeFile(`${f.stateDir}/${staleName}`, "2147483647\n", { mode: 0o600 });
    const reopened = new MoonciteEngine(options);
    try {
      expect(await readdir(f.stateDir)).not.toContain(staleName);
    } finally {
      reopened.close();
    }
  });

  it("recovers corrupt derived SQLite state by rebuilding from unchanged source", async () => {
    const f = await fixture();
    const options = { sessionsRoot: f.sessionsRoot, stateDir: f.stateDir };
    const first = new MoonciteEngine(options);
    expect(first.recall({ query: "silver-cedar-17" }).outcome).toBe("matches");
    first.close();
    await writeFile(`${f.stateDir}/index.sqlite`, "not a sqlite database");
    await chmod(`${f.stateDir}/index.sqlite`, 0o600);
    const recovered = new MoonciteEngine(options);
    try {
      expect(recovered.recall({ query: "silver-cedar-17" }).outcome).toBe("matches");
      expect(await digest(f.source)).toBe(f.sourceDigest);
    } finally {
      recovered.close();
    }
  });
});
