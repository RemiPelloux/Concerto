import { EffortSchema, type ConcertoConfig, type Effort } from "#src/config/types.js";
import { parseRef, type Backend } from "#src/runner/types.js";
import { reachableRefs } from "#src/models/discover.js";
import { isBroken, readHealth, type Health } from "#src/models/health.js";
import { loadPriceIndex, priceFor } from "#src/models/prices.js";
import type { ModelInfo } from "#src/models/types.js";

const SUBSCRIPTION_COST_FACTOR = 0.25;
/** A model on this machine costs nothing per token. */
const FREE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const SUBSCRIPTIONS = new Set<Backend>(["claude-code", "codex", "gemini", "cursor"]);

/** `claude-code/claude-opus-5-5#high` -> the ref and the effort it is pinned to. */
export function splitPin(entry: string): { ref: string; effort?: Effort } {
  const at = entry.lastIndexOf("#");
  if (at < 0) return { ref: entry };
  const effort = EffortSchema.safeParse(entry.slice(at + 1));
  return effort.success ? { ref: entry.slice(0, at), effort: effort.data } : { ref: entry };
}

/** The chain entry for a model: its ref, with its pinned effort when it has one. */
export function pinnedRef(m: ModelInfo): string {
  return m.effort ? `${m.ref}#${m.effort}` : m.ref;
}

/** Reachable models, indexed by ref so lookups never scan the list. */
export class Catalog {
  private readonly byRef: ReadonlyMap<string, ModelInfo>;

  constructor(readonly models: readonly ModelInfo[]) {
    this.byRef = new Map(models.map((m) => [m.ref, m]));
  }

  get(entry: string): ModelInfo | undefined {
    return this.byRef.get(splitPin(entry).ref);
  }

  /** The reachable ones among `entries`, in order, one per model; a pinned entry carries its effort. */
  reachable(entries: readonly string[]): ModelInfo[] {
    const seen = new Set<string>();
    return entries.flatMap((entry) => {
      const { ref, effort } = splitPin(entry);
      const model = this.byRef.get(ref);
      if (!model || seen.has(ref)) return [];
      seen.add(ref);
      return [effort ? { ...model, effort } : model];
    });
  }
}

/** A Codex profile is a pay-per-use proxy, not the prepaid subscription. */
function defaultCostFactor(backend: Backend, profile: string): number {
  return SUBSCRIPTIONS.has(backend) && !profile ? SUBSCRIPTION_COST_FACTOR : 1;
}

/** `ollama/*` blocks every ref with that prefix; anything else blocks one ref. */
export function blockedBy(blocked: readonly string[], ref: string): boolean {
  return blocked.some((b) => (b.endsWith("*") ? ref.startsWith(b.slice(0, -1)) : ref === b));
}

/** Every configured model the policy allows, priced (a local model is free); the caller has already checked they answer. */
export function catalogFrom(config: ConcertoConfig, keep: (ref: string) => boolean = () => true): Catalog {
  const prices = loadPriceIndex();
  const models = Object.entries(config.models)
    .filter(([ref]) => keep(ref) && !blockedBy(config.policy.blockedModels, ref))
    .map(([ref, entry]) => {
      const parsed = parseRef(ref);
      const costFactor = entry.costFactor ?? defaultCostFactor(parsed.backend, parsed.profile);
      return { ref, parsed, tier: entry.tier, price: parsed.backend === "local" ? FREE : priceFor(prices, parsed), costFactor };
    });
  return new Catalog(models);
}

/** Configured models that are installed, logged in, and did not fail a probe in the last day. */
export async function loadCatalog(config: ConcertoConfig, health: Health = readHealth()): Promise<Catalog> {
  const refs = Object.keys(config.models).filter((ref) => !isBroken(health, ref));
  const reachable = await reachableRefs(refs.map(parseRef));
  return catalogFrom(config, (ref) => reachable.has(ref));
}
