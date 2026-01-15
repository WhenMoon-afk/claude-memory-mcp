#!/usr/bin/env node

/**
 * Memory MCP Server - Brain-inspired memory system with smart context loading
 * Version is read dynamically from package.json
 */

import { homedir, platform } from 'os';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// Read version from package.json dynamically
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// In dist/, package.json is one level up
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
  version: string;
};
const VERSION = packageJson.version;
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type { DbDriver } from './database/db-driver.js';
import { getDatabase, closeDatabase } from './database/connection.js';
import { memoryStore } from './tools/memory-store.js';
import { memoryRecall } from './tools/memory-recall.js';
import { memoryForget } from './tools/memory-forget.js';
import type { MemoryInput, SearchOptions } from './types/index.js';
import { isCloudEnabled, getCloudConfig, saveApiKey, getConfigPath, checkCloudHealth } from './cloud.js';

/**
 * Get platform-specific default database path
 * Ensures consistent location across Claude Desktop, Claude Code, and other clients
 */
function getDefaultDbPath(): string {
  const plat = platform();

  let dbPath: string;

  if (plat === 'darwin') {
    // macOS: ~/.claude-memories/memory.db
    dbPath = join(homedir(), '.claude-memories', 'memory.db');
  } else if (plat === 'win32') {
    // Windows: %APPDATA%/claude-memories/memory.db
    dbPath = join(
      process.env['APPDATA'] || join(homedir(), 'AppData', 'Roaming'),
      'claude-memories',
      'memory.db'
    );
  } else {
    // Linux/other: XDG compliant ~/.local/share/claude-memories/memory.db
    const xdgData =
      process.env['XDG_DATA_HOME'] || join(homedir(), '.local', 'share');
    dbPath = join(xdgData, 'claude-memories', 'memory.db');
  }

  // Ensure directory exists
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  return dbPath;
}

/**
 * Configuration from environment or defaults
 */
const config = {
  databasePath: process.env['MEMORY_DB_PATH'] || getDefaultDbPath(),
  defaultTTLDays: parseInt(process.env['DEFAULT_TTL_DAYS'] || '90'),
  databaseDriver: process.env['MEMORY_DB_DRIVER'] || 'better-sqlite3',
};

/**
 * Handle memory_cloud tool actions
 */
async function handleMemoryCloud(action: string, apiKey?: string): Promise<string> {
  switch (action) {
    case 'connect': {
      if (!apiKey) {
        // Show current status and instructions
        const cloudConfig = getCloudConfig();
        const configPath = getConfigPath();

        if (cloudConfig.enabled) {
          return `Cloud sync already configured.\n\nConfig file: ${configPath}\nAPI URL: ${cloudConfig.apiUrl}\n\nTo reconfigure, provide a new api_key.`;
        }

        return `Connect to Substratia Cloud\n\n1. Go to https://substratia.io/dashboard\n2. Click "Connect Claude Code"\n3. Paste the command in Claude Code\n\nOr provide api_key parameter directly.`;
      }

      // Validate API key format (sk_ prefix)
      const key = apiKey.trim();
      if (!key.startsWith('sk_')) {
        return `Invalid API key format. Keys should start with "sk_".\n\nGet your key from: https://substratia.io/dashboard`;
      }

      // Save the API key to config file
      const result = saveApiKey(key);
      if (!result.success) {
        return `Failed to save API key: ${result.error}\n\nYou can set SUBSTRATIA_API_KEY environment variable instead.`;
      }

      const configPath = getConfigPath();

      // Verify connection by checking cloud health
      const cloudConfig = getCloudConfig();
      const healthResult = await checkCloudHealth(cloudConfig);

      if (!healthResult.ok) {
        return `API key saved to: ${configPath}\n\nWarning: Could not verify connection (${healthResult.error})\nKey will be used when service is available.`;
      }

      return `Connected to Substratia Cloud!\n\nConfig saved to: ${configPath}\n\nYour memories will sync when cloud sync is fully enabled.`;
    }

    case 'status': {
      const cloudConfig = getCloudConfig();
      const configPath = getConfigPath();

      if (!cloudConfig.enabled) {
        return `Cloud sync: Not configured\n\nTo enable:\n1. Go to https://substratia.io/dashboard\n2. Create an API key\n3. Run: memory_cloud action:connect api_key:sk_xxx`;
      }

      const healthResult = await checkCloudHealth(cloudConfig);
      const status = healthResult.ok ? 'Connected' : `Unavailable (${healthResult.error})`;

      return `Cloud sync: ${status}\nConfig file: ${configPath}\nAPI URL: ${cloudConfig.apiUrl}`;
    }

    case 'help':
    default: {
      const cloudEnabled = isCloudEnabled();
      const cloudStatus = cloudEnabled ? 'Enabled' : 'Not configured';

      return `# Memory MCP Cloud Sync

## Actions

**connect** - Setup API key for cloud sync
  Optional: api_key (starts with sk_)

**status** - Check cloud connection status

**help** - This message

## Cloud Sync
Status: ${cloudStatus}
${!cloudEnabled ? `
To enable:
1. Go to https://substratia.io/dashboard
2. Click "Connect Claude Code"
3. Paste the command in Claude Code
` : ''}
## Shared Config
memory-mcp shares its config with momentum plugin.
Config file: ~/.config/substratia/credentials.json
Connect once, both tools sync to cloud.`;
    }
  }
}

/**
 * Initialize MCP server
 */
const server = new Server(
  {
    name: '@whenmoon-afk/memory-mcp',
    version: VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Database instance (initialized in main)
let db: DbDriver;

/**
 * Tool definitions
 */
server.setRequestHandler(ListToolsRequestSchema, () => {
  return {
    tools: [
      {
        name: 'memory_store',
        description:
          'Store or update a memory. Provide "id" to update existing memory, omit to create new. Returns standard-formatted memory (no embeddings). Supports fact, entity, relationship, and self memory types.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Memory ID to update (omit to create new memory)',
            },
            content: {
              type: 'string',
              description: 'The memory content to store',
            },
            type: {
              type: 'string',
              enum: ['fact', 'entity', 'relationship', 'self'],
              description: 'Type of memory: fact (discrete info), entity (people/places/things), relationship (connections), self (user preferences)',
            },
            importance: {
              type: 'number',
              description: 'Importance score 0-10 (auto-calculated if not provided)',
              minimum: 0,
              maximum: 10,
            },
            entities: {
              type: 'array',
              items: { type: 'string' },
              description: 'Related entity names (auto-extracted if not provided)',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags for categorization',
            },
            metadata: {
              type: 'object',
              description: 'Additional metadata',
            },
            ttl_days: {
              type: 'number',
              description: 'Time-to-live in days (null for permanent)',
            },
            expires_at: {
              type: 'string',
              description: 'Explicit expiration timestamp (ISO format)',
            },
            provenance: {
              type: 'object',
              description: 'Provenance information (source, timestamp, context)',
            },
          },
          required: ['content', 'type'],
        },
      },
      {
        name: 'memory_recall',
        description:
          'Search memories with intelligent token-aware loading. Always returns memory index (summaries) plus detailed content that fits within token budget. Skill-pattern design: see what exists, load details selectively.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Natural language search query',
            },
            max_tokens: {
              type: 'number',
              description: 'Token budget for response (default: 1000). System auto-allocates: summaries first, then fills remaining budget with full content for top matches.',
              default: 1000,
              minimum: 100,
              maximum: 5000,
            },
            type: {
              type: 'string',
              enum: ['fact', 'entity', 'relationship', 'self'],
              description: 'Optional: Filter by memory type',
            },
            entities: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional: Filter by related entities',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (default: 20, max: 50)',
              default: 20,
              maximum: 50,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'memory_forget',
        description:
          'Soft-delete a memory by ID. Preserves provenance for audit trail. Memory can be recovered or permanently deleted later.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Memory ID to forget',
            },
            reason: {
              type: 'string',
              description: 'Reason for forgetting (stored in provenance)',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'memory_cloud',
        description:
          'Manage Substratia Cloud sync. Actions: connect (setup API key), status (check cloud connection), help (show usage).',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['connect', 'status', 'help'],
              description: 'connect=setup API key, status=check connection, help=show usage',
            },
            api_key: {
              type: 'string',
              description: 'For connect action: Substratia API key (starts with sk_)',
            },
          },
          required: ['action'],
        },
      },
    ],
  };
});

/**
 * Tool execution handler
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'memory_store': {
        const result = memoryStore(db, args as unknown as MemoryInput);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'memory_recall': {
        const result = memoryRecall(db, args as unknown as SearchOptions);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'memory_forget': {
        const { id, reason } = args as { id: string; reason?: string };
        const result = memoryForget(db, id, reason);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'memory_cloud': {
        const { action, api_key } = args as { action: string; api_key?: string };
        const result = await handleMemoryCloud(action, api_key);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new McpError(ErrorCode.InternalError, message);
  }
});

/**
 * Start server
 */
async function main() {
  try {
    // Initialize database
    console.error(`[memory-mcp v${VERSION}] Initializing database...`);
    db = getDatabase(config.databasePath);
    console.error(`[memory-mcp v${VERSION}] Database initialized`);

    // Connect to transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    // Log startup info to stderr (not stdout, which is used for MCP protocol)
    console.error(`[memory-mcp v${VERSION}] Server started`);
    console.error(`[memory-mcp v${VERSION}] Database: ${config.databasePath}`);
  } catch (error) {
    console.error(`[memory-mcp v${VERSION}] Failed to start:`, error);
    throw error;
  }
}

/**
 * Cleanup on exit
 */
process.on('SIGINT', () => {
  console.error(`[memory-mcp v${VERSION}] Shutting down...`);
  closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error(`[memory-mcp v${VERSION}] Shutting down...`);
  closeDatabase();
  process.exit(0);
});

// Start the server
main().catch((error) => {
  console.error(`[memory-mcp v${VERSION}] Fatal error:`, error);
  process.exit(1);
});
