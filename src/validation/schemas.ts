/**
 * Zod runtime validation schemas for MCP tool inputs
 */

import { z } from 'zod';

const MemoryTypeEnum = z.enum(['fact', 'entity', 'relationship', 'self']);

export const MemoryStoreSchema = z.object({
  content: z.string(),
  type: MemoryTypeEnum.optional(),
  id: z.string().optional(),
  importance: z.number().min(0).max(10).optional(),
  entities: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  ttl_days: z.number().nullable().optional(),
  expires_at: z.string().optional(),
  provenance: z
    .object({
      source: z.string(),
      timestamp: z.string().optional(),
      context: z.string().optional(),
      user_id: z.string().optional(),
    })
    .optional(),
});

export const MemoryRecallSchema = z.object({
  query: z.string(),
  max_tokens: z.number().optional(),
  type: MemoryTypeEnum.optional(),
  entities: z.array(z.string()).optional(),
  limit: z.number().optional(),
});

export const MemoryForgetSchema = z.object({
  id: z.string(),
  reason: z.string().optional(),
});
