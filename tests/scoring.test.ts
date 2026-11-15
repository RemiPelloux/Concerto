import { describe, expect, it } from "vitest";
import { NO_IMPACT, type Impact } from "#src/engine/impact.js";
import { effortFor } from "#src/models/router.js";
import { scoreStory } from "#src/orchestrator/scoring.js";

const STORY = { points: 3, complexity: 3, risk: 2, uncertainty: 2, tags: [] as string[] };

function impact(patch: Partial<Impact>): Impact {
  return { ...NO_IMPACT, files: ["src/a.ts"], sourceFiles: 1, source: "imports", ...patch };
}

describe("scoring", () => {
  it("runs from 0 for a trivial story to 100 for the hardest one", () => {
    expect(scoreStory({ points: 1, complexity: 1, risk: 1, uncertainty: 1, tags: [] }).score).toBe(0);
    expect(scoreStory({ points: 13, complexity: 5, risk: 5, uncertainty: 5, tags: [] }).score).toBe(100);
    const worst = impact({ files: Array.from({ length: 48 }, (_, i) => `f${i}.ts`), direct: 48, indirect: 48, tests: Array.from({ length: 32 }, (_, i) => `t${i}`), sourceFiles: 48, untested: 48, lines: 9000, churn: 99, areas: 9 });
    expect(scoreStory({ points: 13, complexity: 5, risk: 5, uncertainty: 5, tags: [] }, worst).score).toBe(100);
  });

  it("uses the model's four factors alone when no file is known, reweighted to fill", () => {
    const alone = scoreStory(STORY);
    expect(alone.factors.map((f) => f.key)).toEqual(["complexity", "risk", "effort", "uncertainty"]);
    expect(alone.factors.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1);
    expect(scoreStory(STORY, NO_IMPACT)).toEqual(alone);
  });

  it("separates stories the model rates the same by what they reach", () => {
    const quiet = scoreStory(STORY, impact({ direct: 0, tests: ["t.test.ts"], lines: 40 })).score;
    const wide = scoreStory(STORY, impact({ direct: 14, indirect: 30, tests: Array.from({ length: 12 }, (_, i) => `t${i}`), lines: 1800, churn: 25, areas: 3 })).score;
    const untested = scoreStory(STORY, impact({ direct: 0, untested: 1, lines: 40 })).score;
    expect(wide).toBeGreaterThan(quiet + 15);
    expect(untested).toBeGreaterThan(quiet);
  });

  it("puts a floor under risk for sensitive code and says why", () => {
    const plain = scoreStory(STORY, impact({}));
    const auth = scoreStory(STORY, impact({ sensitive: ["src/auth/session.ts"] }));
    const tagged = scoreStory({ ...STORY, tags: ["security"] });
    expect(auth.score).toBeGreaterThan(plain.score);
    expect(auth.reasons[0]).toBe("touches src/auth/session.ts");
    expect(tagged.factors.find((f) => f.key === "risk")?.value).toBe(0.75);
  });

  it("explains the score with its largest contributions", () => {
    const b = scoreStory({ ...STORY, complexity: 5 }, impact({ direct: 20, untested: 1 }));
    expect(b.reasons).toHaveLength(3);
    expect(b.reasons).toContain("complexity 5/5");
  });

  it("maps scores to effort bands", () => {
    expect([0, 24, 25, 49, 50, 74, 75, 100].map(effortFor)).toEqual(["low", "low", "medium", "medium", "high", "high", "xhigh", "xhigh"]);
  });
});
