import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotStat, worktreeSnapshot } from "#src/engine/snapshot.js";
import { createConcert } from "#src/orchestrator/concert.js";
import { perform } from "#src/orchestrator/perform.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import type { RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { CATALOG, PLAN_REPLY, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

function gitRepo(): string {
  const cwd = tempDir();
  const git = (...args: string[]) => execFileSync("git", args, { cwd });
  git("init", "-q");
  writeFileSync(join(cwd, "a.txt"), "one\n");
  git("add", "a.txt");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  return cwd;
}

const is = (role: string) => (r: RunRequest) => r.systemFile.includes(`${role}-`);
const changeSection = (prompt: string) => prompt.split("## This story's change")[1]?.split("\n## ")[0] ?? "";

const DONE = "STATUS: done\nchanged it";

async function runAll(cwd: string, build: (r: RunRequest) => string | void) {
  const scripted = scriptedRunner((r) => {
    if (is("scorer")(r)) return PLAN_REPLY;
    if (is("critic")(r)) return "VERDICT: pass\nchecked";
    if (is("conductor")(r)) return "VERDICT: ok\nfine";
    return build(r) || DONE;
  });
  const concert = await createConcert({ config: testConfig(), catalog: CATALOG, store: new Store(), runner: scripted.runner, cwd });
  await scoreRequest(concert, "add health and auth");
  await perform(concert);
  return scripted.calls;
}

const run = async (cwd: string, build: (r: RunRequest) => string | void) => (await runAll(cwd, build)).filter(is("critic"));

describe("snapshotStat", () => {
  it("lists only what changed between two snapshots", async () => {
    const cwd = gitRepo();
    writeFileSync(join(cwd, "before.txt"), "already here");
    const from = await worktreeSnapshot(cwd);
    writeFileSync(join(cwd, "story.txt"), "built");
    const to = await worktreeSnapshot(cwd);
    const stat = await snapshotStat(cwd, from ?? "", to ?? "");
    expect(stat).toContain("story.txt");
    expect(stat).not.toContain("before.txt");
  });
});

describe("the critic's scope", () => {
  it("gets the story's own change, not the rest of the working tree", async () => {
    const cwd = gitRepo();
    writeFileSync(join(cwd, "someone-else.txt"), "unrelated work");
    let builds = 0;
    const critics = await run(cwd, () => writeFileSync(join(cwd, `build-${++builds}.txt`), "built"));
    expect(critics.length).toBeGreaterThan(0);
    for (const critic of critics) {
      const change = changeSection(critic.prompt);
      expect(change).toMatch(/build-\d\.txt/);
      expect(change).toMatch(/git diff [0-9a-f]{40} [0-9a-f]{40}/);
      expect(change).not.toContain("someone-else.txt");
    }
  });

  it("is told when the build changed nothing", async () => {
    const critics = await run(gitRepo(), () => undefined);
    expect(critics.every((r) => r.prompt.includes("The build changed no file"))).toBe(true);
  });

  it("gets no change section outside a Git repository", async () => {
    const critics = await run(tempDir(), () => undefined);
    expect(critics.every((r) => !r.prompt.includes("## This story's change"))).toBe(true);
  });
});

describe("a blocked builder", () => {
  const BLOCKED = "STATUS: blocked\nneeds the production API key";
  const builds = (calls: RunRequest[]) => calls.filter((r) => is("soloist")(r) || is("section")(r));

  it("that changed nothing goes to the conductor, not to the critic or a blind retry", async () => {
    const calls = await runAll(gitRepo(), () => BLOCKED);
    expect(calls.filter(is("critic"))).toHaveLength(0);
    const consults = calls.filter(is("conductor")).filter((r) => r.prompt.includes("stopped as blocked"));
    expect(consults.length).toBeGreaterThan(0);
    expect(consults[0]?.prompt).toContain("needs the production API key");
    const stories = 2;
    expect(builds(calls)).toHaveLength(stories * 2);
  });

  it("that changed files is still checked by the critic", async () => {
    const cwd = gitRepo();
    let n = 0;
    const calls = await runAll(cwd, () => (writeFileSync(join(cwd, `work-${++n}.txt`), "done"), BLOCKED));
    expect(calls.filter(is("critic")).length).toBeGreaterThan(0);
  });
});
