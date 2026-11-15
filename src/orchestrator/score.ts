import { reviewerFor, routeStory } from "../models/router.js";
import type { StoryView } from "../state/types.js";
import { callRole } from "./call.js";
import type { Concert } from "./concert.js";
import { parsePlan, scoreStory, type Plan, type Story } from "./plan.js";

function view(c: Concert, story: Story): StoryView {
  const score = scoreStory(story);
  const route = routeStory({ score, tags: story.tags }, c.catalog, c.config);
  const critic = reviewerFor(story.tags, c.catalog, c.config).ref;
  const { role, effort, rule } = route;
  return { id: story.id, score, role, model: route.model.ref, effort, rule, critic, status: "queued" };
}

/** Splits the request into scored user stories and routes each one to a model. */
export async function scoreRequest(c: Concert, request: string): Promise<Plan> {
  c.store.update(() => ({ phase: "scoring", prompt: request, error: "" }));
  const reply = await callRole(c, { role: "scorer", prompt: request, cacheable: true });
  const plan = parsePlan(reply.text);
  const stories = plan.stories.map((s) => view(c, s));
  c.store.update(() => ({ phase: "planned", plan, stories }));
  c.store.role("scorer", { activity: "done", note: `${stories.length} stories` });
  const points = plan.stories.reduce((sum, s) => sum + s.points, 0);
  c.store.log({ role: "scorer", label: "Score", detail: plan.summary, result: `${points} pts` });
  return plan;
}
