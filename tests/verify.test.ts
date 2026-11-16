import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addedLines, applyMutation, findMutation } from "#src/engine/mutation.js";
import { createConcert } from "#src/orchestrator/concert.js";
import { openWorkspace } from "#src/orchestrator/isolate.js";
import { perform } from "#src/orchestrator/perform.js";
import { mutationProbe, vendorOf } from "#src/orchestrator/review.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import { gitEnv } from "#src/runner/env.js";
import type { RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { CATALOG, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv(), encoding: "utf8" });
const is = (role: string) => (r: RunRequest) => r.systemFile.includes(`${role}-`);
const story = (over: object) => ({ id: "s", title: "Story", asA: "a user", iWant: "it", soThat: "it works", acceptance: ["works"], points: 1, complexity: 1, risk: 1, value: 1, tags: [], ...over });

function repo(files: Record<string, string> = {}): string {
  const cwd = tempDir();
  git(cwd, "init", "-q");
  Object.entries({ "README.md": "x\n", ...files }).forEach(([file, text]) => {
    mkdirSync(join(cwd, file, ".."), { recursive: true });
    writeFileSync(join(cwd, file), text);
  });
  git(cwd, "add", ".");
  git(cwd, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  return cwd;
}

describe("mutation spot checks", () => {
  it("finds a condition in added source lines, never in tests, comments or arrows", () => {
    const diff = "+++ test/a.test.js\n@@ -0,0 +1 @@\n+if (x === 1) fail();\n+++ src/a.js\n@@ -3,0 +4,3 @@\n+// if (a === b)\n+const f = (n) => n;\n+return n >= 18;\n";
    expect(addedLines(diff).map((a) => `${a.file}:${a.line}`)).toEqual(["test/a.test.js:1", "src/a.js:4", "src/a.js:5", "src/a.js:6"]);
    expect(findMutation(diff)).toEqual({ file: "src/a.js", line: 6, from: ">=", to: "<" });
    expect(findMutation("+++ src/a.js\n@@ -0,0 +1 @@\n+const ok = true;\n")).toMatchObject({ from: "true", to: "false" });
    expect(findMutation("+++ src/a.js\n@@ -0,0 +1 @@\n+const trueish = 1;\n")).toBeNull();
  });

  it("puts the file back exactly as it was", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "a.js"), "a\nreturn n >= 18;\n");
    const restore = applyMutation(dir, { file: "a.js", line: 2, from: ">=", to: "<" });
    expect(readFileSync(join(dir, "a.js"), "utf8")).toBe("a\nreturn n < 18;\n");
    restore();
    expect(readFileSync(join(dir, "a.js"), "utf8")).toBe("a\nreturn n >= 18;\n");
  });

  const SEEDS: [string, string][] = [
    ["(age) => age >= 18", "isAdult(20)"], ["(n) => n < 10", "f(1)"], ["(n) => n > 0", "f(1)"], ["(n) => n <= 5", "f(1)"],
    ["(a, b) => a === b", "f(1, 1)"], ["(a, b) => a !== b", "f(1, 2)"], ["(a, b) => a == b", "f(1, 1)"],
    ["(a, b) => a && b", "f(true, true)"], ["(a, b) => a || b", "f(true, false)"], ["() => true", "f()"],
  ];

  async function probe(feature: string, assertion: string): Promise<string> {
    const cwd = repo();
    const config = { ...testConfig(), checks: { test: "node test/feature.test.js", timeoutMinutes: 1 } };
    const c = await createConcert({ config, catalog: CATALOG, store: new Store(), runner: scriptedRunner(() => "").runner, cwd });
    const ws = await openWorkspace(c, "s");
    mkdirSync(join(ws.cwd, "src"), { recursive: true });
    mkdirSync(join(ws.cwd, "test"), { recursive: true });
    writeFileSync(join(ws.cwd, "src", "feature.js"), `const f = ${feature};\nmodule.exports = { f, isAdult: f };\n`);
    writeFileSync(join(ws.cwd, "test", "feature.test.js"), `const m = require("../src/feature.js");\n${assertion}\n`);
    return mutationProbe(c, { story: story({}) as never, cwd: ws.cwd, tree: ws.tree });
  }

  it("catches a test that passes with the feature broken on at least 9 of 10 seeded examples", async () => {
    const caught = await Promise.all(SEEDS.map(([feature]) => probe(feature, 'if (typeof m.f !== "function") process.exit(1);')));
    expect(caught.filter((feedback) => feedback.includes("The tests pass with the feature broken")).length).toBeGreaterThanOrEqual(9);
  });

  it("stays quiet when the test does check the condition", async () => {
    const strong = await probe("(age) => age >= 18", "if (m.isAdult(17) || !m.isAdult(18)) process.exit(1);");
    expect(strong).toBe("");
  });
});

describe("acceptance checks and a second critic", () => {
  it("runs the scorer's acceptance commands after each build and sends a failing one back", async () => {
    const cwd = repo({ "app.txt": "start\n" });
    const check = `node -e "require('fs').readFileSync('app.txt','utf8').includes('done') || process.exit(1)"`;
    const plan = JSON.stringify({ summary: "x", stories: [story({ checks: [check] })] });
    let builds = 0;
    const scripted = scriptedRunner((r) => {
      if (is("scorer")(r)) return plan;
      if (is("conductor")(r)) return "VERDICT: ok\nfine";
      if (is("critic")(r)) return "VERDICT: pass\nchecked";
      writeFileSync(join(r.cwd, "app.txt"), ++builds === 1 ? "half\n" : "done\n");
      return "STATUS: done\nedited";
    });
    const store = new Store();
    const c = await createConcert({ config: testConfig(), catalog: CATALOG, store, runner: scripted.runner, cwd });
    await scoreRequest(c, "x");
    await perform(c);
    expect([builds, store.get().stories.s?.status, store.get().stories.s?.checks?.[0]?.name]).toEqual([2, "passed", "acceptance"]);
  });

  async function riskyRun(conductorOnDisagreement: string) {
    const cwd = repo();
    const plan = JSON.stringify({ summary: "x", stories: [story({ risk: 5 })] });
    let builds = 0;
    const scripted = scriptedRunner((r) => {
      if (is("scorer")(r)) return plan;
      if (is("conductor")(r)) return r.prompt.includes("two critics from different vendors disagree") ? conductorOnDisagreement : "VERDICT: ok\nfine";
      if (is("critic")(r)) return r.session?.id.includes("-critic2") ? "VERDICT: fail\nthe token check is missing" : "VERDICT: pass\nlooks right";
      builds += 1;
      writeFileSync(join(r.cwd, "auth.txt"), "auth\n");
      return "STATUS: done\nedited";
    });
    const store = new Store();
    const c = await createConcert({ config: testConfig(), catalog: CATALOG, store, runner: scripted.runner, cwd });
    await scoreRequest(c, "x");
    await perform(c);
    const critics = scripted.calls.filter(is("critic")).map((r) => r.model);
    return { store, builds, critics };
  }

  it("asks a critic from another vendor on a high-risk story and lets the conductor settle a split", async () => {
    const kept = await riskyRun("VERDICT: ok\nthe first critic is right");
    expect(kept.store.get().stories.s?.status).toBe("passed");
    expect(new Set(kept.critics.map(vendorOf)).size).toBe(2);
    const stopped = await riskyRun("VERDICT: stop\nthe token check is missing and cannot be added here");
    expect([stopped.store.get().stories.s?.status, stopped.builds]).toEqual(["failed", 1]);
  });
});
