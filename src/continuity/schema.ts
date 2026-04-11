import { z } from "zod";

export const continuityActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("help"),
  }),
  z.object({
    action: z.literal("save"),
    type: z.enum([
      "snapshot",
      "decision",
      "project_state",
      "bundle",
      "meta_snapshot",
    ]),
    title: z.string(),
    summary: z.string(),
    project: z.string().optional(),
    themes: z.array(z.string()).optional(),
    entities: z.array(z.string()).optional(),
    next_steps: z.array(z.string()).optional(),
    body: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    action: z.literal("list"),
    project: z.string().optional(),
  }),
  z.object({
    action: z.literal("search"),
    query: z.string(),
  }),
  z.object({
    action: z.literal("get"),
    id: z.string(),
    detail: z.enum(["compact", "standard", "full"]).optional(),
  }),
  z.object({
    action: z.literal("neighbors"),
    id: z.string(),
  }),
  z.object({
    action: z.literal("node"),
    id: z.string(),
  }),
  z.object({
    action: z.literal("related"),
    id: z.string(),
    via: z.enum(["nodes", "edges", "all"]).optional(),
  }),
  z.object({
    action: z.literal("doctor"),
  }),
  z.object({
    action: z.literal("bundle"),
    project: z.string().optional(),
  }),
  z.object({
    action: z.literal("merge"),
    ids: z.array(z.string()).min(2),
    type: z.enum(["bundle", "meta_snapshot"]).default("meta_snapshot"),
    title: z.string().optional(),
  }),
  z.object({
    action: z.literal("delete"),
    id: z.string(),
  }),
]);

export type ContinuityActionInput = z.infer<typeof continuityActionSchema>;
