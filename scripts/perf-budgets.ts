/**
 * Performance budgets: startup, scoring and frame time, each measured as a median and compared with
 * perf-budgets.json. Exits 1 when one is over: CI fails the build on a regression.
 *
 *   node --import tsx --conditions=source scripts/perf-budgets.ts [dist/cli.js]
 */
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { render } from "ink";
import { createElement } from "react";
import { SessionLog } from "#src/engine/session-log.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import { App } from "#src/ui/App.js";
import { createFixture, fixtureConcert, REQUEST } from "#scripts/perf-fixture.js";

const SAMPLES = 7;
const FRAMES = 60;
/** A large terminal, so a frame has the whole plan to draw; and the report's column widths. */
const SCREEN = { columns: 180, rows: 60 };
const COLUMNS = { name: 26, value: 8 };
const budgets = JSON.parse(readFileSync(resolve("perf-budgets.json"), "utf8")) as Record<string, number | string>;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

/** A flag of the built CLI, in an empty folder with no agent CLIs, as a fresh shell would start it. */
function startup(cli: string, flag: string): number {
  const dir = mkdtempSync(join(tmpdir(), "concerto-budget-"));
  const env = { ...process.env, PATH: dir, CONCERTO_CONFIG: resolve("concerto.config.json"), CONCERTO_CLAUDE_BIN: "missing", CONCERTO_CODEX_BIN: "missing", CONCERTO_PI_BIN: "missing", XDG_CONFIG_HOME: dir, XDG_CACHE_HOME: dir, CONCERTO_NO_UPDATE_CHECK: "1" };
  const times = Array.from({ length: SAMPLES }, () => {
    const start = performance.now();
    const result = spawnSync(process.execPath, [cli, flag], { cwd: dir, env, stdio: "ignore" });
    if (result.status !== 0) throw new Error(`${flag} exited ${result.status}`);
    return performance.now() - start;
  });
  rmSync(dir, { recursive: true, force: true });
  return median(times);
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

const cli = resolve(process.argv[2] ?? "dist/cli.js");
const measured: Record<string, number> = {
  "startup --version (ms)": startup(cli, "--version"),
  "startup --help (ms)": startup(cli, "--help"),
  "startup --doctor (ms)": startup(cli, "--doctor"),
  "scoring 256 files (ms)": await scoring(),
  "frame (ms)": await frame(),
};
let over = 0;
for (const [name, ms] of Object.entries(measured)) {
  const budget = Number(budgets[name] ?? Number.POSITIVE_INFINITY);
  const ok = ms <= budget;
  if (!ok) over += 1;
  process.stdout.write(`${ok ? "ok  " : "OVER"} ${name.padEnd(COLUMNS.name)} ${ms.toFixed(1).padStart(COLUMNS.value)}  budget ${budget}\n`);
}
process.exitCode = over ? 1 : 0;
