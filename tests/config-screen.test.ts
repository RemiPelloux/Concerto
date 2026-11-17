import { describe, expect, it } from "vitest";
import { MAX_SCORE } from "#src/config/types.js";
import { Catalog } from "#src/models/catalog.js";
import { nodeFields, settingsFields, shown, skillFields, stepped, typed } from "#src/ui/config/fields.js";
import { branchLine, moveOrg, organize, selectedSlot } from "#src/ui/config/org.js";
import { getIn, setIn } from "#src/ui/config/paths.js";
import { addModel, addRoute, chainMove, swapItems } from "#src/ui/config/actions.js";
import { modelFields } from "#src/ui/config/fields.js";
import { roleSlot } from "#src/ui/model-slots.js";
import { MODELS, testConfig } from "#tests/fixtures.js";

const CATALOG = new Catalog(MODELS);

function config() {
  const c = testConfig();
  c.routes = [
    { name: "ux-build", tags: ["ui"], minScore: 0, maxScore: MAX_SCORE + 1, role: "soloist", models: ["a/builder"], effort: "auto" },
    { name: "small-build", tags: [], minScore: 0, maxScore: 25, role: "section", models: ["a/builder"], effort: "auto" },
  ];
  c.reviews = [{ tags: [], minScore: 0, maxScore: MAX_SCORE + 1, models: ["a/brain"], effort: "auto" }];
  return c;
}

const field = (label: string) => settingsFields().find((f) => f.label.startsWith(label))!;

describe("config paths", () => {
  it("sets a value deep in a copy, creates missing objects and deletes on undefined", () => {
    const root = { a: { b: [1, 2] }, keep: true };
    expect(setIn(root, ["a", "b", 1], 9)).toEqual({ a: { b: [1, 9] }, keep: true });
    expect(root.a.b).toEqual([1, 2]);
    expect(setIn(root, ["x", "y"], 1)).toMatchObject({ x: { y: 1 } });
    expect(setIn(root, ["keep"], undefined)).toEqual({ a: { b: [1, 2] } });
    expect(getIn(root, ["a", "b", 0])).toBe(1);
    expect(getIn(root, ["nope", "deeper"])).toBeUndefined();
  });
});

describe("organigram", () => {
  it("hangs routes under their builder and reviews under the critic", () => {
    const org = organize(config());
    expect(org.top.key).toBe("conductor");
    expect(org.columns.map((c) => [c.head.key, c.leaves.map((l) => l.key)])).toEqual([
      ["rewriter", []],
      ["scorer", []],
      ["soloist", ["ux-build"]],
      ["section", ["small-build"]],
      ["critic", ["review-0"]],
    ]);
  });

  it("walks the chart with the arrows and never leaves it", () => {
    const org = organize(config());
    let at = { col: 0, row: -1 };
    at = moveOrg(org, at, "down");
    expect(selectedSlot(org, at).key).toBe("rewriter");
    expect(moveOrg(org, at, "left")).toEqual(at);
    at = moveOrg(org, at, "right");
    expect(selectedSlot(org, at).key).toBe("scorer");
    expect(moveOrg(org, at, "down")).toEqual(at);
    at = moveOrg(org, moveOrg(org, at, "right"), "down");
    expect(selectedSlot(org, at).key).toBe("ux-build");
    expect(selectedSlot(org, moveOrg(org, at, "left")).key).toBe("scorer");
    expect(selectedSlot(org, moveOrg(org, moveOrg(org, at, "up"), "up")).key).toBe("conductor");
  });

  it("joins the conductor in the middle to every column stem", () => {
    expect(branchLine(10)).toBe("     ┌─────────┬─────────┴─────────┬─────────┐");
    expect(branchLine(9)).toBe("    ┌────────┬────────┴────────┬────────┐");
  });
});

describe("config fields", () => {
  it("turns the budget off below its minimum and on again", () => {
    const budget = field("budget");
    const one = { ...config(), budgetUsd: 1 };
    expect(getIn(stepped(budget, one, -1), ["budgetUsd"])).toBeUndefined();
    expect(shown(budget, config(), CATALOG)).toBe("off");
    expect(getIn(stepped(budget, config(), 1), ["budgetUsd"])).toBe(1);
  });

  it("steps scores on their grid and shows the top as no limit", () => {
    const route = organize(config()).columns[2]!.leaves[0]!;
    const max = nodeFields(route).find((f) => f.label === "score under")!;
    expect(shown(max, config(), CATALOG)).toBe("no limit");
    expect(getIn(stepped(max, config(), -1), ["routes", 0, "maxScore"])).toBe(95);
  });

  it("splits typed lists on commas and lists one pair of fields per skill rule", () => {
    const gates = field("gates");
    expect(getIn(typed(gates, config(), " pnpm test,, pnpm lint "), ["gates"])).toEqual(["pnpm test", "pnpm lint"]);
    const c = { ...config(), skills: [{ tags: ["ui"], paths: ["~/a"] }] };
    expect(skillFields(c).map((f) => shown(f, c, CATALOG))).toEqual(["ui", "~/a"]);
  });
});

describe("config actions", () => {
  it("puts a new route first, tagged new, with the role's model", () => {
    const change = addRoute(config(), CATALOG, "section");
    if (typeof change === "string") throw new Error(change);
    expect(getIn(change.raw, ["routes", 0])).toMatchObject({ name: "route-3", role: "section", tags: ["new"] });
    expect(getIn(change.raw, ["routes", 0, "models"])).toHaveLength(1);
    expect(change.path).toEqual(["routes"]);
  });

  it("swaps two routes and moves a chain model, but not past either end", () => {
    expect(getIn(swapItems(config(), "routes", [0, 1]).raw, ["routes", 0, "name"])).toBe("small-build");
    const c = config();
    c.roles.critic.models = ["a/brain", "a/builder"];
    expect(getIn(chainMove(c, roleSlot("critic"), { index: 0, dir: 1 })?.raw, ["roles", "critic", "models"])).toEqual(["a/builder", "a/brain"]);
    expect(chainMove(c, roleSlot("critic"), { index: 1, dir: 1 })).toBeNull();
  });

  it("refuses a model already listed and steps cost factors without float noise", () => {
    expect(addModel(config(), "a/brain")).toBe("a/brain is already listed.");
    const cost = modelFields(config(), CATALOG).find((f) => f.label.trim() === "cost factor")!;
    const once = stepped(cost, config(), 1);
    expect(getIn(once, ["models", "a/brain", "costFactor"])).toBe(0);
    const tenths = [1, 1, 1].reduce((c) => stepped(cost, c as ReturnType<typeof config>, 1), once);
    expect(getIn(tenths, ["models", "a/brain", "costFactor"])).toBe(0.3);
  });
});
