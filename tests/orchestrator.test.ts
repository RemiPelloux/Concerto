import { beforeEach, describe, expect, it, vi } from "vitest";
import { readChanges } from "#src/engine/changes.js";

const git = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: git.run }) };
});

beforeEach(() => { git.run.mockReset(); });

describe("orchestrator change scans", () => {
  it.each([24, 96])("bounds concurrent diffs and keeps process count linear for %i files", async (count) => {
    const files = Array.from({ length: count }, (_, i) => `new-${i}.txt`);
    let active = 0;
    let peak = 0;
    git.run.mockImplementation(async (command: string, args: string[]) => {
      expect(command).toBe("git");
      if (args[0] === "ls-files") return { stdout: [...files, ".concerto/run.md", ".serena/cache.json", ""].join("\0") };
      if (!args.includes("--no-index")) return { stdout: "2\t1\ttracked.txt\n" };
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      throw Object.assign(new Error("differences"), { stdout: `1\t0\t${args.at(-1)}\n` });
    });

    const changes = await readChanges("/fixture");
    expect(peak).toBe(4);
    expect(active).toBe(0);
    expect(git.run).toHaveBeenCalledTimes(count + 2);
    expect(changes[0]).toEqual({ file: "tracked.txt", added: 2, removed: 1, status: "modified" });
    expect(changes.slice(1)).toEqual(files.map((file) => ({ file, added: 1, removed: 0, status: "added" })));
    expect(git.run.mock.calls.filter(([, args]) => args.includes("--no-index")).map(([, args]) => args.at(-1))).toEqual(files);
  });

  it("finishes later batches when one untracked file disappears", async () => {
    const files = Array.from({ length: 9 }, (_, i) => `new-${i}.txt`);
    git.run.mockImplementation(async (_command: string, args: string[]) => {
      if (args[0] === "ls-files") return { stdout: `${files.join("\0")}\0` };
      if (!args.includes("--no-index")) return { stdout: "" };
      if (args.at(-1) === files[0]) throw new Error("file disappeared");
      throw Object.assign(new Error("differences"), { stdout: `1\t0\t${args.at(-1)}\n` });
    });

    expect(await readChanges("/fixture")).toEqual(files.slice(1).map((file) => ({ file, added: 1, removed: 0, status: "added" })));
    expect(git.run).toHaveBeenCalledTimes(files.length + 2);
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
