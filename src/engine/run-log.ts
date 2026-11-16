import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { userConfigPath } from "#src/config/load.js";
import type { State } from "#src/state/types.js";
import type { Usage } from "#src/runner/usage.js";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const SLOWEST = 3;

/** One finished run as the cost reports and the dashboard read it, from every repository. */
export type RunRecord = {
  at: number;
  repo: string;
  runId: string;
  request: string;
  phase: string;
  passed: number;
  stories: number;
  costUsd: number;
  models: Record<string, { calls: number; usage: Usage }>;
  slowest: { title: string; ms: number; status: string }[];
};

/** `$XDG_CONFIG_HOME/concerto/runs.jsonl`: one line per run, across all repositories. */
export const runLogPath = () => join(dirname(userConfigPath()), "runs.jsonl");

export function recordOf(state: State, at: { repo: string; runId: string }): RunRecord {
  const views = state.order.map((id) => state.stories[id]).filter((v) => v !== undefined);
  const title = (id: string) => state.plan?.stories.find((s) => s.id === id)?.title ?? id;
  const slowest = views.filter((v) => v.ms).sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0)).slice(0, SLOWEST).map((v) => ({ title: title(v.id), ms: v.ms ?? 0, status: v.status }));
  return { at: Date.now(), ...at, request: state.prompt.split("\n")[0] ?? "", phase: state.phase, passed: views.filter((v) => v.status === "passed").length, stories: views.length, costUsd: state.ledger.usage.cost, models: state.ledger.models ?? {}, slowest };
}

/** Appends a run; never throws, a report is not worth failing a run for. */
export function appendRun(record: RunRecord): void {
  try {
    mkdirSync(dirname(runLogPath()), { recursive: true, mode: DIR_MODE });
    appendFileSync(runLogPath(), `${JSON.stringify(record)}\n`, { mode: FILE_MODE });
  } catch {
    // The run already has its own report and outcomes.
  }
}

export function readRuns(): RunRecord[] {
  if (!existsSync(runLogPath())) return [];
  return readFileSync(runLogPath(), "utf8").split("\n").flatMap((line) => {
    try {
      return line ? [JSON.parse(line) as RunRecord] : [];
    } catch {
      return [];
    }
  });
}
