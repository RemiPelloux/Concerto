import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emit, runHeadless } from "#src/headless.js";
import { branchName, startBranch } from "#src/engine/publish.js";
import { finishPr, prBranch } from "#src/commands/publish.js";
import { createConcert } from "#src/orchestrator/concert.js";
import { gitEnv } from "#src/runner/env.js";
import type { RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { CATALOG, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv(), encoding: "utf8" }).trim();
const is = (r: RunRequest, role: string) => r.systemFile.includes(`${role}-`);
const story = (id: string, file: string) => ({ id, title: `Add ${id}`, asA: "a user", iWant: id, soThat: "x", acceptance: [`${id} works`], points: 1, complexity: 1, risk: 1, value: 1, tags: [], files: [file] });
const PLAN = JSON.stringify({ summary: "Add two helpers", stories: [story("sum", "sum.js"), story("max", "max.js")] });

/** A repository with a bare `origin`, its first commit pushed, git identity set locally. */
function repo(): string {
  const cwd = tempDir();
  const origin = tempDir();
  git(origin, "init", "-q", "--bare");
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.email", "t@t");
  git(cwd, "config", "user.name", "t");
  writeFileSync(join(cwd, "README.md"), "demo\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "init");
  git(cwd, "remote", "add", "origin", origin);
  return cwd;
}

/** Builders write their story's file; everything else passes. */
const runner = () => scriptedRunner((r) => {
  if (is(r, "scorer")) return PLAN;
  if (is(r, "critic")) return "VERDICT: pass\nok";
  if (is(r, "conductor")) return "VERDICT: ok\nok";
  const id = ["sum", "max"].find((s) => r.prompt.includes(`## Story ${s}:`)) ?? "x";
  writeFileSync(join(r.cwd, `${id}.js`), `export const ${id} = 1;\n`);
  return "STATUS: done\nok";
});

afterEach(() => vi.unstubAllEnvs());

describe("commits and pull requests", () => {
  async function committedRun() {
    const cwd = repo();
    const pr = await prBranch(true, { cwd, request: "Add two helpers, sum and max!", session: "s-abc-123456" });
    const concert = await createConcert({ config: testConfig(), catalog: CATALOG, store: new Store(), runner: runner().runner, cwd, commit: true });
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((line) => out.push(String(line)) > 0);
    await runHeadless(concert, "Add two helpers", { log: { id: "s-abc", shownPath: "log" }, json: true });
    vi.restoreAllMocks();
    return { cwd, pr, concert, events: out.map((l) => JSON.parse(l) as { type: string; url?: string }) };
  }

  it("commits each merged story on the run's own branch, with only that story's files", async () => {
    const { cwd, pr, events } = await committedRun();
    expect(pr).toEqual({ branch: "concerto/add-two-helpers-sum-and-max-123456", base: "main" });
    expect(git(cwd, "rev-parse", "--abbrev-ref", "HEAD")).toBe(pr?.branch);
    const subjects = git(cwd, "log", "--format=%s", "main..HEAD").split("\n");
    expect(subjects.sort()).toEqual(["Add max", "Add sum"]);
    expect(git(cwd, "show", "--name-only", "--format=", "HEAD").split("\n")).toHaveLength(1);
    expect(git(cwd, "log", "-1", "--format=%b")).toMatch(/As a user, I want .*\n\nBuilt by .*, reviewed by .*\nConcerto-Run: run-/);
    expect(events[0]?.type).toBe("session");
    expect(new Set(events.map((e) => e.type))).toEqual(new Set(["session", "log", "story", "done"]));
  });

  it.skipIf(process.platform === "win32")("pushes the branch and opens a pull request with the report as its body", async () => {
    const { cwd, pr, concert } = await committedRun();
    const record = join(tempDir(), "gh-args.txt");
    const gh = join(tempDir(), "gh");
    writeFileSync(gh, `#!/bin/sh\nprintf '%s ' "$@" > "${record}"\necho https://example.test/pr/1\n`, { mode: 0o700 });
    vi.stubEnv("CONCERTO_GH_BIN", gh);
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((line) => out.push(String(line)) > 0);
    await finishPr(concert, pr!, true);
    vi.restoreAllMocks();
    expect(out).toEqual(['{"type":"pr","url":"https://example.test/pr/1"}\n']);
    expect(git(cwd, "ls-remote", "--heads", "origin")).toContain(pr?.branch);
    expect(readFileSync(record, "utf8")).toMatch(/^pr create --base main --head concerto\/add-two-helpers-sum-and-max-123456 --title Add two helpers --body-file .*run-\w+\.md $/);
  });

  it("refuses to start from a dirty tree, and never commits unless asked", async () => {
    const cwd = repo();
    writeFileSync(join(cwd, "README.md"), "changed\n");
    await expect(startBranch(cwd, branchName("x", "s-1"))).rejects.toThrow(/clean working tree/);
    git(cwd, "checkout", "--", "README.md");
    const concert = await createConcert({ config: testConfig(), catalog: CATALOG, store: new Store(), runner: runner().runner, cwd });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runHeadless(concert, "Add two helpers", { log: { id: "s-1", shownPath: "log" }, json: false });
    vi.restoreAllMocks();
    expect(git(cwd, "rev-list", "--count", "HEAD")).toBe("1");
    expect(git(cwd, "status", "--porcelain")).toContain("sum.js");
  });

  it("writes one JSON object per line", () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((line) => out.push(String(line)) > 0);
    emit("story", { id: "a", status: "passed" });
    vi.restoreAllMocks();
    expect(out).toEqual(['{"type":"story","id":"a","status":"passed"}\n']);
  });
});
