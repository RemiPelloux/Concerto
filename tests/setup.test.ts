import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRouting } from "../src/commands/setup.js";
import { parseConfig } from "../src/config/load.js";
import { estimateStory } from "../src/orchestrator/estimate.js";
import type { Detection } from "../src/setup/detect.js";
import { inferTier } from "../src/setup/tiers.js";
import { buildUserConfig, writeUserConfig } from "../src/setup/user-config.js";
import { CATALOG, tempDir } from "./fixtures.js";

const DETECTION: Detection = {
  claude: true,
  codex: true,
  pi: true,
  rtk: false,
  profiles: ["ce-gpt"],
  linked: [
    { ref: "codex@ce-gpt/gpt-6.1-sol", tier: 4, via: "Codex profile" },
    { ref: "claude-code/claude-opus-5-5", tier: 1, via: "Claude Code subscription" },
  ],
};

describe("onboarding", () => {
  it("knows the tiers of current model families and skips the rest", () => {
    expect(inferTier("claude-fable-5-2")).toBe(5);
    expect(inferTier("gpt-6.1-sol")).toBe(4);
    expect(inferTier("deepseek-v4-pro")).toBe(3);
    expect(inferTier("gpt-6-luna")).toBe(2);
    expect(inferTier("deepseek-v4-flash")).toBe(1);
    expect(inferTier("deepseek-v4-flash-vision-exp")).toBeNull();
    expect(inferTier("gpt-4o-mini")).toBeNull();
  });

  it("adds every linked model to the bundled config without overriding its tiers", () => {
    const config = buildUserConfig(DETECTION, "proxy");
    expect(config.models["codex@ce-gpt/gpt-6.1-sol"]).toEqual({ tier: 4 });
    expect(config.models["claude-code/claude-opus-5-5"]).toEqual({ tier: 4 });
    expect(config.prefer).toEqual(["ce-*", "codex@*"]);
    expect(config.routes.length).toBeGreaterThan(0);
  });

  it("accepts model ids that contain a slash and explains invalid configs", () => {
    const withSlash = { ...DETECTION, linked: [{ ref: "ghostcli/z-ai/glm-5.3[1m]", tier: 3, via: "pi" }] };
    expect(buildUserConfig(withSlash, "api").models["ghostcli/z-ai/glm-5.3[1m]"]).toEqual({ tier: 3 });
    expect(() => parseConfig({ models: { bad: { tier: 9 } } }, "x.json")).toThrow(/invalid config in x\.json:\n {2}models\.bad/);
  });

  it("writes an owner-only file that loads back", () => {
    const path = writeUserConfig(buildUserConfig(DETECTION, "api"), join(tempDir(), "concerto", "config.json"));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8")).prefer).toEqual(["anthropic", "openai", "deepseek"]);
  });

  it("accepts only known routings", () => {
    expect(parseRouting(undefined)).toBe("subscriptions");
    expect(parseRouting("proxy")).toBe("proxy");
    expect(() => parseRouting("cheapest")).toThrow(/subscriptions, proxy, api/);
  });
});

describe("estimate", () => {
  it("grows with points and model price, and is zero without a price", () => {
    const cheap = estimateStory(2, CATALOG.get("a/swarm"), CATALOG.get("a/swarm"));
    const dear = estimateStory(2, CATALOG.get("a/brain"), CATALOG.get("a/swarm"));
    expect(cheap).toBeGreaterThan(0);
    expect(dear).toBeGreaterThan(cheap);
    expect(estimateStory(4, CATALOG.get("a/swarm"), undefined)).toBeCloseTo(2 * estimateStory(2, CATALOG.get("a/swarm"), undefined));
    expect(estimateStory(3, CATALOG.get("c/unpriced"), undefined)).toBe(0);
  });
});
