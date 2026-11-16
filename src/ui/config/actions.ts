import { MAX_SCORE, type ConcertoConfig, type Route } from "#src/config/types.js";
import type { Catalog } from "#src/models/catalog.js";
import { choices, current, roleSlot, slotModels, slotPath, type Slot } from "#src/ui/model-slots.js";
import { setIn, type Path } from "#src/ui/config/paths.js";

/** A change to make: the whole config after it, the one place it touched, and what to say once saved. */
export type Change = { raw: unknown; path: Path; say: (next: ConcertoConfig) => string };
export type ListKind = "routes" | "reviews" | "skills";

/** A new rule takes stories tagged "new" until its tags are changed, so it never steals work by surprise. */
const NEW_TAG = "new";
const NEW_TIER = 3;

/** The model a new rule starts with: what its role runs now, or the strongest it may use. */
function starter(config: ConcertoConfig, catalog: Catalog, slot: Slot): string {
  return current(config, catalog, slot) || (choices(catalog, slot)[0]?.ref ?? "");
}

/** A route for the soloist or the section, first in line so its tags win. */
export function addRoute(config: ConcertoConfig, catalog: Catalog, role: Route["role"]): Change | string {
  const model = starter(config, catalog, roleSlot(role));
  if (!model) return `No reachable model can build for the ${role}.`;
  const name = `route-${config.routes.length + 1}`;
  const route: Route = { name, tags: [NEW_TAG], minScore: 0, maxScore: MAX_SCORE + 1, role, models: [model], effort: "auto" };
  return { raw: { ...config, routes: [route, ...config.routes] }, path: ["routes"], say: () => `added ${name} for stories tagged "${NEW_TAG}"` };
}

export function addReview(config: ConcertoConfig, catalog: Catalog): Change | string {
  const model = starter(config, catalog, roleSlot("critic"));
  if (!model) return "No reachable model can review.";
  const review = { tags: [NEW_TAG], minScore: 0, maxScore: MAX_SCORE + 1, models: [model] };
  return { raw: { ...config, reviews: [review, ...config.reviews] }, path: ["reviews"], say: () => `added a review for stories tagged "${NEW_TAG}"` };
}

export function addSkill(config: ConcertoConfig): Change {
  return { raw: { ...config, skills: [...config.skills, { tags: [NEW_TAG], paths: [] }] }, path: ["skills"], say: () => "added a skill rule" };
}

export function removeItem(config: ConcertoConfig, kind: ListKind, index: number): Change {
  const items: unknown[] = config[kind];
  return { raw: { ...config, [kind]: items.filter((_x, i) => i !== index) }, path: [kind], say: () => `deleted ${kind.slice(0, -1)} ${index + 1}` };
}

/** Swaps two items of a list: the order of routes and reviews is the order they are tried in. */
export function swapItems(config: ConcertoConfig, kind: ListKind, pair: readonly [number, number]): Change {
  const items: unknown[] = [...config[kind]];
  const [a, b] = pair;
  [items[a], items[b]] = [items[b], items[a]];
  return { raw: { ...config, [kind]: items }, path: [kind], say: () => `moved to position ${b + 1}` };
}

export function addModel(config: ConcertoConfig, ref: string): Change | string {
  const clean = ref.trim();
  if (config.models[clean]) return `${clean} is already listed.`;
  return { raw: setIn(config, ["models", clean], { tier: NEW_TIER }), path: ["models", clean], say: () => `added ${clean} at tier ${NEW_TIER}; /probe tests it` };
}

export function removeModel(config: ConcertoConfig, ref: string): Change {
  return { raw: setIn(config, ["models", ref], undefined), path: ["models", ref], say: () => `deleted ${ref}` };
}

function chainChange(config: ConcertoConfig, slot: Slot, models: string[]): Change {
  return { raw: setIn(config, slotPath(slot), models), path: slotPath(slot), say: () => `chain of ${slot.label}: ${models.join(" › ") || "empty"}` };
}

/** Moves the chain's model at `index` one place up (dir -1) or down (dir 1); null at either end. */
export function chainMove(config: ConcertoConfig, slot: Slot, move: { index: number; dir: number }): Change | null {
  const models = [...slotModels(config, slot)];
  const to = move.index + move.dir;
  const [a, b] = [models[move.index], models[to]];
  if (a === undefined || b === undefined) return null;
  [models[move.index], models[to]] = [b, a];
  return chainChange(config, slot, models);
}

export function chainRemove(config: ConcertoConfig, slot: Slot, index: number): Change | null {
  const models = slotModels(config, slot);
  if (models[index] === undefined) return null;
  return chainChange(config, slot, models.filter((_m, i) => i !== index));
}

export function chainAppend(config: ConcertoConfig, slot: Slot, ref: string): Change | string {
  const models = slotModels(config, slot);
  if (models.includes(ref)) return `${ref} is already in the chain.`;
  return chainChange(config, slot, [...models, ref]);
}
