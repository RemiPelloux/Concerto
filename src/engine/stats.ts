import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { UsageSchema } from "#src/runner/usage.js";
import { EMPTY_LEDGER, mergeLedgers, type Ledger } from "#src/engine/ledger.js";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

const StatsSchema = z.object({
  runs: z.number(),
  ledger: z.object({
    usage: UsageSchema,
    soloCost: z.number(),
    cacheSaved: z.number(),
    localHits: z.number(),
    condensedTokens: z.number().default(0),
    dedupedTokens: z.number().default(0),
    fallbacks: z.number().default(0),
  }),
});
export type Stats = z.infer<typeof StatsSchema>;

export function statsPath(cwd: string): string {
  return join(cwd, ".concerto", "stats.json");
}

export function readStats(cwd: string): Stats {
  const file = statsPath(cwd);
  if (!existsSync(file)) return { runs: 0, ledger: EMPTY_LEDGER };
  try {
    const parsed = StatsSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : { runs: 0, ledger: EMPTY_LEDGER };
  } catch {
    return { runs: 0, ledger: EMPTY_LEDGER };
  }
}

/** Adds one run's ledger to the totals kept in `.concerto/stats.json`. */
export function saveRun(cwd: string, ledger: Ledger): Stats {
  const before = readStats(cwd);
  const after = { runs: before.runs + 1, ledger: mergeLedgers(before.ledger, ledger) };
  const file = statsPath(cwd);
  mkdirSync(dirname(file), { recursive: true, mode: DIR_MODE });
  writeFileSync(file, JSON.stringify(after, null, 2), { mode: FILE_MODE });
  chmodSync(file, FILE_MODE);
  return after;
}
