import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { median, sampleCount } from "../scripts/perf-bench.js";
import { createFixture, fixtureConcert, fixturePlan, performFixture, REQUEST } from "../scripts/perf-fixture.js";
import { scoreRequest } from "#src/orchestrator/score.js";

describe("performance harness", () => {
  it("reports medians without changing the samples", () => {
    const samples = [9, 1, 3];
    expect(median(samples)).toBe(3);
    expect(samples).toEqual([9, 1, 3]);
    expect(median([4, 2])).toBe(3);
    expect(() => median([])).toThrow(/empty sample/);
  });

  it("accepts sample counts and rejects invalid input", () => {
    expect(sampleCount([])).toBe(5);
    expect(sampleCount(["--samples", "3"])).toBe(3);
    for (const count of ["0", "-1", "NaN", "1.5", "Infinity"]) {
      expect(() => sampleCount([`--samples=${count}`])).toThrow(/positive integer/);
    }
    expect(() => sampleCount(["--unknown"])).toThrow();
  });

  it("scores and performs the independent fixture stories with real orchestration", async () => {
    const fixture = await createFixture();
    try {
      const { concert, calls } = await fixtureConcert(fixture.cwd);
      await scoreRequest(concert, REQUEST);
      expect(concert.store.get().phase).toBe("planned");
      expect(calls).toHaveLength(1);
      expect(concert.store.get().order).toHaveLength(fixturePlan().stories.length);
      let changes = concert.store.get().changes;
      let scans = 0;
      const unsubscribe = concert.store.subscribe(() => {
        if (changes === concert.store.get().changes) return;
        changes = concert.store.get().changes;
        scans += 1;
      });
      expect(await performFixture(concert)).toBe(fixturePlan().stories.length);
      unsubscribe();
      expect(scans).toBe(fixturePlan().stories.length);
      expect(changes).toHaveLength(fixture.untracked);
      expect(concert.store.get().phase).toBe("done");
      expect(calls).toHaveLength(19);
      expect(Object.values(concert.store.get().stories).every((s) => s.status === "passed")).toBe(true);
    } finally {
      fixture.cleanup();
    }
    expect(existsSync(fixture.cwd)).toBe(false);
  });

  it("rejects a fan-out without a scored plan and cleans up", async () => {
    const fixture = await createFixture();
    try {
      const { concert } = await fixtureConcert(fixture.cwd);
      await expect(performFixture(concert)).rejects.toThrow(/score a request first/);
    } finally {
      fixture.cleanup();
    }
    expect(existsSync(fixture.cwd)).toBe(false);
  });
});
