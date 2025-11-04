#!/usr/bin/env node

/**
 * Memory MCP Server - Automatic Installation Script
 * Configures Claude Desktop to use the memory server
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { homedir, platform } from 'os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get Claude Desktop config path based on platform
 */
function getClaudeConfigPath() {
  const plat = platform();

  switch (plat) {
    case 'darwin': // macOS
      return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');

    case 'win32': // Windows
      return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');

    default: // Linux and others
      const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
      return join(configHome, 'Claude', 'claude_desktop_config.json');
  }
}

/**
 * Get platform-specific MCP server configuration
 */
function getMcpServerConfig() {
  // Get the absolute path to the installed package
  const packageRoot = dirname(__dirname);
  const serverPath = join(packageRoot, 'dist', 'index.js');

  // All platforms use node directly with the server path
  return {
    command: 'node',
    args: [serverPath]
  };
}

/**
 * Install the memory server configuration
 */
function install() {
  console.log('🧠 Memory MCP Server - Automatic Installation\n');

  const configPath = getClaudeConfigPath();
  const configDir = dirname(configPath);

  // Ensure config directory exists
  if (!existsSync(configDir)) {
    console.log(`📁 Creating config directory: ${configDir}`);
    try {
      mkdirSync(configDir, { recursive: true });
    } catch (error) {
      console.error(`❌ Failed to create config directory: ${error.message}`);
      console.log('\n⚠️  Please create the directory manually and run this installer again.');
      process.exit(1);
    }
  }

  // Read existing config or create new one
  let config = { mcpServers: {} };
  let isNewConfig = true;

  if (existsSync(configPath)) {
    isNewConfig = false;
    console.log(`📖 Reading existing config: ${configPath}`);

    try {
      const configContent = readFileSync(configPath, 'utf-8');
      config = JSON.parse(configContent);

      // Ensure mcpServers object exists
      if (!config.mcpServers) {
        config.mcpServers = {};
      }

      // Create backup
      const backupPath = `${configPath}.backup`;
      writeFileSync(backupPath, configContent, 'utf-8');
      console.log(`💾 Backup created: ${backupPath}`);

    } catch (error) {
      console.error(`❌ Failed to read/parse config file: ${error.message}`);
      console.log('\n⚠️  Your config file may be corrupted. Please fix it manually or delete it to create a new one.');
      process.exit(1);
    }
  } else {
    console.log(`📝 Creating new config file: ${configPath}`);
  }

  // Add or update memory server configuration
  const serverConfig = getMcpServerConfig();
  const serverExists = config.mcpServers.memory !== undefined;

  config.mcpServers.memory = serverConfig;

  // Write updated config
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    if (serverExists) {
      console.log('✅ Memory server configuration updated!');
    } else {
      console.log('✅ Memory server configuration added!');
    }

  } catch (error) {
    console.error(`❌ Failed to write config file: ${error.message}`);
    console.log('\n⚠️  Please check file permissions and try again.');
    process.exit(1);
  }

  // Display next steps
  console.log('\n📋 Next Steps:');
  console.log('1. Restart Claude Desktop completely (quit and reopen)');
  console.log('2. The memory server will be available automatically');
  console.log('3. Try asking Claude to "store a memory" or "recall memories about..."');

  console.log('\n📍 Configuration Location:');
  console.log(`   ${configPath}`);

  console.log('\n✨ Installation complete! Enjoy your persistent AI memory!\n');
}

// Run installer
try {
  install();
} catch (error) {
  console.error('❌ Installation failed:', error.message);
  console.error('\n📖 For manual installation instructions, see:');
  console.error('   https://github.com/WhenMoon-afk/claude-memory-mcp#readme');
  process.exit(1);
}
