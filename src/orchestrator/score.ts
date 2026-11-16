import { analyzeImpact, NO_IMPACT, type Impact } from "#src/engine/impact.js";
import { safePaths } from "#src/engine/paths.js";
import { blendedPrice, reviewChain, routeStory } from "#src/models/router.js";
import type { ModelInfo } from "#src/models/types.js";
import { MIN_MODEL_STORIES, type Calibration } from "#src/engine/calibrate.js";
import type { StoryView } from "#src/state/types.js";
import { callRole } from "#src/orchestrator/call.js";
import type { Concert } from "#src/orchestrator/concert.js";
import { estimateStory } from "#src/orchestrator/estimate.js";
import { parsePlan, type Plan, type Story } from "#src/orchestrator/plan.js";
import { scoreStory, WEIGHTS, type FactorKey } from "#src/orchestrator/scoring.js";
import { pathCosts } from "#src/orchestrator/paths.js";
import { planForSimilar, rememberPlan } from "#src/engine/similar.js";
import { bump } from "#src/engine/ledger.js";
import type { Segment } from "#src/engine/segments.js";

const NO_CHECKPOINTS = { "plan-lock": "", "repeat-error": "", "critics-disagree": "", "before-done": "" };

/**
 * Between models of the same price, the one that passed more stories in this repository goes
 * first: history breaks ties, it never overrides the routing.
 */
export function preferProven(chain: ModelInfo[], calibration: Calibration): ModelInfo[] {
  const rate = (m: ModelInfo) => {
    const r = calibration.records.get(m.ref);
    return r && r.stories >= MIN_MODEL_STORIES ? r.passRate : -1;
  };
  return chain.map((m, i) => ({ m, i })).sort((a, b) => (blendedPrice(a.m) === blendedPrice(b.m) ? rate(b.m) - rate(a.m) || a.i - b.i : a.i - b.i)).map(({ m }) => m);
}

export function storyView(c: Concert, story: Story, impact: Impact): StoryView {
  const breakdown = scoreStory(story, impact, (c.calibration.weights as Record<FactorKey, number> | null) ?? WEIGHTS);
  const { score } = breakdown;
  const route = routeStory({ score, tags: story.tags }, c.catalog, c.config);
  const builders = preferProven(route.chain, c.calibration);
  const chain = builders.map((m) => m.ref);
  const reviewers = preferProven(reviewChain({ score, tags: story.tags }, c.catalog, c.config), c.calibration);
  const estimate = estimateStory({ points: story.points, builder: builders[0], critic: reviewers[0], calibration: c.calibration });
  const critics = reviewers.map((m) => m.ref);
  const { role, effort, rule } = route;
  return { id: story.id, score, reasons: breakdown.reasons, factors: breakdown.factors, role, effort, rule, chain, model: chain[0] ?? "", critics, estimate, impact, status: "queued" };
}

/** The scorer's file paths are model output: normalized and kept inside the repository. */
function withSafeFiles(plan: Plan): Plan {
  return { ...plan, stories: plan.stories.map((s) => ({ ...s, files: safePaths(s.files) })) };
}

/**
 * The scorer's plan. A request worded differently from one already scored on the same repository
 * state reuses that plan: no model call, counted as a local hit.
 */
async function planText(c: Concert, request: string, segments: Segment[]): Promise<string> {
  const repoKey = c.template ? `${c.repo.key}|${c.template.split("\n")[0]}` : c.repo.key;
  const reused = planForSimilar(c.cwd, request, { repoKey, ttlHours: c.config.cache.ttlHours });
  if (reused) {
    c.store.update((s) => ({ ledger: bump(s.ledger, "localHits") }));
    c.store.log({ role: "scorer", label: "Score", detail: "same request, worded differently: plan reused", result: "local hit" });
    return reused;
  }
  const reply = await callRole(c, { role: "scorer", segments, cacheable: true, label: "scoring the request" });
  rememberPlan(c.cwd, request, { repoKey, reply: reply.text });
  return reply.text;
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
    { name: "plan shape", text: c.template },
    { name: "request", text: `## Request\n${request}` },
  ];
  const plan = withSafeFiles(parsePlan(await planText(c, request, segments)));
  const impacts = await analyzeImpact({ cwd: c.cwd, repoFiles: c.repo.files, cache: c.blastRadius, stories: plan.stories });
  const views = plan.stories.map((s) => storyView(c, s, impacts.get(s.id) ?? NO_IMPACT));
  const stories = Object.fromEntries(views.map((v) => [v.id, v]));
  const paths = pathCosts(c.catalog, { stories: plan.stories, views: stories });
  c.store.update(() => ({ phase: "planned", plan, stories, order: views.map((v) => v.id), paths }));
  c.store.role("scorer", { activity: "done", note: `${views.length} stories` });
  const points = plan.stories.reduce((sum, s) => sum + s.points, 0);
  const tests = new Set(views.flatMap((v) => v.impact.tests)).size;
  c.store.log({ role: "scorer", label: "Score", detail: plan.summary, result: `${points} pts · ${tests} tests` });
}
