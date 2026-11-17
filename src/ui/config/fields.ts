import { EFFORTS, MAX_SCORE, MAX_TIER, type ConcertoConfig } from "#src/config/types.js";
import type { Catalog } from "#src/models/catalog.js";
import { current, slotModels, type Slot } from "#src/ui/model-slots.js";
import { getIn, setIn, type Path } from "#src/ui/config/paths.js";

type Base = { label: string; hint?: string };
/** `optional`: below `min` removes the value, shown as `unset`. `limit`: how the top value reads. */
type NumberField = Base & { kind: "number"; path: Path; min: number; max: number; step: number; optional?: boolean; unset?: string; limit?: string };
/** One editable value: ←→ steps a number or a choice, or flips a toggle; Enter types a list or a text, picks a model or edits a chain. */
export type Field =
  | NumberField
  | (Base & { kind: "choice"; path: Path; options: readonly string[] })
  | (Base & { kind: "list" | "text"; path: Path })
  | (Base & { kind: "toggle"; path: Path })
  | (Base & { kind: "model"; slot: Slot })
  | (Base & { kind: "chain"; slot: Slot });

const SCORE_STEP = 5;
const NO_LIMIT = MAX_SCORE + 1;
const MAX_BUDGET = 1000;
const MAX_TIMEOUT = 240;
const TIMEOUT_STEP = 5;
const MAX_PARALLEL = 32;
const MAX_TTL = 720;
const TTL_STEP = 12;
const ENTRIES_STEP = 50;
const MAX_ENTRIES = 10000;
const MAX_COST = 5;
const COST_STEP = 0.1;
const DECIMALS = 2;

const tier = (label: string, path: Path): Field => ({ kind: "number", label, path, min: 1, max: MAX_TIER, step: 1 });
const score = (label: string, path: Path): Field => ({ kind: "number", label, path, min: 0, max: NO_LIMIT, step: SCORE_STEP, limit: "no limit" });

function roleFields(slot: Slot): Field[] {
  const at = ["roles", slot.key];
  return [
    { kind: "model", label: "model", slot },
    { kind: "chain", label: "chain", slot, hint: "the order models are tried in" },
    { kind: "choice", label: "effort", path: [...at, "effort"], options: EFFORTS },
    tier("lowest tier", [...at, "minTier"]),
    { kind: "list", label: "tools", path: [...at, "tools"], hint: "comma separated, e.g. read, bash" },
  ];
}

function routeFields(slot: Slot): Field[] {
  const at = ["routes", slot.index];
  return [
    { kind: "model", label: "model", slot },
    { kind: "chain", label: "chain", slot, hint: "the order models are tried in" },
    { kind: "text", label: "name", path: [...at, "name"] },
    { kind: "choice", label: "builder", path: [...at, "role"], options: ["soloist", "section"] },
    { kind: "list", label: "tags", path: [...at, "tags"], hint: "stories with any of these tags; empty: any" },
    score("score from", [...at, "minScore"]),
    score("score under", [...at, "maxScore"]),
    { kind: "choice", label: "effort", path: [...at, "effort"], options: ["auto", ...EFFORTS] },
  ];
}

function reviewFields(slot: Slot): Field[] {
  const at = ["reviews", slot.index];
  return [
    { kind: "model", label: "model", slot },
    { kind: "chain", label: "chain", slot, hint: "the order models are tried in" },
    { kind: "list", label: "tags", path: [...at, "tags"], hint: "stories with any of these tags; empty: any" },
    score("score from", [...at, "minScore"]),
    score("score under", [...at, "maxScore"]),
    { kind: "choice", label: "effort", path: [...at, "effort"], options: ["auto", ...EFFORTS], hint: "auto scales with the story score" },
  ];
}

/** What can be changed on one box of the organigram. */
export function nodeFields(slot: Slot): Field[] {
  if (slot.kind === "roles") return roleFields(slot);
  return slot.kind === "routes" ? routeFields(slot) : reviewFields(slot);
}

export function settingsFields(): Field[] {
  return [
    { kind: "number", label: "budget per run ($)", path: ["budgetUsd"], min: 1, max: MAX_BUDGET, step: 1, optional: true },
    { kind: "toggle", label: "rewriter", path: ["rewrite"], hint: "sharpens each request first; off runs it as typed" },
    { kind: "list", label: "providers tried first", path: ["prefer"], hint: "e.g. ce-*, codex@*  or  claude-code, codex" },
    { kind: "list", label: "gates", path: ["gates"], hint: "commands every story must pass, comma separated" },
    { kind: "number", label: "timeout (minutes)", path: ["timeoutMinutes"], min: 1, max: MAX_TIMEOUT, step: TIMEOUT_STEP },
    { kind: "number", label: "parallel builders", path: ["swarm", "maxParallel"], min: 1, max: MAX_PARALLEL, step: 1 },
    { kind: "text", label: "cache folder", path: ["cache", "dir"] },
    { kind: "number", label: "cache lifetime (hours)", path: ["cache", "ttlHours"], min: 1, max: MAX_TTL, step: TTL_STEP },
    { kind: "number", label: "cache entries", path: ["cache", "maxEntries"], min: ENTRIES_STEP, max: MAX_ENTRIES, step: ENTRIES_STEP },
  ];
}

/** Every model in the config with its tier and cost factor; the hint says whether it answers here. */
export function modelFields(config: ConcertoConfig, catalog: Catalog): Field[] {
  const reachable = new Set(catalog.models.map((m) => m.ref));
  return Object.keys(config.models).flatMap((ref): Field[] => [
    { ...tier(ref, ["models", ref, "tier"]), hint: reachable.has(ref) ? "reachable" : "not reachable" },
    { kind: "number", label: "  cost factor", path: ["models", ref, "costFactor"], min: 0, max: MAX_COST, step: COST_STEP, optional: true, unset: "price list", hint: "0 = prepaid subscription" },
  ]);
}

export function skillFields(config: ConcertoConfig): Field[] {
  return config.skills.flatMap((_rule, i): Field[] => [
    { kind: "list", label: `rule ${i + 1} tags`, path: ["skills", i, "tags"], hint: "stories with these tags…" },
    { kind: "list", label: `rule ${i + 1} skills`, path: ["skills", i, "paths"], hint: "…get these skill folders" },
  ]);
}

function shownNumber(field: NumberField, value: unknown): string {
  if (typeof value !== "number") return field.unset ?? "off";
  return field.limit && value >= field.max ? field.limit : String(value);
}

/** The value as the screen shows it. */
export function shown(field: Field, config: ConcertoConfig, catalog: Catalog): string {
  if (field.kind === "model") return current(config, catalog, field.slot) || "(none reachable)";
  if (field.kind === "chain") return slotModels(config, field.slot).join(" › ") || "cheapest model at the tier";
  const value = getIn(config, field.path);
  if (field.kind === "number") return shownNumber(field, value);
  if (field.kind === "toggle") return value ? "on" : "off";
  if (Array.isArray(value)) return value.join(", ") || "none";
  return String(value ?? "");
}

function stepNumber(field: NumberField, config: ConcertoConfig, dir: number): unknown {
  const value = getIn(config, field.path);
  if (typeof value !== "number") return dir > 0 ? setIn(config, field.path, field.min) : config;
  const next = Number((Math.round((value + dir * field.step) / field.step) * field.step).toFixed(DECIMALS));
  if (next < field.min && field.optional) return setIn(config, field.path, undefined);
  return setIn(config, field.path, Math.max(field.min, Math.min(next, field.max)));
}

/** ←→ on a number, a choice or a toggle: the whole config with that one value moved; null when it cannot step. */
export function stepped(field: Field, config: ConcertoConfig, dir: number): unknown {
  if (field.kind === "number") return stepNumber(field, config, dir);
  if (field.kind === "toggle") return setIn(config, field.path, !getIn(config, field.path));
  if (field.kind !== "choice") return null;
  const at = field.options.indexOf(String(getIn(config, field.path)));
  const size = field.options.length;
  return setIn(config, field.path, field.options[(at + dir + size) % size]);
}

/** The text a list or text field starts editing from. */
export function editText(field: Field, config: ConcertoConfig): string {
  if (field.kind !== "list" && field.kind !== "text") return "";
  const value = getIn(config, field.path);
  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
}

/** The whole config with the typed text stored in a list or text field. */
export function typed(field: Field, config: ConcertoConfig, text: string): unknown {
  if (field.kind === "text") return setIn(config, field.path, text.trim());
  if (field.kind !== "list") return null;
  return setIn(config, field.path, text.split(",").map((t) => t.trim()).filter(Boolean));
}
