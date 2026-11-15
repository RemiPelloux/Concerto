import { z } from "zod";

export const MAX_TIER = 5;
const MAX_SCORE = 100;
const TIER = z.number().int().min(1).max(MAX_TIER);
const DEFAULT_TIMEOUT_MINUTES = 30;
const DEFAULT_CACHE_ENTRIES = 500;
/** Model refs are checked by parseRef at load; this only keeps obvious garbage out. */
/** The model id may itself contain slashes (pi lists `z-ai/glm-5.3`); the prefix may not. */
const REF = z.string().regex(/^[\w.@-]+\/[\w.:/[\]-]+$/, "model refs look like <backend>/<model>");
const PREFER = z.string().regex(/^[\w.@-]+\*?$/, "prefer entries are provider names, optionally ending in *");

export const ROLES = ["conductor", "scorer", "soloist", "critic", "section"] as const;
export type Role = (typeof ROLES)[number];

const EffortSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof EffortSchema>;

const RoleConfigSchema = z.object({
  minTier: TIER,
  effort: EffortSchema,
  tools: z.array(z.string()),
  /** Preferred models, first reachable wins. Empty: cheapest model at minTier. */
  models: z.array(REF).default([]),
});
export type RoleConfig = z.infer<typeof RoleConfigSchema>;

const SkillRuleSchema = z.object({ tags: z.array(z.string()), paths: z.array(z.string()) });
export type SkillRule = z.infer<typeof SkillRuleSchema>;

const RouteSchema = z.object({
  name: z.string(),
  tags: z.array(z.string()).default([]),
  minScore: z.number().min(0).max(MAX_SCORE).default(0),
  role: z.enum(["soloist", "section"]),
  models: z.array(REF).min(1),
  /** "auto": from the score, low under 25, medium under 50, high under 75, xhigh above. */
  effort: EffortSchema.or(z.literal("auto")).default("auto"),
});
export type Route = z.infer<typeof RouteSchema>;

const ReviewSchema = z.object({ tags: z.array(z.string()), models: z.array(REF).min(1) });
export type Review = z.infer<typeof ReviewSchema>;

export const ConfigSchema = z.object({
  models: z.record(REF, z.object({ tier: TIER, costFactor: z.number().min(0).optional() })),
  /** Providers tried first in every chain, e.g. ["ce-*"] to send everything through a proxy. */
  prefer: z.array(PREFER).default([]),
  timeoutMinutes: z.number().positive().default(DEFAULT_TIMEOUT_MINUTES),
  /** API-equivalent dollars; no new story or attempt starts once a run has spent this. */
  budgetUsd: z.number().positive().optional(),
  roles: z.object({
    conductor: RoleConfigSchema,
    scorer: RoleConfigSchema,
    soloist: RoleConfigSchema,
    critic: RoleConfigSchema,
    section: RoleConfigSchema,
  }),
  routes: z.array(RouteSchema).default([]),
  reviews: z.array(ReviewSchema).default([]),
  skills: z.array(SkillRuleSchema),
  swarm: z.object({ maxParallel: z.number().int().min(1) }),
  cache: z.object({
    dir: z.string(),
    ttlHours: z.number().positive(),
    maxEntries: z.number().int().positive().default(DEFAULT_CACHE_ENTRIES),
  }),
});
export type ConcertoConfig = z.infer<typeof ConfigSchema>;
