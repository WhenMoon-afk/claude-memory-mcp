#!/usr/bin/env node

/**
 * Memory MCP v2.0 - Smart monolith MCP server
 * Brain-inspired memory system with smart context loading
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type Database from 'better-sqlite3';
import { getDatabase, closeDatabase } from './database/connection.js';
import { memoryStore } from './tools/memory-store.js';
import { memoryRecall } from './tools/memory-recall.js';
import { memoryForget } from './tools/memory-forget.js';
import type { MemoryInput, SearchOptions } from './types/index.js';

/**
 * Configuration from environment or defaults
 */
const config = {
  databasePath: process.env['MEMORY_DB_PATH'] || './memory.db',
  defaultTTLDays: parseInt(process.env['DEFAULT_TTL_DAYS'] || '90'),
};

/**
 * Initialize MCP server
 */
const server = new Server(
  {
    name: '@whenmoon-afk/memory-mcp',
    version: '2.1.2',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Database instance (initialized in main)
let db: Database.Database;

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
        const result = await memoryStore(db, args as unknown as MemoryInput);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'memory_recall': {
        const result = await memoryRecall(db, args as unknown as SearchOptions);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'memory_forget': {
        const { id, reason } = args as { id: string; reason?: string };
        const result = await memoryForget(db, id, reason);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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
    console.error('Initializing database...');
    db = getDatabase(config.databasePath);
    console.error('Database initialized successfully');

    // Connect to transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    // Log startup info to stderr (not stdout, which is used for MCP protocol)
    console.error('Memory MCP v2.0 server started');
    console.error(`Database: ${config.databasePath}`);
  } catch (error) {
    console.error('Failed to start server:', error);
    throw error;
  }
}

/**
 * Cleanup on exit
 */
process.on('SIGINT', () => {
  console.error('Shutting down Memory MCP server...');
  closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Shutting down Memory MCP server...');
  closeDatabase();
  process.exit(0);
});

// Start the server
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
