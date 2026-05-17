import { z } from "zod";

export const continuityToolInputSchema = {
  action: z
    .enum([
      "help",
      "save",
      "list",
      "search",
      "get",
      "neighbors",
      "node",
      "related",
      "doctor",
      "bundle",
      "merge",
      "delete",
    ])
    .describe("Continuity action to dispatch."),
  type: z
    .enum(["snapshot", "decision", "project_state", "bundle", "meta_snapshot"])
    .optional()
    .describe("Artifact type for save, or output type for merge."),
  title: z.string().optional().describe("Artifact title for save or merge."),
  summary: z.string().optional().describe("Short artifact summary for save."),
  project: z.string().optional().describe("Project label or id."),
  themes: z.array(z.string()).optional().describe("Theme nodes to link."),
  entities: z.array(z.string()).optional().describe("Entity nodes to link."),
  next_steps: z.array(z.string()).optional().describe("Follow-up steps to persist."),
  body: z.record(z.string(), z.unknown()).optional().describe("Optional artifact body."),
  query: z.string().optional().describe("Search query."),
  id: z.string().optional().describe("Artifact or graph node id."),
  ids: z.array(z.string()).optional().describe("Artifact ids for merge."),
  detail: z
    .enum(["compact", "standard", "full"])
    .optional()
    .describe("Detail level for get."),
  via: z
    .enum(["nodes", "edges", "all"])
    .optional()
    .describe("Relationship explanation mode."),
};

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
