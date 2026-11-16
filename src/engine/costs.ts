import { basename } from "node:path";
import type { RunRecord } from "#src/engine/run-log.js";
import { promptTokens } from "#src/runner/usage.js";

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;
const THURSDAY = 4;
const CENTS = 2;
/** Column widths of the terminal table: repository, model, calls, dollars. */
const COLUMNS = { repo: 20, model: 36, calls: 5, cost: 8 };

export type CostRow = { week: string; repo: string; model: string; calls: number; promptTokens: number; outputTokens: number; costUsd: number };

/** ISO week of a time, `2026-W47`: weeks start on Monday, week 1 holds the year's first Thursday. */
export function isoWeek(at: number): string {
  const d = new Date(at);
  const day = d.getUTCDay() || WEEK_DAYS;
  const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + THURSDAY - day);
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.ceil(((thursday - Date.UTC(year, 0, 1)) / DAY_MS + 1) / WEEK_DAYS);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Runs since `sinceMs` (all when 0), as one row per week, repository and model, newest week first. */
export function costRows(runs: readonly RunRecord[], sinceMs = 0): CostRow[] {
  const rows = new Map<string, CostRow>();
  runs.filter((r) => r.at >= sinceMs).forEach((run) => Object.entries(run.models).forEach(([model, m]) => {
    const row = { week: isoWeek(run.at), repo: run.repo, model };
    const key = `${row.week}\0${row.repo}\0${model}`;
    const sum = rows.get(key) ?? { ...row, calls: 0, promptTokens: 0, outputTokens: 0, costUsd: 0 };
    rows.set(key, { ...sum, calls: sum.calls + m.calls, promptTokens: sum.promptTokens + promptTokens(m.usage), outputTokens: sum.outputTokens + m.usage.output, costUsd: sum.costUsd + m.usage.cost });
  }));
  return [...rows.values()].sort((a, b) => b.week.localeCompare(a.week) || b.costUsd - a.costUsd);
}

const cell = (v: string | number) => (typeof v === "number" || !/[",\n]/.test(v) ? String(v) : `"${v.replace(/"/g, '""')}"`);

export function costCsv(rows: readonly CostRow[]): string {
  const lines = rows.map((r) => [r.week, r.repo, r.model, r.calls, r.promptTokens, r.outputTokens, r.costUsd.toFixed(CENTS + CENTS)].map(cell).join(","));
  return ["week,repository,model,calls,prompt_tokens,output_tokens,cost_usd", ...lines].join("\n") + "\n";
}

/** A table for the terminal, with a total line per week. */
export function costTable(rows: readonly CostRow[]): string[] {
  if (rows.length === 0) return ["No finished runs recorded yet."];
  const weeks = [...new Set(rows.map((r) => r.week))];
  return weeks.flatMap((week) => {
    const inWeek = rows.filter((r) => r.week === week);
    const total = inWeek.reduce((s, r) => s + r.costUsd, 0);
    const line = (r: CostRow) => `  ${basename(r.repo).padEnd(COLUMNS.repo)} ${r.model.padEnd(COLUMNS.model)} ${String(r.calls).padStart(COLUMNS.calls)} calls  $${r.costUsd.toFixed(CENTS).padStart(COLUMNS.cost)}`;
    return [`${week}  $${total.toFixed(CENTS)}`, ...inWeek.map(line), ""];
  });
}
