import type { Impact } from "#src/engine/impact.js";
import { FIBONACCI, type Story } from "#src/orchestrator/plan.js";

const PERCENT = 100;
const SCALE_SPAN = 4;
const SENSITIVE_RISK = 0.75;
const SENSITIVE_TAGS = new Set(["security", "auth", "payments", "migration", "infra"]);
const TOP_REASONS = 3;
/** Saturation points: beyond these, more of the same does not make a story harder. */
const SAT = { reach: 48, lines: 3000, tests: 32, churn: 40, areas: 5 };

export type FactorKey = "complexity" | "risk" | "effort" | "uncertainty" | "reach" | "size" | "coverage" | "tests" | "churn" | "spread";
export type Factor = { key: FactorKey; weight: number; value: number; note: string };
export type Breakdown = { score: number; factors: Factor[]; reasons: string[] };

/** Weights sum to 1. The last six are measured in the repository; the first four come from the scorer. */
export const WEIGHTS: Record<FactorKey, number> = {
  complexity: 0.22,
  risk: 0.16,
  effort: 0.1,
  uncertainty: 0.08,
  reach: 0.14,
  size: 0.08,
  coverage: 0.1,
  tests: 0.04,
  churn: 0.04,
  spread: 0.04,
};

const scale = (n: number) => (n - 1) / SCALE_SPAN;
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const logScale = (n: number, saturation: number) => Math.min(1, Math.log2(1 + Math.max(0, n)) / Math.log2(1 + saturation));

type Scored = Pick<Story, "points" | "complexity" | "risk" | "uncertainty" | "tags">;

function modelFactors(s: Scored, sensitive: string[], w: Record<FactorKey, number>): Factor[] {
  const flagged = sensitive.length > 0 || s.tags.some((t) => SENSITIVE_TAGS.has(t));
  const risk = flagged ? Math.max(scale(s.risk), SENSITIVE_RISK) : scale(s.risk);
  const why = sensitive.length > 0 ? `touches ${sensitive.slice(0, 2).join(", ")}` : flagged ? "sensitive area" : `risk ${s.risk}/5`;
  return [
    { key: "complexity", weight: w.complexity, value: scale(s.complexity), note: `complexity ${s.complexity}/5` },
    { key: "risk", weight: w.risk, value: risk, note: why },
    { key: "effort", weight: w.effort, value: FIBONACCI.indexOf(s.points) / (FIBONACCI.length - 1), note: count(s.points, "point") },
    { key: "uncertainty", weight: w.uncertainty, value: scale(s.uncertainty), note: `scope uncertainty ${s.uncertainty}/5` },
  ];
}

function measuredFactors(i: Impact, w: Record<FactorKey, number>): Factor[] {
  const source = i.sourceFiles;
  return [
    { key: "reach", weight: w.reach, value: logScale(i.files.length + i.direct + i.indirect / 2, SAT.reach), note: `${i.direct} direct and ${count(i.indirect, "indirect importer")}` },
    { key: "size", weight: w.size, value: logScale(i.lines, SAT.lines), note: `${count(i.lines, "line")} in touched files` },
    { key: "coverage", weight: w.coverage, value: source === 0 ? 0 : i.untested / source, note: `${i.untested} of ${count(source, "source file")} untested` },
    { key: "tests", weight: w.tests, value: logScale(i.tests.length, SAT.tests), note: `${count(i.tests.length, "test")} to run` },
    { key: "churn", weight: w.churn, value: logScale(i.churn, SAT.churn), note: `${count(i.churn, "commit")} in 90 days` },
    { key: "spread", weight: w.spread, value: Math.min(1, (i.areas - 1) / (SAT.areas - 1)), note: `${count(i.areas, "area")} of the codebase` },
  ];
}

/**
 * 0 to 100, computed in code from ten factors. The scorer supplies four; six are measured in
 * the repository; `weights` are the hand-set ones until the repository's history calibrates them.
 * When a story names no file, the measured factors drop out and the model's
 * weights are scaled up to fill. Sensitive paths or tags put a floor under risk.
 */
export function scoreStory(story: Scored, impact?: Impact, weights: Record<FactorKey, number> = WEIGHTS): Breakdown {
  const measured = impact && impact.files.length > 0 ? measuredFactors(impact, weights) : [];
  const factors = [...modelFactors(story, impact?.sensitive ?? [], weights), ...measured];
  const total = factors.reduce((sum, f) => sum + f.weight, 0);
  const normalized = factors.map((f) => ({ ...f, weight: f.weight / total }));
  const score = Math.round(normalized.reduce((sum, f) => sum + f.weight * f.value, 0) * PERCENT);
  const reasons = [...normalized].sort((a, b) => b.weight * b.value - a.weight * a.value).filter((f) => f.value > 0).slice(0, TOP_REASONS).map((f) => f.note);
  return { score, factors: normalized, reasons };
}
