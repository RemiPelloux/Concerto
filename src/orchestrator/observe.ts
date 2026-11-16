import { compareRoutes, observe, type RouteAnswer, type RouteChange } from "#src/engine/behaviour.js";
import type { Concert } from "#src/orchestrator/concert.js";
import { withBefore } from "#src/orchestrator/isolate.js";
import type { Job } from "#src/orchestrator/review.js";

const KB = 1024;

const size = (a: RouteAnswer | null) => (a ? `${a.status} (${(a.length / KB).toFixed(1)} KB)` : "no answer");

function describe(change: RouteChange): string {
  const sameStatus = change.before && change.after && change.before.status === change.after.status;
  return `\`${change.route}\`: ${size(change.before)} before, ${size(change.after)} after${sameStatus ? ", body changed" : ""}`;
}

/**
 * The opt-in behaviour diff: the configured server is started from the story's starting snapshot
 * and from its worktree, the routes are asked on both, and what changed is kept for the critic.
 */
export async function observeBehaviour(c: Concert, job: Job): Promise<void> {
  const serve = c.config.behaviour;
  if (!serve || !job.tree) return;
  const tree = job.tree;
  const [before, after] = await Promise.all([withBefore(c, { story: job.story, tree }, (dir) => observe(dir, serve)), observe(job.cwd, serve)]);
  const silent = !before ? "before" : !after ? "after" : "";
  const lines = silent ? [`the server did not answer within ${serve.readySeconds}s ${silent} the change`] : compareRoutes(before ?? [], after ?? []).map(describe);
  const shown = lines.length > 0 ? lines : ["no route changed"];
  c.store.story(job.story.id, { behaviour: shown });
  c.store.log({ role: "critic", label: "Behaviour", detail: `${job.story.title}: ${shown.join("; ")}`, result: "observed" });
}

export function behaviourBrief(c: Concert, storyId: string): string {
  const lines = c.store.view(storyId).behaviour ?? [];
  if (lines.length === 0) return "";
  return `## Behaviour diff\nConcerto started the server before and after this change and asked the configured routes:\n${lines.map((l) => `- ${l}`).join("\n")}`;
}
