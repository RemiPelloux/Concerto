import { reviewChain, routeStory } from "../models/router.js";
import type { StoryView } from "../state/types.js";
import { callRole } from "./call.js";
import type { Concert } from "./concert.js";
import { parsePlan, scoreStory, type Story } from "./plan.js";

function view(c: Concert, story: Story): StoryView {
  const score = scoreStory(story);
  const route = routeStory({ score, tags: story.tags }, c.catalog, c.config);
  const chain = route.chain.map((m) => m.ref);
  const critics = reviewChain(story.tags, c.catalog, c.config).map((m) => m.ref);
  return { id: story.id, score, role: route.role, effort: route.effort, rule: route.rule, chain, model: chain[0] ?? "", critics, status: "queued" };
}

/**
 * Splits the request into scored user stories and routes each one. The repository snapshot
 * goes first so the same request on a changed repository is not answered from the cache.
 */
export async function scoreRequest(c: Concert, request: string): Promise<void> {
  c.store.update(() => ({ phase: "scoring", prompt: request, error: "", notes: [], checkpoints: { "plan-lock": "", "repeat-error": "", "before-done": "" } }));
  const segments = [
    { name: "repository snapshot", text: c.repo.text },
    { name: "request", text: `## Request\n${request}` },
  ];
  const reply = await callRole(c, { role: "scorer", segments, cacheable: true });
  const plan = parsePlan(reply.text);
  const views = plan.stories.map((s) => view(c, s));
  c.store.update(() => ({ phase: "planned", plan, stories: Object.fromEntries(views.map((v) => [v.id, v])), order: views.map((v) => v.id) }));
  c.store.role("scorer", { activity: "done", note: `${views.length} stories` });
  const points = plan.stories.reduce((sum, s) => sum + s.points, 0);
  c.store.log({ role: "scorer", label: "Score", detail: plan.summary, result: `${points} pts` });
}
