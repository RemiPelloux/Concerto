import { describe, expect, it } from "vitest";
import { executionWaves, parsePlan, scoreStory, type Story } from "../src/orchestrator/plan.js";
import { PLAN_REPLY } from "./fixtures.js";

const ids = (waves: Story[][]) => waves.map((w) => w.map((s) => s.id));

function story(id: string, dependsOn: string[] = []): Story {
  return { ...parsePlan(PLAN_REPLY).stories[0]!, id, dependsOn };
}

describe("plan", () => {
  it("parses a fenced JSON reply", () => {
    const plan = parsePlan("Here you go:\n```json\n" + PLAN_REPLY + "\n```");
    expect(plan.stories.map((s) => s.id)).toEqual(["route", "auth"]);
  });

  it("rejects points outside the Fibonacci scale, unsafe ids and duplicate ids", () => {
    expect(() => parsePlan(PLAN_REPLY.replace('"points":2', '"points":4'))).toThrow(/points must be/);
    expect(() => parsePlan(PLAN_REPLY.replace('"id":"route"', '"id":"../../etc"'))).toThrow(/kebab-case/);
    expect(() => parsePlan(PLAN_REPLY.replace('"id":"auth"', '"id":"route"'))).toThrow(/unique/);
  });

  it("rejects a reply with no JSON", () => {
    expect(() => parsePlan("I could not do it")).toThrow(/did not return a JSON plan/);
  });

  it("scores from 0 for trivial to 100 for the hardest story", () => {
    expect(scoreStory({ points: 1, complexity: 1, risk: 1 })).toBe(0);
    expect(scoreStory({ points: 13, complexity: 5, risk: 5 })).toBe(100);
    expect(scoreStory({ points: 8, complexity: 4, risk: 5 })).toBe(84);
  });

  it("groups independent stories into one wave and dependents into later ones", () => {
    const waves = executionWaves([story("a"), story("b"), story("c", ["a"]), story("d", ["c", "b"]), story("e", ["missing", "e"])]);
    expect(ids(waves)).toEqual([["a", "b", "e"], ["c"], ["d"]]);
  });

  it("breaks a dependency cycle instead of looping", () => {
    const waves = executionWaves([story("x", ["y"]), story("y", ["x"]), story("z", ["y"])]);
    expect(ids(waves).flat().sort()).toEqual(["x", "y", "z"]);
    expect(waves.length).toBe(3);
  });
});
