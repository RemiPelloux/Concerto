export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type ModelInfo = {
  ref: string;
  contextK: number;
  tier: number;
  price: Price | null;
  /** Multiplier on list price for routing. Subscriptions default below 1: they are prepaid. */
  costFactor: number;
};

export type ListedModel = { ref: string; contextK: number };
