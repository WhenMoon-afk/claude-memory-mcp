import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  getDataDir,
  getObservationsPath,
  getIdentityDir,
  migrateIfNeeded,
} from "./paths.js";

describe("getDataDir", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("uses IDENTITY_DATA_DIR when set (highest priority)", () => {
    process.env["IDENTITY_DATA_DIR"] = "/explicit/override";
    process.env["XDG_DATA_HOME"] = "/custom/data";
    expect(getDataDir()).toBe("/explicit/override");
    delete process.env["IDENTITY_DATA_DIR"];
  });

  it("uses XDG_DATA_HOME when set", () => {
    process.env["XDG_DATA_HOME"] = "/custom/data";
    expect(getDataDir()).toBe("/custom/data/claude-memory");
  });

  it("falls back to ~/.local/share when XDG_DATA_HOME is unset", () => {
    delete process.env["XDG_DATA_HOME"];
    process.env["HOME"] = "/home/testuser";
    expect(getDataDir()).toBe("/home/testuser/.local/share/claude-memory");
  });

  it("uses APPDATA on Windows when set", () => {
    delete process.env["XDG_DATA_HOME"];
    delete process.env["HOME"];
    process.env["APPDATA"] = "C:\\Users\\TestUser\\AppData\\Roaming";
    // Use join() so separator matches platform (/ on Linux, \ on Windows)
    expect(getDataDir()).toBe(
      join("C:\\Users\\TestUser\\AppData\\Roaming", "claude-memory"),
    );
    delete process.env["APPDATA"];
  });

  it("prefers XDG_DATA_HOME over APPDATA", () => {
    process.env["XDG_DATA_HOME"] = "/custom/data";
    process.env["APPDATA"] = "C:\\Users\\TestUser\\AppData\\Roaming";
    expect(getDataDir()).toBe("/custom/data/claude-memory");
    delete process.env["APPDATA"];
  });
});

describe("getObservationsPath", () => {
  beforeEach(() => {
    process.env["XDG_DATA_HOME"] = "/custom/data";
  });

  afterEach(() => {
    delete process.env["XDG_DATA_HOME"];
  });

  it("returns observations.json inside data dir", () => {
    expect(getObservationsPath()).toBe(
      "/custom/data/claude-memory/observations.json",
    );
  });
});

describe("getIdentityDir", () => {
  beforeEach(() => {
    process.env["XDG_DATA_HOME"] = "/custom/data";
  });

  afterEach(() => {
    delete process.env["XDG_DATA_HOME"];
  });

  it("returns identity subdirectory inside data dir", () => {
    expect(getIdentityDir()).toBe("/custom/data/claude-memory/identity");
  });
});

describe("migrateIfNeeded", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    tmpDir = mkdtempSync(join(tmpdir(), "migrate-test-"));
  });

  afterEach(() => {
    process.env = originalEnv;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("copies legacy data to new path when APPDATA differs from HOME", () => {
    // Simulate: legacy data at HOME/.local/share/claude-memory
    const fakeHome = join(tmpDir, "home");
    const fakeAppdata = join(tmpDir, "appdata");
    const legacyDir = join(fakeHome, ".local", "share", "claude-memory");
    const legacyIdentity = join(legacyDir, "identity");
    mkdirSync(legacyIdentity, { recursive: true });
    writeFileSync(
      join(legacyIdentity, "soul.md"),
      "# Soul\n\nI am a test agent.",
    );
    writeFileSync(
      join(legacyDir, "observations.json"),
      '{"test":{"total_recalls":1}}',
    );

    // Set env so getDataDir() returns APPDATA path (different from legacy)
    delete process.env["IDENTITY_DATA_DIR"];
    delete process.env["XDG_DATA_HOME"];
    process.env["APPDATA"] = fakeAppdata;
    process.env["HOME"] = fakeHome;

    const newDir = getDataDir(); // Should be fakeAppdata/claude-memory
    expect(existsSync(newDir)).toBe(false); // Not yet created

    migrateIfNeeded();

    // Data should now exist at new path
    expect(existsSync(join(newDir, "identity", "soul.md"))).toBe(true);
    expect(
      readFileSync(join(newDir, "identity", "soul.md"), "utf-8"),
    ).toContain("I am a test agent");
    expect(existsSync(join(newDir, "observations.json"))).toBe(true);
  });

  it("does nothing when new path already has data", () => {
    const fakeHome = join(tmpDir, "home");
    const fakeAppdata = join(tmpDir, "appdata");
    const legacyDir = join(fakeHome, ".local", "share", "claude-memory");
    mkdirSync(join(legacyDir, "identity"), { recursive: true });
    writeFileSync(join(legacyDir, "identity", "soul.md"), "OLD SOUL");

    // New path already exists with different data
    const newDir = join(fakeAppdata, "claude-memory");
    mkdirSync(join(newDir, "identity"), { recursive: true });
    writeFileSync(join(newDir, "identity", "soul.md"), "NEW SOUL");

    delete process.env["IDENTITY_DATA_DIR"];
    delete process.env["XDG_DATA_HOME"];
    process.env["APPDATA"] = fakeAppdata;
    process.env["HOME"] = fakeHome;

    migrateIfNeeded();

    // New data should be preserved, not overwritten
    expect(readFileSync(join(newDir, "identity", "soul.md"), "utf-8")).toBe(
      "NEW SOUL",
    );
  });

  it("does nothing when no legacy data exists", () => {
    const fakeHome = join(tmpDir, "home");
    const fakeAppdata = join(tmpDir, "appdata");

    delete process.env["IDENTITY_DATA_DIR"];
    delete process.env["XDG_DATA_HOME"];
    process.env["APPDATA"] = fakeAppdata;
    process.env["HOME"] = fakeHome;

    migrateIfNeeded(); // Should not throw

    const newDir = getDataDir();
    expect(existsSync(newDir)).toBe(false); // Nothing created
  });

  it("skips migration when IDENTITY_DATA_DIR is set", () => {
    const explicit = join(tmpDir, "explicit");
    process.env["IDENTITY_DATA_DIR"] = explicit;

    migrateIfNeeded(); // Should not throw or migrate

    expect(existsSync(explicit)).toBe(false); // Not created by migration
  });
});
