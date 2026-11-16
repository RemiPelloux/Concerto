import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gitEnv } from "#src/runner/env.js";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createConcert } from "#src/orchestrator/concert.js";
import { worktreeSnapshot } from "#src/engine/snapshot.js";
import { perform } from "#src/orchestrator/perform.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import type { RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { CATALOG, PLAN_REPLY, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

function gitRepo(): string {
  const cwd = tempDir();
  // gitEnv(): never the GIT_DIR a commit hook sets, or these commands would act on the real repository.
  const git = (...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv() });
  git("init", "-q");
  writeFileSync(join(cwd, "a.txt"), "one\n");
  git("add", "a.txt");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  return cwd;
}

describe("worktreeSnapshot", () => {
  it("changes with tracked edits and new files, not with Concerto's own state", async () => {
    const cwd = gitRepo();
    const first = await worktreeSnapshot(cwd);
    expect(first).toMatch(/^[0-9a-f]{40}$/);
    mkdirSync(join(cwd, ".concerto"));
    writeFileSync(join(cwd, ".concerto", "log.txt"), "noise");
    expect(await worktreeSnapshot(cwd)).toBe(first);
    writeFileSync(join(cwd, "new.txt"), "x");
    const withNew = await worktreeSnapshot(cwd);
    expect(withNew).not.toBe(first);
    writeFileSync(join(cwd, "a.txt"), "two\n");
    expect(await worktreeSnapshot(cwd)).not.toBe(withNew);
  });

  it("leaves the real index alone", async () => {
    const cwd = gitRepo();
    writeFileSync(join(cwd, "new.txt"), "x");
    await worktreeSnapshot(cwd);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd, env: gitEnv() }).toString()).toBe("?? new.txt\n");
  });

  it("is null outside a Git repository", async () => {
    expect(await worktreeSnapshot(tempDir())).toBeNull();
  });
});

const is = (role: string) => (r: RunRequest) => r.systemFile.includes(`${role}-`);

async function run(gates: string[], cwd = tempDir()) {
  const scripted = scriptedRunner((r) => {
    if (is("scorer")(r)) return PLAN_REPLY;
    if (is("critic")(r)) return "VERDICT: pass\nchecked";
    if (is("conductor")(r)) return "VERDICT: ok\nfine";
    return "STATUS: done\nchanged it";
  });
  const store = new Store();
  const concert = await createConcert({ config: { ...testConfig(), gates }, catalog: CATALOG, store, runner: scripted.runner, cwd });
  await scoreRequest(concert, "add health and auth");
  await perform(concert);
  const builds = scripted.calls.filter((r) => is("soloist")(r) || is("section")(r));
  return { store, critics: scripted.calls.filter(is("critic")), builds };
}

describe("gates in a run", () => {
  it("a red gate goes back to the builder and never reaches the critic", async () => {
    // Gates run in the system shell (cmd.exe on Windows): node keeps them portable.
    const { store, critics, builds } = await run([`node -e "console.error('boom'); process.exit(1)"`]);
    expect(critics).toHaveLength(0);
    expect(Object.values(store.get().stories).every((s) => s.status === "failed")).toBe(true);
    expect(builds.some((r) => r.prompt.includes("boom"))).toBe(true);
  });

  it("does not run a failed gate again over a build that changed nothing", async () => {
    const cwd = gitRepo();
    const log = join(cwd, ".git", "gate-runs").replace(/\\/g, "/");
    const { builds } = await run([`node -e "require('fs').appendFileSync('${log}', 'x\\n'); process.exit(1)"`], cwd);
    expect(builds.some((r) => r.prompt.includes("changed no file"))).toBe(true);
    const runs = readFileSync(join(cwd, ".git", "gate-runs"), "utf8").trim().split("\n");
    expect(runs.length).toBeLessThan(builds.length);
  });

  it("a green gate lets the critic review", async () => {
    const { store, critics } = await run([`node -e "process.exit(0)"`]);
    expect(critics.length).toBeGreaterThan(0);
    expect(store.get().phase).toBe("done");
  });
});
