import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ParseCache } from "#src/engine/parse-cache.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import { createFixture, fixtureConcert, performFixture, REQUEST } from "#scripts/perf-fixture.js";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, readFileSync: vi.fn(fs.readFileSync) };
});

vi.mock("node:child_process", async (original) => {
  const cp = await original<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  const execFile = Object.assign(vi.fn(cp.execFile), {
    [promisify.custom]: vi.fn(promisify(cp.execFile)),
  });
  return { ...cp, execFile };
});

/** Two benchmark fan-outs: about 50 s on a Windows runner, where git processes start slowly. */
const TWO_FAN_OUTS_TIMEOUT_MS = 120_000;

async function measureFanout(cwd: string) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const gitCalls = vi.mocked(promisify(execFile));
  const parsed: string[] = [];
  const get = ParseCache.prototype.get;
  const spy = vi.spyOn(ParseCache.prototype, "get").mockImplementation(function (this: ParseCache, ...args: Parameters<ParseCache["get"]>) {
    const [root, path, parse] = args;
    return get.call(this, root, path, () => { parsed.push(path); return parse(); });
  });
  vi.mocked(readFileSync).mockClear();
  gitCalls.mockClear();
  try {
    const { concert } = await fixtureConcert(cwd);
    await scoreRequest(concert, REQUEST);
    expect(await performFixture(concert)).toBe(8);
    const reads = vi.mocked(readFileSync).mock.calls.map(([path]) => String(path)).filter((path) => path.startsWith(join(cwd, "src")));
    const git = gitCalls.mock.calls.filter(([bin]) => bin === "git").map(([, args, options]) => JSON.stringify([options?.cwd, args]));
    return { parsed, reads, git, lookups: spy.mock.calls.length };
  } finally {
    spy.mockRestore();
  }
}

describe("derived-cache duplicate-work gate", () => {
  it("does no repeated source parsing in fan-out and reuses persisted parses in a new concert", async () => {
    const fixture = await createFixture();
    try {
      const cold = await measureFanout(fixture.cwd);
      const warm = await measureFanout(fixture.cwd);
      expect(cold.lookups).toBe(fixture.sources);
      expect(cold.parsed).toHaveLength(fixture.sources);
      expect(new Set(cold.parsed).size).toBe(cold.parsed.length);
      expect(cold.reads).toHaveLength(fixture.sources);
      expect(new Set(cold.reads).size).toBe(cold.reads.length);
      expect(warm.lookups).toBe(fixture.sources);
      expect(warm.parsed).toEqual([]);
      // Context packs still read eight story sources; no source is read twice.
      expect(warm.reads).toHaveLength(8);
      expect(new Set(warm.reads).size).toBe(warm.reads.length);
      expect(cold.git.length - new Set(cold.git).size).toBeGreaterThan(0);
      expect(warm.git.length).toBe(cold.git.length);
    } finally {
      fixture.cleanup();
    }
  }, TWO_FAN_OUTS_TIMEOUT_MS);
});
