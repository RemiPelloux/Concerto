import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeReport } from "#src/engine/report.js";
import { Catalog } from "#src/models/catalog.js";
import type { ModelInfo } from "#src/models/types.js";
import { createConcert } from "#src/orchestrator/concert.js";
import { rolesFor } from "#src/orchestrator/custom-roles.js";
import { perform } from "#src/orchestrator/perform.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import { parseRef, type RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

const PRICE = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 };
const model = (ref: string, tier: number): ModelInfo => ({ ref, parsed: parseRef(ref), tier, price: ref.startsWith("ollama/") ? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } : PRICE, costFactor: 1 });

/** Five vendors behind five different CLIs, and a model on this machine. */
const REFS = {
  conductor: "claude-code/claude-opus-5-5",
  builder: "codex/gpt-6.1-sol",
  critic: "gemini/gemini-3-pro",
  section: "opencode/deepseek/deepseek-v4-pro",
  security: "goose/xai/grok-4",
  scorer: "ollama/qwen3:8b",
};
const CATALOG = new Catalog(Object.entries(REFS).map(([role, ref]) => model(ref, role === "scorer" ? 1 : 4)));

const story = (id: string, tags: string[], files: string[]) => ({ id, title: `Story ${id}`, asA: "a user", iWant: id, soThat: "x", acceptance: [`${id} works`], points: 2, complexity: 2, risk: 2, value: 2, tags, files });
const PLAN = JSON.stringify({ summary: "two stories", stories: [story("login", ["auth"], ["src/auth/login.ts"]), story("readme", [], ["README.md"])] });
const is = (r: RunRequest, name: string) => r.systemFile.includes(`${name}-`);

function config(cwd: string) {
  const base = testConfig();
  writeFileSync(join(cwd, "SECURITY_REVIEW.md"), "Fail the story if it logs a password or a token.");
  return {
    ...base,
    models: Object.fromEntries(CATALOG.models.map((m) => [m.ref, { tier: m.tier }])),
    roles: { ...base.roles, conductor: { ...base.roles.conductor, models: [REFS.conductor] }, scorer: { ...base.roles.scorer, minTier: 1, models: [REFS.scorer] }, critic: { ...base.roles.critic, models: [REFS.critic] }, soloist: { ...base.roles.soloist, models: [REFS.builder] }, section: { ...base.roles.section, minTier: 4, models: [REFS.builder] } },
    reviews: [{ tags: [], minScore: 0, maxScore: 101, models: [REFS.critic] }],
    routes: [{ name: "every story", tags: [], minScore: 0, maxScore: 101, role: "section" as const, models: [REFS.builder], effort: "auto" as const }],
    customRoles: [
      { name: "security", kind: "review" as const, instructions: "SECURITY_REVIEW.md", tags: ["auth"], paths: [], minScore: 0, models: [REFS.security], minTier: 3, effort: "medium" as const },
      { name: "docs", kind: "build" as const, instructions: "Update the docs for what the story changed.", tags: [], paths: ["src/**"], minScore: 0, models: [REFS.section], minTier: 3, effort: "low" as const },
    ],
  };
}

describe("a run across vendors, a local model and custom roles", () => {
  it("uses each of them, and the report accounts for every call", async () => {
    const cwd = tempDir();
    let securityRounds = 0;
    const scripted = scriptedRunner((r) => {
      if (is(r, "scorer")) return PLAN;
      if (is(r, "conductor")) return "VERDICT: ok\nok";
      if (is(r, "custom-security")) return (securityRounds += 1) === 1 ? "VERDICT: fail\nlogs the token on line 3" : "VERDICT: pass\nclean";
      if (is(r, "critic")) return "VERDICT: pass\nok";
      return "STATUS: done\nok";
    });
    const store = new Store();
    const c = await createConcert({ config: config(cwd), catalog: CATALOG, store, runner: scripted.runner, cwd });
    await scoreRequest(c, "login and readme");
    await perform(c);
    const used = new Set(scripted.calls.map((r) => r.model));
    expect([...used].sort()).toEqual(Object.values(REFS).sort());
    expect(new Set([...used].map((ref) => parseRef(ref).provider)).size).toBeGreaterThanOrEqual(6);
    expect(Object.values(store.get().stories).map((s) => s.status)).toEqual(["passed", "passed"]);
    const rebuilt = scripted.calls.filter((r) => !is(r, "scorer") && !is(r, "conductor") && !is(r, "critic") && !is(r, "custom") && r.prompt.includes("logs the token on line 3"));
    expect(rebuilt).toHaveLength(1);
    expect(scripted.calls.filter((r) => is(r, "custom-docs")).map((r) => r.cwd)).toHaveLength(1);
    expect(readFileSync(scripted.calls.find((r) => is(r, "custom-security"))?.systemFile ?? "", "utf8")).toMatch(/## Your role: security\n\nFail the story if it logs a password/);
    const report = readFileSync(writeReport(store.get(), { cwd, runId: c.runId }), "utf8");
    Object.values(REFS).forEach((ref) => expect(report).toContain(`| \`${ref}\` |`));
    expect(report).toContain(`| **All** | ${scripted.calls.length} |`);
  });

  it("applies a custom role by tag, by path glob and by score", async () => {
    const c = await createConcert({ config: config(tempDir()), catalog: CATALOG, store: new Store(), runner: scriptedRunner(() => PLAN).runner, cwd: tempDir() });
    const names = (s: ReturnType<typeof story>, kind: "review" | "build") => rolesFor(c, { ...s, uncertainty: 1, dependsOn: [], checks: [] }, kind).map((r) => r.name);
    expect(names(story("a", ["auth"], []), "review")).toEqual(["security"]);
    expect(names(story("b", [], ["lib/x.ts"]), "review")).toEqual([]);
    expect(names(story("c", [], ["src/deep/x.ts"]), "build")).toEqual(["docs"]);
    expect(names(story("d", [], ["docs/x.md"]), "build")).toEqual([]);
  });
});
