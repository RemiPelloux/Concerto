import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeBack, mergeLines } from "#src/engine/merge.js";
import { changesIn, clearLeftovers, closeWorktree, openWorktree, snapshot, worktreeRoot } from "#src/engine/worktree.js";
import { gitEnv } from "#src/runner/env.js";
import { tempDir } from "#tests/fixtures.js";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv(), encoding: "utf8" });
const LINES = Array.from({ length: 12 }, (_, i) => `line ${i}`);

/** A repository with one committed file, an uncommitted edit, an untracked file and ignored deps. */
function repo(): string {
  const cwd = tempDir();
  git(cwd, "init", "-q");
  writeFileSync(join(cwd, ".gitignore"), "node_modules/\n.env\n");
  writeFileSync(join(cwd, "app.txt"), `${LINES.join("\n")}\n`);
  git(cwd, "add", ".");
  git(cwd, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  writeFileSync(join(cwd, "draft.txt"), "untracked\n");
  mkdirSync(join(cwd, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(cwd, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  writeFileSync(join(cwd, ".env"), "TOKEN=x\n");
  writeFileSync(join(cwd, ".git", "info", "exclude"), ".concerto/\n");
  return cwd;
}

const edit = (dir: string, index: number, text: string) => {
  const lines = readFileSync(join(dir, "app.txt"), "utf8").split("\n");
  lines[index] = text;
  writeFileSync(join(dir, "app.txt"), lines.join("\n"));
};

describe("story worktrees", () => {
  it("snapshots uncommitted and untracked work without touching the index or HEAD", async () => {
    const cwd = repo();
    edit(cwd, 0, "edited, not committed");
    const [head, status] = [git(cwd, "rev-parse", "HEAD"), git(cwd, "status", "--porcelain")];
    const base = await snapshot(cwd);
    expect([git(cwd, "rev-parse", "HEAD"), git(cwd, "status", "--porcelain")]).toEqual([head, status]);
    expect(git(cwd, "show", `${base}:app.txt`)).toContain("edited, not committed");
    expect(git(cwd, "show", `${base}:draft.txt`)).toBe("untracked\n");
    expect(() => git(cwd, "show", `${base}:node_modules/dep/index.js`)).toThrow();
  });

  it("links dependencies into the worktree, reports only the story's changes, and cleans up", async () => {
    const cwd = repo();
    const w = await openWorktree(cwd, "run-1/story-a", await snapshot(cwd));
    expect(readFileSync(join(w.dir, "node_modules", "dep", "index.js"), "utf8")).toContain("module.exports");
    expect(readFileSync(join(w.dir, ".env"), "utf8")).toBe("TOKEN=x\n");
    edit(w.dir, 3, "story a");
    writeFileSync(join(w.dir, "new.txt"), "new\n");
    expect(await changesIn(w)).toEqual([{ status: "M", file: "app.txt" }, { status: "A", file: "new.txt" }]);
    await closeWorktree(cwd, w);
    expect(existsSync(w.dir)).toBe(false);
    expect(readFileSync(join(cwd, "node_modules", "dep", "index.js"), "utf8")).toContain("module.exports");
    expect(git(cwd, "worktree", "list")).not.toContain("story-a");
  });

  it("merges stories that edit neighbouring lines of one file, and refuses a real conflict whole", async () => {
    const cwd = repo();
    const base = await snapshot(cwd);
    const [a, b, c] = await Promise.all(["a", "b", "c"].map((n) => openWorktree(cwd, `run-1/${n}`, base)));
    edit(a!.dir, 2, "story a");
    edit(b!.dir, 4, "story b");
    edit(c!.dir, 2, "story c wants line 2 too");
    writeFileSync(join(c!.dir, "extra.txt"), "c\n");
    expect((await mergeBack(cwd, a!, await changesIn(a!))).merged).toEqual(["app.txt"]);
    expect((await mergeBack(cwd, b!, await changesIn(b!))).merged).toEqual(["app.txt"]);
    const lines = readFileSync(join(cwd, "app.txt"), "utf8").split("\n");
    expect([lines[2], lines[4]]).toEqual(["story a", "story b"]);
    const clash = await mergeBack(cwd, c!, await changesIn(c!));
    expect(clash.conflicts).toEqual(["app.txt"]);
    expect(clash.detail).toContain("<<<<<<<");
    expect(existsSync(join(cwd, "extra.txt"))).toBe(false);
    await Promise.all([a, b, c].map((w) => closeWorktree(cwd, w!)));
  });

  it("merges edits on adjacent lines, which git alone calls a conflict, but never two edits of one line", () => {
    expect(mergeLines("A\nb\nc", "a\nb\nc", "a\nB\nc")).toBe("A\nB\nc");
    expect(mergeLines("A\nb", "a\nb", "a\nb")).toBe("A\nb");
    expect(mergeLines("A\nb", "a\nb", "Z\nb")).toBeNull();
    expect(mergeLines("A\nb\nnew", "a\nb", "a\nB")).toBeNull();
  });

  it("deletes a file only if nobody changed it meanwhile", async () => {
    const cwd = repo();
    const w = await openWorktree(cwd, "run-1/d", await snapshot(cwd));
    execFileSync("rm", [join(w.dir, "draft.txt")]);
    expect((await mergeBack(cwd, w, await changesIn(w))).merged).toEqual(["draft.txt"]);
    expect(existsSync(join(cwd, "draft.txt"))).toBe(false);
    await closeWorktree(cwd, w);
  });

  it("saves a crashed run's unmerged work as a patch before removing its worktree", async () => {
    const cwd = repo();
    const w = await openWorktree(cwd, "run-old/e", await snapshot(cwd));
    edit(w.dir, 7, "unmerged work");
    const patches = await clearLeftovers(cwd);
    expect(patches).toHaveLength(1);
    expect(readFileSync(patches[0]!, "utf8")).toContain("+unmerged work");
    expect(readFileSync(patches[0]!, "utf8")).not.toContain("node_modules");
    expect(existsSync(w.dir)).toBe(false);
    expect(lstatSync(join(cwd, "node_modules")).isDirectory()).toBe(true);
    expect(readdirSync(worktreeRoot(cwd)).filter((f) => f.endsWith(".patch"))).toHaveLength(1);
  });
});
