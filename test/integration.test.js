/**
 * Integration tests for Memory MCP Server
 * Tests installer functionality and package integrity
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { platform } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

describe('Package Integrity', () => {
  it('should have install.js with correct shebang', () => {
    const installPath = join(projectRoot, 'install.js');
    expect(existsSync(installPath)).toBe(true);

    const content = readFileSync(installPath, 'utf-8');
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('should have built dist/index.js with shebang', () => {
    const distPath = join(projectRoot, 'dist', 'index.js');
    expect(existsSync(distPath)).toBe(true);

    const content = readFileSync(distPath, 'utf-8');
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('should have correct bin entries in package.json', () => {
    const packagePath = join(projectRoot, 'package.json');
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));

    expect(pkg.bin).toBeDefined();
    // v2.4.0: bin points to server, installer is separate
    expect(pkg.bin['memory-mcp']).toBe('./dist/index.js');
    expect(pkg.bin['memory-mcp-install']).toBe('./install.js');
  });

  it('should include required files in package', () => {
    const packagePath = join(projectRoot, 'package.json');
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));

    expect(pkg.files).toBeDefined();
    expect(pkg.files).toContain('dist/');
    expect(pkg.files).toContain('install.js');
    expect(pkg.files).toContain('README.md');
    expect(pkg.files).toContain('LICENSE');
  });

  it('should have prepublishOnly script for auto-build', () => {
    const packagePath = join(projectRoot, 'package.json');
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));

    // Build runs via prepublishOnly before npm publish
    expect(pkg.scripts.prepublishOnly).toBeDefined();
    expect(pkg.scripts.prepublishOnly).toContain('build');
  });
});

describe('Installer Logic', () => {
  it('should export platform-specific config helper', () => {
    // Read install.js and verify it contains platform detection
    const installPath = join(projectRoot, 'install.js');
    const content = readFileSync(installPath, 'utf-8');

    // Check for essential functions
    expect(content).toContain('getClaudeConfigPath');
    expect(content).toContain('getMcpServerConfig');

    // Check for platform handling
    expect(content).toContain('darwin'); // macOS
    expect(content).toContain('win32'); // Windows

    // v2.4.0: npx github: approach for all platforms
    expect(content).toContain("command: 'npx'");
    expect(content).toContain('github:whenmoon-afk/claude-memory-mcp');
  });

  it('should detect correct platform', () => {
    const currentPlatform = platform();
    expect(['darwin', 'win32', 'linux']).toContain(currentPlatform);
  });

  it('should have backup logic in installer', () => {
    const installPath = join(projectRoot, 'install.js');
    const content = readFileSync(installPath, 'utf-8');

    expect(content).toContain('.backup');
    expect(content).toContain('writeFileSync');
  });

  it('should handle config creation and updates', () => {
    const installPath = join(projectRoot, 'install.js');
    const content = readFileSync(installPath, 'utf-8');

    // Verify config manipulation
    expect(content).toContain('mcpServers');
    expect(content).toContain('JSON.parse');
    expect(content).toContain('JSON.stringify');
  });
});

describe('Windows Compatibility', () => {
  it('installer should use npx github: approach', () => {
    const installPath = join(projectRoot, 'install.js');
    const content = readFileSync(installPath, 'utf-8');

    // v2.4.0: npx github: approach works on all platforms including Windows
    expect(content).toContain("command: 'npx'");
    expect(content).toContain('github:whenmoon-afk/claude-memory-mcp');
    expect(content).toContain('MEMORY_DB_PATH');
  });

  it('README should document installation process', () => {
    const readmePath = join(projectRoot, 'README.md');
    const content = readFileSync(readmePath, 'utf-8');

    expect(content).toContain('npx @whenmoon-afk/memory-mcp');
    expect(content).toContain('Windows');
  });
});

describe('Documentation', () => {
  it('should not claim "no external dependencies"', () => {
    const readmePath = join(projectRoot, 'README.md');
    const content = readFileSync(readmePath, 'utf-8');

    // Should NOT contain the false claim
    expect(content).not.toContain('no external dependencies');

    // Should mention actual dependencies (v2.3.0: simplified README)
    expect(content).toContain('minimal dependencies');
    expect(content).toContain('@modelcontextprotocol/sdk');
    expect(content).toContain('better-sqlite3');
  });

  it('should have Dependencies section in README', () => {
    const readmePath = join(projectRoot, 'README.md');
    const content = readFileSync(readmePath, 'utf-8');

    expect(content).toContain('## Dependencies');
    expect(content).toContain('@modelcontextprotocol/sdk');
    expect(content).toContain('better-sqlite3');
  });

  it('should document installation methods', () => {
    const readmePath = join(projectRoot, 'README.md');
    const content = readFileSync(readmePath, 'utf-8');

    // v2.4.0: Multiple installation methods documented
    expect(content).toContain('## Quick Start');
    expect(content).toContain('Direct from GitHub');
    expect(content).toContain('Global Install');
    expect(content).toContain('github:whenmoon-afk/claude-memory-mcp');
    expect(content).toContain('memory-mcp-install');
  });
});

describe('Version Consistency', () => {
  it('should read version dynamically from package.json', () => {
    const indexPath = join(projectRoot, 'src', 'index.ts');
    const indexContent = readFileSync(indexPath, 'utf-8');

    // v2.4.0: Version is read dynamically from package.json
    expect(indexContent).toContain('VERSION');
    expect(indexContent).toContain('packageJson.version');
    expect(indexContent).toContain('version: VERSION');
  });

  it('should be version 2.5.0', () => {
    const packagePath = join(projectRoot, 'package.json');
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));

    expect(pkg.version).toBe('2.5.0');
  });
});
