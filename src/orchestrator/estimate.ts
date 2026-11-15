import type { ModelInfo } from "../models/types.js";

const PER_MILLION = 1_000_000;
/** Rough agent traffic per story point, measured on small runs: mostly cached prompt tokens. */
const PROMPT_TOKENS_PER_POINT = 60_000;
const OUTPUT_TOKENS_PER_POINT = 3_000;
const CACHED_SHARE = 0.8;
/** A review reads the change and runs the checks: about 40% of a build. */
const REVIEW_SHARE = 0.4;

function callCost(points: number, model: ModelInfo | undefined): number {
  const p = model?.price;
  if (!p) return 0;
  const prompt = PROMPT_TOKENS_PER_POINT * ((1 - CACHED_SHARE) * p.input + CACHED_SHARE * p.cacheRead);
  return (points * (prompt + OUTPUT_TOKENS_PER_POINT * p.output)) / PER_MILLION;
}

/**
 * API-equivalent dollars for one story: one build and one review. An order of magnitude to
 * compare stories and set a budget, not a quote. Retries and conductor consults come on top.
 */
export function estimateStory(points: number, builder: ModelInfo | undefined, critic: ModelInfo | undefined): number {
  return callCost(points, builder) + REVIEW_SHARE * callCost(points, critic);
}
