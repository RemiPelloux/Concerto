import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { createConcert, type Concert } from "#src/orchestrator/concert.js";
import { perform } from "#src/orchestrator/perform.js";
import { parsePlan } from "#src/orchestrator/plan.js";
import { Store } from "#src/state/store.js";
import { gitEnv } from "#src/runner/env.js";
import { CATALOG, PLAN_REPLY, scriptedRunner, testConfig } from "#tests/fixtures.js";

const run = promisify(execFile);
const SOURCE_COUNT = 256;
const UNTRACKED_COUNT = 24;
const STORY_COUNT = 8;
/** A hang guard, not a measurement: every story now builds in a worktree, and Windows starts git slowly. */
const SCAN_TIMEOUT_MS = 60_000;
export const TOOL_EVENTS = 100;
export const REQUEST = "Update the fixture modules and verify their dependents";

export function fixturePlan() {
  const template = parsePlan(PLAN_REPLY).stories[0];
  assert.ok(template);
  return { summary: REQUEST, stories: Array.from({ length: STORY_COUNT }, (_, i) => ({
    ...template, id: `story-${i}`, title: `Update module ${i}`, files: [`src/module-${i}.ts`],
  })) };
}

async function git(cwd: string, args: string[]): Promise<void> {
  await run("git", args, { cwd, env: gitEnv() });
}

function writeSources(cwd: string): void {
  mkdirSync(join(cwd, "src"));
  for (let i = 0; i < SOURCE_COUNT; i += 1) {
    const imported = i === 0 ? "" : `import './module-${i - 1}.js';\n`;
    writeFileSync(join(cwd, `src/module-${i}.ts`), `${imported}export const value = ${i};\n`);
  }
  writeFileSync(join(cwd, ".gitignore"), "node_modules/\n.concerto/\n.smarttest/\n");
  writeFileSync(join(cwd, "package.json"), '{"type":"module","scripts":{"test":"vitest run"}}');
}

export async function createFixture() {
  const cwd = mkdtempSync(join(tmpdir(), "concerto-perf-"));
  try {
    await git(cwd, ["init", "--quiet"]);
    writeSources(cwd);
    await git(cwd, ["add", "src", ".gitignore", "package.json"]);
    await git(cwd, ["-c", "user.name=Benchmark", "-c", "user.email=benchmark@localhost", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "fixture"]);
    for (let i = 0; i < UNTRACKED_COUNT; i += 1) writeFileSync(join(cwd, `new-${i}.txt`), "fixture\n");
    return { cwd, sources: SOURCE_COUNT, untracked: UNTRACKED_COUNT, cleanup: () => rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) };
  } catch (error) {
    rmSync(cwd, { recursive: true, force: true });
    throw error;
  }
}

export function enableSmarttest(cwd: string): void {
  mkdirSync(join(cwd, "node_modules", ".bin"), { recursive: true });
  symlinkSync(resolve("node_modules/@tkmremi/smarttest/dist/bin.js"), join(cwd, "node_modules", ".bin", "smarttest"));
}

export async function fixtureConcert(cwd: string) {
  const scripted = scriptedRunner((req) => {
    if (req.systemFile.includes("scorer-")) return JSON.stringify(fixturePlan());
    if (req.systemFile.includes("critic-")) return "VERDICT: pass\nverified";
    if (req.systemFile.includes("conductor-")) return "VERDICT: ok\nverified";
    return "STATUS: done\nfixture";
  });
  const concert = await createConcert({ config: testConfig(), catalog: CATALOG, store: new Store(), runner: scripted.runner, cwd });
  return { concert, calls: scripted.calls };
}

/** Include every build's background change scan before timing or deleting the fixture. */
export async function performFixture(concert: Concert): Promise<number> {
  let complete!: () => void;
  let fail!: (error: Error) => void;
  const completion = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
  const expected = concert.store.get().order.length;
  let changes = concert.store.get().changes;
  let scans = 0;
  const unsubscribe = concert.store.subscribe(() => {
    if (changes === concert.store.get().changes) return;
    changes = concert.store.get().changes;
    scans += 1;
    if (scans === expected) complete();
  });
  const timer = setTimeout(() => fail(new Error("Fixture change scans timed out")), SCAN_TIMEOUT_MS);
  try {
    await Promise.all([perform(concert), completion]);
    return scans;
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
}
