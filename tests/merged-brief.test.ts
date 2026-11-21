import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createConcert } from "#src/orchestrator/concert.js";
import { mergedBrief } from "#src/orchestrator/merged-brief.js";
import { perform } from "#src/orchestrator/perform.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import { parsePlan } from "#src/orchestrator/plan.js";
import { gitEnv } from "#src/runner/env.js";
import { Store } from "#src/state/store.js";
import type { StoryView } from "#src/state/types.js";
import { CATALOG, PLAN_REPLY, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv() });

/** A repository with two committed files, then what two stories merged into it. */
function merged(): string {
  const cwd = tempDir();
  git(cwd, "init", "-q");
  writeFileSync(join(cwd, "health.ts"), "export const ok = true;\n");
  writeFileSync(join(cwd, "auth.ts"), "export const auth = 1;\n");
  git(cwd, "add", ".");
  git(cwd, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  writeFileSync(join(cwd, "health.ts"), "export const ok = true;\nexport const route = '/health';\n");
  writeFileSync(join(cwd, "auth.ts"), Array.from({ length: 400 }, (_l, i) => `export const line${i} = ${i};`).join("\n"));
  return cwd;
}

function state(mergedFiles: Record<string, string[]>) {
  const plan = parsePlan(PLAN_REPLY);
  const store = new Store();
  const stories = Object.fromEntries(plan.stories.map((s) => [s.id, { id: s.id, status: "passed", merged: mergedFiles[s.id] ?? [] } as unknown as StoryView]));
  store.update(() => ({ plan, stories, order: plan.stories.map((s) => s.id) }));
  return { s: store.get() };
}

describe("what the conductor sees before calling done", () => {
  it("lists each story with what it merged, and shows the merged diff", async () => {
    const cwd = merged();
    const ids = parsePlan(PLAN_REPLY).stories.map((st) => st.id);
    const { s } = state({ [ids[0]!]: ["health.ts"] });
    const brief = await mergedBrief(s, cwd);
    ids.forEach((id) => expect(brief).toContain(`- ${id} (passed)`));
    expect(brief).toContain("health.ts");
    expect(brief).toContain("+export const route = '/health';");
  });

  it("names the files whose diff is over the budget instead of cutting a diff in half", async () => {
    const cwd = merged();
    const [first, second] = parsePlan(PLAN_REPLY).stories;
    const { s } = state({ [first!.id]: ["health.ts"], [second!.id]: ["auth.ts"] });
    const brief = await mergedBrief(s, cwd, 2000);
    expect(brief).toContain("+export const route = '/health';");
    expect(brief).not.toContain("line399");
    expect(brief).toMatch(/Not shown[^\n]*auth\.ts/);
  });

  it("says so when nothing was merged", async () => {
    const { s } = state({});
    expect(await mergedBrief(s, merged())).toContain("Nothing was merged");
  });
});

describe("the conductor's last checkpoint in a run", () => {
  it("is asked with the merged diff in hand, not told to go and find it", async () => {
    const cwd = merged();
    const is = (role: string) => (r: { systemFile: string }) => r.systemFile.includes(`${role}-`);
    const scripted = scriptedRunner((r) => {
      if (is("scorer")(r)) return PLAN_REPLY;
      if (is("critic")(r)) return "VERDICT: pass\nchecked";
      if (is("conductor")(r)) return "VERDICT: ok\nfine";
      writeFileSync(join(r.cwd, "built.ts"), "export const built = 'by a story';\n");
      return "STATUS: done\nchanged it";
    });
    const c = await createConcert({ config: testConfig(), catalog: CATALOG, store: new Store(), runner: scripted.runner, cwd });
    await scoreRequest(c, "add health and auth");
    await perform(c);
    const last = scripted.calls.filter(is("conductor")).find((r) => r.prompt.includes("before calling done"));
    expect(last?.prompt).toContain("## What the run merged");
    expect(last?.prompt).toContain("+export const built = 'by a story';");
    const first = scripted.calls.find(is("conductor"));
    expect(first?.prompt).toContain("## Code map");
    expect(existsSync(join(cwd, ".concerto", "code-map.md"))).toBe(true);
  });
});
