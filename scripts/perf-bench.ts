import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { readChanges } from "#src/engine/changes.js";
import { analyzeImpact } from "#src/engine/impact.js";
import { ImportGraph } from "#src/engine/import-graph.js";
import { buildRepoMap } from "#src/engine/repo-map.js";
import { callRole } from "#src/orchestrator/call.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import { Store } from "#src/state/store.js";
import { createFixture, enableSmarttest, fixtureConcert, fixturePlan, performFixture, REQUEST, TOOL_EVENTS } from "./perf-fixture.js";

const DEFAULT_SAMPLES = 5;
const DECIMAL_PLACES = 3;
const STORE_UPDATES = 1000;
const STARTUP_TIMEOUT_MS = 10_000;
type Measurement = { name: string; file: string; medianMs: number; samplesMs: number[]; counts: Record<string, number> };
type Task = { name: string; file: string; run: () => Promise<Record<string, number>> };

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("Cannot measure an empty sample");
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ((ordered[middle] ?? 0) + (ordered[Math.ceil(ordered.length / 2) - 1] ?? 0)) / 2;
}

export function sampleCount(args: string[]): number {
  const { values } = parseArgs({ args, options: { samples: { type: "string", default: String(DEFAULT_SAMPLES) } } });
  const count = Number(values.samples);
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("--samples must be a positive integer");
  return count;
}

async function measure(task: Task, count: number): Promise<Measurement> {
  const counts = await task.run(); // One untimed warm-up; startup still launches a fresh process each time.
  const samplesMs: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = performance.now();
    const sampleCounts = await task.run();
    samplesMs.push(Number((performance.now() - start).toFixed(DECIMAL_PLACES)));
    assert.deepEqual(sampleCounts, counts, `${task.name}: workload changed between samples`);
  }
  return { name: task.name, file: task.file, medianMs: median(samplesMs), samplesMs, counts };
}

async function startup(): Promise<Record<string, number>> {
  const directory = mkdtempSync(join(tmpdir(), "concerto-startup-"));
  const output = join(directory, "help.txt");
  const fd = openSync(output, "w");
  try {
    const child = spawn(process.execPath, [resolve("dist/cli.js"), "--help"], {
      timeout: STARTUP_TIMEOUT_MS, stdio: ["ignore", fd, fd],
    });
    const [code] = await once(child, "close");
    assert.equal(code, 0);
    assert.match(readFileSync(output, "utf8"), /concerto/i);
    return { processes: 1 };
  } finally {
    closeSync(fd);
    rmSync(directory, { recursive: true, force: true });
  }
}

async function scoring(cwd: string): Promise<Record<string, number>> {
  rmSync(join(cwd, ".concerto", "cache"), { recursive: true, force: true });
  const { concert, calls } = await fixtureConcert(cwd);
  await scoreRequest(concert, REQUEST);
  assert.equal(concert.store.get().phase, "planned");
  assert.equal(calls.length, 1);
  return { runnerCalls: calls.length, stories: concert.store.get().order.length };
}

async function fanout(cwd: string): Promise<Record<string, number>> {
  const { concert, calls } = await fixtureConcert(cwd);
  await scoreRequest(concert, REQUEST);
  calls.length = 0;
  const changeScans = await performFixture(concert);
  const stories = Object.values(concert.store.get().stories);
  assert.equal(concert.store.get().phase, "done");
  assert.ok(stories.every((s) => s.status === "passed"));
  assert.equal(calls.length, stories.length * 2 + 2);
  return { runnerCalls: calls.length, stories: stories.length, changeScans, maxParallel: concert.config.swarm.maxParallel };
}

async function toolBurst(cwd: string): Promise<Record<string, number>> {
  const { concert } = await fixtureConcert(cwd);
  let notifications = 0;
  const unsubscribe = concert.store.subscribe(() => { notifications += 1; });
  concert.runner = async (_req, onEvent) => {
    for (let i = 0; i < TOOL_EVENTS; i += 1) onEvent({ kind: "tool", name: "read", detail: "fixture.ts" });
    return { text: "done", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, turns: 1 };
  };
  await callRole(concert, { role: "section", segments: [{ name: "fixture", text: REQUEST }] });
  unsubscribe();
  return { events: TOOL_EVENTS, notifications };
}

async function storeBurst(): Promise<Record<string, number>> {
  const store = new Store();
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });
  for (let i = 0; i < STORE_UPDATES; i += 1) store.role("section", { note: "same note" });
  return { updates: STORE_UPDATES, notifications };
}

async function tasks(cwd: string): Promise<Task[]> {
  const repo = await buildRepoMap(cwd);
  const input = { cwd, repoFiles: repo.files, stories: fixturePlan().stories };
  return [
    { name: "startup", file: "src/cli.ts", run: startup },
    { name: "scoring", file: "src/orchestrator/score.ts", run: () => scoring(cwd) },
    { name: "fan-out", file: "src/orchestrator/perform.ts", run: () => fanout(cwd) },
    { name: "concert setup", file: "src/orchestrator/concert.ts", run: async () => { await fixtureConcert(cwd); return {}; } },
    { name: "repository snapshot", file: "src/engine/repo-map.ts", run: async () => ({ files: (await buildRepoMap(cwd)).files.length }) },
    { name: "import graph", file: "src/engine/import-graph.ts", run: async () => {
      const graph = new ImportGraph(cwd, repo.files);
      assert.ok(graph.dependentsOf(["src/module-0.ts"]).length > 0);
      return { sourceFiles: repo.files.filter((f) => f.endsWith(".ts")).length };
    } },
    { name: "impact without SmartTest", file: "src/engine/impact.ts", run: async () => ({ stories: (await analyzeImpact(input)).size }) },
    { name: "untracked changes", file: "src/engine/changes.ts", run: async () => {
      const changes = await readChanges(cwd);
      assert.ok(changes.every((c) => c.added === 1));
      return { changes: changes.length };
    } },
    { name: "tool event burst", file: "src/orchestrator/call.ts", run: () => toolBurst(cwd) },
    { name: "identical store updates", file: "src/state/store.ts", run: storeBurst },
  ];
}

export async function runBenchmarks(samples: number) {
  const fixture = await createFixture();
  try {
    const results: Measurement[] = [];
    for (const task of await tasks(fixture.cwd)) results.push(await measure(task, samples));
    enableSmarttest(fixture.cwd);
    const repo = await buildRepoMap(fixture.cwd);
    results.push(await measure({ name: "impact with SmartTest", file: "src/engine/impact.ts", run: async () => {
      const impact = await analyzeImpact({ cwd: fixture.cwd, repoFiles: repo.files, stories: fixturePlan().stories });
      assert.equal(impact.size, fixturePlan().stories.length);
      return { distinctSourceFiles: fixturePlan().stories.length };
    } }, samples));
    return { samples, node: process.version, platform: process.platform, arch: process.arch,
      fixture: { sources: fixture.sources, untracked: fixture.untracked, request: REQUEST }, results };
  } finally {
    fixture.cleanup();
  }
}

async function main(): Promise<void> {
  const report = await runBenchmarks(sampleCount(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
