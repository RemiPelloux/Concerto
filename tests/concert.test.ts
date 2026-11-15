import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createConcert } from "#src/orchestrator/concert.js";
import { perform } from "#src/orchestrator/perform.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import type { Runner, RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { CATALOG, PLAN_REPLY, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

const is = (role: string) => (r: RunRequest) => r.systemFile.includes(`${role}-`);

type Script = { critic?: (n: number) => string; conductor?: string };

function setup(script: Script = {}, wrap: (r: Runner) => Runner = (r) => r) {
  let critiques = 0;
  const scripted = scriptedRunner((r) => {
    if (is("scorer")(r)) return PLAN_REPLY;
    if (is("critic")(r)) return script.critic?.(++critiques) ?? "VERDICT: pass\nchecked";
    if (is("conductor")(r)) return script.conductor ?? "VERDICT: ok\nlooks fine";
    return "STATUS: done\nchanged it";
  });
  const store = new Store();
  const init = { config: testConfig(), catalog: CATALOG, store, runner: wrap(scripted.runner), cwd: tempDir() };
  return { ...scripted, store, init };
}

describe("concert", () => {
  it("scores, routes by difficulty and answers a repeated request from the local cache", async () => {
    const { init, store, calls } = setup();
    await scoreRequest(await createConcert(init), "add health and auth");
    const { stories } = store.get();
    expect([stories.route?.role, stories.route?.model]).toEqual(["section", "a/swarm"]);
    expect([stories.auth?.role, stories.auth?.model]).toEqual(["soloist", "b/cheap-builder"]);
    await scoreRequest(await createConcert(init), "add   health and auth");
    expect(calls.filter(is("scorer"))).toHaveLength(1);
    expect(store.get().ledger.localHits).toBe(1);
  });

  it("performs the plan, saves the stats and only sends the conductor what is new", async () => {
    const { init, store, calls } = setup();
    const concert = await createConcert(init);
    await scoreRequest(concert, "add health and auth");
    await perform(concert);
    expect(store.get().phase).toBe("done");
    expect(Object.values(store.get().stories).every((s) => s.status === "passed")).toBe(true);
    const consults = calls.filter(is("conductor"));
    expect(consults).toHaveLength(2);
    expect(consults[1]?.session?.resume).toBe(true);
    expect(consults[1]?.prompt).toMatch(/still applies: plan/);
    expect(store.get().ledger.dedupedTokens).toBeGreaterThan(0);
  });

  it("hands plan-lock guidance to every builder", async () => {
    const { init, calls } = setup({ conductor: "VERDICT: revise\nmissing check\nAdd a test for the 401 path." });
    const concert = await createConcert(init);
    await scoreRequest(concert, "add health and auth");
    await perform(concert);
    const builds = calls.filter((r) => is("builder")(r) || is("section")(r));
    expect(builds.length).toBeGreaterThan(0);
    expect(builds.every((r) => r.prompt.includes("Add a test for the 401 path."))).toBe(true);
  });

  it("after two failed reviews, retries once with the conductor's guidance", async () => {
    const { init, store, calls } = setup({ critic: (n) => (n <= 2 ? "VERDICT: fail\nbroken\n\x1b[31mERR\x1b[0m\nERR\nERR" : "VERDICT: pass\nok") });
    const concert = await createConcert(init);
    await scoreRequest(concert, "add health and auth");
    await perform(concert);
    expect(store.get().checkpoints["repeat-error"]).toBe("ok");
    expect(store.get().stories.route?.status).toBe("passed");
    const third = calls.filter((r) => is("section")(r) && r.prompt.includes("Conductor guidance"));
    expect(third).toHaveLength(1);
    expect(third[0]?.prompt).toContain("ERR  (×3)");
    expect(store.get().ledger.condensedTokens).toBeGreaterThan(0);
  });

  it("writes a run report with every story, model and verdict", async () => {
    const { init, store } = setup();
    const concert = await createConcert(init);
    await scoreRequest(concert, "add health and auth");
    await perform(concert);
    const entry = store.get().log.find((e) => e.label === "Report");
    expect(entry?.detail).toMatch(/^\.concerto\/runs\/run-\w+\.md$/);
    const report = readFileSync(join(init.cwd, entry?.detail ?? ""), "utf8");
    expect(report).toContain("# Add a health endpoint");
    expect(report).toMatch(/\| Protect admin routes \| 8 \| 0 files, 0 importers, 0 tests \| 76 \(complexity 4\/5; sensitive area; 8 points\) \| b\/cheap-builder \| .* \| passed \|/);
    expect(report).toContain("## Totals");
  });

  it("stops starting stories once the budget is spent and says so", async () => {
    const { init, store, calls } = setup();
    const concert = await createConcert({ ...init, config: { ...init.config, budgetUsd: 0.000001 } });
    await scoreRequest(concert, "add health and auth");
    await perform(concert);
    expect(Object.values(store.get().stories).every((s) => s.status === "skipped")).toBe(true);
    expect(store.get().error).toMatch(/budget of \$0\.00 reached, 2 stories not started/);
    expect(calls.filter((r) => is("builder")(r) || is("section")(r))).toHaveLength(0);
  });

  it("falls back to the next model in the chain when a call fails", async () => {
    const failFirstBuilder: (r: Runner) => Runner = (runner) => async (req, onEvent) => {
      if (req.model === "a/swarm") throw new Error("429 rate limited");
      return runner(req, onEvent);
    };
    const { init, store, calls } = setup({}, failFirstBuilder);
    const concert = await createConcert(init);
    await scoreRequest(concert, "add health and auth");
    await perform(concert);
    expect(store.get().stories.route?.status).toBe("passed");
    expect(store.get().stories.route?.model).not.toBe("a/swarm");
    expect(store.get().ledger.fallbacks).toBeGreaterThan(0);
    expect(store.get().log.some((e) => e.label === "Fallback" && e.detail.includes("429"))).toBe(true);
    expect(calls.some((r) => r.model === "a/swarm")).toBe(false);
  });
});
