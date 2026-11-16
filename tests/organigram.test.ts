import { describe, expect, it } from "vitest";
import { Catalog } from "#src/models/catalog.js";
import type { ModelInfo } from "#src/models/types.js";
import { reviewChain, roleChain, routeStory } from "#src/models/router.js";
import { parseRef } from "#src/runner/types.js";
import type { Detection } from "#src/setup/detect.js";
import { organigramLines, proposeRoles } from "#src/setup/organigram.js";
import { sourceLines } from "#src/setup/sources.js";
import { MODELS, testConfig } from "#tests/fixtures.js";

const cheap = (ref: string, tier: number): ModelInfo => ({ ref, parsed: parseRef(ref), tier, price: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0 }, costFactor: 1 });
const CHEAP = [cheap("ce-deepseek/deepseek-v4-pro", 3), cheap("ce-grok/grok-4.7", 3), cheap("anthropic/claude-haiku-5-5", 2), cheap("codex/gpt-6.1-terra", 4)];
const MIXED = new Catalog([...MODELS, ...CHEAP]);
const isCheap = (ref: string) => CHEAP.some((m) => m.ref === ref);
const ANY = 101;

describe("brain roles", () => {
  it("never plan, score, review or build hard stories on a low-cost model, even the cheapest one", () => {
    for (const role of ["conductor", "scorer", "critic", "soloist"] as const) {
      expect(roleChain(MIXED, testConfig(), role).map((m) => m.ref).filter(isCheap)).toEqual([]);
    }
    expect(routeStory({ score: 70, tags: [] }, MIXED, testConfig()).chain.map((m) => m.ref).filter(isCheap)).toEqual([]);
  });

  it("skips a low-cost model a config names for a brain role or a review", () => {
    const config = testConfig();
    config.roles.critic.models = ["ce-grok/grok-4.7", "a/checker"];
    config.reviews = [{ tags: [], minScore: 0, maxScore: ANY, models: ["codex/gpt-6.1-terra"] }];
    expect(roleChain(MIXED, config, "critic")[0]?.ref).toBe("a/checker");
    expect(reviewChain({ score: 10, tags: [] }, MIXED, config).map((m) => m.ref).filter(isCheap)).toEqual([]);
  });

  it("lets the section build light stories on the low-cost models", () => {
    expect(roleChain(MIXED, testConfig(), "section").map((m) => m.ref).some(isCheap)).toBe(true);
    expect(isCheap(routeStory({ score: 10, tags: [] }, MIXED, testConfig()).chain[0]?.ref ?? "")).toBe(true);
  });

  it("fails with a clear message when only low-cost models are reachable", () => {
    expect(() => roleChain(new Catalog(CHEAP), testConfig(), "conductor")).toThrow(/conductor needs a premium model/);
  });
});

describe("organigram", () => {
  it("proposes premium models for brain roles and the cheapest able model for the section", () => {
    const roles = proposeRoles(testConfig().roles, MIXED);
    expect(roles.conductor.models).toEqual(["a/brain"]);
    expect(roles.critic.models.filter(isCheap)).toEqual([]);
    expect(roles.soloist.models[0]).toBe("b/cheap-builder");
    expect(isCheap(roles.section.models[0] ?? "")).toBe(true);
    expect(proposeRoles(testConfig().roles, new Catalog(CHEAP)).conductor.models).toEqual([]);
  });

  it("draws the conductor on top and every other role under it", () => {
    const config = { ...testConfig(), roles: proposeRoles(testConfig().roles, MIXED) };
    const lines = organigramLines(MIXED, config);
    expect(lines[0]).toMatch(/^conductor\s+a\/brain\s+plans/);
    expect(lines[4]).toMatch(/^└─ section/);
    expect(organigramLines(new Catalog(CHEAP), testConfig())[0]).toContain("(none reachable)");
  });
});

describe("machine scan", () => {
  it("lists the API keys it found by name, never by value", () => {
    const none: Detection = { claude: false, codex: false, pi: false, rtk: false, profiles: [], linked: [] };
    const lines = sourceLines(none, { CE_GPT_KEY: "sk-secret-value", OPENAI_API_KEY: "sk-other", SHODAN_API_KEY: "x", HOME: "/h" });
    expect(lines.join("\n")).toContain("CE_GPT_KEY, OPENAI_API_KEY");
    expect(lines.join("\n")).not.toMatch(/secret|sk-|SHODAN/);
    expect(lines[0]).toMatch(/Claude Code\s+not installed/);
  });
});
