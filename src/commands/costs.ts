import { chmodSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { costCsv, costRows, costTable } from "#src/engine/costs.js";
import { renderDashboard } from "#src/engine/dashboard.js";
import { readRuns, runLogPath } from "#src/engine/run-log.js";

const DAY_MS = 86_400_000;
const FILE_MODE = 0o600;

/** `--costs [--since <days>] [--csv]`: what runs cost, by week, repository and model. */
export function printCosts(opts: { since?: string; csv?: boolean }): void {
  const days = opts.since === undefined ? 0 : Number(opts.since);
  if (!(days >= 0)) throw new Error("--since takes a number of days.");
  const rows = costRows(readRuns(), days ? Date.now() - days * DAY_MS : 0);
  process.stdout.write(opts.csv ? costCsv(rows) : `${costTable(rows).join("\n")}\n`);
}

/** `--dashboard`: writes the page next to the run log and prints where it is. */
export function writeDashboard(): void {
  const file = join(dirname(runLogPath()), "dashboard.html");
  writeFileSync(file, renderDashboard(readRuns()), { mode: FILE_MODE });
  chmodSync(file, FILE_MODE);
  process.stdout.write(`${file}\n`);
}
