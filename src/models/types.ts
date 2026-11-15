import type { ModelRef } from "#src/runner/types.js";

export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type ModelInfo = {
  ref: string;
  parsed: ModelRef;
  tier: number;
  price: Price | null;
  /** Multiplier on list price for routing. Subscriptions default below 1: they are prepaid. */
  costFactor: number;
};
