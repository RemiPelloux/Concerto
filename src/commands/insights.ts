import { calibrate, MIN_STORIES, type ModelRecord } from "#src/engine/calibrate.js";
import { readOutcomes, type Outcome } from "#src/engine/outcomes.js";
import { WEIGHTS } from "#src/orchestrator/scoring.js";

const PERCENT = 100;
const MODEL = 34;
const SHOWN = 5;
const CENTS = 2;
/** Column widths of the per-model table. */
const COL = { count: 3, rate: 11, perPoint: 12 };
const MOVED_SHOWN = 3;

const dollars = (n: number) => `$${n.toFixed(CENTS)}`;
const total = (list: Outcome[]) => list.reduce((sum, o) => sum + o.cost, 0);

function modelLine(r: ModelRecord, spent: number): string {
  const rate = `${Math.round(r.passRate * PERCENT)}% passed`;
  const perPoint = r.costPerPoint === null ? "-" : `${dollars(r.costPerPoint)}/point`;
  return `${r.model.padEnd(MODEL)} ${String(r.stories).padStart(COL.count)} stories · ${rate.padEnd(COL.rate)} · ${r.attempts.toFixed(1)} builds · ${perPoint.padEnd(COL.perPoint)} · ${dollars(spent)}`;
}

/** Files named by two or more stories that failed: where review keeps saying no. */
function failingFiles(outcomes: Outcome[]): string[] {
  const counts = new Map<string, number>();
  outcomes.filter((o) => !o.passed).forEach((o) => o.files.forEach((f) => counts.set(f, (counts.get(f) ?? 0) + 1)));
  return [...counts].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, SHOWN).map(([f, n]) => `${f} (${n} failed stories)`);
}

function weightLines(fitted: Record<string, number> | null, stories: number): string[] {
  if (!fitted) return [`score weights     hand-set: ${stories} of ${MIN_STORIES} stories recorded before calibration`];
  const moved = Object.entries(WEIGHTS).map(([k, w]) => ({ k, w, now: fitted[k] ?? w })).sort((a, b) => Math.abs(b.now - b.w) - Math.abs(a.now - a.w));
  return [`score weights     calibrated on ${stories} stories; moved most: ${moved.slice(0, MOVED_SHOWN).map((m) => `${m.k} ${m.w.toFixed(2)} to ${m.now.toFixed(2)}`).join(", ")}`];
}

/**
 * What this repository's runs say: each model's pass rate, builds per story and cost per point,
 * where the money went, the files that keep failing review, and how the score was calibrated.
 */
export function insightsLines(cwd: string): string[] {
  const outcomes = readOutcomes(cwd);
  if (outcomes.length === 0) return ["No finished stories recorded in this repository yet. Insights start after the first run."];
  const cal = calibrate(outcomes, WEIGHTS);
  const runs = new Set(outcomes.map((o) => o.runId)).size;
  const spent = (model: string) => total(outcomes.filter((o) => o.model === model));
  const models = [...cal.records.values()].sort((a, b) => spent(b.model) - spent(a.model));
  const failing = failingFiles(outcomes);
  return [
    `${outcomes.length} stories in ${runs} runs · ${dollars(total(outcomes))} spent · ${Math.round((outcomes.filter((o) => o.passed).length / outcomes.length) * PERCENT)}% passed`,
    ...weightLines(cal.weights, outcomes.length),
    "",
    ...models.map((r) => modelLine(r, spent(r.model))),
    ...(failing.length > 0 ? ["", "files that keep failing review:", ...failing.map((f) => `  ${f}`)] : []),
  ];
}
