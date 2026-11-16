import { MAX_SCORE, ROLES, type ConcertoConfig, type Role, type Route } from "#src/config/types.js";
import { BRAIN_ROLES, isCheapModel } from "#src/models/brain.js";
import type { Catalog } from "#src/models/catalog.js";
import { roleChain } from "#src/models/router.js";
import type { ModelInfo } from "#src/models/types.js";
import { claudeFirst } from "#src/setup/organigram.js";
import { savePath, type Path } from "#src/ui/config/paths.js";

/** One place a model is chosen: a role, a build route or a review rule. */
export type Slot = { kind: "roles" | "routes" | "reviews"; key: string; index: number; label: string; duty: string; brain: boolean };

const DUTY: Record<Role, string> = {
  conductor: "plans the request and splits it into stories",
  scorer: "scores each story",
  soloist: "builds the hard stories",
  critic: "reviews every story",
  section: "builds the light stories",
};

/** What a rule takes, e.g. "tags ui,ux" or "score ≥ 55" or "score < 25". */
function takes(r: Pick<Route, "tags" | "minScore" | "maxScore">): string {
  const parts = [r.tags.length ? `tags ${r.tags.join(",")}` : "", r.minScore > 0 ? `score ≥ ${r.minScore}` : "", r.maxScore <= MAX_SCORE ? `score < ${r.maxScore}` : ""];
  return parts.filter(Boolean).join(" · ") || "any story";
}

export function roleSlot(role: Role): Slot {
  return { kind: "roles", key: role, index: ROLES.indexOf(role), label: role, duty: DUTY[role], brain: BRAIN_ROLES.has(role) };
}

/** Every slot, in the order the picker lists them: roles, then build routes, then reviews. */
export function slots(config: ConcertoConfig): Slot[] {
  const roles = ROLES.map(roleSlot);
  const routes = config.routes.map((r, index): Slot => ({ kind: "routes", key: r.name, index, label: `build: ${r.name}`, duty: `${r.role} · ${takes(r)}`, brain: BRAIN_ROLES.has(r.role) }));
  const reviews = config.reviews.map((r, index): Slot => ({ kind: "reviews", key: `review-${index}`, index, label: `review ${index + 1}`, duty: `reviews ${takes(r)}`, brain: true }));
  return [...roles, ...routes, ...reviews];
}

/** The models configured for the slot, in order: its chain before preferences and reachability. */
export function slotModels(config: ConcertoConfig, slot: Slot): string[] {
  if (slot.kind === "roles") return config.roles[slot.key as Role].models;
  return config[slot.kind][slot.index]?.models ?? [];
}

/** The model that would run for this slot now, after preferences and the brain rule; "" when none. */
export function current(config: ConcertoConfig, catalog: Catalog, slot: Slot): string {
  try {
    if (slot.kind === "roles") return roleChain(catalog, config, slot.key as Role)[0]?.ref ?? "";
    return catalog.reachable(slotModels(config, slot)).find((m) => !slot.brain || !isCheapModel(m))?.ref ?? "";
  } catch {
    return "";
  }
}

/** Models the slot may use: premium ones for brain work, strongest first, Claude before GPT. */
export function choices(catalog: Catalog, slot: Slot): ModelInfo[] {
  const allowed = catalog.models.filter((m) => !slot.brain || !isCheapModel(m));
  const tiers = [...new Set(allowed.map((m) => m.tier))].sort((a, b) => b - a);
  return tiers.flatMap((t) => claudeFirst(allowed.filter((m) => m.tier === t)));
}

/** The chosen model goes first; the others stay behind it as fallbacks. */
export function assign(config: ConcertoConfig, slot: Slot, ref: string): ConcertoConfig {
  const models = [ref, ...slotModels(config, slot).filter((m) => m !== ref)];
  if (slot.kind === "roles") return { ...config, roles: { ...config.roles, [slot.key]: { ...config.roles[slot.key as Role], models } } };
  return { ...config, [slot.kind]: config[slot.kind].map((r, i) => (i === slot.index ? { ...r, models } : r)) };
}

/** Where the slot's model chain lives in the config. */
export function slotPath(slot: Slot): Path {
  return slot.kind === "roles" ? ["roles", slot.key, "models"] : [slot.kind, slot.index, "models"];
}

/** Saves the slot's chain to the config in use, editing only that slot in the file. */
export function saveChoice(cwd: string, config: ConcertoConfig, slot: Slot): string {
  return savePath(cwd, config, slotPath(slot));
}
