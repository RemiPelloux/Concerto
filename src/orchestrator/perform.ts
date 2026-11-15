import type { Concert } from "./concert.js";
import { buildStory } from "./build.js";
import { consult } from "./consult.js";
import { executionWaves, type Story } from "./plan.js";

async function inBatches(items: Story[], size: number, fn: (s: Story) => Promise<boolean>): Promise<boolean[]> {
  const results: boolean[] = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return results;
}

/** Soloist stories in a wave run one by one; section stories swarm in parallel. */
async function playWave(c: Concert, wave: Story[]): Promise<boolean[]> {
  const roleOf = (s: Story) => c.store.get().stories.find((v) => v.id === s.id)?.role;
  const solo = wave.filter((s) => roleOf(s) === "soloist");
  const section = wave.filter((s) => roleOf(s) !== "soloist");
  const build = (s: Story) => buildStory(c, s);
  const swarm = inBatches(section, c.config.swarm.maxParallel, build);
  const soloResults = await inBatches(solo, 1, build);
  return [...soloResults, ...(await swarm)];
}

/** Runs the locked plan: conductor check, waves of builds, final conductor check. */
export async function perform(c: Concert): Promise<void> {
  const plan = c.store.get().plan;
  if (!plan) throw new Error("Nothing to perform: score a request first.");
  c.store.update(() => ({ phase: "running" }));
  const lock = await consult(c, "plan-lock");
  if (lock.verdict === "stop") {
    c.store.update(() => ({ phase: "failed", error: `Conductor stopped the plan: ${lock.finding}` }));
    return;
  }
  const results: boolean[] = [];
  for (const wave of executionWaves(plan.stories)) results.push(...(await playWave(c, wave)));
  await consult(c, "before-done");
  const failed = results.filter((ok) => !ok).length;
  c.store.update(() => ({ phase: failed === 0 ? "done" : "failed", error: failed ? `${failed} stories failed review` : "" }));
}
