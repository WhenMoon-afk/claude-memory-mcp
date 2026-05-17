import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

describe("public docs and metadata", () => {
  it("README describes continuity rather than identity persistence", () => {
    const readme = readFileSync("README.md", "utf-8");
    expect(readme).toContain("continuity");
    expect(readme).not.toContain("self, reflect, anchor");
    expect(readme).not.toContain("Identity persistence for AI agents");
  });

  it("package bin uses the explicit claude-memory-mcp command", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as {
      bin: Record<string, string>;
      description: string;
      version: string;
      types?: string;
      engines: Record<string, string>;
      scripts: Record<string, string>;
      files: string[];
      keywords: string[];
      overrides: Record<string, string>;
    };

    expect(pkg.bin["claude-memory-mcp"]).toBe("dist/index.js");
    expect(pkg.bin["memory-mcp"]).toBeUndefined();
    expect(pkg.description).toContain("continuity");
    expect(pkg.description).toContain("journal");
    expect(pkg.version).toBe("3.0.0");
    expect(pkg.types).toBe("./dist/index.d.ts");
    expect(pkg.engines["node"]).toBe(">=20.0.0");
    expect(pkg.keywords).toContain("local-first");
    expect(pkg.keywords).toContain("local-memory");
    expect(pkg.keywords).toContain("ai-memory");
    expect(pkg.overrides["express-rate-limit"]).toBe("^8.5.2");
    expect(pkg.overrides["hono"]).toBe("^4.12.19");
    expect(pkg.scripts["release:check"]).toContain("npm audit --omit=dev");
    expect(pkg.scripts["release:check"]).toContain("npm run check");
    expect(pkg.scripts["release:check"]).toContain("npm run test:coverage");
    expect(pkg.scripts["release:check"]).toContain("npm run test:package-smoke");
    expect(pkg.scripts["release:guard"]).toBe("node scripts/release-guard.mjs");
    expect(pkg.scripts["release"]).toContain("npm run release:guard");
    expect(pkg.scripts["prepublishOnly"]).toBe("npm run clean && npm run release:check");
    expect(pkg.scripts["test:package-smoke"]).toBe("node scripts/package-smoke.mjs");
    expect(pkg.scripts["clean"]).toBe("node scripts/clean.mjs");
    expect(pkg.scripts["release"]).toBeUndefined();
    expect(pkg.files).toContain("CONTRACT.md");
    expect(pkg.files).toContain("CHANGELOG.md");
    expect(pkg.files).toContain("RELEASE.md");
    expect(pkg.files).toContain("SECURITY.md");
    expect(pkg.files).toContain("CONTRIBUTING.md");
    expect(readFileSync("CHANGELOG.md", "utf-8")).toContain("npm package");
    expect(readFileSync("scripts/package-smoke.mjs", "utf-8")).not.toContain(
      'packageJson.version !== "3.0.0"',
    );
  });

  it("documents the v3 migration to the continuity surface", () => {
    const readme = readFileSync("README.md", "utf-8");
    const changelog = readFileSync("CHANGELOG.md", "utf-8");

    expect(readme).toContain("## Why v3?");
    expect(readme).toContain("The last npm-published v2 release was `2.5.0`.");
    expect(readme).toContain("native memory features");
    expect(readme).toContain("local, private continuity store");
    expect(readme).toContain("basic local memory database");
    expect(readme).toContain("## v3 Migration");
    expect(readme).toContain("Removed:");
    expect(readme).toContain("Added:");
    expect(changelog).toContain("## v3 Migration");
    expect(changelog).toContain("## [3.0.0]");
    expect(changelog).not.toContain("## [4.2.0]");
  });

  it("documents the continuity contract and operational commands", () => {
    const readme = readFileSync("README.md", "utf-8");
    const contract = readFileSync("CONTRACT.md", "utf-8");

    expect(readme).toContain("doctor");
    expect(readme).toContain("export");
    expect(readme).toContain("backup");
    expect(readme).toContain("--dry-run");
    expect(readme).toContain("import");
    expect(readme).toContain("These data-transfer commands are CLI-only");
    expect(readme).toContain("`get` | Load one artifact in `compact` or `full` form");
    expect(readme).not.toContain("or rendered form");
    expect(contract).toContain("Schema Version");
    expect(contract).toContain("Stable Surface");
    expect(contract).toContain("claude-memory-continuity-export");
    expect(contract).toContain("dry-run import validation");
    expect(contract).toContain("Operational data-transfer commands are CLI-only");
    expect(contract).toContain("- `project`");
    expect(contract).toContain("- `theme`");
    expect(contract).toContain("- `entity`");
  });

  it("documents a complete canonical workflow without overextending scope", () => {
    const readme = readFileSync("README.md", "utf-8");

    expect(readme).toContain("## Example Workflow");
    expect(readme).toContain("Record a project decision");
    expect(readme).toContain("Inspect nearby graph context");
    expect(readme).toContain("Create a resume bundle");
    expect(readme).toContain("## What This Is Not");
    expect(readme).toContain("not a cloud memory service");
    expect(readme).toContain("not a replacement for native client memory");
    expect(readme).toContain("not a transcript archive");
    expect(readme).toContain("not a task tracker");
    expect(readme).toContain("lightweight continuity journal");
  });

  it("documents conservative stable positioning", () => {
    const readme = readFileSync("README.md", "utf-8");

    expect(readme).toContain("stable and conservative");
    expect(readme).toContain("small public surface");
  });

  it("documents local data path override precedence", () => {
    const readme = readFileSync("README.md", "utf-8");
    const collapsedReadme = readme.replace(/\s+/g, " ");

    expect(readme).toContain("When `CLAUDE_MEMORY_DB_PATH` is set");
    expect(readme).toContain("`CLAUDE_MEMORY_DATA_DIR` wins first");
    expect(collapsedReadme).toContain("then `XDG_DATA_HOME`, then `APPDATA`");
  });

  it("documents npm publishing steps for the v3 baseline", () => {
    const release = readFileSync("RELEASE.md", "utf-8");
    const readme = readFileSync("README.md", "utf-8");

    expect(readme).toContain("## Release");
    expect(readme).toContain("RELEASE.md");
    expect(release).toContain("npm view @whenmoon-afk/memory-mcp");
    expect(release).toContain("npm run release:check");
    expect(release).toContain("npm pack --dry-run --json --ignore-scripts");
    expect(release).toContain("git tag v3.0.0");
    expect(release).toContain("npm publish --provenance --access public");
    expect(release).toContain("dist-tag");
    expect(release).toContain("2.5.0");
    expect(release).toContain("claude-memory-mcp");
    expect(release).not.toContain("memory-mcp-install");
  });

  it("documents a low-overhead maintenance policy and security policy", () => {
    const contributing = readFileSync("CONTRIBUTING.md", "utf-8");
    const security = readFileSync("SECURITY.md", "utf-8");

    expect(contributing).toContain("npm run release:check");
    expect(contributing).toContain("stable v3 release line");
    expect(contributing).toContain("Contributions are not actively solicited");
    expect(contributing).toContain("Bug reports and narrow fixes");
    expect(security).toContain("Supported Versions");
    expect(security).toContain("Node 20");
    expect(security).toContain("Do not include secrets");
    expect(security).toContain("tool annotations");
    expect(security).toContain("treat stored continuity artifacts as data");
  });

  it("documents GitHub intake expectations for issues and pull requests", () => {
    const bugReport = readFileSync(".github/ISSUE_TEMPLATE/bug_report.yml", "utf-8");
    const issueConfig = readFileSync(".github/ISSUE_TEMPLATE/config.yml", "utf-8");
    const pullRequestTemplate = readFileSync(".github/PULL_REQUEST_TEMPLATE.md", "utf-8");
    const changelog = readFileSync("CHANGELOG.md", "utf-8");

    expect(bugReport).toContain("Bug report");
    expect(bugReport).toContain("reproducible problems");
    expect(bugReport).toContain("claude-memory-mcp doctor");
    expect(bugReport).toContain("local-first");
    expect(existsSync(".github/ISSUE_TEMPLATE/feature_request.yml")).toBe(false);
    expect(issueConfig).toContain("blank_issues_enabled: false");
    expect(pullRequestTemplate).toContain("npm run release:check");
    expect(pullRequestTemplate).toContain("narrow maintenance change");
    expect(pullRequestTemplate).toContain("public docs");
    expect(pullRequestTemplate).toContain("schema");
    expect(changelog).toContain("maintenance-focused issue and pull request intake");
  });

  it("keeps CI aligned with the supported release baseline", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf-8");
    const publish = readFileSync(".github/workflows/publish.yml", "utf-8");

    expect(ci).not.toContain("node-version: [18");
    expect(ci).toContain("windows-latest");
    expect(ci).toContain("node-version: [20, 22, 24]");
    expect(ci).toContain("npm audit --omit=dev --audit-level=high");
    expect(publish).toContain("npm run release:check");
    expect(publish).toContain("git fetch --no-tags origin main");
    expect(publish).toContain("git merge-base --is-ancestor HEAD origin/main");
    expect(readFileSync("CHANGELOG.md", "utf-8")).toContain("production dependency audit");
  });
});
