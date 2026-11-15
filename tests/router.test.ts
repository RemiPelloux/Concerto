import { describe, expect, it } from "vitest";
import { Catalog } from "../src/models/catalog.js";
import { blendedPrice, preferFirst, requiredTier, reviewChain, roleChain, routeStory, tierChain } from "../src/models/router.js";
import { CATALOG, MODELS, testConfig } from "./fixtures.js";

const refs = (models: { ref: string }[]) => models.map((m) => m.ref);

function routedConfig() {
  const config = testConfig();
  config.routes = [
    { name: "ux-build", tags: ["ui"], minScore: 0, role: "soloist", models: ["x/missing", "a/builder", "proxy/builder"], effort: "high" },
    { name: "complex-build", tags: [], minScore: 55, role: "soloist", models: ["a/builder"], effort: "high" },
    { name: "light-build", tags: [], minScore: 0, role: "section", models: ["b/cheap-builder"], effort: "medium" },
  ];
  config.reviews = [{ tags: ["ui"], models: ["a/brain"] }];
  return config;
}

describe("catalog", () => {
  it("looks models up by ref and keeps only reachable ones, in order, once", () => {
    expect(CATALOG.get("a/brain")?.tier).toBe(5);
    expect(refs(CATALOG.reachable(["x/missing", "a/swarm", "a/brain", "a/swarm"]))).toEqual(["a/swarm", "a/brain"]);
  });
});

describe("router", () => {
  it("orders a tier chain by blended price, cheapest first", () => {
    expect(refs(tierChain(CATALOG, 4))[0]).toBe("b/cheap-builder");
    expect(refs(tierChain(CATALOG, 5))).toEqual(["a/brain"]);
    expect(blendedPrice(MODELS[6]!)).toBe(Number.POSITIVE_INFINITY);
  });

  it("weighs prepaid subscriptions by their cost factor", () => {
    const prepaid = new Catalog(MODELS.map((m) => (m.ref === "a/builder" ? { ...m, costFactor: 0.25 } : m)));
    expect(tierChain(prepaid, 4)[0]?.ref).toBe("a/builder");
  });

  it("falls back to the strongest models when none meets the tier, and fails on an empty catalog", () => {
    const weak = new Catalog(MODELS.filter((m) => m.tier <= 3));
    expect(tierChain(weak, 5)[0]?.ref).toBe("a/checker");
    expect(() => roleChain(new Catalog([]), testConfig(), "critic")).toThrow(/No configured model/);
  });

  it("routes UI and hard stories to the builder route and the rest to the light route", () => {
    const config = routedConfig();
    expect(routeStory({ score: 10, tags: ["ui"] }, CATALOG, config)).toMatchObject({ rule: "ux-build", role: "soloist" });
    expect(routeStory({ score: 70, tags: [] }, CATALOG, config).chain[0]?.ref).toBe("a/builder");
    expect(routeStory({ score: 20, tags: ["api"] }, CATALOG, config)).toMatchObject({ rule: "light-build", effort: "medium" });
    expect(requiredTier(90)).toBe(4);
  });

  it("keeps the route's tier for fallbacks and caps the chain", () => {
    const chain = routeStory({ score: 10, tags: ["ui"] }, CATALOG, routedConfig()).chain;
    expect(chain.every((m) => m.tier >= 4)).toBe(true);
    expect(chain.length).toBeLessThanOrEqual(4);
  });

  it("skips a route whose models are all unreachable", () => {
    const config = routedConfig();
    config.routes = [{ name: "gone", tags: [], minScore: 0, role: "soloist", models: ["x/missing"], effort: "high" }];
    expect(routeStory({ score: 90, tags: [] }, CATALOG, config).rule).toBe("cheapest-tier");
  });

  it("prefers a provider for the same model without swapping the model", () => {
    const ordered = preferFirst(CATALOG.reachable(["a/builder", "proxy/builder", "a/checker"]), ["proxy"]);
    expect(refs(ordered)).toEqual(["proxy/builder", "a/builder", "a/checker"]);
    expect(refs(preferFirst(CATALOG.reachable(["a/brain", "a/builder"]), ["pro*"]))).toEqual(["a/brain", "a/builder"]);
  });

  it("gives UI stories their own reviewer and honours role preferences", () => {
    const config = routedConfig();
    expect(reviewChain(["ui"], CATALOG, config)[0]?.ref).toBe("a/brain");
    expect(reviewChain(["api"], CATALOG, config)[0]?.ref).toBe("b/cheap-builder");
    config.roles.critic.models = ["a/builder"];
    expect(roleChain(CATALOG, config, "critic")[0]?.ref).toBe("a/builder");
  });
});
