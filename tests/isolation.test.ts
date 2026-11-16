import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createConcert } from "#src/orchestrator/concert.js";
import { perform } from "#src/orchestrator/perform.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import { gitEnv } from "#src/runner/env.js";
import type { RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { CATALOG, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

const STORIES = 6;
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv(), encoding: "utf8" });
const is = (role: string) => (r: RunRequest) => r.systemFile.includes(`${role}-`);
const ids = Array.from({ length: STORIES }, (_, i) => `s${i}`);

/** Six independent stories, story sN rewrites line N of the same file. */
const PLAN = JSON.stringify({
  summary: "Six edits to one file",
  stories: ids.map((id) => ({ id, title: `Edit ${id}`, asA: "a user", iWant: id, soThat: "it changes", acceptance: [`${id} is written`], points: 1, complexity: 1, risk: 1, value: 1, tags: [], files: ["app.txt"] })),
});

function repo(): string {
  const cwd = tempDir();
  git(cwd, "init", "-q");
  writeFileSync(join(cwd, "app.txt"), `${ids.map((id) => `${id}: before`).join("\n")}\n`);
  git(cwd, "add", ".");
  git(cwd, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  return cwd;
}

const storyOf = (r: RunRequest) => ids.find((id) => r.session?.id.endsWith(`-${id}`) || r.session?.id.includes(`-${id}-`)) ?? "";

function setEdit(cwd: string, id: string): void {
  const lines = readFileSync(join(cwd, "app.txt"), "utf8").split("\n");
  lines[Number(id.slice(1))] = `${id}: after`;
  writeFileSync(join(cwd, "app.txt"), lines.join("\n"));
}

describe("story isolation", () => {
  it("builds six parallel stories on neighbouring lines in their own worktrees and merges all six", async () => {
    const cwd = repo();
    const seen: string[] = [];
    const scripted = scriptedRunner((r) => {
      if (is("scorer")(r)) return PLAN;
      if (is("conductor")(r)) return "VERDICT: ok\nfine";
      const id = storyOf(r);
      if (!is("critic")(r)) {
        expect(r.cwd).not.toBe(cwd);
        setEdit(r.cwd, id);
        return "STATUS: done\nedited";
      }
      const diff = git(r.cwd, "diff", "HEAD");
      seen.push(`${id}:${ids.filter((other) => diff.includes(`+${other}: after`)).join(",")}`);
      return "VERDICT: pass\nchecked";
    });
    const store = new Store();
    const concert = await createConcert({ config: testConfig(), catalog: CATALOG, store, runner: scripted.runner, cwd });
    await scoreRequest(concert, "six edits");
    await perform(concert);
    expect(store.get().phase).toBe("done");
    expect(seen.sort()).toEqual(ids.map((id) => `${id}:${id}`));
    expect(readFileSync(join(cwd, "app.txt"), "utf8")).toBe(`${ids.map((id) => `${id}: after`).join("\n")}\n`);
    expect(ids.every((id) => store.get().stories[id]?.merged?.includes("app.txt"))).toBe(true);
    const root = join(cwd, ".concerto", "worktrees");
    expect(existsSync(root) ? readdirSync(root).filter((f) => !f.endsWith(".pid")) : []).toEqual([]);
    expect(git(cwd, "worktree", "list").trim().split("\n")).toHaveLength(1);
    expect(git(cwd, "status", "--porcelain")).toBe(" M app.txt\n");
    const report = readFileSync(join(cwd, ".concerto", "runs", `${concert.runId}.md`), "utf8");
    expect(report).toContain("### Edit s3\n\n- Merged: `app.txt`");
  });

  it("keeps the main folder untouched when a story fails, and saves the story's work as a patch", async () => {
    const cwd = repo();
    const scripted = scriptedRunner((r) => {
      if (is("scorer")(r)) return JSON.stringify({ ...JSON.parse(PLAN), stories: JSON.parse(PLAN).stories.slice(0, 1) });
      if (is("conductor")(r)) return "VERDICT: ok\nfine";
      if (is("critic")(r)) return "VERDICT: fail\nline 0 is wrong";
      setEdit(r.cwd, "s0");
      return "STATUS: done\nedited";
    });
    const store = new Store();
    const concert = await createConcert({ config: testConfig(), catalog: CATALOG, store, runner: scripted.runner, cwd });
    await scoreRequest(concert, "one edit");
    await perform(concert);
    expect(store.get().stories.s0?.status).toBe("failed");
    expect(git(cwd, "status", "--porcelain")).toBe("");
    const root = join(cwd, ".concerto", "worktrees");
    const patches = readdirSync(root).filter((f) => f.startsWith("failed-"));
    expect(patches).toHaveLength(1);
    expect(readFileSync(join(root, patches[0]!), "utf8")).toContain("+s0: after");
  });

  it("rebuilds a passing story on top of the current code when its merge conflicts, keeping both", async () => {
    const cwd = repo();
    const two = JSON.stringify({ ...JSON.parse(PLAN), stories: JSON.parse(PLAN).stories.slice(0, 2) });
    const prompts: string[] = [];
    const scripted = scriptedRunner((r) => {
      if (is("scorer")(r)) return two;
      if (is("conductor")(r)) return "VERDICT: ok\nfine";
      if (is("critic")(r)) return "VERDICT: pass\nchecked";
      const id = storyOf(r);
      prompts.push(r.prompt);
      // A real builder edits CRLF files as they are; on Windows the worktree checkout has CRLF.
      const lines = readFileSync(join(r.cwd, "app.txt"), "utf8").split(/\r?\n/);
      const rebuild = r.prompt.includes("Your change no longer applies");
      lines[0] = rebuild ? `${lines[0]}+${id}` : `exports: ${id}`;
      writeFileSync(join(r.cwd, "app.txt"), lines.join("\n"));
      return "STATUS: done\nedited";
    });
    const store = new Store();
    const concert = await createConcert({ config: testConfig(), catalog: CATALOG, store, runner: scripted.runner, cwd });
    await scoreRequest(concert, "two edits of one line");
    await perform(concert);
    const first = readFileSync(join(cwd, "app.txt"), "utf8").split("\n")[0] ?? "";
    expect(["exports: s0+s1", "exports: s1+s0"]).toContain(first);
    expect([store.get().stories.s0?.status, store.get().stories.s1?.status]).toEqual(["passed", "passed"]);
    expect(prompts.filter((p) => p.includes("Your change no longer applies"))).toHaveLength(1);
    const critics = scripted.calls.filter(is("critic")).map((r) => r.session?.id ?? "");
    expect(critics.filter((id) => /-critic-r1-/.test(id))).toHaveLength(1);
    expect(readdirSync(join(cwd, ".concerto", "worktrees")).filter((f) => f.endsWith(".patch"))).toEqual([]);
  });
});
