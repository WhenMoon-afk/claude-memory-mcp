#!/usr/bin/env node

/**
 * Package memory-mcp as a Claude Desktop extension (.mcpb)
 * Uses Anthropic's official mcpb CLI for standards compliance
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const BUILD_DIR = join(ROOT, 'build-desktop');
const OUTPUT_FILE = join(ROOT, 'memory-mcp.mcpb');

console.log('📦 Packaging memory-mcp for Claude Desktop...\n');

// Clean and create build directory
if (existsSync(BUILD_DIR)) {
  execSync(`rm -rf "${BUILD_DIR}"`, { stdio: 'inherit' });
}
mkdirSync(BUILD_DIR, { recursive: true });

// Copy manifest from desktop-extension folder
const manifestSrc = join(ROOT, 'desktop-extension', 'manifest.json');
const manifestDest = join(BUILD_DIR, 'manifest.json');
copyFileSync(manifestSrc, manifestDest);
console.log('✓ Copied manifest.json');

// Copy dist folder
const distSrc = join(ROOT, 'dist');
const distDest = join(BUILD_DIR, 'dist');
execSync(`cp -r "${distSrc}" "${distDest}"`, { stdio: 'inherit' });
console.log('✓ Copied dist/');

// Install production dependencies in build dir
const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const prodPackage = {
  name: packageJson.name,
  version: packageJson.version,
  type: 'module',
  dependencies: packageJson.dependencies
};
const prodPackagePath = join(BUILD_DIR, 'package.json');
writeFileSync(prodPackagePath, JSON.stringify(prodPackage, null, 2));

console.log('⏳ Installing production dependencies...');
execSync('npm install --omit=dev --ignore-scripts', {
  cwd: BUILD_DIR,
  stdio: 'inherit'
});
console.log('✓ Installed dependencies');

// Copy README and LICENSE
if (existsSync(join(ROOT, 'desktop-extension', 'README.md'))) {
  copyFileSync(join(ROOT, 'desktop-extension', 'README.md'), join(BUILD_DIR, 'README.md'));
}
if (existsSync(join(ROOT, 'LICENSE'))) {
  copyFileSync(join(ROOT, 'LICENSE'), join(BUILD_DIR, 'LICENSE'));
}
console.log('✓ Copied README and LICENSE');

// Use official mcpb CLI to pack
console.log('\n⏳ Creating .mcpb archive with official mcpb CLI...');
if (existsSync(OUTPUT_FILE)) {
  execSync(`rm "${OUTPUT_FILE}"`, { stdio: 'inherit' });
}

try {
  execSync(`npx @anthropic-ai/mcpb pack "${BUILD_DIR}" "${OUTPUT_FILE}"`, {
    stdio: 'inherit',
    cwd: ROOT
  });
} catch (error) {
  console.error('❌ mcpb pack failed, falling back to zip...');
  execSync(`cd "${BUILD_DIR}" && zip -r "${OUTPUT_FILE}" .`, { stdio: 'inherit' });
}

// Get file size
const { statSync } = await import('fs');
const stats = statSync(OUTPUT_FILE);
const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

console.log(`\n✅ Created ${OUTPUT_FILE}`);
console.log(`   Size: ${sizeMB} MB`);

// Validate the output
console.log('\n⏳ Validating output...');
try {
  execSync(`npx @anthropic-ai/mcpb info "${OUTPUT_FILE}"`, { stdio: 'inherit' });
} catch {
  console.log('   (mcpb info not available, skipping validation)');
}

console.log('\n📋 Next steps:');
console.log('   1. Test: Drag memory-mcp.mcpb into Claude Desktop');
console.log('   2. Submit: https://docs.anthropic.com/desktop-extensions/submit');
console.log('   3. Or host on GitHub releases for manual downloads\n');
