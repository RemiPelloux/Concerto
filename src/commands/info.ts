import { join } from "node:path";
import { ROLES, type ConcertoConfig } from "../config/types.js";
import { cacheHitRatio } from "../engine/ledger.js";
import { ResponseCache } from "../engine/response-cache.js";
import { readStats } from "../engine/stats.js";
import type { Catalog } from "../models/catalog.js";
import { reviewChain, roleChain, routeStory } from "../models/router.js";
import type { ModelInfo } from "../models/types.js";
import { promptTokens } from "../runner/usage.js";

const COLUMN = 30;
const PERCENT = 100;
const SAMPLES = [
  { label: "score 20", score: 20, tags: [] },
  { label: "score 60", score: 60, tags: [] },
  { label: "score 90", score: 90, tags: [] },
  { label: "ui, score 20", score: 20, tags: ["ui"] },
];

const out = (line: string) => process.stdout.write(`${line}\n`);
const refs = (chain: ModelInfo[]) => chain.map((m) => m.ref).join(" > ");

function price(m: ModelInfo): string {
  return m.price ? `$${m.price.input}/$${m.price.output} x${m.costFactor}` : "no price";
}

/** `--models`: what is reachable, each role's chain, and how sample stories route. */
export function printModels(catalog: Catalog, config: ConcertoConfig): void {
  catalog.models.forEach((m) => out(`model  ${m.ref.padEnd(COLUMN)} tier ${m.tier}  ${price(m)}`));
  ROLES.forEach((r) => out(`role   ${r.padEnd(COLUMN)} ${refs(roleChain(catalog, config, r))}`));
  SAMPLES.forEach((s) => {
    const a = routeStory(s, catalog, config);
    out(`story  ${s.label.padEnd(COLUMN)} ${a.rule}: ${refs(a.chain)} · review ${refs(reviewChain(s.tags, catalog, config))}`);
  });
}

/** `--stats`: totals across every run in this repository. */
export function printStats(cwd: string): void {
  const { runs, ledger } = readStats(cwd);
  const u = ledger.usage;
  out(`runs              ${runs}`);
  out(`tokens            ${promptTokens(u)} prompt, ${u.output} output`);
  out(`provider cache    ${Math.round(cacheHitRatio(u) * PERCENT)}% read, $${ledger.cacheSaved.toFixed(2)} saved`);
  out(`local cache       ${ledger.localHits} calls answered without a model`);
  out(`condensed         ${ledger.condensedTokens} tokens removed from feedback and logs`);
  out(`session dedupe    ${ledger.dedupedTokens} tokens not resent`);
  out(`fallbacks         ${ledger.fallbacks}`);
  out(`cost              $${u.cost.toFixed(2)} (API-equivalent) vs $${ledger.soloCost.toFixed(2)} on the conductor alone`);
}

/** `--clear-cache`: drops the local response cache, keeps the stats. */
export function clearCache(cwd: string, config: ConcertoConfig): void {
  const removed = new ResponseCache({ ...config.cache, dir: join(cwd, config.cache.dir) }).clear();
  out(`removed ${removed} cached responses`);
}
