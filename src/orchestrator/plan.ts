import { z } from "zod";

// eslint-disable-next-line no-magic-numbers -- the Fibonacci point scale is the data itself
export const FIBONACCI: readonly number[] = [1, 2, 3, 5, 8, 13];
const SCALE_MAX = 5;
const SCALE = z.number().int().min(1).max(SCALE_MAX);
const SCALE_SPAN = SCALE_MAX - 1;
const WEIGHTS = { complexity: 0.5, risk: 0.3, points: 0.2, blast: 0 };
const WEIGHTS_WITH_BLAST = { complexity: 0.4, risk: 0.25, points: 0.15, blast: 0.2 };
const BLAST_SATURATION = 64;
const PERCENT = 100;
const MAX_STORIES = 24;
/** Story ids end up in session ids and file names: keep them to a safe slug. */
const STORY_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

export const StorySchema = z.object({
  id: z.string().regex(STORY_ID, "story ids are lowercase kebab-case, 48 characters at most"),
  title: z.string().min(1),
  asA: z.string(),
  iWant: z.string(),
  soThat: z.string(),
  acceptance: z.array(z.string()).min(1),
  points: z.number().refine((n) => FIBONACCI.includes(n), "points must be 1, 2, 3, 5, 8 or 13"),
  complexity: SCALE,
  risk: SCALE,
  value: SCALE,
  tags: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
  /** Files the story will likely change or create. Sanitized before any use. */
  files: z.array(z.string()).default([]),
});
export type Story = z.infer<typeof StorySchema>;

export const PlanSchema = z
  .object({ summary: z.string(), stories: z.array(StorySchema).min(1).max(MAX_STORIES) })
  .refine((p) => new Set(p.stories.map((s) => s.id)).size === p.stories.length, "story ids must be unique");
export type Plan = z.infer<typeof PlanSchema>;

/** What the story reaches in the repository, measured by Concerto, not guessed by a model. */
export type Reach = { files: number; dependents: number; tests: number };

/**
 * 0 to 1. Logarithmic: the step from 1 to 4 reached files matters more than from 40 to 43.
 * Saturates at 64 files, importers and tests together.
 */
export function blastRadius(reach: Reach): number {
  const total = reach.files + reach.dependents + reach.tests;
  return Math.min(1, Math.log2(1 + total) / Math.log2(1 + BLAST_SATURATION));
}

/**
 * 0 to 100. How hard the story is, which decides the model it gets. With a measured reach,
 * the blast radius takes 20% and the other weights shrink; without one, the model's numbers
 * decide alone.
 */
export function scoreStory(story: Pick<Story, "points" | "complexity" | "risk">, reach?: Reach): number {
  const parts = {
    complexity: (story.complexity - 1) / SCALE_SPAN,
    risk: (story.risk - 1) / SCALE_SPAN,
    points: FIBONACCI.indexOf(story.points) / (FIBONACCI.length - 1),
    blast: reach && reach.files > 0 ? blastRadius(reach) : null,
  };
  const w = parts.blast === null ? WEIGHTS : WEIGHTS_WITH_BLAST;
  const raw = w.complexity * parts.complexity + w.risk * parts.risk + w.points * parts.points + w.blast * (parts.blast ?? 0);
  return Math.round(raw * PERCENT);
}

/** Pulls the first JSON object out of a model reply, fenced or not, and validates it. */
export function parsePlan(reply: string): Plan {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The scorer did not return a JSON plan.");
  return PlanSchema.parse(JSON.parse(reply.slice(start, end + 1)));
}

/**
 * Groups stories into waves: each wave only depends on earlier ones. Kahn's algorithm,
 * linear in stories plus dependencies. Unknown and self dependencies are ignored; a cycle is
 * broken by releasing the first blocked story in plan order.
 */
export function executionWaves(stories: Story[]): Story[][] {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const blockers = new Map(stories.map((s) => [s.id, new Set(s.dependsOn.filter((d) => d !== s.id && byId.has(d)))]));
  const dependents = new Map<string, string[]>();
  blockers.forEach((deps, id) => deps.forEach((d) => dependents.set(d, [...(dependents.get(d) ?? []), id])));
  const waves: Story[][] = [];
  let ready = stories.filter((s) => blockers.get(s.id)?.size === 0);
  let left = stories.length;
  while (left > 0) {
    const wave = ready.length > 0 ? ready : stories.filter((s) => (blockers.get(s.id)?.size ?? 0) > 0).slice(0, 1);
    wave.forEach((s) => blockers.delete(s.id));
    waves.push(wave);
    left -= wave.length;
    const next = new Set(wave.flatMap((s) => dependents.get(s.id) ?? []).filter((id) => blockers.has(id)));
    next.forEach((id) => wave.forEach((s) => blockers.get(id)?.delete(s.id)));
    ready = stories.filter((s) => next.has(s.id) && blockers.get(s.id)?.size === 0);
  }
  return waves;
}
