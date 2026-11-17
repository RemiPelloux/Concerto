import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { median, sampleCount } from "#scripts/perf-bench.js";
import { createFixture, fixtureConcert, fixturePlan, performFixture, REQUEST, TOOL_EVENTS } from "#scripts/perf-fixture.js";
import { callRole } from "#src/orchestrator/call.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import { readChanges } from "#src/engine/changes.js";
import { analyzeImpact } from "#src/engine/impact.js";
import { BlastRadius } from "#src/engine/blast-radius.js";
import { tempDir } from "#tests/fixtures.js";

/** One benchmark fan-out takes 23 to 30 s on a Windows runner, where git processes start slowly. */
const FAN_OUT_TIMEOUT_MS = 90_000;
const boundary = vi.hoisted(() => ({ cwd: "", files: [] as string[], calls: [] as string[], fail: false }));

vi.mock("node:child_process", async (original) => {
  const cp = await original<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  const run = promisify(cp.execFile);
  const execFile = (...args: unknown[]) => Reflect.apply(cp.execFile, undefined, args);
  Object.assign(execFile, { [promisify.custom]: (bin: string, args: string[], options: { cwd?: string }) => {
    if (options.cwd !== boundary.cwd) return run(bin, args, options);
    boundary.calls.push(bin);
    if (boundary.fail) return Promise.reject(new Error("Process failed"));
    if (bin === "git") return Promise.resolve({ stdout: args[0] === "ls-files" ? [...boundary.files, "missing.txt"].join("\0") : "" });
    const files = args.slice(args.findIndex((arg) => arg.endsWith("/smarttest")) + 1);
    return Promise.resolve({ stdout: files.map((file) => JSON.stringify({ target: file, tests: [{ test: `${file}.test.ts` }] })).join("\n") });
  } });
  return { ...cp, execFile };
});

describe("subprocess budgets", () => {
  it.each([1, 24, 32])("uses four Git processes for %i untracked files and skips missing files", async (count) => {
    boundary.cwd = tempDir();
    boundary.files = Array.from({ length: count }, (_, i) => `new-${i}.txt`);
    boundary.files.forEach((file) => writeFileSync(join(boundary.cwd, file), "one\ntwo"));
    boundary.calls = [];
    try {
      const changes = await readChanges(boundary.cwd);
      expect(changes).toHaveLength(count);
      expect(changes.every((change) => change.added === 2 && change.status === "added")).toBe(true);
      expect(boundary.calls).toEqual(["git", "git", "git", "git"]);
    } finally { boundary.cwd = ""; }
  });

  it.each([1, 8, 32])("caps SmartTest at four processes for %i paths and reuses cached coverage", async (count) => {
    boundary.cwd = tempDir();
    boundary.files = Array.from({ length: count }, (_, i) => `source-${i}.ts`);
    boundary.files.forEach((file) => writeFileSync(join(boundary.cwd, file), "export {};"));
    mkdirSync(join(boundary.cwd, "node_modules/.bin"), { recursive: true });
    writeFileSync(join(boundary.cwd, "node_modules/.bin/smarttest"), "fixture");
    const cache = new BlastRadius(boundary.cwd, boundary.files);
    const input = { cwd: boundary.cwd, repoFiles: boundary.files, cache,
      stories: boundary.files.map((file) => ({ id: file, files: [file] })) };
    boundary.calls = [];
    try {
      const impacts = await analyzeImpact(input);
      for (const file of boundary.files) expect(impacts.get(file)).toMatchObject({ tests: [`${file}.test.ts`], untested: 0 });
      expect(boundary.calls.filter((bin) => bin !== "git")).toHaveLength(Math.min(4, count));
      await analyzeImpact(input);
      expect(boundary.calls.filter((bin) => bin !== "git")).toHaveLength(Math.min(4, count));
    } finally { boundary.cwd = ""; }
  });

  it("keeps empty results when Git or SmartTest fails", async () => {
    boundary.cwd = tempDir();
    boundary.files = ["source.ts"];
    writeFileSync(join(boundary.cwd, "source.ts"), "export {};");
    mkdirSync(join(boundary.cwd, "node_modules/.bin"), { recursive: true });
    writeFileSync(join(boundary.cwd, "node_modules/.bin/smarttest"), "fixture");
    boundary.fail = true;
    try {
      expect(await readChanges(boundary.cwd)).toEqual([]);
      const impacts = await analyzeImpact({ cwd: boundary.cwd, repoFiles: boundary.files, stories: [{ id: "a", files: boundary.files }] });
      expect(impacts.get("a")).toMatchObject({ tests: [], untested: 1, source: "smarttest" });
    } finally { boundary.fail = false; boundary.cwd = ""; }
  });
});
import { Store } from "#src/state/store.js";
import { CATALOG } from "#tests/fixtures.js";

describe("tool notification performance", () => {
  it("notifies only while a repeated tool changes the visible trail", () => {
    const store = new Store();
    let notifications = 0;
    store.subscribe(() => { notifications += 1; });
    for (let i = 0; i < TOOL_EVENTS; i += 1) store.tool("read");
    expect(notifications).toBe(6);
    expect(store.get().swarm).toEqual(Array(6).fill("read"));
    const full = store.get();
    store.tool("read");
    expect(store.get()).toBe(full);
    store.tool("write");
    expect(notifications).toBe(7);
    expect(store.get().swarm).toEqual(["read", "read", "read", "read", "read", "write"]);
    expect(full.swarm).toEqual(Array(6).fill("read"));
    store.tool("write");
    expect(notifications).toBe(8);
    expect(store.get().swarm).toEqual(["read", "read", "read", "read", "write", "write"]);
    store.update(() => ({ swarm: [] }));
    store.tool("write");
    expect(notifications).toBe(10);
    expect(store.get().swarm).toEqual(["write"]);
  });

  it.each([false, true])("preserves final agent output and status (failure: %s)", async (fails) => {
    const fixture = await createFixture();
    try {
      const { concert } = await fixtureConcert(fixture.cwd);
      let notifications = 0;
      const statuses: string[] = [];
      concert.store.subscribe(() => {
        notifications += 1;
        statuses.push(concert.store.get().agents["section:section"]?.status ?? "idle");
      });
      concert.runner = async (_req, onEvent) => {
        for (let i = 0; i < TOOL_EVENTS; i += 1) onEvent({ kind: "tool", name: "read", detail: "fixture.ts" });
        if (fails) throw new Error("fixture failure");
        return { text: "done", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, turns: 1 };
      };
      const result = callRole(concert, { role: "section", segments: [{ name: "fixture", text: REQUEST }], chain: [CATALOG.get("a/swarm")!] });
      if (fails) await expect(result).rejects.toThrow("fixture failure");
      else expect((await result).text).toBe("done");
      const agent = concert.store.get().agents["section:section"];
      expect(agent?.status).toBe(fails ? "failed" : "done");
      expect(agent?.endedAt).toEqual(expect.any(Number));
      expect(agent?.lines.filter((line) => line === "▸ read fixture.ts")).toHaveLength(TOOL_EVENTS);
      if (fails) expect(agent?.lines.at(-1)).toBe("✗ fixture failure");
      expect(statuses).toContain(fails ? "failed" : "done");
      expect(notifications).toBe(fails ? 13 : 12);
    } finally {
      fixture.cleanup();
    }
  });
});

describe("performance harness", () => {
  it("reports medians without changing the samples", () => {
    const samples = [9, 1, 3];
    expect(median(samples)).toBe(3);
    expect(samples).toEqual([9, 1, 3]);
    expect(median([4, 2])).toBe(3);
    expect(() => median([])).toThrow(/empty sample/);
  });

  it("accepts sample counts and rejects invalid input", () => {
    expect(sampleCount([])).toBe(5);
    expect(sampleCount(["--samples", "3"])).toBe(3);
    for (const count of ["0", "-1", "NaN", "1.5", "Infinity"]) {
      expect(() => sampleCount([`--samples=${count}`])).toThrow(/positive integer/);
    }
    expect(() => sampleCount(["--unknown"])).toThrow();
  });

  it("scores and performs the independent fixture stories with real orchestration", async () => {
    const fixture = await createFixture();
    try {
      const { concert, calls } = await fixtureConcert(fixture.cwd);
      await scoreRequest(concert, REQUEST);
      expect(concert.store.get().phase).toBe("planned");
      expect(calls).toHaveLength(1);
      expect(concert.store.get().order).toHaveLength(fixturePlan().stories.length);
      let changes = concert.store.get().changes;
      let scans = 0;
      const unsubscribe = concert.store.subscribe(() => {
        if (changes === concert.store.get().changes) return;
        changes = concert.store.get().changes;
        scans += 1;
      });
      expect(await performFixture(concert)).toBe(fixturePlan().stories.length);
      unsubscribe();
      expect(scans).toBe(fixturePlan().stories.length);
      expect(changes).toHaveLength(fixture.untracked);
      expect(concert.store.get().phase).toBe("done");
      expect(calls).toHaveLength(19);
      expect(Object.values(concert.store.get().stories).every((s) => s.status === "passed")).toBe(true);
    } finally {
      fixture.cleanup();
    }
    expect(existsSync(fixture.cwd)).toBe(false);
  }, FAN_OUT_TIMEOUT_MS);

  it("rejects a fan-out without a scored plan and cleans up", async () => {
    const fixture = await createFixture();
    try {
      const { concert } = await fixtureConcert(fixture.cwd);
      await expect(performFixture(concert)).rejects.toThrow(/score a request first/);
    } finally {
      fixture.cleanup();
    }
    expect(existsSync(fixture.cwd)).toBe(false);
  });
});
