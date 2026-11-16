import type { ConcertoConfig } from "#src/config/types.js";
import { parseRef, type Backend } from "#src/runner/types.js";
import { reachableRefs } from "#src/models/discover.js";
import { isBroken, readHealth, type Health } from "#src/models/health.js";
import { loadPriceIndex, priceFor } from "#src/models/prices.js";
import type { ModelInfo } from "#src/models/types.js";

const SUBSCRIPTION_COST_FACTOR = 0.25;
const SUBSCRIPTIONS = new Set<Backend>(["claude-code", "codex", "gemini", "cursor"]);

/** Reachable models, indexed by ref so lookups never scan the list. */
export class Catalog {
  private readonly byRef: ReadonlyMap<string, ModelInfo>;

  constructor(readonly models: readonly ModelInfo[]) {
    this.byRef = new Map(models.map((m) => [m.ref, m]));
  }

  get(ref: string): ModelInfo | undefined {
    return this.byRef.get(ref);
  }

  /** The reachable ones among `refs`, in order, without duplicates. */
  reachable(refs: readonly string[]): ModelInfo[] {
    return [...new Set(refs)].flatMap((ref) => this.byRef.get(ref) ?? []);
  }
}

/** A Codex profile is a pay-per-use proxy, not the prepaid subscription. */
function defaultCostFactor(backend: Backend, profile: string): number {
  return SUBSCRIPTIONS.has(backend) && !profile ? SUBSCRIPTION_COST_FACTOR : 1;
}

/** Configured models that are installed, logged in, and did not fail a probe in the last day. */
export async function loadCatalog(config: ConcertoConfig, health: Health = readHealth()): Promise<Catalog> {
  const entries = Object.entries(config.models)
    .filter(([ref]) => !isBroken(health, ref))
    .map(([ref, entry]) => ({ ref, entry, parsed: parseRef(ref) }));
  const [reachable, prices] = [await reachableRefs(entries.map((e) => e.parsed)), loadPriceIndex()];
  const models = entries
    .filter((e) => reachable.has(e.ref))
    .map(({ ref, entry, parsed }) => ({
      ref,
      parsed,
      tier: entry.tier,
      price: priceFor(prices, parsed),
      costFactor: entry.costFactor ?? defaultCostFactor(parsed.backend, parsed.profile),
    }));
  return new Catalog(models);
}
