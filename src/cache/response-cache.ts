import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunResult } from "../runner/types.js";
import { hashParts } from "./hash.js";

const MS_PER_HOUR = 3_600_000;

/**
 * Exact-match cache for calls that only read: the scorer and conductor consults.
 * A hit costs zero tokens. Builder calls are never cached, they change the tree.
 */
export class ResponseCache {
  private readonly ttlMs: number;

  constructor(
    private readonly dir: string,
    ttlHours: number,
  ) {
    this.ttlMs = ttlHours * MS_PER_HOUR;
  }

  key(parts: readonly string[]): string {
    return hashParts(parts);
  }

  get(key: string): RunResult | null {
    const file = join(this.dir, `${key}.json`);
    if (!existsSync(file)) return null;
    if (Date.now() - statSync(file).mtimeMs > this.ttlMs) return null;
    return JSON.parse(readFileSync(file, "utf8")) as RunResult;
  }

  set(key: string, value: RunResult): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${key}.json`), JSON.stringify(value));
  }
}
