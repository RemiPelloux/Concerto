import type { ConcertoConfig, Effort, Role } from "../config/types.js";
import type { ModelInfo } from "./types.js";

/** Typical agent traffic reads about three tokens for every one it writes. */
const INPUT_SHARE = 0.75;
const TIER = { bulk: 1, standard: 2, strong: 3, frontier: 4 };
const FLOOR = { frontier: 80, strong: 55, standard: 30, bulk: 0 };
const TIER_BY_SCORE: ReadonlyArray<[number, number]> = [
  [FLOOR.frontier, TIER.frontier],
  [FLOOR.strong, TIER.strong],
  [FLOOR.standard, TIER.standard],
  [FLOOR.bulk, TIER.bulk],
];

export type Assignment = { role: Role; model: ModelInfo; effort: Effort; rule: string };
export type StoryShape = { score: number; tags: string[] };

/** Routing cost per million tokens: list price, blended, times the model's cost factor. */
export function blendedPrice(model: ModelInfo): number {
  if (!model.price) return Number.POSITIVE_INFINITY;
  const list = model.price.input * INPUT_SHARE + model.price.output * (1 - INPUT_SHARE);
  return list * model.costFactor;
}

export function requiredTier(score: number): number {
  const hit = TIER_BY_SCORE.find(([min]) => score >= min);
  return hit ? hit[1] : TIER.bulk;
}

/** Cheapest model that meets the tier; the strongest one left when none does. */
export function pickModel(catalog: ModelInfo[], minTier: number): ModelInfo {
  const able = catalog.filter((m) => m.tier >= minTier);
  if (able.length === 0) {
    const best = [...catalog].sort((a, b) => b.tier - a.tier)[0];
    if (!best) throw new Error("No configured model is available. Run `concerto --models`.");
    return best;
  }
  const ranked = able.map((m, order) => ({ m, order, cost: blendedPrice(m) }));
  ranked.sort((a, b) => a.cost - b.cost || b.m.tier - a.m.tier || a.order - b.order);
  return ranked[0]!.m;
}

export function firstAvailable(catalog: ModelInfo[], refs: string[]): ModelInfo | undefined {
  return refs.map((ref) => catalog.find((m) => m.ref === ref)).find(Boolean);
}

export function modelForRole(catalog: ModelInfo[], config: ConcertoConfig, role: Role): ModelInfo {
  const roleCfg = config.roles[role];
  return firstAvailable(catalog, roleCfg.models) ?? pickModel(catalog, roleCfg.minTier);
}

function tagged(ruleTags: string[], tags: string[]): boolean {
  return ruleTags.length === 0 || ruleTags.some((t) => tags.includes(t));
}

function byTier(score: number, catalog: ModelInfo[]): Assignment {
  const role: Role = score >= FLOOR.strong ? "soloist" : "section";
  const effort: Effort = score >= FLOOR.frontier ? "high" : score >= FLOOR.strong ? "medium" : "low";
  return { role, model: pickModel(catalog, requiredTier(score)), effort, rule: "cheapest-tier" };
}

/** First configured route that matches and has a reachable model; otherwise the cheapest able tier. */
export function routeStory(story: StoryShape, catalog: ModelInfo[], config: ConcertoConfig): Assignment {
  for (const route of config.routes) {
    if (story.score < route.minScore || !tagged(route.tags, story.tags)) continue;
    const model = firstAvailable(catalog, route.models);
    if (model) return { role: route.role, model, effort: route.effort, rule: route.name };
  }
  return byTier(story.score, catalog);
}

/** UI stories can get a specialist reviewer; everything else gets the critic role's model. */
export function reviewerFor(tags: string[], catalog: ModelInfo[], config: ConcertoConfig): ModelInfo {
  const review = config.reviews.find((r) => r.tags.some((t) => tags.includes(t)));
  const special = review ? firstAvailable(catalog, review.models) : undefined;
  return special ?? modelForRole(catalog, config, "critic");
}
