import { join } from "node:path";
import { ROLES, type ConcertoConfig } from "#src/config/types.js";
import { cacheHitRatio } from "#src/engine/ledger.js";
import { ResponseCache } from "#src/engine/response-cache.js";
import { readStats } from "#src/engine/stats.js";
import type { Catalog } from "#src/models/catalog.js";
import { reviewChain, roleChain, routeStory } from "#src/models/router.js";
import type { ModelInfo } from "#src/models/types.js";
import { promptTokens } from "#src/runner/usage.js";

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

/** Each role's chain and how sample stories route. Shared by `--models` and `/models`. */
export function routingLines(catalog: Catalog, config: ConcertoConfig): string[] {
  const roles = ROLES.map((r) => `role   ${r.padEnd(COLUMN)} ${refs(roleChain(catalog, config, r))}`);
  const stories = SAMPLES.map((s) => {
    const a = routeStory(s, catalog, config);
    return `story  ${s.label.padEnd(COLUMN)} ${a.rule}: ${refs(a.chain)} · review ${refs(reviewChain(s.tags, catalog, config))}`;
  });
  return [...roles, ...stories];
}

/** `--models`: what is reachable, each role's chain, and how sample stories route. */
export function printModels(catalog: Catalog, config: ConcertoConfig): void {
  catalog.models.forEach((m) => out(`model  ${m.ref.padEnd(COLUMN)} tier ${m.tier}  ${price(m)}`));
  routingLines(catalog, config).forEach(out);
}

/** Totals across every run in this repository. Shared by `--stats` and `/stats`. */
export function statsLines(cwd: string): string[] {
  const { runs, ledger } = readStats(cwd);
  const u = ledger.usage;
  return [
    `runs              ${runs}`,
    `tokens            ${promptTokens(u)} prompt, ${u.output} output`,
    `provider cache    ${Math.round(cacheHitRatio(u) * PERCENT)}% read, $${ledger.cacheSaved.toFixed(2)} saved`,
    `local cache       ${ledger.localHits} calls answered without a model`,
    `condensed         ${ledger.condensedTokens} tokens removed from feedback and logs`,
    `session dedupe    ${ledger.dedupedTokens} tokens not resent`,
    `fallbacks         ${ledger.fallbacks}`,
    `cost              $${u.cost.toFixed(2)} (API-equivalent) vs $${ledger.soloCost.toFixed(2)} on the conductor alone`,
  ];
}

export function printStats(cwd: string): void {
  statsLines(cwd).forEach(out);
}

/** `--clear-cache`: drops the local response cache, keeps the stats. */
export function clearCache(cwd: string, config: ConcertoConfig): void {
  const removed = new ResponseCache({ ...config.cache, dir: join(cwd, config.cache.dir) }).clear();
  out(`removed ${removed} cached responses`);
}
