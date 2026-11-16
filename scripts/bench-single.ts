/**
 * Concerto against one model alone, on the tasks in bench/single/: each task is solved twice in a
 * fresh copy of its repository, once by `concerto --run` and once by Claude Code with one model,
 * then graded by hidden tests neither saw. Writes docs/benchmark-single.md.
 *
 *   pnpm build && node --import tsx --conditions=source scripts/bench-single.ts [--model claude-sonnet-5-5]
 *
 * It uses your own logins and config, so it spends what such runs spend.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const TASKS = resolve("bench/single");
const CLI = resolve("dist/cli.js");
const MS_PER_MINUTE = 60_000;
/** A run that takes longer than this is stopped and graded as it stands. */
const TIMEOUT_MINUTES = 30;
const TIMEOUT_MS = TIMEOUT_MINUTES * MS_PER_MINUTE;
const CENTS = 2;
const model = process.argv.includes("--model") ? (process.argv[process.argv.indexOf("--model") + 1] ?? "") : "claude-sonnet-5-5";

type Result = { task: string; mode: string; passed: number; total: number; costUsd: number; minutes: number };

/** A fresh git repository with the task's starting files. */
function checkout(task: string): string {
  const cwd = mkdtempSync(join(tmpdir(), `concerto-bench-${task}-`));
  cpSync(join(TASKS, task, "repo"), cwd, { recursive: true });
  const git = (...args: string[]) => spawnSync("git", args, { cwd, stdio: "ignore" });
  git("init", "-q");
  git("add", ".");
  git("-c", "user.email=bench@localhost", "-c", "user.name=bench", "commit", "-qm", "task");
  return cwd;
}

/** The hidden tests, copied in only now, run with Node's test runner: passed and total. */
function grade(task: string, cwd: string): { passed: number; total: number } {
  cpSync(join(TASKS, task, "hidden"), join(cwd, "hidden"), { recursive: true });
  const out = spawnSync(process.execPath, ["--test", "hidden/"], { cwd, encoding: "utf8" }).stdout;
  const count = (k: string) => Number(new RegExp(`^ℹ ${k} (\\d+)`, "m").exec(out)?.[1] ?? 0);
  return { passed: count("pass"), total: count("tests") };
}

/** Concerto with your config: the cost is its API-equivalent total from the done event. */
function concerto(cwd: string, request: string): number {
  const run = spawnSync(process.execPath, [CLI, "--run", "--json", request], { cwd, encoding: "utf8", timeout: TIMEOUT_MS, env: { ...process.env, CONCERTO_NO_UPDATE_CHECK: "1" } });
  const done = run.stdout.split("\n").filter((l) => l.startsWith('{"type":"done"')).map((l) => JSON.parse(l) as { costUsd: number }).at(-1);
  return done?.costUsd ?? 0;
}

/** One model in Claude Code, allowed to edit and run the tests: its reported cost. */
function single(cwd: string, request: string): number {
  const run = spawnSync("claude", ["-p", "--model", model, "--output-format", "json", "--permission-mode", "acceptEdits", "--allowedTools", "Bash(node:*),Bash(npm:*),Edit,Write,Read"], { cwd, input: request, encoding: "utf8", timeout: TIMEOUT_MS });
  try {
    return (JSON.parse(run.stdout) as { total_cost_usd?: number }).total_cost_usd ?? 0;
  } catch {
    return 0;
  }
}

function measure(task: string, mode: "concerto" | "single"): Result {
  const cwd = checkout(task);
  const request = readFileSync(join(TASKS, task, "request.txt"), "utf8").trim();
  const start = performance.now();
  const costUsd = mode === "concerto" ? concerto(cwd, request) : single(cwd, request);
  const minutes = (performance.now() - start) / MS_PER_MINUTE;
  return { task, mode: mode === "single" ? `${model} alone` : "Concerto", ...grade(task, cwd), costUsd, minutes };
}

function report(results: Result[]): string {
  const row = (r: Result) => `| ${r.task} | ${r.mode} | ${r.passed}/${r.total} | $${r.costUsd.toFixed(CENTS)} | ${r.minutes.toFixed(1)} min |`;
  const sum = (mode: string) => {
    const mine = results.filter((r) => r.mode === mode);
    return `| **all** | ${mode} | ${mine.reduce((s, r) => s + r.passed, 0)}/${mine.reduce((s, r) => s + r.total, 0)} | $${mine.reduce((s, r) => s + r.costUsd, 0).toFixed(CENTS)} | ${mine.reduce((s, r) => s + r.minutes, 0).toFixed(1)} min |`;
  };
  const modes = [...new Set(results.map((r) => r.mode))];
  return ["| Task | Who | Hidden tests passed | Cost (API-equivalent) | Time |", "|---|---|---|---|---|", ...results.map(row), ...modes.map(sum)].join("\n");
}

const tasks = readdirSync(TASKS).sort();
const results = tasks.flatMap((task) => (["concerto", "single"] as const).map((mode) => {
  process.stderr.write(`${task} · ${mode}…\n`);
  return measure(task, mode);
}));
const table = report(results);
writeFileSync(resolve("out/benchmark-single.json"), JSON.stringify(results, null, 2));
process.stdout.write(`${table}\n`);
