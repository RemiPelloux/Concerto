import { saveRun } from "../engine/stats.js";
import { buildStory } from "./build.js";
import type { Concert } from "./concert.js";
import { consult } from "./consult.js";
import { executionWaves, type Story } from "./plan.js";

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
  const build = (s: Story) => buildStory(c, s);
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
    const failed = results.filter((ok) => !ok).length;
    const error = failed > 0 ? `${failed} stories failed review` : final.verdict !== "ok" ? `Conductor: ${final.finding}` : "";
    c.store.update(() => ({ phase: error ? "failed" : "done", error }));
  } finally {
    saveRun(c.cwd, c.store.get().ledger);
  }
}
