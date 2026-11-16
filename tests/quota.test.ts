import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordOutcomes } from "#src/engine/outcomes.js";
import { Catalog } from "#src/models/catalog.js";
import { parsePriceSource, priceBookPath, updatePriceBook } from "#src/models/price-book.js";
import { loadPriceIndex, priceFor } from "#src/models/prices.js";
import { blocked, pauseOnLimit, recordSpend } from "#src/models/quota.js";
import type { ModelInfo } from "#src/models/types.js";
import { createConcert } from "#src/orchestrator/concert.js";
import { pathCosts } from "#src/orchestrator/paths.js";
import { perform } from "#src/orchestrator/perform.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import { parseRef, type RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { CATALOG, MODELS, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

const is = (role: string) => (r: RunRequest) => r.systemFile.includes(`${role}-`);
const story = (id: string, over: object = {}) => ({ id, title: id, asA: "a user", iWant: id, soThat: "x", acceptance: ["x"], points: 2, complexity: 1, risk: 1, value: 1, tags: [], ...over });
const answer = (plan: string) => (r: RunRequest) => (is("scorer")(r) ? plan : is("critic")(r) ? "VERDICT: pass\nok" : is("conductor")(r) ? "VERDICT: ok\nok" : "STATUS: done\nok");

describe("accounts, windows and rate limits", () => {
  it("moves the calls after a spent window to another account, without one failed call", async () => {
    const plan = JSON.stringify({ summary: "two", stories: [story("one"), story("two", { dependsOn: ["one"] })] });
    const store = new Store();
    const scripted = scriptedRunner(answer(plan));
    const seen: { account: string; afterQuota: boolean; builder: boolean }[] = [];
    const runner: typeof scripted.runner = (req, onEvent) => {
      const afterQuota = store.get().log.some((e) => e.label === "Quota");
      seen.push({ account: parseRef(req.model).prefix, afterQuota, builder: !is("scorer")(req) && !is("critic")(req) && !is("conductor")(req) });
      return scripted.runner(req, onEvent);
    };
    const config = { ...testConfig(), limits: { b: { windowHours: 5, maxUsd: 0.0001 } } };
    const c = await createConcert({ config, catalog: CATALOG, store, runner, cwd: tempDir() });
    await scoreRequest(c, "two stories");
    await perform(c);
    expect(seen.some((s) => s.account === "b" && !s.afterQuota)).toBe(true);
    expect(seen.filter((s) => s.afterQuota).every((s) => s.account !== "b")).toBe(true);
    expect(seen.some((s) => s.afterQuota && s.builder)).toBe(true);
    expect([store.get().phase, store.get().ledger.fallbacks]).toEqual(["done", 0]);
  });

  it("pauses an account until the reset a rate-limit error names", () => {
    const resetAt = Math.floor(Date.now() / 1000) + 3600;
    expect(pauseOnLimit("claude-code", `Claude AI usage limit reached|${resetAt}`)).toBe(true);
    expect(blocked("claude-code", undefined)).toMatch(/^rate-limited until/);
    expect(pauseOnLimit("codex", "You've hit your usage limit. Try again in 2 hours.")).toBe(true);
    expect(blocked("codex", undefined)).toMatch(/^rate-limited until/);
    expect(pauseOnLimit("anthropic", "invalid model id")).toBe(false);
    expect(blocked("anthropic", undefined)).toBeNull();
  });

  it("counts only the spend inside the window", () => {
    recordSpend("ce-gpt", 3);
    expect(blocked("ce-gpt", { windowHours: 5, maxUsd: 5 })).toBeNull();
    recordSpend("ce-gpt", 2.5);
    expect(blocked("ce-gpt", { windowHours: 5, maxUsd: 5 })).toMatch(/\$5\.50 of its \$5 per 5 h window used/);
  });
});

describe("budgets", () => {
  async function run(budgets: object, opts: { cwd?: string; critic?: string } = {}) {
    const plan = JSON.stringify({ summary: "two", stories: [story("one"), story("two", { dependsOn: ["one"] })] });
    const store = new Store();
    const reply = (r: RunRequest) => (is("critic")(r) && opts.critic ? opts.critic : answer(plan)(r));
    const c = await createConcert({ config: { ...testConfig(), budgets }, catalog: CATALOG, store, runner: scriptedRunner(reply).runner, cwd: opts.cwd ?? tempDir() });
    await scoreRequest(c, "two stories");
    await perform(c);
    return store.get();
  }

  it("counts today's earlier runs against the daily budget, and not yesterday's", async () => {
    const spent = (at: number) => ({ at, runId: "earlier", tags: [], files: [], points: 1, score: 1, factors: {}, model: "a/swarm", critic: "", attempts: 1, passed: true, cost: 5 });
    const today = tempDir();
    recordOutcomes(today, [spent(Date.now())]);
    const stopped = await run({ day: 5 }, { cwd: today });
    expect([stopped.stories.one?.status, stopped.stories.two?.status]).toEqual(["skipped", "skipped"]);
    expect(stopped.error).toBe("daily budget reached, 2 stories not started");
    expect(stopped.log.filter((e) => e.label === "Budget" && e.result === "warning")).toHaveLength(1);
    const yesterday = tempDir();
    recordOutcomes(yesterday, [spent(Date.now() - 36 * 3_600_000)]);
    const ran = await run({ day: 5 }, { cwd: yesterday });
    expect([ran.stories.one?.status, ran.stories.two?.status]).toEqual(["passed", "passed"]);
  });

  it("caps each story on its own: a story that keeps failing review stops once it has spent its budget", async () => {
    const state = await run({ story: 0.000001 }, { critic: "VERDICT: fail\nnot yet" });
    expect(state.stories.one?.status).toBe("skipped");
    expect(state.log.some((e) => e.label === "Budget" && /story budget/.test(e.detail))).toBe(true);
  });
});

describe("prices and paths", () => {
  it("reads models.dev prices and ranks them between pi's registry and your own models", async () => {
    const source = { anthropic: { models: { "claude-opus-5-5": { cost: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 } }, free: {} } } };
    expect(parsePriceSource(source, "2026-11-16").providers.anthropic).toEqual({ "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } });
    await updatePriceBook(async () => new Response(JSON.stringify(source)), priceBookPath());
    const pi = tempDir();
    writeFileSync(join(pi, "models-store.json"), JSON.stringify({ anthropic: [{ id: "claude-opus-5-5", cost: { input: 9, output: 9, cacheRead: 9, cacheWrite: 9 } }] }));
    expect(priceFor(loadPriceIndex(pi), parseRef("claude-code/claude-opus-5-5"))?.input).toBe(4);
    mkdirSync(pi, { recursive: true });
    writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { anthropic: { models: [{ id: "claude-opus-5-5", cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } }] } } }));
    expect(priceFor(loadPriceIndex(pi), parseRef("claude-code/claude-opus-5-5"))?.input).toBe(1);
  });

  it("prices the plan on each way of reaching its models, with the /prefer that picks it", () => {
    const same = (ref: string): ModelInfo => ({ ...MODELS[1]!, ref, parsed: parseRef(ref) });
    const catalog = new Catalog([same("claude-code/m"), same("codex@proxy/m"), same("anthropic/m")]);
    const views = { s: { chain: ["claude-code/m"], critics: [] } } as never;
    const paths = pathCosts(catalog, { stories: [story("s")] as never, views });
    expect(paths.map((p) => [p.path, p.prefer, p.cost > 0])).toEqual([["subscriptions", "claude-code", true], ["profiles", "codex@proxy", true], ["api", "anthropic", true]]);
  });
});
