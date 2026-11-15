import type { Price } from "../models/types.js";
import { addUsage, promptTokens, ZERO_USAGE, type Usage } from "../runner/usage.js";

const PER_MILLION = 1_000_000;

export type Ledger = {
  usage: Usage;
  /** What the same tokens would have cost on the conductor model alone. */
  soloCost: number;
  /** Dollars saved by prompt-cache reads compared with paying full input price. */
  cacheSaved: number;
  /** Calls answered from Concerto's own response cache, at zero tokens. */
  localHits: number;
};

export const EMPTY_LEDGER: Ledger = { usage: ZERO_USAGE, soloCost: 0, cacheSaved: 0, localHits: 0 };

export function priceUsage(u: Usage, p: Price): number {
  const dollars = u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite;
  return dollars / PER_MILLION;
}

type Entry = { usage: Usage; price: Price | null; brain: Price | null };

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

export function cacheHitRatio(u: Usage): number {
  const total = promptTokens(u);
  return total === 0 ? 0 : u.cacheRead / total;
}
