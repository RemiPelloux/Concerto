import { z } from "zod";

export const MAX_TIER = 5;
export const MAX_SCORE = 100;
const TIER = z.number().int().min(1).max(MAX_TIER);
const DEFAULT_TIMEOUT_MINUTES = 30;
const DEFAULT_CACHE_ENTRIES = 500;
const DEFAULT_CHECK_MINUTES = 10;
const DEFAULT_READY_SECONDS = 60;
/** Claude Code and Codex subscriptions reset over about five hours. */
const DEFAULT_WINDOW_HOURS = 5;
/** A command, false to turn the check off, or absent to let Concerto detect it. */
const CheckSetting = z.string().min(1).or(z.literal(false)).optional();
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
  /** Exclusive: a route with maxScore 25 takes stories scoring under 25. */
  maxScore: z.number().min(0).max(MAX_SCORE + 1).default(MAX_SCORE + 1),
  role: z.enum(["soloist", "section"]),
  models: z.array(REF).min(1),
  /** "auto": from the score, low under 25, medium under 50, high under 75, xhigh above. */
  effort: EffortSchema.or(z.literal("auto")).default("auto"),
});
export type Route = z.infer<typeof RouteSchema>;

/** No tags: any story in the score band. maxScore is exclusive, as for routes. */
const ReviewSchema = z.object({
  tags: z.array(z.string()).default([]),
  minScore: z.number().min(0).max(MAX_SCORE).default(0),
  maxScore: z.number().min(0).max(MAX_SCORE + 1).default(MAX_SCORE + 1),
  models: z.array(REF).min(1),
});
export type Review = z.infer<typeof ReviewSchema>;

export const ConfigSchema = z.object({
  models: z.record(REF, z.object({ tier: TIER, costFactor: z.number().min(0).optional() })),
  /** Providers tried first in every chain, e.g. ["ce-*"] to send everything through a proxy. */
  prefer: z.array(PREFER).default([]),
  timeoutMinutes: z.number().positive().default(DEFAULT_TIMEOUT_MINUTES),
  /**
   * Per account (`claude-code`, `codex`, `codex@ce-gpt`, a pi provider): API-equivalent dollars
   * Concerto may spend there in a rolling window before it sends calls elsewhere.
   */
  limits: z.record(z.string(), z.object({ windowHours: z.number().positive().default(DEFAULT_WINDOW_HOURS), maxUsd: z.number().positive() })).default({}),
  /** Caps beyond the run's budgetUsd: per story, per calendar day and for the repository in total. */
  budgets: z.object({ story: z.number().positive().optional(), day: z.number().positive().optional(), repo: z.number().positive().optional() }).default({}),
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
  /** "worktree": every story builds in its own git worktree and is merged back when it passes. */
  isolation: z.enum(["worktree", "off"]).default("worktree"),
  /** Web projects: start the server before and after each story and show the critic which routes changed. */
  behaviour: z
    .object({ serve: z.string().min(1), routes: z.array(z.string().startsWith("/")).min(1), readySeconds: z.number().positive().default(DEFAULT_READY_SECONDS) })
    .optional(),
  /** Run after every build, before the critic: a red check sends the story back to its builder. */
  checks: z
    .object({ test: CheckSetting, typecheck: CheckSetting, lint: CheckSetting, timeoutMinutes: z.number().positive().default(DEFAULT_CHECK_MINUTES) })
    .default({ timeoutMinutes: DEFAULT_CHECK_MINUTES }),
  cache: z.object({
    dir: z.string(),
    ttlHours: z.number().positive(),
    maxEntries: z.number().int().positive().default(DEFAULT_CACHE_ENTRIES),
  }),
});
export type ConcertoConfig = z.infer<typeof ConfigSchema>;
