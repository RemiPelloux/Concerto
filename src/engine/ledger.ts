import type { Price } from "#src/models/types.js";
import { addUsage, promptTokens, ZERO_USAGE, type Usage } from "#src/runner/usage.js";

const PER_MILLION = 1_000_000;

export type Ledger = {
  usage: Usage;
  /** What the same tokens would have cost on the conductor model alone. */
  soloCost: number;
  /** Dollars saved by provider cache reads compared with paying full input price. */
  cacheSaved: number;
  /** Calls answered by the local response cache or an identical call in flight. */
  localHits: number;
  /** Tokens the condenser removed from critiques, logs and guidance before sending them. */
  condensedTokens: number;
  /** Tokens not resent because the session already had them. */
  dedupedTokens: number;
  /** Calls that failed on one model and moved to the next in the chain. */
  fallbacks: number;
  /** Usage per role (scorer, critic…): which prompts the provider's cache actually serves. */
  roles: Record<string, Usage>;
  /** Calls and usage per model, so a report accounts for every call. Absent in sessions before 0.11. */
  models?: Record<string, { calls: number; usage: Usage }>;
};

export const EMPTY_LEDGER: Ledger = {
  usage: ZERO_USAGE,
  soloCost: 0,
  cacheSaved: 0,
  localHits: 0,
  condensedTokens: 0,
  dedupedTokens: 0,
  fallbacks: 0,
  roles: {},
  models: {},
};

export function priceUsage(u: Usage, p: Price): number {
  const dollars = u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite;
  return dollars / PER_MILLION;
}

type Entry = { usage: Usage; price: Price | null; brain: Price | null; role?: string; model?: string };

type ModelCalls = NonNullable<Ledger["models"]>;

function addCalls(a: ModelCalls, b: ModelCalls): ModelCalls {
  const refs = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return Object.fromEntries(refs.map((r) => [r, { calls: (a[r]?.calls ?? 0) + (b[r]?.calls ?? 0), usage: addUsage(a[r]?.usage ?? ZERO_USAGE, b[r]?.usage ?? ZERO_USAGE) }]));
}

/** Adds one call. When the CLI reports no cost, list price is used (API-equivalent). */
export function record(ledger: Ledger, entry: Entry): Ledger {
  const { price, brain } = entry;
  const usage = { ...entry.usage, cost: entry.usage.cost || (price ? priceUsage(entry.usage, price) : 0) };
  const saved = price ? (usage.cacheRead * (price.input - price.cacheRead)) / PER_MILLION : 0;
  return {
    ...ledger,
    usage: addUsage(ledger.usage, usage),
    soloCost: ledger.soloCost + (brain ? priceUsage(usage, brain) : usage.cost),
    cacheSaved: ledger.cacheSaved + saved,
    roles: entry.role ? { ...ledger.roles, [entry.role]: addUsage(ledger.roles[entry.role] ?? ZERO_USAGE, usage) } : ledger.roles,
    models: entry.model ? addCalls(ledger.models ?? {}, { [entry.model]: { calls: 1, usage } }) : ledger.models,
  };
}

export function bump(ledger: Ledger, field: "localHits" | "fallbacks" | "condensedTokens" | "dedupedTokens", by = 1): Ledger {
  return { ...ledger, [field]: ledger[field] + by };
}

export function cacheHitRatio(u: Usage): number {
  const total = promptTokens(u);
  return total === 0 ? 0 : u.cacheRead / total;
}

export function mergeLedgers(a: Ledger, b: Ledger): Ledger {
  return {
    usage: addUsage(a.usage, b.usage),
    soloCost: a.soloCost + b.soloCost,
    cacheSaved: a.cacheSaved + b.cacheSaved,
    localHits: a.localHits + b.localHits,
    condensedTokens: a.condensedTokens + b.condensedTokens,
    dedupedTokens: a.dedupedTokens + b.dedupedTokens,
    fallbacks: a.fallbacks + b.fallbacks,
    roles: Object.fromEntries([...new Set([...Object.keys(a.roles), ...Object.keys(b.roles)])].map((r) => [r, addUsage(a.roles[r] ?? ZERO_USAGE, b.roles[r] ?? ZERO_USAGE)])),
    models: addCalls(a.models ?? {}, b.models ?? {}),
  };
}
