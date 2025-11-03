#!/usr/bin/env node
/**
 * Build script for creating optimized MCPB bundle
 * Only includes production dependencies and built code
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Read version from package.json
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = packageJson.version;

console.log(`🏗️  Building Memory MCP v${version} MCPB Bundle...\n`);

// Step 1: Clean previous builds
console.log('1. Cleaning previous builds...');
if (fs.existsSync('.mcpb-build')) {
  fs.rmSync('.mcpb-build', { recursive: true, force: true });
}
execSync('npm run clean', { stdio: 'inherit' });

// Step 2: Build TypeScript
console.log('\n2. Building TypeScript...');
execSync('npm run build', { stdio: 'inherit' });

// Step 3: Create build directory
console.log('\n3. Creating optimized bundle directory...');
fs.mkdirSync('.mcpb-build', { recursive: true });

// Step 4: Copy only necessary files
console.log('4. Copying production files...');
const filesToCopy = [
  'dist',
  'manifest.json',
  'mcpb/manifest.json',
  'LICENSE',
  'README.md',
  'package.json',
  'package-lock.json',
];

for (const file of filesToCopy) {
  const src = path.join(process.cwd(), file);
  const dest = path.join('.mcpb-build', file);

  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.statSync(src).isDirectory()) {
      fs.cpSync(src, dest, { recursive: true });
    } else {
      fs.copyFileSync(src, dest);
    }
    console.log(`   ✓ ${file}`);
  }
}

// Step 5: Install ONLY production dependencies in build dir
console.log('\n5. Installing production dependencies...');
process.chdir('.mcpb-build');
execSync('npm install --production --no-audit --no-fund', { stdio: 'inherit' });
process.chdir('..');

// Step 6: Create MCPB bundle
console.log('\n6. Creating MCPB bundle...');
process.chdir('.mcpb-build');
execSync('npx mcpb pack', { stdio: 'inherit' });
process.chdir('..');

// Step 7: Move bundle to root
console.log('\n7. Moving bundle to root...');
const bundleName = `memory-mcp-v${version}.mcpb`;
if (fs.existsSync(path.join('.mcpb-build', bundleName))) {
  fs.copyFileSync(
    path.join('.mcpb-build', bundleName),
    bundleName
  );
  console.log(`   ✓ ${bundleName}`);
} else {
  // Try alternative name
  const files = fs.readdirSync('.mcpb-build');
  const mcpbFile = files.find((f) => f.endsWith('.mcpb'));
  if (mcpbFile) {
    fs.copyFileSync(path.join('.mcpb-build', mcpbFile), bundleName);
    console.log(`   ✓ ${bundleName}`);
  }
}

// Step 8: Show bundle info
if (fs.existsSync(bundleName)) {
  const stats = fs.statSync(bundleName);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`\n✅ Bundle created successfully!`);
  console.log(`   📦 ${bundleName}`);
  console.log(`   📊 Size: ${sizeMB} MB`);
} else {
  console.error('\n❌ Bundle creation failed!');
  process.exit(1);
}

console.log('\n🎉 Build complete!');
