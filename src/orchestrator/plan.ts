import { z } from "zod";

// eslint-disable-next-line no-magic-numbers -- the Fibonacci point scale is the data itself
export const FIBONACCI: readonly number[] = [1, 2, 3, 5, 8, 13];
const SCALE_MAX = 5;
const SCALE = z.number().int().min(1).max(SCALE_MAX);
const WEIGHTS = { complexity: 0.5, risk: 0.3, points: 0.2 };
const PERCENT = 100;
const SCALE_SPAN = SCALE_MAX - 1;

export const StorySchema = z.object({
  id: z.string().min(1),
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
});
export type Story = z.infer<typeof StorySchema>;

export const PlanSchema = z.object({
  summary: z.string(),
  stories: z.array(StorySchema).min(1),
});
export type Plan = z.infer<typeof PlanSchema>;

/** 0 to 100. How hard the story is, which decides the model tier it gets. */
export function scoreStory(story: Pick<Story, "points" | "complexity" | "risk">): number {
  const pointsRank = FIBONACCI.indexOf(story.points) / (FIBONACCI.length - 1);
  const raw =
    WEIGHTS.complexity * ((story.complexity - 1) / SCALE_SPAN) +
    WEIGHTS.risk * ((story.risk - 1) / SCALE_SPAN) +
    WEIGHTS.points * pointsRank;
  return Math.round(raw * PERCENT);
}

/** Pulls the first JSON object out of a model reply, fenced or not. */
export function parsePlan(reply: string): Plan {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The scorer did not return a JSON plan.");
  return PlanSchema.parse(JSON.parse(reply.slice(start, end + 1)));
}

/** Orders stories so each one runs after the stories it depends on. */
export function executionWaves(stories: Story[]): Story[][] {
  const done = new Set<string>();
  const waves: Story[][] = [];
  let left = stories;
  while (left.length > 0) {
    const ready = left.filter((s) => s.dependsOn.every((d) => done.has(d) || !left.some((l) => l.id === d)));
    const wave = ready.length > 0 ? ready : left.slice(0, 1);
    wave.forEach((s) => done.add(s.id));
    waves.push(wave);
    left = left.filter((s) => !done.has(s.id));
  }
  return waves;
}
