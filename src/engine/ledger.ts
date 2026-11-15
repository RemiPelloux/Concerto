import type { Price } from "../models/types.js";
import { addUsage, promptTokens, ZERO_USAGE, type Usage } from "../runner/usage.js";

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
};

export const EMPTY_LEDGER: Ledger = {
  usage: ZERO_USAGE,
  soloCost: 0,
  cacheSaved: 0,
  localHits: 0,
  condensedTokens: 0,
  dedupedTokens: 0,
  fallbacks: 0,
};

export function priceUsage(u: Usage, p: Price): number {
  const dollars = u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite;
  return dollars / PER_MILLION;
}

type Entry = { usage: Usage; price: Price | null; brain: Price | null };

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
  };
}
