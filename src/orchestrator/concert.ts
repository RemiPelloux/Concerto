import { join } from "node:path";
import type { ConcertoConfig } from "#src/config/types.js";
import { BlastRadius } from "#src/engine/blast-radius.js";
import { buildRepoMap, type RepoMap } from "#src/engine/repo-map.js";
import { ResponseCache } from "#src/engine/response-cache.js";
import { Sessions } from "#src/engine/sessions.js";
import { SystemPrompts } from "#src/engine/system-prompts.js";
import { claimRun, clearLeftovers } from "#src/engine/worktree.js";
import { detectChecks, type Check } from "#src/engine/checks.js";
import { calibrate, type Calibration } from "#src/engine/calibrate.js";
import { readOutcomes } from "#src/engine/outcomes.js";
import { WEIGHTS } from "#src/orchestrator/scoring.js";
import { detectToolchain, toolchainNotes } from "#src/engine/toolchain.js";
import type { Catalog } from "#src/models/catalog.js";
import { roleChain } from "#src/models/router.js";
import type { Price } from "#src/models/types.js";
import type { Runner } from "#src/runner/types.js";
import type { Store } from "#src/state/store.js";
import { Skills } from "#src/orchestrator/skills.js";

const BASE36 = 36;

/** Everything one run needs, built once and passed around as a single object. */
export type Concert = {
  config: ConcertoConfig;
  catalog: Catalog;
  store: Store;
  runner: Runner;
  cwd: string;
  runId: string;
  signal: AbortSignal;
  cache: ResponseCache;
  sessions: Sessions;
  prompts: SystemPrompts;
  skills: Skills;
  repo: RepoMap;
  blastRadius: BlastRadius;
  /** Stories build in their own git worktrees (a git repository and isolation not turned off). */
  isolated: boolean;
  /** What every story must pass before review: the project's tests, type check and lint. */
  checks: Check[];
  /** What this repository's past runs say: fitted score weights and each model's track record. */
  calibration: Calibration;
  /** Conductor list price: the "one frontier model alone" baseline in the cost panel. */
  brainPrice: Price | null;
};

export type ConcertInit = Pick<Concert, "config" | "catalog" | "store" | "runner" | "cwd"> & { signal?: AbortSignal };

/** Claims this run's worktrees and saves, then removes, any a crashed run left behind. */
async function prepareWorktrees(init: ConcertInit, runId: string): Promise<void> {
  claimRun(init.cwd, runId);
  const patches = await clearLeftovers(init.cwd);
  if (patches.length > 0) init.store.log({ role: "conductor", label: "Cleanup", detail: `unmerged work of an interrupted run saved in ${patches.length} patch file(s) in .concerto/worktrees/`, result: "saved" });
}

export async function createConcert(init: ConcertInit): Promise<Concert> {
  const { config, cwd } = init;
  const runId = `run-${Date.now().toString(BASE36)}`;
  const cache = new ResponseCache({ ...config.cache, dir: join(cwd, config.cache.dir) });
  cache.prune();
  const repo = await buildRepoMap(cwd);
  const isolated = config.isolation === "worktree" && repo.key !== "no-git";
  if (isolated) await prepareWorktrees(init, runId);
  return {
    ...init,
    runId,
    signal: init.signal ?? new AbortController().signal,
    cache,
    sessions: new Sessions(join(cwd, ".concerto", "sessions"), runId),
    prompts: new SystemPrompts(cwd, toolchainNotes(detectToolchain(cwd))),
    skills: new Skills(config.skills, cwd),
    repo,
    blastRadius: new BlastRadius(cwd, repo.files),
    isolated,
    checks: detectChecks(cwd, config.checks),
    calibration: calibrate(readOutcomes(cwd), WEIGHTS),
    brainPrice: roleChain(init.catalog, config, "conductor")[0]?.price ?? null,
  };
}
