import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hunksOf, loadMerge, rejectHunk, rejectStory, storyPatch } from "#src/engine/review-work.js";
import { createConcert } from "#src/orchestrator/concert.js";
import { askBuilder } from "#src/orchestrator/follow-up.js";
import { pause, resume } from "#src/orchestrator/pause.js";
import { perform } from "#src/orchestrator/perform.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import { gitEnv } from "#src/runner/env.js";
import type { RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { sideBySide, wordDiff } from "#src/ui/side-by-side.js";
import { CATALOG, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv(), encoding: "utf8" });
const is = (role: string) => (r: RunRequest) => r.systemFile.includes(`${role}-`);
const LINES = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
const story = (id: string) => ({ id, title: `Story ${id}`, asA: "a user", iWant: id, soThat: "x", acceptance: [`${id} done`], points: 1, complexity: 1, risk: 1, value: 1, tags: [], files: [`${id}.txt`] });
const read = (cwd: string, file: string) => readFileSync(join(cwd, file), "utf8");

/** Four stories, each with its own file; s3 changes two distant lines, so its change has two hunks. */
async function fourStoryRun() {
  const cwd = tempDir();
  git(cwd, "init", "-q");
  ["s1", "s2", "s3", "s4"].forEach((id) => writeFileSync(join(cwd, `${id}.txt`), `${LINES}\n`));
  git(cwd, "add", ".");
  git(cwd, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  const plan = JSON.stringify({ summary: "four", stories: ["s1", "s2", "s3", "s4"].map(story) });
  const builds: { id: string; prompt: string }[] = [];
  const scripted = scriptedRunner((r) => {
    if (is("scorer")(r)) return plan;
    if (is("critic")(r)) return "VERDICT: pass\nok";
    if (is("conductor")(r)) return "VERDICT: ok\nok";
    const id = ["s1", "s2", "s3", "s4"].find((s) => r.prompt.includes(`## Story ${s}:`) || r.session?.id.includes(`-${s}-`)) ?? "";
    builds.push({ id, prompt: r.prompt });
    const lines = read(r.cwd, `${id}.txt`).split("\n");
    lines[1] = r.prompt.includes("use uppercase") ? `${id.toUpperCase()} TOP` : `${id} top`;
    if (id === "s3") lines[18] = "s3 bottom";
    writeFileSync(join(r.cwd, `${id}.txt`), lines.join("\n"));
    return "STATUS: done\nok";
  });
  const store = new Store();
  const c = await createConcert({ config: testConfig(), catalog: CATALOG, store, runner: scripted.runner, cwd });
  await scoreRequest(c, "four stories");
  await perform(c);
  return { c, cwd, store, builds };
}

describe("reviewing a run's work", () => {
  it("keeps two stories, keeps one in part, and sends one back that alone is rebuilt", async () => {
    const { c, cwd, store, builds } = await fourStoryRun();
    expect(Object.values(store.get().stories).every((s) => s.status === "passed")).toBe(true);
    const hunks = hunksOf(await storyPatch(loadMerge(cwd, { runId: c.runId, storyId: "s3" }) ?? []));
    expect(hunks.map((h) => h.file)).toEqual(["s3.txt", "s3.txt"]);
    const taken = await rejectHunk(cwd, { runId: c.runId, storyId: "s3", index: 1 });
    expect(read(cwd, "s3.txt").split("\n").slice(0, 2)).toEqual(["line 0", "line 1"]);
    expect(read(cwd, "s3.txt").split("\n")[18]).toBe("s3 bottom");
    expect(readFileSync(taken.saved, "utf8")).toContain("+s3 top");
    const before = { s1: read(cwd, "s1.txt"), s2: read(cwd, "s2.txt"), s3: read(cwd, "s3.txt") };
    const buildsBefore = builds.length;
    expect(await askBuilder(c, "s4", "use uppercase")).toBe(true);
    expect(read(cwd, "s4.txt").split("\n")[1]).toBe("S4 TOP");
    expect(builds.slice(buildsBefore).map((b) => b.id)).toEqual(["s4"]);
    expect(builds.at(-1)?.prompt).toContain("## The person reviewing your work asks\nuse uppercase");
    expect({ s1: read(cwd, "s1.txt"), s2: read(cwd, "s2.txt"), s3: read(cwd, "s3.txt") }).toEqual(before);
    expect(store.get().phase).toBe("done");
  });

  it("takes a whole story back out, saved as a patch that brings it back", async () => {
    const { c, cwd } = await fourStoryRun();
    const done = await rejectStory(cwd, { runId: c.runId, storyId: "s2" });
    expect(done.reverted).toEqual(["s2.txt"]);
    expect(read(cwd, "s2.txt")).toBe(`${LINES}\n`);
    git(cwd, "-c", "core.autocrlf=false", "apply", done.saved);
    expect(read(cwd, "s2.txt").split("\n")[1]).toBe("s2 top");
    await expect(rejectStory(cwd, { runId: c.runId, storyId: "s2" })).rejects.toThrow(/Nothing merged for "s2"/);
  });

  it("starts no new story while paused, and goes on after /continue", async () => {
    const cwd = tempDir();
    const plan = JSON.stringify({ summary: "one", stories: [story("s1")] });
    const scripted = scriptedRunner((r) => (is("scorer")(r) ? plan : is("critic")(r) ? "VERDICT: pass\nok" : is("conductor")(r) ? "VERDICT: ok\nok" : "STATUS: done\nok"));
    const store = new Store();
    const c = await createConcert({ config: testConfig(), catalog: CATALOG, store, runner: scripted.runner, cwd });
    await scoreRequest(c, "one");
    pause(c);
    const running = perform(c);
    await new Promise((r) => setTimeout(r, 200));
    expect(scripted.calls.filter((r) => !is("scorer")(r) && !is("conductor")(r))).toHaveLength(0);
    resume(c);
    await running;
    expect(store.get().stories.s1?.status).toBe("passed");
    expect(existsSync(join(cwd, ".concerto"))).toBe(true);
  });

  it("lays a diff out side by side and marks the words that changed", () => {
    expect(wordDiff("const total = a + b;", "const total = a - b;")).toEqual({
      left: [{ text: "const total = a ", changed: false }, { text: "+", changed: true }, { text: " b;", changed: false }],
      right: [{ text: "const total = a ", changed: false }, { text: "-", changed: true }, { text: " b;", changed: false }],
    });
    const rows = sideBySide("--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n keep\n-old line\n+new line\n+added\n");
    expect(rows.map((r) => r.kind)).toEqual(["hunk", "same", "change", "add"]);
  });
});
