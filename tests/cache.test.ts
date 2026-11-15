import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cacheHitRatio, EMPTY_LEDGER, record } from "../src/cache/ledger.js";
import { systemPromptFile } from "../src/cache/prefix.js";
import { ResponseCache } from "../src/cache/response-cache.js";
import { CATALOG } from "./fixtures.js";

const tmp = () => mkdtempSync(join(tmpdir(), "concerto-"));

describe("cache", () => {
  it("returns a stored response until it expires", () => {
    const dir = tmp();
    const cache = new ResponseCache(dir, 1);
    const key = cache.key(["model", "prompt"]);
    cache.set(key, { text: "hi", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0 }, turns: 1 });
    expect(cache.get(key)?.text).toBe("hi");
    expect(new ResponseCache(dir, 0).get(key)).toBeNull();
    expect(cache.get(cache.key(["model", "other"]))).toBeNull();
  });

  it("writes a byte-stable system prompt per role", () => {
    const cwd = tmp();
    const first = systemPromptFile("critic", cwd);
    expect(systemPromptFile("critic", cwd)).toBe(first);
    expect(systemPromptFile("soloist", cwd)).not.toBe(first);
    expect(readFileSync(first, "utf8")).toMatch(/You are the critic/);
  });

  it("prices usage, the solo baseline and cache savings", () => {
    const usage = { input: 1_000_000, output: 0, cacheRead: 1_000_000, cacheWrite: 0, cost: 0 };
    const [brain, swarm] = [CATALOG[0]!, CATALOG[4]!];
    const ledger = record(EMPTY_LEDGER, { usage, price: swarm.price, brain: brain.price });
    expect(ledger.usage.cost).toBeCloseTo(0.11);
    expect(ledger.soloCost).toBeCloseTo(8.8);
    expect(ledger.cacheSaved).toBeCloseTo(0.09);
    expect(cacheHitRatio(ledger.usage)).toBe(0.5);
  });
});
