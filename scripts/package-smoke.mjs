#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";

const requiredFiles = [
  "package/dist/index.js",
  "package/README.md",
  "package/CONTRACT.md",
  "package/CHANGELOG.md",
  "package/RELEASE.md",
  "package/SECURITY.md",
  "package/CONTRIBUTING.md",
  "package/LICENSE",
  "package/package.json",
];

const forbiddenPatterns = [
  /^package\/(cli|commands|hooks|skills|docs)\//,
  /^package\/dist\/(clock|identity|observations|paths)\./,
  /^package\/dist\/.*\.fixtures\./,
  /^package\/dist\/tools\//,
  /^package\/\.github\//,
  /^package\/manifest\.json$/,
  /^package\/mcp-servers\.json$/,
  /^package\/CODEX-CRASH-NOTE-/,
  /^package\/.*\.mcpb$/,
];

execFileSync("npm", ["run", "clean"], { stdio: "inherit" });
execFileSync("npm", ["run", "build"], { stdio: "inherit" });

const packDir = mkdtempSync(join(tmpdir(), "memory-mcp-package-smoke-"));
const archive = execFileSync(
  "npm",
  [
    "pack",
    "--silent",
    "--ignore-scripts",
    "--dry-run=false",
    "--pack-destination",
    packDir,
  ],
  {
    encoding: "utf8",
    env: { ...process.env, npm_config_dry_run: "false" },
  },
)
  .trim()
  .split(/\r?\n/)
  .at(-1);

if (!archive) {
  fail("npm pack did not return an archive name");
}

const archivePath = isAbsolute(archive) ? archive : join(packDir, archive);

try {
  const contents = execFileSync("tar", ["-tf", archivePath], {
    encoding: "utf8",
  })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

  const contentSet = new Set(contents);
  const missing = requiredFiles.filter((file) => !contentSet.has(file));
  if (missing.length > 0) {
    fail(`Missing expected npm package files:\n${missing.join("\n")}`);
  }

  const forbidden = contents.filter((file) =>
    forbiddenPatterns.some((pattern) => pattern.test(file)),
  );
  if (forbidden.length > 0) {
    fail(`Unexpected files found in npm package:\n${forbidden.join("\n")}`);
  }

  const packageJson = JSON.parse(
    execFileSync("tar", ["-xOf", archivePath, "package/package.json"], {
      encoding: "utf8",
    }),
  );

  if (packageJson.version !== "3.0.0") {
    fail(`Expected package version 3.0.0, got ${packageJson.version}`);
  }

  if (packageJson.bin?.["claude-memory-mcp"] !== "dist/index.js") {
    fail("Expected claude-memory-mcp bin to point at dist/index.js");
  }

  if (packageJson.bin?.["memory-mcp"]) {
    fail("Unexpected legacy memory-mcp bin found in package metadata");
  }

  if (packageJson.types !== "./dist/index.d.ts") {
    fail("Expected package types to point at ./dist/index.d.ts");
  }

  if (!packageJson.keywords?.includes("local-first")) {
    fail("Expected package keywords to include local-first");
  }

  if (!packageJson.keywords?.includes("local-memory")) {
    fail("Expected package keywords to include local-memory");
  }
} finally {
  rmSync(packDir, { recursive: true, force: true });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
