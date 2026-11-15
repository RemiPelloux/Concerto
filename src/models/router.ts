import type { ConcertoConfig, Effort, Role } from "#src/config/types.js";
import type { Catalog } from "#src/models/catalog.js";
import type { ModelInfo } from "#src/models/types.js";

/** Typical agent traffic reads about three tokens for every one it writes. */
const INPUT_SHARE = 0.75;
const MAX_CHAIN = 4;
const TIER = { bulk: 1, standard: 2, strong: 3, frontier: 4 };
const FLOOR = { frontier: 80, strong: 55, standard: 30, bulk: 0 };
const TIER_BY_SCORE: ReadonlyArray<[number, number]> = [
  [FLOOR.frontier, TIER.frontier],
  [FLOOR.strong, TIER.strong],
  [FLOOR.standard, TIER.standard],
  [FLOOR.bulk, TIER.bulk],
];

/** `chain[0]` runs; the rest are fallbacks when a call fails (rate limit, outage). */
/** Score bands for the builder's effort when a route says "auto". */
const BAND = { xhigh: 75, high: 50, medium: 25 };
const EFFORT_BANDS: ReadonlyArray<[number, Effort]> = [
  [BAND.xhigh, "xhigh"],
  [BAND.high, "high"],
  [BAND.medium, "medium"],
];

export function effortFor(score: number): Effort {
  return EFFORT_BANDS.find(([min]) => score >= min)?.[1] ?? "low";
}

export type Assignment = { role: Role; chain: ModelInfo[]; effort: Effort; rule: string };
export type StoryShape = { score: number; tags: string[] };

export function blendedPrice(model: ModelInfo): number {
  if (!model.price) return Number.POSITIVE_INFINITY;
  const list = model.price.input * INPUT_SHARE + model.price.output * (1 - INPUT_SHARE);
  return list * model.costFactor;
}

export function requiredTier(score: number): number {
  return TIER_BY_SCORE.find(([min]) => score >= min)?.[1] ?? TIER.bulk;
}

/** Every model at or above the tier, cheapest first; the strongest ones when none qualifies. */
export function tierChain(catalog: Catalog, minTier: number): ModelInfo[] {
  const all = catalog.models.map((m, order) => ({ m, order, cost: blendedPrice(m) }));
  const able = all.filter((x) => x.m.tier >= minTier);
  if (able.length > 0) return able.sort((a, b) => a.cost - b.cost || b.m.tier - a.m.tier || a.order - b.order).map((x) => x.m);
  return all.sort((a, b) => b.m.tier - a.m.tier || a.order - b.order).map((x) => x.m);
}

function matchesPrefer(entry: string, m: ModelInfo): boolean {
  const { prefix, provider } = m.parsed;
  if (!entry.endsWith("*")) return entry === prefix || entry === provider;
  const head = entry.slice(0, -1);
  return prefix.startsWith(head) || provider.startsWith(head);
}

/**
 * Puts preferred providers first without changing which model runs: variants of the same
 * model (claude-code/claude-opus-5-5, ce-claude/claude-opus-5-5) stay grouped in the order the
 * config lists the models, and only their providers are reordered.
 */
export function preferFirst(models: ModelInfo[], prefer: readonly string[]): ModelInfo[] {
  if (prefer.length === 0) return models;
  const group = new Map<string, number>();
  models.forEach((m) => group.set(m.parsed.id, group.get(m.parsed.id) ?? group.size));
  const rank = (m: ModelInfo) => {
    const at = prefer.findIndex((p) => matchesPrefer(p, m));
    return at < 0 ? prefer.length : at;
  };
  const keyed = models.map((m, i) => ({ m, i, g: group.get(m.parsed.id) ?? 0, r: rank(m) }));
  return keyed.sort((a, b) => a.g - b.g || a.r - b.r || a.i - b.i).map((x) => x.m);
}

function chainOf(config: ConcertoConfig, wanted: ModelInfo[], fallback: ModelInfo[]): ModelInfo[] {
  const rest = fallback.filter((m) => !wanted.includes(m));
  const chain = [...preferFirst(wanted, config.prefer), ...preferFirst(rest, config.prefer)].slice(0, MAX_CHAIN);
  if (chain.length === 0) throw new Error("No configured model is reachable. Run `concerto --models`.");
  return chain;
}

export function roleChain(catalog: Catalog, config: ConcertoConfig, role: Role): ModelInfo[] {
  const cfg = config.roles[role];
  return chainOf(config, catalog.reachable(cfg.models), tierChain(catalog, cfg.minTier));
}

function tagged(ruleTags: string[], tags: string[]): boolean {
  return ruleTags.length === 0 || ruleTags.some((t) => tags.includes(t));
}

/** First matching route with a reachable model wins; otherwise the cheapest able tier. */
export function routeStory(story: StoryShape, catalog: Catalog, config: ConcertoConfig): Assignment {
  for (const route of config.routes) {
    if (story.score < route.minScore || !tagged(route.tags, story.tags)) continue;
    const wanted = catalog.reachable(route.models);
    if (wanted.length === 0) continue;
    const fallback = tierChain(catalog, Math.min(...wanted.map((m) => m.tier)));
    const effort = route.effort === "auto" ? effortFor(story.score) : route.effort;
    return { role: route.role, chain: chainOf(config, wanted, fallback), effort, rule: route.name };
  }
  const fallback = tierChain(catalog, requiredTier(story.score));
  const role: Role = story.score >= FLOOR.strong ? "soloist" : "section";
  return { role, chain: chainOf(config, [], fallback), effort: effortFor(story.score), rule: "cheapest-tier" };
}

/** UI stories can get a specialist reviewer; everything else gets the critic role's chain. */
export function reviewChain(tags: string[], catalog: Catalog, config: ConcertoConfig): ModelInfo[] {
  const review = config.reviews.find((r) => r.tags.some((t) => tags.includes(t)));
  const special = review ? catalog.reachable(review.models) : [];
  const critic = roleChain(catalog, config, "critic");
  return special.length > 0 ? chainOf(config, special, critic) : critic;
}
