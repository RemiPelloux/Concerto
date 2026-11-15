import { join } from "node:path";
import type { ConcertoConfig } from "../config/types.js";
import { buildRepoMap, type RepoMap } from "../engine/repo-map.js";
import { ResponseCache } from "../engine/response-cache.js";
import { Sessions } from "../engine/sessions.js";
import { SystemPrompts } from "../engine/system-prompts.js";
import { detectToolchain, toolchainNotes } from "../engine/toolchain.js";
import type { Catalog } from "../models/catalog.js";
import { roleChain } from "../models/router.js";
import type { Price } from "../models/types.js";
import type { Runner } from "../runner/types.js";
import type { Store } from "../state/store.js";
import { Skills } from "./skills.js";

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
  /** Conductor list price: the "one frontier model alone" baseline in the cost panel. */
  brainPrice: Price | null;
};

export type ConcertInit = Pick<Concert, "config" | "catalog" | "store" | "runner" | "cwd"> & { signal?: AbortSignal };

export async function createConcert(init: ConcertInit): Promise<Concert> {
  const { config, cwd } = init;
  const runId = `run-${Date.now().toString(BASE36)}`;
  const cache = new ResponseCache({ ...config.cache, dir: join(cwd, config.cache.dir) });
  cache.prune();
  return {
    ...init,
    runId,
    signal: init.signal ?? new AbortController().signal,
    cache,
    sessions: new Sessions(join(cwd, ".concerto", "sessions"), runId),
    prompts: new SystemPrompts(cwd, toolchainNotes(detectToolchain(cwd))),
    skills: new Skills(config.skills, cwd),
    repo: await buildRepoMap(cwd),
    brainPrice: roleChain(init.catalog, config, "conductor")[0]?.price ?? null,
  };
}
