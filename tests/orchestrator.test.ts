import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readChanges } from "#src/engine/changes.js";
import { tempDir } from "#tests/fixtures.js";

const git = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: git.run }) };
});

beforeEach(() => { git.run.mockReset(); });

describe("orchestrator change scans", () => {
  it.each([24, 96])("keeps process count constant for %i files", async (count) => {
    const cwd = tempDir();
    const files = Array.from({ length: count }, (_, i) => `new-${i}.txt`);
    files.forEach((file) => writeFileSync(join(cwd, file), "one\n"));
    git.run.mockImplementation(async (command: string, args: string[]) => {
      expect(command).toBe("git");
      if (args[0] === "ls-files") return { stdout: [...files, ".concerto/run.md", ".serena/cache.json", ""].join("\0") };
      expect(args).not.toContain("--no-index");
      return { stdout: "2\t1\ttracked.txt\n" };
    });

    const changes = await readChanges(cwd);
    expect(git.run).toHaveBeenCalledTimes(4);
    expect(changes[0]).toEqual({ file: "tracked.txt", added: 2, removed: 1, status: "modified" });
    expect(changes.slice(1)).toEqual(files.map((file) => ({ file, added: 1, removed: 0, status: "added" })));
    expect(git.run.mock.calls.some(([, args]) => args.includes("--no-index"))).toBe(false);
  });

  it("finishes later batches when one untracked file disappears", async () => {
    const cwd = tempDir();
    const files = Array.from({ length: 65 }, (_, i) => `new-${i}.txt`);
    files.slice(1).forEach((file) => writeFileSync(join(cwd, file), "one\n"));
    git.run.mockImplementation(async (_command: string, args: string[]) => {
      if (args[0] === "ls-files") return { stdout: `${files.join("\0")}\0` };
      expect(args).not.toContain("--no-index");
      return { stdout: "" };
    });

    expect(await readChanges(cwd)).toEqual(files.slice(1).map((file) => ({ file, added: 1, removed: 0, status: "added" })));
    expect(git.run).toHaveBeenCalledTimes(4);
  });

  it("starts no file diffs when there are no eligible untracked files", async () => {
    git.run.mockImplementation(async (_command: string, args: string[]) => ({
      stdout: args[0] === "ls-files" ? ".concerto/run.md\0.serena/cache.json\0" : "",
    }));
    expect(await readChanges("/fixture")).toEqual([]);
    expect(git.run).toHaveBeenCalledTimes(2);
  });

  it("returns no changes outside a Git repository", async () => {
    git.run.mockRejectedValue(new Error("not a git repository"));
    expect(await readChanges("/fixture")).toEqual([]);
    expect(git.run).toHaveBeenCalledTimes(2);
  });
});
