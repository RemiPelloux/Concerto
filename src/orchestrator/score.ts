import { analyzeImpact, NO_IMPACT, type Impact } from "#src/engine/impact.js";
import { safePaths } from "#src/engine/paths.js";
import { reviewChain, routeStory } from "#src/models/router.js";
import type { StoryView } from "#src/state/types.js";
import { callRole } from "#src/orchestrator/call.js";
import type { Concert } from "#src/orchestrator/concert.js";
import { estimateStory } from "#src/orchestrator/estimate.js";
import { parsePlan, type Plan, type Story } from "#src/orchestrator/plan.js";
import { scoreStory } from "#src/orchestrator/scoring.js";

const NO_CHECKPOINTS = { "plan-lock": "", "repeat-error": "", "before-done": "" };

function view(c: Concert, story: Story, impact: Impact): StoryView {
  const breakdown = scoreStory(story, impact);
  const { score } = breakdown;
  const route = routeStory({ score, tags: story.tags }, c.catalog, c.config);
  const chain = route.chain.map((m) => m.ref);
  const reviewers = reviewChain(story.tags, c.catalog, c.config);
  const estimate = estimateStory(story.points, route.chain[0], reviewers[0]);
  const critics = reviewers.map((m) => m.ref);
  const { role, effort, rule } = route;
  return { id: story.id, score, reasons: breakdown.reasons, factors: breakdown.factors, role, effort, rule, chain, model: chain[0] ?? "", critics, estimate, impact, status: "queued" };
}

/** The scorer's file paths are model output: normalized and kept inside the repository. */
function withSafeFiles(plan: Plan): Plan {
  return { ...plan, stories: plan.stories.map((s) => ({ ...s, files: safePaths(s.files) })) };
}

/**
 * Splits the request into scored user stories, measures what each one reaches in the
 * repository (files, importers, covering tests), then scores and routes it. The repository
 * snapshot goes first so the same request on a changed repository is not a cache hit.
 */
export async function scoreRequest(c: Concert, request: string): Promise<void> {
  c.store.update(() => ({ phase: "scoring", prompt: request, error: "", notes: [], checkpoints: NO_CHECKPOINTS }));
  const segments = [
    { name: "repository snapshot", text: c.repo.text },
    { name: "request", text: `## Request\n${request}` },
  ];
  const reply = await callRole(c, { role: "scorer", segments, cacheable: true, label: "scoring the request" });
  const plan = withSafeFiles(parsePlan(reply.text));
  const impacts = await analyzeImpact({ cwd: c.cwd, repoFiles: c.repo.files, stories: plan.stories });
  const views = plan.stories.map((s) => view(c, s, impacts.get(s.id) ?? NO_IMPACT));
  c.store.update(() => ({ phase: "planned", plan, stories: Object.fromEntries(views.map((v) => [v.id, v])), order: views.map((v) => v.id) }));
  c.store.role("scorer", { activity: "done", note: `${views.length} stories` });
  const points = plan.stories.reduce((sum, s) => sum + s.points, 0);
  const tests = new Set(views.flatMap((v) => v.impact.tests)).size;
  c.store.log({ role: "scorer", label: "Score", detail: plan.summary, result: `${points} pts · ${tests} tests` });
}
