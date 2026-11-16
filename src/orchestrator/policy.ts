import { readChanges } from "#src/engine/changes.js";
import { matching } from "#src/engine/glob.js";
import { changesIn } from "#src/engine/worktree.js";
import type { Concert } from "#src/orchestrator/concert.js";
import type { Job } from "#src/orchestrator/review.js";

/** What every builder reads first when the project protects paths. "" without a policy. */
export function policyBrief(c: Concert): string {
  const paths = c.config.policy.protectedPaths;
  return paths.length ? `## Project policy\nNever create, change or delete files matching: ${paths.map((p) => `\`${p}\``).join(", ")}. A change there is refused and the story fails.` : "";
}

/**
 * Checks a build against the policy before the tests and the critic: a story that changed a
 * protected file goes back to its builder, and it can never pass or merge while it does.
 */
export async function policyGate(c: Concert, job: Job): Promise<string> {
  const paths = c.config.policy.protectedPaths;
  if (paths.length === 0) return "";
  const changed = job.tree ? (await changesIn(job.tree)).map((ch) => ch.file) : (await readChanges(job.cwd)).map((ch) => ch.file);
  const hits = matching(changed, paths);
  if (hits.length === 0) return "";
  const rule = paths.join(", ");
  c.store.story(job.story.id, { finding: `policy: ${hits.join(", ")} may not be changed (${rule})` });
  c.store.log({ role: "conductor", label: "Policy", detail: `${job.story.title}: changed ${hits.join(", ")}, protected by ${rule}`, result: "refused" });
  return `## The project's policy refused this change\nThese files may not be changed by any agent: ${hits.map((h) => `\`${h}\``).join(", ")} (protected: ${rule}). Undo every change to them and do the story without them.`;
}
