import { describe, expect, it } from "vitest";
import { executionWaves, parsePlan, scoreStory } from "../src/orchestrator/plan.js";
import { PLAN_REPLY } from "./fixtures.js";

describe("plan", () => {
  it("parses a fenced JSON reply", () => {
    const plan = parsePlan("Here you go:\n```json\n" + PLAN_REPLY + "\n```");
    expect(plan.stories.map((s) => s.id)).toEqual(["route", "auth"]);
  });

  it("rejects points outside the Fibonacci scale", () => {
    const bad = PLAN_REPLY.replace('"points":2', '"points":4');
    expect(() => parsePlan(bad)).toThrow(/points must be/);
  });

  it("rejects a reply with no JSON", () => {
    expect(() => parsePlan("I could not do it")).toThrow(/did not return a JSON plan/);
  });

  it("scores from 0 for trivial to 100 for the hardest story", () => {
    expect(scoreStory({ points: 1, complexity: 1, risk: 1 })).toBe(0);
    expect(scoreStory({ points: 13, complexity: 5, risk: 5 })).toBe(100);
    expect(scoreStory({ points: 8, complexity: 4, risk: 5 })).toBe(84);
  });

  it("runs dependents in a later wave", () => {
    const waves = executionWaves(parsePlan(PLAN_REPLY).stories).map((w) => w.map((s) => s.id));
    expect(waves).toEqual([["route"], ["auth"]]);
  });

  it("breaks a dependency cycle instead of looping", () => {
    const stories = parsePlan(PLAN_REPLY).stories.map((s) => ({ ...s, dependsOn: s.id === "route" ? ["auth"] : ["route"] }));
    expect(executionWaves(stories)).toHaveLength(2);
  });
});
