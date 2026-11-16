import { relative } from "node:path";
import { writeReport } from "#src/engine/report.js";
import { saveRun } from "#src/engine/stats.js";
import { releaseRun } from "#src/engine/worktree.js";
import { runOutcome } from "#src/orchestrator/budget.js";
import { buildStory } from "#src/orchestrator/build.js";
import type { Concert } from "#src/orchestrator/concert.js";
import { consult } from "#src/orchestrator/consult.js";
import { executionWaves, type Story } from "#src/orchestrator/plan.js";

async function inBatches(items: Story[], size: number, fn: (s: Story) => Promise<boolean>): Promise<boolean[]> {
  const results: boolean[] = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return results;
}

/**
 * Soloist stories run one by one, section stories in parallel. Within a wave, stories that
 * run on the same model go back to back, so its prompt cache is still warm for the next one.
 */
async function playWave(c: Concert, wave: Story[]): Promise<boolean[]> {
  const view = (s: Story) => c.store.view(s.id);
  const byModel = (a: Story, b: Story) => view(a).model.localeCompare(view(b).model);
  const solo = wave.filter((s) => view(s).role === "soloist").sort(byModel);
  const section = wave.filter((s) => view(s).role !== "soloist").sort(byModel);
  // A resumed session keeps what passed: only the rest is built again.
  const build = (s: Story) => (view(s).status === "passed" ? Promise.resolve(true) : buildStory(c, s));
  const swarm = inBatches(section, c.config.swarm.maxParallel, build);
  const soloResults = await inBatches(solo, 1, build);
  return [...soloResults, ...(await swarm)];
}

async function lockPlan(c: Concert): Promise<boolean> {
  const lock = await consult(c, "plan-lock");
  if (lock.verdict === "stop") {
    c.store.update(() => ({ phase: "failed", error: `Conductor stopped the plan: ${lock.finding}` }));
    return false;
  }
  if (lock.verdict === "revise") c.store.update((s) => ({ notes: [...s.notes, lock.guidance || lock.finding] }));
  return true;
}

/** Runs the plan: plan-lock check, waves of builds, before-done check, then saves the stats. */
export async function perform(c: Concert): Promise<void> {
  const plan = c.store.get().plan;
  if (!plan) throw new Error("Nothing to perform: score a request first.");
  c.store.update(() => ({ phase: "running" }));
  try {
    if (!(await lockPlan(c))) return;
    const results: boolean[] = [];
    for (const wave of executionWaves(plan.stories)) results.push(...(await playWave(c, wave)));
    const final = await consult(c, "before-done");
    const error = runOutcome(c, final.verdict === "ok" ? "" : final.finding);
    c.store.update(() => ({ phase: error ? "failed" : "done", error }));
  } finally {
    if (c.isolated) releaseRun(c.cwd, c.runId);
    saveRun(c.cwd, c.store.get().ledger);
    const report = writeReport(c.store.get(), { cwd: c.cwd, runId: c.runId });
    c.store.log({ role: "conductor", label: "Report", detail: relative(c.cwd, report), result: "written" });
  }
}
