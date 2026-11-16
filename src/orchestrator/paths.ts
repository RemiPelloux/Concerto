import type { Catalog } from "#src/models/catalog.js";
import type { ModelInfo } from "#src/models/types.js";
import type { Story } from "#src/orchestrator/plan.js";
import { estimateStory } from "#src/orchestrator/estimate.js";
import type { PathCost, StoryView } from "#src/state/types.js";

type Path = PathCost["path"];
const SUBSCRIPTION_CLIS = new Set(["claude-code", "codex", "gemini", "cursor"]);
const LABEL: Record<Path, string> = { subscriptions: "on your subscriptions", profiles: "through Codex profiles", api: "on API keys" };

/** Which way a model is reached: a subscription CLI's login, a Codex profile, or API keys. */
export function pathOf(m: ModelInfo): Path {
  if (!SUBSCRIPTION_CLIS.has(m.parsed.backend)) return "api";
  return m.parsed.profile ? "profiles" : "subscriptions";
}

/** The same model (by id) reached the given way, if the catalog has it. */
function sameModel(catalog: Catalog, ref: string | undefined, path: Path): ModelInfo | undefined {
  const id = ref ? catalog.get(ref)?.parsed.id : undefined;
  return id ? catalog.models.find((m) => m.parsed.id === id && pathOf(m) === path) : undefined;
}

function costOn(catalog: Catalog, path: Path, plan: { stories: Story[]; views: Record<string, StoryView> }): PathCost {
  let cost = 0;
  let missing = 0;
  const used = new Set<string>();
  for (const story of plan.stories) {
    const view = plan.views[story.id];
    const builder = sameModel(catalog, view?.chain[0], path);
    if (!builder) missing += 1;
    else {
      used.add(builder.parsed.prefix);
      cost += estimateStory({ points: story.points, builder, critic: sameModel(catalog, view?.critics[0], path) });
    }
  }
  return { path, label: LABEL[path], cost, missing, prefer: [...used].join(",") };
}

/**
 * What the plan would cost, API-equivalent at list prices, if every story ran one way: on the
 * subscriptions (prepaid), through Codex profiles, or on API keys. `prefer` is the /prefer value
 * that picks it; `missing` counts stories whose model is not reachable that way.
 */
export function pathCosts(catalog: Catalog, plan: { stories: Story[]; views: Record<string, StoryView> }): PathCost[] {
  return (["subscriptions", "profiles", "api"] as const).map((path) => costOn(catalog, path, plan)).filter((p) => p.missing < plan.stories.length);
}
