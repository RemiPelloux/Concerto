import type { Calibration } from "#src/engine/calibrate.js";
import type { State, StoryView } from "#src/state/types.js";

const CENTS = 2;
const FACTORS_SHOWN = 5;
const TITLE = 44;

const dollars = (n: number) => `$${n.toFixed(CENTS)}`;

function factorLine(v: StoryView): string {
  const top = [...v.factors].sort((a, b) => b.weight * b.value - a.weight * a.value).slice(0, FACTORS_SHOWN);
  return `    why: ${top.map((f) => `${f.note} (${f.weight.toFixed(2)} x ${f.value.toFixed(2)})`).join(" · ")}`;
}

function estimateLine(v: StoryView, calibration: Calibration): string {
  const record = calibration.records.get(v.model);
  const basis = record?.costPerPoint ? `measured: ${dollars(record.costPerPoint)} per point over ${record.stories} stories here` : "list prices: one build and one review";
  return `    estimate ${dollars(v.estimate)} (${basis})`;
}

/**
 * `--plan --explain`: each story's score with the factors that made it, the rule that routed it,
 * its builders and reviewers in order, and where its estimate comes from; then the paths.
 */
export function explainLines(state: State, calibration: Calibration): string[] {
  const stories = (state.plan?.stories ?? []).flatMap((story) => {
    const v = state.stories[story.id];
    if (!v) return [];
    return [
      `${story.id.padEnd(TITLE / 2)} ${story.title.slice(0, TITLE).padEnd(TITLE)} score ${v.score} · ${story.points} pts${story.dependsOn.length ? ` · after ${story.dependsOn.join(", ")}` : ""}`,
      factorLine(v),
      `    built by ${v.chain[0] ?? "-"} (rule ${v.rule}, ${v.role}, effort ${v.effort})${v.chain.length > 1 ? `, then ${v.chain.slice(1).join(", ")}` : ""}`,
      `    reviewed by ${v.critics[0] ?? "-"}${v.critics.length > 1 ? `, then ${v.critics.slice(1).join(", ")}` : ""}`,
      estimateLine(v, calibration),
    ];
  });
  const paths = state.paths.map((p) => `  ${p.label}: ${dollars(p.cost)}${p.missing ? `, ${p.missing} stories not reachable` : ""} (--prefer ${p.prefer})`);
  return [`${state.plan?.summary ?? ""}`, "", ...stories, ...(paths.length ? ["", "the whole plan:", ...paths] : [])];
}
