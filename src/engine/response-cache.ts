import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { RunResult } from "../runner/types.js";
import { UsageSchema } from "../runner/usage.js";
import { hashParts } from "./hash.js";

const MS_PER_HOUR = 3_600_000;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const EXT = ".json";

const EntrySchema = z.object({ v: z.literal(1), result: z.object({ text: z.string(), usage: UsageSchema, turns: z.number() }) });

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export type Hit = "local" | "inflight" | "miss";
export type CacheOptions = { dir: string; ttlHours: number; maxEntries: number };

/**
 * Exact-match cache for read-only calls (the scorer). A hit costs zero tokens.
 * Entries are validated on read, written atomically with owner-only permissions, and pruned
 * to `maxEntries`. Identical calls in flight at the same time share one request.
 */
export class ResponseCache {
  private readonly inflight = new Map<string, Promise<RunResult>>();
  private readonly ttlMs: number;

  constructor(private readonly opts: CacheOptions) {
    this.ttlMs = opts.ttlHours * MS_PER_HOUR;
  }

  key(parts: readonly string[]): string {
    return hashParts(parts);
  }

  get(key: string): RunResult | null {
    const file = join(this.opts.dir, key + EXT);
    if (!existsSync(file) || Date.now() - statSync(file).mtimeMs >= this.ttlMs) return null;
    const parsed = EntrySchema.safeParse(readJson(file));
    return parsed.success ? parsed.data.result : null;
  }

  set(key: string, result: RunResult): void {
    mkdirSync(this.opts.dir, { recursive: true, mode: DIR_MODE });
    const file = join(this.opts.dir, key + EXT);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ v: 1, result }), { mode: FILE_MODE });
    chmodSync(tmp, FILE_MODE);
    renameSync(tmp, file);
  }

  /** Returns the cached result, joins an identical call in flight, or runs `produce` once. */
  async once(key: string, produce: () => Promise<RunResult>): Promise<{ result: RunResult; hit: Hit }> {
    const stored = this.get(key);
    if (stored) return { result: stored, hit: "local" };
    const pending = this.inflight.get(key);
    if (pending) return { result: await pending, hit: "inflight" };
    const job = produce().finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    const result = await job;
    this.set(key, result);
    return { result, hit: "miss" };
  }

  /** Drops expired entries, then the oldest ones beyond `maxEntries`. Returns how many went. */
  prune(): number {
    if (!existsSync(this.opts.dir)) return 0;
    const now = Date.now();
    const entries = readdirSync(this.opts.dir)
      .filter((f) => f.endsWith(EXT))
      .map((f) => ({ file: join(this.opts.dir, f), mtime: statSync(join(this.opts.dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    const doomed = entries.filter((e, i) => i >= this.opts.maxEntries || now - e.mtime >= this.ttlMs);
    doomed.forEach((e) => rmSync(e.file, { force: true }));
    return doomed.length;
  }

  clear(): number {
    if (!existsSync(this.opts.dir)) return 0;
    const files = readdirSync(this.opts.dir).filter((f) => f.endsWith(EXT));
    files.forEach((f) => rmSync(join(this.opts.dir, f), { force: true }));
    return files.length;
  }
}
