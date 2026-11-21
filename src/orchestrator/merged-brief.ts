import { fileDiff } from "#src/engine/changes.js";
import type { State } from "#src/state/types.js";

/**
 * Characters of merged diff the conductor gets before calling done: enough for a typical run's
 * stories whole. Files past it are named, not cut, and the conductor reads those if they matter.
 */
export const DIFF_BUDGET = 24_000;

/** By id: the conductor already has the plan, with every story's id and title. */
function storyLines(s: State): string[] {
  return s.order.map((id) => {
    const view = s.stories[id];
    const files = view?.merged?.length ? `: ${view.merged.join(", ")}` : "";
    return `- ${id} (${view?.status ?? "unknown"})${files}`;
  });
}

/** Whole file diffs in order while they fit the budget; the rest named. */
function fit(diffs: { file: string; text: string }[], budget: number): string {
  let used = 0;
  const shown: string[] = [];
  const left: string[] = [];
  for (const d of diffs) {
    if (used + d.text.length > budget) {
      left.push(d.file);
      continue;
    }
    used += d.text.length;
    shown.push(d.text);
  }
  const note = left.length ? `\n\nNot shown, over the budget: ${left.join(", ")}. Read them if they matter.` : "";
  return `${shown.join("")}${note}`;
}

/**
 * What the run merged, for the conductor's last checkpoint: each story with its files, then the
 * merged diff. With it the conductor checks the change instead of searching for it.
 */
export async function mergedBrief(s: State, cwd: string, budget = DIFF_BUDGET): Promise<string> {
  const files = [...new Set(s.order.flatMap((id) => s.stories[id]?.merged ?? []))];
  const head = ["## What the run merged", ...storyLines(s)];
  if (files.length === 0) return [...head, "", "Nothing was merged."].join("\n");
  const diffs = await Promise.all(files.map(async (file) => ({ file, text: await fileDiff(cwd, file) })));
  return [...head, "", "## The merged diff", fit(diffs, budget)].join("\n");
}
