import type { ConcertoConfig } from "../src/config/types.js";
import type { ModelInfo } from "../src/models/types.js";
import type { Runner, RunRequest } from "../src/runner/types.js";

const price = (input: number, output: number) => ({ input, output, cacheRead: input / 10, cacheWrite: input * 1.25 });

export const CATALOG: ModelInfo[] = [
  { ref: "a/brain", contextK: 1000, tier: 5, price: price(8, 40), costFactor: 1 },
  { ref: "a/builder", contextK: 1000, tier: 4, price: price(4, 20), costFactor: 1 },
  { ref: "b/cheap-builder", contextK: 272, tier: 4, price: price(2, 10), costFactor: 1 },
  { ref: "a/checker", contextK: 1000, tier: 3, price: price(2, 10), costFactor: 1 },
  { ref: "a/swarm", contextK: 1000, tier: 2, price: price(0.1, 0.5), costFactor: 1 },
  { ref: "c/unpriced", contextK: 128, tier: 1, price: null, costFactor: 1 },
];

export function testConfig(): ConcertoConfig {
  const role = (minTier: number) => ({ minTier, effort: "medium" as const, tools: [], models: [] });
  return {
    models: Object.fromEntries(CATALOG.map((m) => [m.ref, { tier: m.tier }])),
    roles: { conductor: role(5), scorer: role(3), soloist: role(4), critic: role(3), section: role(1) },
    routes: [],
    reviews: [],
    skills: [],
    swarm: { maxParallel: 3 },
    cache: { dir: ".concerto/cache", ttlHours: 1 },
  };
}

export const PLAN_REPLY = JSON.stringify({
  summary: "Add a health endpoint",
  stories: [
    { id: "route", title: "Add /health route", asA: "an operator", iWant: "a health route", soThat: "I can probe it", acceptance: ["GET /health returns 200"], points: 2, complexity: 1, risk: 1, value: 3, tags: ["backend"] },
    { id: "auth", title: "Protect admin routes", asA: "an admin", iWant: "auth", soThat: "data stays safe", acceptance: ["401 without token"], points: 8, complexity: 4, risk: 5, value: 5, tags: ["security"], dependsOn: ["route"] },
  ],
});

export type Scripted = { calls: RunRequest[]; runner: Runner };

/** Stands in for the pi subprocess, the third-party boundary, and records each request. */
export function scriptedRunner(reply: (req: RunRequest) => string): Scripted {
  const calls: RunRequest[] = [];
  const runner: Runner = async (req, onEvent) => {
    calls.push(req);
    onEvent({ kind: "tool", name: "read", detail: "src/index.ts" });
    const usage = { input: 100, output: 50, cacheRead: 900, cacheWrite: 0, cost: 0 };
    return { text: reply(req), usage, turns: 1 };
  };
  return { calls, runner };
}
