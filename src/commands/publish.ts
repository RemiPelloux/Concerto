import { existsSync } from "node:fs";
import { join } from "node:path";
import { branchName, openPullRequest, startBranch } from "#src/engine/publish.js";
import { emit } from "#src/headless.js";
import type { Concert } from "#src/orchestrator/concert.js";

/** `--pr`: the run's own branch, started before it from a clean tree; null without --pr. */
export async function prBranch(pr: boolean, at: { cwd: string; request: string; session: string }): Promise<{ branch: string; base: string } | null> {
  if (!pr) return null;
  const branch = branchName(at.request, at.session);
  return { branch, base: await startBranch(at.cwd, branch) };
}

/** After the run: pushes the branch and opens the pull request when any story was committed. */
export async function finishPr(concert: Concert, pr: { branch: string; base: string }, json: boolean): Promise<void> {
  const committed = concert.store.get().log.some((e) => e.label === "Commit");
  const report = join(concert.cwd, ".concerto", "runs", `${concert.runId}.md`);
  if (!committed || !existsSync(report)) return void (json ? emit("pr", { url: null, reason: "nothing was merged" }) : process.stdout.write("No pull request: nothing was merged.\n"));
  const title = concert.store.get().plan?.summary || concert.store.get().prompt.split("\n")[0] || "Concerto run";
  const url = await openPullRequest(concert.cwd, { ...pr, title, bodyFile: report });
  if (json) emit("pr", { url });
  else process.stdout.write(`Pull request: ${url}\n`);
}
