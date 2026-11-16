import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import type { ConcertoConfig } from "#src/config/types.js";
import { Catalog } from "#src/models/catalog.js";
import type { ModelInfo } from "#src/models/types.js";
import { parseRef, type Runner, type RunRequest } from "#src/runner/types.js";

const price = (input: number, output: number) => ({ input, output, cacheRead: input / 10, cacheWrite: input * 1.25 });

function model(ref: string, tier: number, p: ReturnType<typeof price> | null): ModelInfo {
  return { ref, parsed: parseRef(ref), tier, price: p, costFactor: 1 };
}

export const MODELS: ModelInfo[] = [
  model("a/brain", 5, price(8, 40)),
  model("a/builder", 4, price(4, 20)),
  model("proxy/builder", 4, price(4, 20)),
  model("b/cheap-builder", 4, price(2, 10)),
  model("a/checker", 3, price(2, 10)),
  model("a/swarm", 2, price(0.1, 0.5)),
  model("c/unpriced", 1, null),
];
export const CATALOG = new Catalog(MODELS);

/** Owner-only (0600). Windows has no Unix permission bits, so there is nothing to check there. */
export function expectOwnerOnly(path: string): void {
  if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "concerto-"));
}

export function testConfig(): ConcertoConfig {
  const role = (minTier: number) => ({ minTier, effort: "medium" as const, tools: [], models: [] });
  return {
    models: Object.fromEntries(MODELS.map((m) => [m.ref, { tier: m.tier }])),
    roles: { conductor: role(5), scorer: role(3), soloist: role(4), critic: role(3), section: role(1) },
    routes: [],
    reviews: [],
    customRoles: [],
    policy: { protectedPaths: [], blockedModels: [], requireReview: [] },
    notify: [],
    sandbox: { enabled: false, allowHosts: [], hide: [] },
    ui: { theme: "default", keys: {}, language: "auto" },
    prefer: [],
    timeoutMinutes: 1,
    skills: [],
    swarm: { maxParallel: 3 },
    isolation: "worktree",
    limits: {},
    budgets: {},
    checks: { test: false, typecheck: false, lint: false, timeoutMinutes: 1 },
    cache: { dir: ".concerto/cache", ttlHours: 1, maxEntries: 50 },
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

/** Stands in for the agent CLIs, the third-party boundary, and records every request. */
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
