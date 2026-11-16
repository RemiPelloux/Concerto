import { EffortSchema } from "#src/config/types.js";
import { analyzeImpact, NO_IMPACT } from "#src/engine/impact.js";
import type { Concert } from "#src/orchestrator/concert.js";
import { editPlan, type Edit } from "#src/orchestrator/edit.js";
import { estimateStory } from "#src/orchestrator/estimate.js";
import { pathCosts } from "#src/orchestrator/paths.js";
import { storyView } from "#src/orchestrator/score.js";
import type { StoryView } from "#src/state/types.js";

type RouteEdit = Extract<Edit, { kind: "route" | "reviewer" | "effort" }>;

function describe(edit: Edit): string {
  if (edit.kind === "merge") return `merged ${edit.id} into ${edit.into}`;
  if (edit.kind === "after") return `${edit.id} now waits for ${edit.deps.join(", ") || "nothing"}`;
  if (edit.kind === "retitle") return `${edit.id} retitled "${edit.title}"`;
  if (edit.kind === "route" || edit.kind === "reviewer") return `${edit.id} ${edit.kind === "route" ? "built" : "reviewed"} by ${edit.model}`;
  if (edit.kind === "effort") return `${edit.id} at effort ${edit.effort}`;
  return `${edit.kind === "drop" ? "dropped" : "split"} ${edit.id}`;
}

/** Who builds, who reviews, how hard: the chosen model goes first, the rest stay as fallbacks. */
function rerouted(c: Concert, view: StoryView, edit: RouteEdit): Partial<StoryView> {
  if (edit.kind === "effort") return { effort: EffortSchema.parse(edit.effort) };
  const model = c.catalog.get(edit.model);
  if (!model) throw new Error(`"${edit.model}" is not a reachable model. /models lists them.`);
  if (edit.kind === "reviewer") return { critics: [model.ref, ...view.critics.filter((m) => m !== model.ref)] };
  const chain = [model.ref, ...view.chain.filter((m) => m !== model.ref)];
  const points = c.store.get().plan?.stories.find((s) => s.id === view.id)?.points ?? 1;
  return { chain, model: model.ref, estimate: estimateStory({ points, builder: model, critic: c.catalog.get(view.critics[0] ?? ""), calibration: c.calibration }) };
}

/**
 * Applies an edit to the plan waiting for Enter. Shape edits (drop, merge, split, retitle, after)
 * measure and score the stories they changed again; the others keep each story's measurements.
 */
export async function applyEdit(c: Concert, edit: Edit): Promise<string> {
  const state = c.store.get();
  if (state.phase !== "planned" || !state.plan) throw new Error("Edits change a plan waiting for Enter; there is none right now.");
  if (edit.kind === "route" || edit.kind === "reviewer" || edit.kind === "effort") {
    const view = state.stories[edit.id];
    if (!view) throw new Error(`No story "${edit.id}" in the plan.`);
    c.store.story(edit.id, rerouted(c, view, edit));
  } else {
    const { plan, changed } = editPlan(state.plan, edit);
    const fresh = plan.stories.filter((s) => changed.includes(s.id));
    const impacts = await analyzeImpact({ cwd: c.cwd, repoFiles: c.repo.files, cache: c.blastRadius, stories: fresh });
    const kept = (id: string) => state.stories[id] as StoryView;
    const stories = Object.fromEntries(plan.stories.map((s) => [s.id, changed.includes(s.id) ? storyView(c, s, impacts.get(s.id) ?? NO_IMPACT) : kept(s.id)]));
    c.store.update(() => ({ plan, stories, order: plan.stories.map((s) => s.id) }));
  }
  const after = c.store.get();
  c.store.update(() => ({ paths: pathCosts(c.catalog, { stories: after.plan?.stories ?? [], views: after.stories }) }));
  c.store.log({ role: "scorer", label: "Edit", detail: describe(edit), result: "re-planned" });
  return describe(edit);
}
