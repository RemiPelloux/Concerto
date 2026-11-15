import type { ConcertoConfig } from "../config/types.js";
import { CLAUDE_CODE, CODEX } from "../runner/index.js";
import { splitRef } from "../runner/types.js";
import { discoverModels } from "./discover.js";
import { loadPriceIndex, priceFor } from "./prices.js";
import type { ListedModel, ModelInfo } from "./types.js";

const SUBSCRIPTION_COST_FACTOR = 0.25;
const SUBSCRIPTIONS = new Set([CLAUDE_CODE, CODEX]);

function defaultCostFactor(ref: string): number {
  return SUBSCRIPTIONS.has(splitRef(ref).prefix) ? SUBSCRIPTION_COST_FACTOR : 1;
}

export function buildCatalog(listed: ListedModel[], config: ConcertoConfig): ModelInfo[] {
  const prices = loadPriceIndex();
  const available = new Map(listed.map((m) => [m.ref, m]));
  return Object.entries(config.models).flatMap(([ref, entry]) => {
    const found = available.get(ref);
    if (!found) return [];
    const costFactor = entry.costFactor ?? defaultCostFactor(ref);
    return [{ ref, contextK: found.contextK, tier: entry.tier, price: priceFor(prices, ref), costFactor }];
  });
}

export async function loadCatalog(config: ConcertoConfig): Promise<ModelInfo[]> {
  return buildCatalog(await discoverModels(), config);
}
