import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectChecks, detectTest, runGate } from "#src/engine/checks.js";
import { createConcert } from "#src/orchestrator/concert.js";
import { perform } from "#src/orchestrator/perform.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import { gitEnv } from "#src/runner/env.js";
import type { RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { CATALOG, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

const project = (files: Record<string, string>) => {
  const cwd = tempDir();
  Object.entries(files).forEach(([file, text]) => {
    mkdirSync(join(cwd, file, ".."), { recursive: true });
    writeFileSync(join(cwd, file), text);
  });
  return cwd;
};
const node = (script: string) => `node -e ${JSON.stringify(script)}`;

describe("checks", () => {
  it("finds the test command each kind of project uses", () => {
    expect(detectTest(project({ "package.json": '{"scripts":{"test":"vitest run"}}', "pnpm-lock.yaml": "" }))).toBe("pnpm test");
    expect(detectTest(project({ "package.json": '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' }))).toBeNull();
    expect(detectTest(project({ "pyproject.toml": "[tool.pytest.ini_options]\n" }))).toBe("python -m pytest -q");
    expect(detectTest(project({ "go.mod": "module x\n" }))).toBe("go test ./...");
    expect(detectTest(project({ "Cargo.toml": "[package]\n" }))).toBe("cargo test");
    expect(detectTest(project({ "composer.json": "{}", "phpunit.xml": "" }))).toBe("vendor/bin/phpunit");
    expect(detectTest(project({ "pom.xml": "" }))).toBe("mvn -q test");
    expect(detectTest(project({ "smarttest.config.ts": "", "node_modules/.bin/smarttest": "", "pnpm-lock.yaml": "" }))).toBe("pnpm exec smarttest run --affected");
  });

  it("adds the type check and lint scripts, and lets the config set or turn off each check", () => {
    const cwd = project({ "package.json": '{"scripts":{"test":"vitest","typecheck":"tsc","lint":"eslint ."}}' });
    expect(detectChecks(cwd).map((c) => c.command)).toEqual(["npm test", "npm run typecheck", "npm run lint"]);
    expect(detectChecks(cwd, { test: "make test", lint: false }).map((c) => c.command)).toEqual(["make test", "npm run typecheck"]);
  });

  it("stops at the first red check and calls a test that passes on a rerun flaky", async () => {
    const cwd = tempDir();
    const flaky = node(`const f=require('path').join(process.cwd(),'seen');if(!require('fs').existsSync(f)){require('fs').writeFileSync(f,'');process.exit(1)}`);
    const opts = { cwd, timeoutMs: 10_000 };
    const green = await runGate([{ name: "test", command: flaky }, { name: "lint", command: node("") }], opts);
    expect(green.ok).toBe(true);
    expect(green.results.map((r) => [r.ok, r.flaky ?? false])).toEqual([[true, true], [true, false]]);
    const red = await runGate([{ name: "typecheck", command: node("console.error('TS2322 at app.ts:3');process.exit(2)") }, { name: "lint", command: node("") }], opts);
    expect([red.ok, red.results.length, red.results[0]?.output]).toEqual([false, 1, "TS2322 at app.ts:3\n"]);
  });
});

describe("the test gate in a run", () => {
  it("sends a story with failing tests back to its builder without asking the critic", async () => {
    const cwd = project({ "package.json": `{"scripts":{"test":${JSON.stringify(node("if(!require('fs').readFileSync('app.txt','utf8').includes('fixed'))process.exit(1)"))}}}`, "app.txt": "start\n" });
    const git = (...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv() });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
    const plan = JSON.stringify({ summary: "fix", stories: [{ id: "fix", title: "Fix the app", asA: "a user", iWant: "a fix", soThat: "tests pass", acceptance: ["tests pass"], points: 1, complexity: 1, risk: 1, value: 1, tags: [] }] });
    const is = (role: string) => (r: RunRequest) => r.systemFile.includes(`${role}-`);
    let builds = 0;
    const critics: string[] = [];
    const scripted = scriptedRunner((r) => {
      if (is("scorer")(r)) return plan;
      if (is("conductor")(r)) return "VERDICT: ok\nfine";
      if (is("critic")(r)) {
        critics.push(readFileSync(join(r.cwd, "app.txt"), "utf8"));
        return "VERDICT: pass\nchecked";
      }
      builds += 1;
      writeFileSync(join(r.cwd, "app.txt"), builds === 1 ? "broken\n" : "fixed\n");
      return "STATUS: done\nedited";
    });
    const store = new Store();
    const config = { ...testConfig(), checks: { timeoutMinutes: 1 } };
    const concert = await createConcert({ config, catalog: CATALOG, store, runner: scripted.runner, cwd });
    await scoreRequest(concert, "fix it");
    await perform(concert);
    expect([builds, critics]).toEqual([2, ["fixed\n"]]);
    expect(store.get().stories.fix?.status).toBe("passed");
    expect(scripted.calls.filter((r) => !is("critic")(r) && !is("scorer")(r) && !is("conductor")(r))[1]?.prompt).toContain("Concerto ran `npm test` and it failed");
    expect(readFileSync(join(cwd, "app.txt"), "utf8")).toBe("fixed\n");
    expect(readFileSync(join(cwd, ".concerto", "runs", `${concert.runId}.md`), "utf8")).toMatch(/- Ran `npm test`: passed, \d+ ms/);
    expect(existsSync(join(cwd, "broken"))).toBe(false);
  });
});
