import { describe, expect, it } from "vitest";
import { blendedPrice, modelForRole, pickModel, requiredTier, reviewerFor, routeStory } from "../src/models/router.js";
import { CATALOG, testConfig } from "./fixtures.js";

function routedConfig() {
  const config = testConfig();
  config.routes = [
    { name: "ux-build", tags: ["ui"], minScore: 0, role: "soloist", models: ["x/missing", "a/builder"], effort: "high" },
    { name: "complex-build", tags: [], minScore: 55, role: "soloist", models: ["a/builder"], effort: "high" },
    { name: "light-build", tags: [], minScore: 0, role: "section", models: ["b/cheap-builder"], effort: "medium" },
  ];
  config.reviews = [{ tags: ["ui"], models: ["a/brain"] }];
  return config;
}

describe("router", () => {
  it("picks the cheapest model that meets the tier", () => {
    expect(pickModel(CATALOG, 4).ref).toBe("b/cheap-builder");
    expect(pickModel(CATALOG, 5).ref).toBe("a/brain");
    expect(pickModel(CATALOG, 1).ref).toBe("a/swarm");
  });

  it("weighs subscriptions by their cost factor", () => {
    const prepaid = CATALOG.map((m) => (m.ref === "a/builder" ? { ...m, costFactor: 0.25 } : m));
    expect(pickModel(prepaid, 4).ref).toBe("a/builder");
    expect(blendedPrice({ ...CATALOG[5]! })).toBe(Number.POSITIVE_INFINITY);
  });

  it("falls back to the strongest model when no model meets the tier", () => {
    expect(pickModel(CATALOG.filter((m) => m.tier <= 3), 5).ref).toBe("a/checker");
    expect(() => pickModel([], 1)).toThrow(/No configured model/);
  });

  it("sends UI stories and hard stories to the builder route, the rest to the light route", () => {
    const config = routedConfig();
    expect(routeStory({ score: 10, tags: ["ui"] }, CATALOG, config)).toMatchObject({ rule: "ux-build", role: "soloist" });
    expect(routeStory({ score: 70, tags: [] }, CATALOG, config).model.ref).toBe("a/builder");
    expect(routeStory({ score: 20, tags: ["api"] }, CATALOG, config)).toMatchObject({ rule: "light-build", effort: "medium" });
  });

  it("skips a route whose models are all unreachable", () => {
    const config = routedConfig();
    config.routes = [{ name: "gone", tags: [], minScore: 0, role: "soloist", models: ["x/missing"], effort: "high" }];
    expect(routeStory({ score: 90, tags: [] }, CATALOG, config).rule).toBe("cheapest-tier");
    expect(requiredTier(90)).toBe(4);
  });

  it("gives UI stories their own reviewer and honours role preferences", () => {
    const config = routedConfig();
    expect(reviewerFor(["ui"], CATALOG, config).ref).toBe("a/brain");
    expect(reviewerFor(["api"], CATALOG, config).ref).toBe("b/cheap-builder");
    config.roles.critic.models = ["a/builder"];
    expect(modelForRole(CATALOG, config, "critic").ref).toBe("a/builder");
  });
});
