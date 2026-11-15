import { z } from "zod";

export const MAX_TIER = 5;
const MAX_SCORE = 100;
const TIER = z.number().int().min(1).max(MAX_TIER);

export const ROLES = ["conductor", "scorer", "soloist", "critic", "section"] as const;
export type Role = (typeof ROLES)[number];

const EffortSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof EffortSchema>;

const RoleConfigSchema = z.object({
  minTier: TIER,
  effort: EffortSchema,
  tools: z.array(z.string()),
  /** Preferred models, first reachable wins. Empty: cheapest model at minTier. */
  models: z.array(z.string()).default([]),
});
export type RoleConfig = z.infer<typeof RoleConfigSchema>;

const SkillRuleSchema = z.object({ tags: z.array(z.string()), paths: z.array(z.string()) });
export type SkillRule = z.infer<typeof SkillRuleSchema>;

const RouteSchema = z.object({
  name: z.string(),
  tags: z.array(z.string()).default([]),
  minScore: z.number().min(0).max(MAX_SCORE).default(0),
  role: z.enum(["soloist", "section"]),
  models: z.array(z.string()).min(1),
  effort: EffortSchema,
});
export type Route = z.infer<typeof RouteSchema>;

const ReviewSchema = z.object({ tags: z.array(z.string()), models: z.array(z.string()).min(1) });
export type Review = z.infer<typeof ReviewSchema>;

export const ConfigSchema = z.object({
  models: z.record(z.string(), z.object({ tier: TIER, costFactor: z.number().min(0).optional() })),
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
  cache: z.object({ dir: z.string(), ttlHours: z.number().positive() }),
});
export type ConcertoConfig = z.infer<typeof ConfigSchema>;
