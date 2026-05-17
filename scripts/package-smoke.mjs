#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { runNpm } from "./npm-invocation.mjs";

const requiredFiles = [
  "package/dist/index.js",
  "package/dist/index.d.ts",
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
  /^package\/CLAUDE\.md$/,
  /^package\/manifest\.json$/,
  /^package\/mcp-servers\.json$/,
  /^package\/CODEX-CRASH-NOTE-/,
  /^package\/(RECOVERY|SESSION).*\.md$/,
  /^package\/.*\.mcpb$/,
];

const expectedPackageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

runNpm(["run", "clean"], { execFileSync, stdio: "inherit" });
runNpm(["run", "build"], { execFileSync, stdio: "inherit" });

const packDir = mkdtempSync(join(tmpdir(), "memory-mcp-package-smoke-"));
const archive = runNpm(
  [
    "pack",
    "--silent",
    "--ignore-scripts",
    "--dry-run=false",
    "--pack-destination",
    packDir,
  ],
  {
    execFileSync,
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

  if (packageJson.name !== expectedPackageJson.name) {
    fail(`Expected package name ${expectedPackageJson.name}, got ${packageJson.name}`);
  }

  if (packageJson.version !== expectedPackageJson.version) {
    fail(
      `Expected package version ${expectedPackageJson.version}, got ${packageJson.version}`,
    );
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

  const installDir = mkdtempSync(join(tmpdir(), "memory-mcp-package-install-"));
  try {
    writeFileSync(join(installDir, "package.json"), '{"private":true}\n');
    runNpm(["install", "--no-audit", "--no-fund", archivePath], {
      execFileSync,
      cwd: installDir,
      stdio: "inherit",
    });

    const setupOutput = runNpm(["exec", "--", "claude-memory-mcp", "setup"], {
      execFileSync,
      cwd: installDir,
      encoding: "utf8",
      env: {
        ...process.env,
        CLAUDE_MEMORY_DATA_DIR: join(installDir, "data"),
      },
    });

    if (!setupOutput.includes("Continuity MCP")) {
      fail("Installed claude-memory-mcp binary did not print setup instructions");
    }

    const versionOutput = runNpm(["exec", "--", "claude-memory-mcp", "--version"], {
      execFileSync,
      cwd: installDir,
      encoding: "utf8",
    }).trim();

    if (versionOutput !== expectedPackageJson.version) {
      fail(
        `Installed claude-memory-mcp binary reported version ${versionOutput}, expected ${expectedPackageJson.version}`,
      );
    }
  } finally {
    rmSync(installDir, { recursive: true, force: true });
  }
} finally {
  rmSync(packDir, { recursive: true, force: true });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
