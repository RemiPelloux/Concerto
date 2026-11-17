/**
 * Performance budgets: timing medians and deterministic work counts compared with
 * perf-budgets.json. Exits 1 on a regression or an incomplete measurement.
 *
 *   node --import tsx --conditions=source scripts/perf-budgets.ts [dist/cli.js]
 */
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { render } from "ink";
import { createElement } from "react";
import { SessionLog } from "#src/engine/session-log.js";
import { workingDiff } from "#src/engine/changes.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import { App } from "#src/ui/App.js";
import { createFixture, fixtureConcert, performFixture, REQUEST } from "#scripts/perf-fixture.js";

const SAMPLES = 7;
const FRAMES = 60;
/** A large terminal, so a frame has the whole plan to draw; and the report's column widths. */
const SCREEN = { columns: 180, rows: 60 };
const COLUMNS = { name: 26, value: 8 };
const STARTUP_TIMEOUT_MS = 10_000;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

/** A flag of the built CLI, in an empty folder with no agent CLIs, as a fresh shell would start it. */
export function startup(cli: string, flag: string): number {
  const dir = mkdtempSync(join(tmpdir(), "concerto-budget-"));
  const env = { ...process.env, PATH: dir, CONCERTO_CONFIG: resolve("concerto.config.json"), CONCERTO_CLAUDE_BIN: "missing", CONCERTO_CODEX_BIN: "missing", CONCERTO_PI_BIN: "missing", XDG_CONFIG_HOME: dir, XDG_CACHE_HOME: dir, CONCERTO_NO_UPDATE_CHECK: "1" };
  try {
    const times = Array.from({ length: SAMPLES }, () => {
      const start = performance.now();
      const result = spawnSync(process.execPath, [cli, flag], { cwd: dir, env, stdio: "ignore", timeout: STARTUP_TIMEOUT_MS });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`${flag} exited ${result.status}`);
      return performance.now() - start;
    });
    return median(times);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Scoring a request over the 256-file fixture: the repository scan, the import graph, the scorer's reply. */
async function scoring(): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const fixture = await createFixture();
    const { concert } = await fixtureConcert(fixture.cwd);
    const start = performance.now();
    await scoreRequest(concert, REQUEST);
    times.push(performance.now() - start);
    fixture.cleanup();
  }
  return median(times);
}

class Terminal extends EventEmitter {
  columns = SCREEN.columns;
  rows = SCREEN.rows;
  isTTY = true;
  frames = 0;
  written: (() => void) | null = null;
  write(): boolean {
    this.frames += 1;
    this.written?.();
    return true;
  }
}

/** A keyboard nobody types on: Ink needs one to listen for keys. */
const keyboard = () => Object.assign(new EventEmitter(), { isTTY: true, setRawMode: () => undefined, setEncoding: () => undefined, ref: () => undefined, unref: () => undefined, read: () => null });

/** One frame of the TUI with a scored plan on screen: from a store update until Ink writes the new frame. */
async function frame(): Promise<number> {
  const fixture = await createFixture();
  const { concert } = await fixtureConcert(fixture.cwd);
  await scoreRequest(concert, REQUEST);
  const terminal = new Terminal();
  const deps = { ...concert, autoPerform: false, initialRequest: "", showTour: false, onExit: () => undefined, log: new SessionLog(fixture.cwd) };
  const app = render(createElement(App, deps), { stdout: terminal as never, stdin: keyboard() as never, debug: true, patchConsole: false, exitOnCtrlC: false });
  const times: number[] = [];
  for (let i = 0; i < FRAMES; i += 1) {
    const drawn = new Promise<void>((done) => (terminal.written = done));
    const start = performance.now();
    concert.store.log({ role: "critic", label: "Frame", detail: `update ${i}`, result: "ok" });
    await drawn;
    times.push(performance.now() - start);
  }
  const drawn = terminal.frames;
  app.unmount();
  fixture.cleanup();
  if (drawn < FRAMES) throw new Error(`The TUI drew ${drawn} frames for ${FRAMES} updates.`);
  return median(times);
}

/** Count actual loads in a separate process; instrumentation is outside startup timings. */
export function startupModules(cli: string, flag: string): Record<string, number> {
  const dir = mkdtempSync(join(tmpdir(), "concerto-modules-"));
  const report = join(dir, "modules.json");
  const hook = join(dir, "hook.mjs");
  writeFileSync(hook, `import { registerHooks } from 'node:module';
import { writeFileSync } from 'node:fs';
const loaded = new Set();
registerHooks({ load(url, context, next) { loaded.add(url); return next(url, context); } });
process.on('exit', () => writeFileSync(${JSON.stringify(report)}, JSON.stringify([...loaded])));`);
  try {
    const result = spawnSync(process.execPath, ["--import", pathToFileURL(hook).href, cli, flag], {
      cwd: dir, env: { ...process.env, CONCERTO_NO_UPDATE_CHECK: "1" }, stdio: "ignore", timeout: STARTUP_TIMEOUT_MS,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${flag} module probe exited ${result.status}`);
    const modules = JSON.parse(readFileSync(report, "utf8")) as string[];
    const heavy = modules.filter((url) => /\/(?:ink|react|react-reconciler|orchestrator)\//.test(url));
    return { [`startup ${flag} modules`]: modules.length, [`startup ${flag} heavy modules`]: heavy.length };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Trace real Git processes only during workingDiff, excluding fixture setup. */
export async function workCounts(): Promise<Record<string, number>> {
  const fixture = await createFixture();
  const previous = process.env.GIT_TRACE2_EVENT;
  try {
    // Keep the trace outside the repository's untracked-file workload.
    const tracePath = join(fixture.cwd, ".git", "budget-trace");
    process.env.GIT_TRACE2_EVENT = tracePath;
    const patch = await workingDiff(fixture.cwd);
    if (!patch.includes("new-0.txt")) throw new Error("workingDiff did not produce the fixture patch");
    const events = readFileSync(tracePath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { event: string });
    restoreTrace(previous);
    const { concert, calls } = await fixtureConcert(fixture.cwd);
    await scoreRequest(concert, REQUEST);
    const scoringCalls = calls.length;
    calls.length = 0;
    await performFixture(concert);
    return { "workingDiff git processes": events.filter((event) => event.event === "start").length,
      "scoring runner calls": scoringCalls, "fan-out runner calls": calls.length };
  } finally {
    restoreTrace(previous);
    fixture.cleanup();
  }
}

function restoreTrace(previous: string | undefined): void {
  if (previous === undefined) delete process.env.GIT_TRACE2_EVENT;
  else process.env.GIT_TRACE2_EVENT = previous;
}

/** Fail closed for missing, invalid or unmeasured budgets as well as regressions. */
export function checkBudgets(measured: Record<string, number>, budgets: Record<string, unknown>): number {
  let over = 0;
  const names = new Set([...Object.keys(measured), ...Object.keys(budgets).filter((name) => !name.startsWith("_"))]);
  for (const name of names) {
    const value = measured[name];
    const budget = budgets[name];
    const ok = typeof budget === "number" && Number.isFinite(budget) && budget >= 0 &&
      value !== undefined && Number.isFinite(value) && value >= 0 && value <= budget;
    if (!ok) over += 1;
    process.stdout.write(`${ok ? "ok  " : "OVER"} ${name.padEnd(COLUMNS.name)} ${String(value?.toFixed(1)).padStart(COLUMNS.value)}  budget ${String(budget)}\n`);
  }
  return over;
}

async function main(): Promise<void> {
  const cli = resolve(process.argv[2] ?? "dist/cli.js");
  const measured = {
    "startup --version (ms)": startup(cli, "--version"),
    "startup --help (ms)": startup(cli, "--help"),
    "startup --doctor (ms)": startup(cli, "--doctor"),
    "scoring 256 files (ms)": await scoring(), "frame (ms)": await frame(),
    ...startupModules(cli, "--help"), ...startupModules(cli, "--version"), ...await workCounts(),
  };
  const budgets = JSON.parse(readFileSync(resolve("perf-budgets.json"), "utf8")) as Record<string, unknown>;
  process.exitCode = checkBudgets(measured, budgets) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
