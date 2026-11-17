import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { readChanges } from "#src/engine/changes.js";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BlastRadius } from "#src/engine/blast-radius.js";
import { contextPack } from "#src/engine/context-pack.js";
import { analyzeImpact } from "#src/engine/impact.js";
import { ReadCache } from "#src/engine/read-cache.js";
import { gitEnv } from "#src/runner/env.js";
import { fixtureConcert, createFixture, performFixture, REQUEST } from "#scripts/perf-fixture.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import { tempDir } from "#tests/fixtures.js";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, readFileSync: vi.fn(fs.readFileSync) };
});

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, readFile: vi.fn(fs.readFile) };
});

/** More than one tick of the coarsest file clock the cache meets: Windows' ~16 ms. */
const CLOCK_TICK_MS = 50;
/** One benchmark fan-out takes about 25 s on a Windows runner, where git processes start slowly. */
const FAN_OUT_TIMEOUT_MS = 90_000;

function reads(path: string): number {
  return vi.mocked(readFileSync).mock.calls.filter(([file]) => file === path).length;
}

describe("per-run file reads", () => {
  it("shares repeated and concurrent lookups, while separate runs read independently", async () => {
    const path = join(tempDir(), "source.ts");
    writeFileSync(path, "export const a = 1;");
    const cache = new ReadCache();
    const before = reads(path);
    const results = await Promise.all([Promise.resolve().then(() => cache.read(path)), Promise.resolve().then(() => cache.read(path))]);
    expect(results).toEqual(["export const a = 1;", "export const a = 1;"]);
    expect(reads(path) - before).toBe(1);
    expect(new ReadCache().read(path)).toBe(results[0]);
    expect(reads(path) - before).toBe(2);
    cache.clear();
    expect(cache.read(path)).toBe(results[0]);
    expect(reads(path) - before).toBe(3);
  });

  it("refreshes edits with restored timestamps, deletions and recreations", async () => {
    const path = join(tempDir(), "source.ts");
    writeFileSync(path, "first");
    const cache = new ReadCache();
    expect(cache.read(path)).toBe("first");
    const restored = new Date(0);
    utimesSync(path, restored, restored);
    expect(cache.read(path)).toBe("first");
    // Only ctime tells this edit apart (same size, mtime put back), and Windows ticks ctime on a
    // ~16 ms clock: the edit comes a tick after the read, as a builder's edits do.
    await new Promise((resolve) => setTimeout(resolve, CLOCK_TICK_MS));
    writeFileSync(path, "other");
    utimesSync(path, restored, restored);
    expect(cache.read(path)).toBe("other");
    rmSync(path);
    expect(() => cache.read(path)).toThrow();
    writeFileSync(path, "again");
    expect(cache.read(path)).toBe("again");
  });

  it("does not retain failures", () => {
    const path = join(tempDir(), "source.ts");
    const cache = new ReadCache();
    expect(() => cache.read(path)).toThrow();
    writeFileSync(path, "recovered");
    expect(cache.read(path)).toBe("recovered");
    cache.clear();
    vi.mocked(readFileSync).mockImplementationOnce(() => { throw new Error("transient failure"); });
    expect(() => cache.read(path)).toThrow("transient failure");
    expect(cache.read(path)).toBe("recovered");
  });

  it("reuses graph reads in context packs and refreshes after a build changes the tree", async () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, "src"));
    const path = join(cwd, "src/a.ts");
    writeFileSync(path, "export const first = 1;");
    const cache = new BlastRadius(cwd, ["src/a.ts"]);
    const input = { cwd, repoFiles: ["src/a.ts"], cache, stories: [{ id: "a", files: ["src/a.ts"] }] };
    const before = reads(path);
    const impact = await analyzeImpact(input);
    expect(contextPack(cwd, ["src/a.ts"], cache.parseCache)).toBe(contextPack(cwd, ["src/a.ts"]));
    expect(reads(path) - before).toBe(2); // One graph read and the explicit uncached comparison.
    expect((await analyzeImpact(input)).get("a")).toEqual(impact.get("a"));
    contextPack(cwd, ["src/a.ts"], cache.parseCache);
    expect(reads(path) - before).toBe(2);
    writeFileSync(path, "export const second = 2;\n");
    expect(contextPack(cwd, ["src/a.ts"], cache.parseCache)).toContain("second");
    expect((await analyzeImpact(input)).get("a")?.lines).toBe(2);
    rmSync(path);
    expect(contextPack(cwd, ["src/a.ts"], cache.parseCache)).toBe("");
  });
  it("shares concurrent binary reads, retries failures and rejects stale in-flight cache fills", async () => {
    const path = join(tempDir(), "binary");
    writeFileSync(path, Buffer.from([0, 255, 10]));
    const cache = new ReadCache();
    vi.mocked(readFile).mockClear();
    const [first, second] = await Promise.all([cache.readBuffer(path), cache.readBuffer(path)]);
    expect(first).toEqual(Buffer.from([0, 255, 10]));
    expect(second).toBe(first);
    expect(readFile).toHaveBeenCalledTimes(1);
    cache.clear();
    vi.mocked(readFile).mockRejectedValueOnce(new Error("temporary"));
    await expect(cache.readBuffer(path)).rejects.toThrow("temporary");
    expect(await cache.readBuffer(path)).toEqual(first);
    cache.clear();
    let finish!: (buffer: Buffer<ArrayBuffer>) => void;
    vi.mocked(readFile).mockImplementationOnce(() => new Promise<Buffer<ArrayBuffer>>((resolve) => { finish = resolve; }));
    const stale = cache.readBuffer(path);
    cache.clear();
    writeFileSync(path, "fresh");
    expect((await cache.readBuffer(path)).toString()).toBe("fresh");
    finish(Buffer.from("stale"));
    await stale;
    expect(cache.read(path)).toBe("fresh");
  });

  it("bounds retained bytes and normalizes paths", () => {
    const cwd = tempDir();
    const path = join(cwd, "a");
    const large = join(cwd, "b");
    writeFileSync(path, Buffer.alloc(8_388_608, "a"));
    writeFileSync(large, Buffer.alloc(16_777_217, "b"));
    const cache = new ReadCache();
    const before = reads(path);
    cache.read(path);
    cache.read(`${cwd}/./a`);
    expect(reads(path) - before).toBe(1);
    cache.read(large);
    cache.read(large);
    expect(reads(large)).toBe(2); // Oversized content is returned without retaining it.
    writeFileSync(large, Buffer.alloc(8_388_609, "b"));
    cache.read(large);
    cache.read(path);
    expect(reads(path) - before).toBe(2); // The oldest entry was evicted.
  });

  it("keeps cached and uncached change scans equivalent after writes and deletions", async () => {
    const cwd = tempDir();
    // gitEnv: inside a commit hook, git's GIT_DIR and GIT_INDEX_FILE would aim these at the real repository.
    await promisify(execFile)("git", ["init", "--quiet"], { cwd, env: gitEnv() });
    await promisify(execFile)("git", ["-c", "user.name=Test", "-c", "user.email=test@localhost", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture"], { cwd, env: gitEnv() });
    const path = join(cwd, "new.txt");
    writeFileSync(path, "first\n");
    const cache = new ReadCache();
    expect(await readChanges(cwd, cache)).toEqual(await readChanges(cwd));
    vi.mocked(readFile).mockClear();
    expect((await readChanges(cwd, cache))[0]?.added).toBe(1);
    expect(readFile).not.toHaveBeenCalled();
    writeFileSync(path, "first\nsecond\n");
    expect((await readChanges(cwd, cache))[0]?.added).toBe(2);
    expect(await readChanges(cwd, cache)).toEqual(await readChanges(cwd));
    rmSync(path);
    expect(await readChanges(cwd, cache)).toEqual([]);
    expect(await readChanges(tempDir(), cache)).toEqual([]);
  });

  it("reads each source and untracked file once during the benchmark fan-out", async () => {
    const fixture = await createFixture();
    try {
      const { concert } = await fixtureConcert(fixture.cwd);
      vi.mocked(readFileSync).mockClear();
      vi.mocked(readFile).mockClear();
      await scoreRequest(concert, REQUEST);
      expect(await performFixture(concert)).toBe(8);
      const paths = [...vi.mocked(readFileSync).mock.calls, ...vi.mocked(readFile).mock.calls]
        .map(([path]) => String(path)).filter((path) => path.startsWith(join(fixture.cwd, "src")) || path.startsWith(join(fixture.cwd, "new-")));
      expect(paths).toHaveLength(fixture.sources + fixture.untracked);
      expect(new Set(paths).size).toBe(paths.length);
    } finally {
      fixture.cleanup();
    }
  }, FAN_OUT_TIMEOUT_MS);

});
