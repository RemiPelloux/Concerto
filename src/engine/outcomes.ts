import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { State } from "#src/state/types.js";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
/** Enough history to learn from, small enough to read on every run. */
const KEPT = 2000;

/** One finished story: what it was, who built it, what it took, and whether it passed. */
const OutcomeSchema = z.object({
  at: z.number(),
  runId: z.string(),
  tags: z.array(z.string()),
  files: z.array(z.string()),
  points: z.number(),
  score: z.number(),
  factors: z.record(z.string(), z.number()),
  model: z.string(),
  critic: z.string(),
  attempts: z.number(),
  passed: z.boolean(),
  cost: z.number(),
});
export type Outcome = z.infer<typeof OutcomeSchema>;

export const outcomesPath = (cwd: string) => join(cwd, ".concerto", "outcomes.jsonl");

/** The run's finished stories, as outcomes. Stories that never started (budget, stop) are left out. */
export function outcomesOf(state: State, runId: string): Outcome[] {
  const at = Date.now();
  return (state.plan?.stories ?? []).flatMap((story) => {
    const v = state.stories[story.id];
    if (!v || (v.status !== "passed" && v.status !== "failed") || !v.attempts) return [];
    const factors = Object.fromEntries(v.factors.map((f) => [f.key, f.value]));
    return [{ at, runId, tags: story.tags, files: story.files, points: story.points, score: v.score, factors, model: v.model, critic: v.critics[0] ?? "", attempts: v.attempts, passed: v.status === "passed", cost: v.spent ?? 0 }];
  });
}

/** Appends outcomes to `.concerto/outcomes.jsonl`, owner-only, keeping the newest KEPT. */
export function recordOutcomes(cwd: string, outcomes: Outcome[]): void {
  if (outcomes.length === 0) return;
  const file = outcomesPath(cwd);
  mkdirSync(dirname(file), { recursive: true, mode: DIR_MODE });
  appendFileSync(file, outcomes.map((o) => `${JSON.stringify(o)}\n`).join(""), { mode: FILE_MODE });
  chmodSync(file, FILE_MODE);
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  if (lines.length > KEPT) writeFileSync(file, `${lines.slice(-KEPT).join("\n")}\n`, { mode: FILE_MODE });
}

/** Every valid outcome recorded in this repository, oldest first; unreadable lines are skipped. */
export function readOutcomes(cwd: string): Outcome[] {
  const file = outcomesPath(cwd);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").flatMap((line) => {
    try {
      const parsed = OutcomeSchema.safeParse(JSON.parse(line));
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
}
