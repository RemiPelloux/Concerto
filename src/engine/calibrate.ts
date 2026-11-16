import type { Outcome } from "#src/engine/outcomes.js";

/** Below this many recorded stories, the hand-set weights stay as they are. */
export const MIN_STORIES = 20;
/** A model's own cost per point is used once it has this many paid stories. */
export const MIN_MODEL_STORIES = 5;
/** How far history may move a weight from its hand-set value: a quarter to double. */
const SHRINK = 0.25;
const GROW = 2;
const RETRIES_FOR_HARD = 2;

export type ModelRecord = { model: string; stories: number; passRate: number; attempts: number; costPerPoint: number | null };
export type Calibration = {
  stories: number;
  /** Factor weights fitted to this repository's history, or null while it is too short. */
  weights: Record<string, number> | null;
  records: Map<string, ModelRecord>;
};

/** 1 for a story that failed, up to 1 with retries for one that passed, 0 for a first-try pass. */
const hardness = (o: Outcome) => (o.passed ? Math.min(1, (o.attempts - 1) / RETRIES_FOR_HARD) : 1);

function pearson(xs: number[], ys: number[]): number {
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const [mx, my] = [mean(xs), mean(ys)];
  const cov = xs.reduce((sum, x, i) => sum + (x - mx) * ((ys[i] ?? 0) - my), 0);
  const spread = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0));
  return spread === 0 ? 0 : cov / spread;
}

/**
 * The hand-set weights, each moved by how well its factor predicted hard stories here: a factor
 * that went with failures and retries weighs more, one that did not weighs less. Sums to 1.
 */
export function fitWeights(outcomes: Outcome[], prior: Record<string, number>): Record<string, number> | null {
  if (outcomes.length < MIN_STORIES) return null;
  const hard = outcomes.map(hardness);
  const moved = Object.entries(prior).map(([key, w]) => {
    const r = pearson(outcomes.map((o) => o.factors[key] ?? 0), hard);
    return [key, w * Math.min(GROW, Math.max(SHRINK, 1 + r))] as const;
  });
  const total = moved.reduce((sum, [, w]) => sum + w, 0);
  return Object.fromEntries(moved.map(([key, w]) => [key, w / total]));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? null) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function recordOf(model: string, own: Outcome[]): ModelRecord {
  const paid = own.filter((o) => o.cost > 0).map((o) => o.cost / o.points);
  return {
    model,
    stories: own.length,
    passRate: own.filter((o) => o.passed).length / own.length,
    attempts: own.reduce((sum, o) => sum + o.attempts, 0) / own.length,
    costPerPoint: paid.length >= MIN_MODEL_STORIES ? median(paid) : null,
  };
}

/** What this repository's history says: fitted weights and each model's track record. */
export function calibrate(outcomes: Outcome[], prior: Record<string, number>): Calibration {
  const byModel = new Map<string, Outcome[]>();
  outcomes.forEach((o) => byModel.set(o.model, [...(byModel.get(o.model) ?? []), o]));
  const records = new Map([...byModel].map(([model, own]) => [model, recordOf(model, own)]));
  return { stories: outcomes.length, weights: fitWeights(outcomes, prior), records };
}

export const NO_CALIBRATION: Calibration = { stories: 0, weights: null, records: new Map() };
