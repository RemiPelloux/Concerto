import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approxTokens } from "#src/engine/condense.js";
import { contextPack, PACK_TOKENS } from "#src/engine/context-pack.js";
import { contentWords, sameRequest } from "#src/engine/similar.js";
import { planExcerpt } from "#src/orchestrator/briefs.js";
import { createConcert } from "#src/orchestrator/concert.js";
import { perform } from "#src/orchestrator/perform.js";
import { parsePlan } from "#src/orchestrator/plan.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import type { RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { createFixture } from "#scripts/perf-fixture.js";
import { CATALOG, PLAN_REPLY, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

const is = (role: string) => (r: RunRequest) => r.systemFile.includes(`${role}-`);
/** Prompt tokens Concerto 0.4 sent for this exact run, measured before Sprint 6. */
const BASELINE_04 = 7079;
const NO_CHECKS = { test: false as const, typecheck: false as const, lint: false as const, timeoutMinutes: 1 };

const tenStories = () => Array.from({ length: 10 }, (_, i) => ({
  id: `s${i}`, title: `Rename value in module ${i * 20}`, asA: "a maintainer", iWant: `module ${i * 20} to export a clearer name`, soThat: "readers understand it",
  acceptance: [`src/module-${i * 20}.ts exports \`count\` instead of \`value\``, "every importer still builds"], points: 2, complexity: 2, risk: 2, value: 2,
  tags: ["backend"], files: [`src/module-${i * 20}.ts`, `src/module-${i * 20 + 1}.ts`], dependsOn: i > 0 && i % 3 === 0 ? [`s${i - 1}`] : [],
}));

describe("token engine", () => {
  it("sends 30% fewer prompt tokens than 0.4 on the same 10-story run, with every story passing", async () => {
    const fixture = await createFixture();
    try {
      const plan = JSON.stringify({ summary: "Rename value exports across modules", stories: tenStories() });
      const scripted = scriptedRunner((r) => (is("scorer")(r) ? plan : is("critic")(r) ? "VERDICT: pass\nok" : is("conductor")(r) ? "VERDICT: ok\nok" : "STATUS: done\nok"));
      const store = new Store();
      const c = await createConcert({ config: { ...testConfig(), checks: NO_CHECKS }, catalog: CATALOG, store, runner: scripted.runner, cwd: fixture.cwd });
      await scoreRequest(c, "Rename value exports across modules");
      await perform(c);
      const sent = scripted.calls.reduce((sum, r) => sum + approxTokens(r.prompt), 0);
      expect(Object.values(store.get().stories).every((s) => s.status === "passed")).toBe(true);
      expect(sent).toBeLessThanOrEqual(BASELINE_04 * 0.7);
      expect(scripted.calls.filter(is("critic")).every((r) => !r.prompt.includes("## Repository snapshot"))).toBe(true);
      expect(Object.keys(store.get().ledger.roles).sort()).toEqual(["conductor", "critic", "scorer", "section"]);
    } finally {
      fixture.cleanup();
    }
  }, 60_000);

  it("shows a story only its own neighbours in the plan", () => {
    const plan = parsePlan(JSON.stringify({ summary: "x", stories: tenStories() }));
    const excerpt = planExcerpt(plan, "s3");
    expect(excerpt).toContain("- s2: Rename value in module 40 (lands before this one)");
    expect(excerpt).toContain("8 other stories build separately. Do only this story.");
    expect(excerpt).not.toContain("s7");
  });

  it("packs what a story's files export, cut at its token budget", () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "a.ts"), "export async function total(n: number): Promise<number> {\n  return n;\n}\nconst hidden = 1;\nexport const rate = 0.2;\n");
    writeFileSync(join(cwd, "big.ts"), Array.from({ length: 400 }, (_, i) => `export function f${i}(x: number): number {\n  return x;\n}`).join("\n"));
    writeFileSync(join(cwd, "a.py"), "def area(r):\n    return r\n\nclass Shape:\n    pass\n");
    expect(contextPack(cwd, ["a.ts"])).toBe("## Context pack (what the story's files export now)\n`a.ts`:\n  export async function total(n: number): Promise<number>\n  export const rate");
    expect(contextPack(cwd, ["a.py"])).toContain("  def area(r):\n  class Shape:");
    expect(approxTokens(contextPack(cwd, ["a.ts", "big.ts"]))).toBeLessThanOrEqual(PACK_TOKENS);
    expect(contextPack(cwd, ["new.ts"])).toBe("");
  });

  it("reuses the plan of a request worded differently, never one with other numbers", async () => {
    expect(sameRequest(contentWords("Please add a health endpoint to the API."), contentWords("add health endpoint to API"))).toBe(true);
    expect(sameRequest(contentWords("add 3 retries to the client"), contentWords("add 5 retries to the client"))).toBe(false);
    expect(sameRequest(contentWords("add a health endpoint"), contentWords("remove the health endpoint"))).toBe(false);
    const scripted = scriptedRunner((r) => (is("scorer")(r) ? PLAN_REPLY : "VERDICT: ok\nok"));
    const store = new Store();
    const c = await createConcert({ config: testConfig(), catalog: CATALOG, store, runner: scripted.runner, cwd: tempDir() });
    await scoreRequest(c, "Add a health endpoint and protect the admin routes.");
    await scoreRequest(c, "please add health endpoint, and protect admin routes");
    expect(scripted.calls.filter(is("scorer"))).toHaveLength(1);
    expect(store.get().log.at(-2)?.result).toBe("local hit");
  });
});
