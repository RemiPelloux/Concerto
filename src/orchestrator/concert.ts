import { join } from "node:path";
import { ResponseCache } from "../cache/response-cache.js";
import type { ConcertoConfig } from "../config/types.js";
import type { ModelInfo } from "../models/types.js";
import type { Runner } from "../runner/types.js";
import type { Store } from "../state/store.js";

/** Everything one run needs, passed around as a single object. */
export type Concert = {
  config: ConcertoConfig;
  catalog: ModelInfo[];
  store: Store;
  runner: Runner;
  cache: ResponseCache;
  cwd: string;
  runId: string;
  signal: AbortSignal;
};

const BASE36 = 36;

type ConcertInit = Omit<Concert, "cache" | "runId" | "signal"> & { signal?: AbortSignal };

export function createConcert(init: ConcertInit): Concert {
  const cacheDir = join(init.cwd, init.config.cache.dir);
  return {
    ...init,
    cache: new ResponseCache(cacheDir, init.config.cache.ttlHours),
    runId: `run-${Date.now().toString(BASE36)}`,
    signal: init.signal ?? new AbortController().signal,
  };
}

export function sessionDir(c: Concert): string {
  return join(c.cwd, ".concerto", "sessions");
}
