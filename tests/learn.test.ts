import { appendFileSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { insightsLines } from "#src/commands/insights.js";
import { calibrate, fitWeights } from "#src/engine/calibrate.js";
import { outcomesPath, readOutcomes, recordOutcomes, type Outcome } from "#src/engine/outcomes.js";
import { createConcert } from "#src/orchestrator/concert.js";
import { estimateStory } from "#src/orchestrator/estimate.js";
import { perform } from "#src/orchestrator/perform.js";
import { preferProven } from "#src/orchestrator/score.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import { WEIGHTS } from "#src/orchestrator/scoring.js";
import type { RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { CATALOG, expectOwnerOnly, PLAN_REPLY, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

const is = (role: string) => (r: RunRequest) => r.systemFile.includes(`${role}-`);
/** Deterministic noise in [1 - spread, 1 + spread], so the test never flakes. */
const noise = (i: number, spread: number) => 1 + spread * Math.sin(i * 12.9898);
const factors = (coverage: number) => Object.fromEntries(Object.keys(WEIGHTS).map((k) => [k, k === "coverage" ? coverage : 0.5]));

function outcome(over: Partial<Outcome>): Outcome {
  return { at: 0, runId: "r", tags: [], files: [], points: 2, score: 40, factors: factors(0.5), model: "a/builder", critic: "a/checker", attempts: 1, passed: true, cost: 0.1, ...over };
}

describe("learning from runs", () => {
  it("records each finished story's model, builds, cost and result after a run", async () => {
    const cwd = tempDir();
    const scripted = scriptedRunner((r) => (is("scorer")(r) ? PLAN_REPLY : is("critic")(r) ? "VERDICT: pass\nok" : is("conductor")(r) ? "VERDICT: ok\nok" : "STATUS: done\nok"));
    const concert = await createConcert({ config: testConfig(), catalog: CATALOG, store: new Store(), runner: scripted.runner, cwd });
    await scoreRequest(concert, "add health and auth");
    await perform(concert);
    const recorded = readOutcomes(cwd);
    expect(recorded.map((o) => [o.points, o.attempts, o.passed])).toEqual([[2, 1, true], [8, 1, true]]);
    expect(recorded.every((o) => o.cost > 0 && o.model !== "" && Object.keys(o.factors).length >= 4)).toBe(true);
    expectOwnerOnly(outcomesPath(cwd));
  });

  it("skips a damaged line instead of losing the history", () => {
    const cwd = tempDir();
    recordOutcomes(cwd, [outcome({})]);
    appendFileSync(outcomesPath(cwd), "{not json\n");
    recordOutcomes(cwd, [outcome({ passed: false })]);
    expect(readOutcomes(cwd).map((o) => o.passed)).toEqual([true, false]);
  });

  it("keeps the hand-set weights until 20 stories, then weighs more what predicted failures", () => {
    const few = Array.from({ length: 19 }, () => outcome({}));
    expect(fitWeights(few, WEIGHTS)).toBeNull();
    const history = Array.from({ length: 30 }, (_, i) => outcome({ factors: factors(i % 3 === 0 ? 0.9 : 0.1), passed: i % 3 !== 0 }));
    const fitted = fitWeights(history, WEIGHTS)!;
    expect(fitted.coverage).toBeGreaterThan(WEIGHTS.coverage);
    expect(Object.values(fitted).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("estimates within 30% of the real cost for 8 of 10 runs after 20 recorded runs", () => {
    const COST_PER_POINT = 0.05;
    const history = Array.from({ length: 40 }, (_, i) => outcome({ runId: `run-${Math.floor(i / 2)}`, points: [1, 2, 3, 5, 8][i % 5]!, cost: 0 }))
      .map((o, i) => ({ ...o, cost: COST_PER_POINT * o.points * noise(i, 0.15) }));
    const calibration = calibrate(history, WEIGHTS);
    const builder = CATALOG.get("a/builder");
    const within = Array.from({ length: 10 }, (_, i) => {
      const points = [1, 2, 3, 5, 8][i % 5]!;
      const actual = COST_PER_POINT * points * noise(i + 100, 0.2);
      const estimate = estimateStory({ points, builder, critic: CATALOG.get("a/checker"), calibration });
      return Math.abs(estimate - actual) / actual <= 0.3;
    });
    expect(within.filter(Boolean).length).toBeGreaterThanOrEqual(8);
    const listPrice = estimateStory({ points: 3, builder, critic: CATALOG.get("a/checker") });
    expect(Math.abs(listPrice - COST_PER_POINT * 3) / (COST_PER_POINT * 3)).toBeGreaterThan(0.3);
  });

  it("lets a model's track record break a price tie, never override the routing", () => {
    const history = [
      ...Array.from({ length: 5 }, () => outcome({ model: "proxy/builder", passed: true })),
      ...Array.from({ length: 5 }, (_, i) => outcome({ model: "a/builder", passed: i === 0 })),
    ];
    const calibration = calibrate(history, WEIGHTS);
    const chain = CATALOG.reachable(["a/builder", "proxy/builder", "b/cheap-builder"]);
    expect(preferProven(chain, calibration).map((m) => m.ref)).toEqual(["proxy/builder", "a/builder", "b/cheap-builder"]);
  });

  it("tells which model passes, what it costs and which files keep failing", () => {
    const cwd = tempDir();
    recordOutcomes(cwd, [
      ...Array.from({ length: 5 }, (_, i) => outcome({ runId: `r${i}`, cost: 0.2, points: 2 })),
      outcome({ model: "b/cheap-builder", passed: false, files: ["src/auth.ts"] }),
      outcome({ model: "b/cheap-builder", passed: false, files: ["src/auth.ts"] }),
    ]);
    const text = insightsLines(cwd).join("\n");
    expect(text).toMatch(/^7 stories in 6 runs · \$1\.20 spent · 71% passed/);
    expect(text).toContain("hand-set: 7 of 20 stories recorded");
    expect(text).toMatch(/a\/builder\s+5 stories · 100% passed\s+· 1\.0 builds · \$0\.10\/point/);
    expect(text).toContain("src/auth.ts (2 failed stories)");
    expect(readFileSync(outcomesPath(cwd), "utf8").split("\n").filter(Boolean)).toHaveLength(7);
  });
});
