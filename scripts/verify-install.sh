#!/bin/bash

# Verification script for Memory MCP installer
# Tests package integrity and installation process

set -e

echo "🔍 Memory MCP Installation Verification Script"
echo "=============================================="
echo ""

# Check Node.js version
echo "📦 Checking Node.js version..."
NODE_VERSION=$(node --version)
echo "   Node.js: $NODE_VERSION"
echo ""

# Build the project
echo "🔨 Building project..."
npm run build
echo "   ✅ Build successful"
echo ""

# Run tests
echo "🧪 Running tests..."
npm test
echo "   ✅ All tests passed"
echo ""

# Create package
echo "📦 Creating package..."
npm pack
TARBALL=$(ls -t *.tgz | head -1)
echo "   Created: $TARBALL"
echo ""

# Check package contents
echo "📋 Verifying package contents..."
REQUIRED_FILES=("package/dist/index.js" "package/install.js" "package/README.md" "package/LICENSE")

for file in "${REQUIRED_FILES[@]}"; do
  if tar -tzf "$TARBALL" | grep -q "^$file$"; then
    echo "   ✅ $file"
  else
    echo "   ❌ Missing: $file"
    exit 1
  fi
done
echo ""

# Check shebang in install.js
echo "🔍 Verifying install.js shebang..."
tar -xzf "$TARBALL" package/install.js
if head -n 1 package/install.js | grep -q "#!/usr/bin/env node"; then
  echo "   ✅ install.js has correct shebang"
else
  echo "   ❌ install.js missing shebang"
  exit 1
fi
echo ""

# Check shebang in dist/index.js
echo "🔍 Verifying dist/index.js shebang..."
tar -xzf "$TARBALL" package/dist/index.js
if head -n 1 package/dist/index.js | grep -q "#!/usr/bin/env node"; then
  echo "   ✅ dist/index.js has correct shebang"
else
  echo "   ❌ dist/index.js missing shebang"
  exit 1
fi
echo ""

# Cleanup
echo "🧹 Cleaning up..."
rm -rf package/
rm -f "$TARBALL"
echo "   ✅ Cleanup complete"
echo ""

echo "✨ Verification complete! Package is ready for publishing."
echo ""
echo "Next steps:"
echo "  1. Review changes: git diff main..feat/npx-installer"
echo "  2. Merge PR: git checkout main && git merge feat/npx-installer"
echo "  3. Publish: npm publish"
