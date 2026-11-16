import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRouting } from "#src/commands/setup.js";
import { parseConfig } from "#src/config/load.js";
import { estimateStory } from "#src/orchestrator/estimate.js";
import type { Detection } from "#src/setup/detect.js";
import { inferTier } from "#src/setup/tiers.js";
import { buildUserConfig, writeUserConfig } from "#src/setup/user-config.js";
import { isBroken, readHealth, saveHealth } from "#src/models/health.js";
import type { Runner } from "#src/runner/types.js";
import { ZERO_USAGE } from "#src/runner/usage.js";
import { probeModels, redact } from "#src/setup/probe.js";
import { CATALOG, expectOwnerOnly, tempDir } from "#tests/fixtures.js";

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

const WORKING = new Set(["codex@ce-gpt/gpt-6.1-sol", "claude-code/claude-opus-5-5"]);

describe("probes", () => {
  it("records which models answer, failing errors and wrong answers", async () => {
    const runner: Runner = async (req) => {
      if (req.model === "a/down") throw new Error("401 Unauthorized\nmore detail");
      return { text: req.model === "a/odd" ? "I cannot do that" : "OK", usage: ZERO_USAGE, turns: 1 };
    };
    const seen: string[] = [];
    const health = await probeModels(["a/up", "a/down", "a/odd", "a/up"], { runner, concurrency: 2, onResult: (ref) => seen.push(ref) });
    expect(Object.fromEntries(Object.entries(health).map(([ref, c]) => [ref, c.ok]))).toEqual({ "a/up": true, "a/down": false, "a/odd": false });
    expect(health["a/down"]?.error).toBe("401 Unauthorized");
    expect(seen.sort()).toEqual(["a/down", "a/odd", "a/up"]);
  });

  it("redacts key prefixes and client IPs from provider errors", () => {
    const raw = 'Incorrect API key provided: sk-a5f13******** from 88.185.86.131 and 2a01:e0a:e55:a0f0:59b9:1683:aa:1';
    expect(redact(raw)).toBe("Incorrect API key provided: [key] from [ip] and [ip]");
  });

  it("keeps a failed model out of routing for a day, then retries it", () => {
    const now = Date.now();
    const health = { "a/x": { ok: false, checkedAt: now - 1000, error: "e" }, "a/y": { ok: true, checkedAt: now, error: "" } };
    expect(isBroken(health, "a/x", now)).toBe(true);
    expect(isBroken(health, "a/y", now)).toBe(false);
    expect(isBroken(health, "a/x", now + 25 * 3_600_000)).toBe(false);
    const path = join(tempDir(), "health.json");
    saveHealth({ "a/x": health["a/x"] }, path);
    expect(readHealth(saveHealth({ "a/y": health["a/y"] }, path) && path)).toEqual(health);
  });
});

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

  it("keeps only the models that answered their probe, without overriding bundled tiers", () => {
    const config = buildUserConfig(DETECTION, "proxy", WORKING);
    expect(Object.keys(config.models).sort()).toEqual([...WORKING].sort());
    expect(config.models["codex@ce-gpt/gpt-6.1-sol"]).toEqual({ tier: 4 });
    expect(config.models["claude-code/claude-opus-5-5"]).toEqual({ tier: 4 });
    expect(config.prefer).toEqual(["ce-*", "codex@*"]);
    expect(config.routes.length).toBeGreaterThan(0);
  });

  it("accepts model ids that contain a slash and explains invalid configs", () => {
    const withSlash = { ...DETECTION, linked: [{ ref: "ghostcli/z-ai/glm-5.3[1m]", tier: 3, via: "pi" }] };
    expect(buildUserConfig(withSlash, "api", new Set(["ghostcli/z-ai/glm-5.3[1m]"])).models["ghostcli/z-ai/glm-5.3[1m]"]).toEqual({ tier: 3 });
    expect(() => parseConfig({ models: { bad: { tier: 9 } } }, "x.json")).toThrow(/invalid config in x\.json:\n {2}models\.bad/);
  });

  it("writes an owner-only file that loads back", () => {
    const path = writeUserConfig(buildUserConfig(DETECTION, "api", WORKING), join(tempDir(), "concerto", "config.json"));
    expectOwnerOnly(path);
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
    const cheap = estimateStory({ points: 2, builder: CATALOG.get("a/swarm"), critic: CATALOG.get("a/swarm") });
    const dear = estimateStory({ points: 2, builder: CATALOG.get("a/brain"), critic: CATALOG.get("a/swarm") });
    expect(cheap).toBeGreaterThan(0);
    expect(dear).toBeGreaterThan(cheap);
    const at = (points: number, ref: string) => estimateStory({ points, builder: CATALOG.get(ref), critic: undefined });
    expect(at(4, "a/swarm")).toBeCloseTo(2 * at(2, "a/swarm"));
    expect(at(3, "c/unpriced")).toBe(0);
  });
});
