import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fileDiff, parseNumstat, readChanges } from "#src/engine/changes.js";
import { gitEnv } from "#src/runner/env.js";
import { AgentFeed } from "#src/orchestrator/feed.js";
import { Store } from "#src/state/store.js";
import { windowAround } from "#src/ui/AgentList.js";
import { completeSlash, parseSlash } from "#src/ui/slash.js";
import { tempDir } from "#tests/fixtures.js";

describe("agent feed", () => {
  it("turns deltas, tools and errors into lines, written at most every 150 ms", () => {
    vi.useFakeTimers();
    const store = new Store();
    store.agentStart({ id: "a", role: "soloist", model: "x/m", label: "story" });
    const feed = new AgentFeed(store, "a");
    feed.push({ kind: "text", delta: "Reading the " });
    feed.push({ kind: "text", delta: "code\nnext" });
    feed.push({ kind: "tool", name: "bash", detail: "npm test" });
    expect(store.get().agents.a?.lines).toEqual([]);
    vi.advanceTimersByTime(150);
    expect(store.get().agents.a?.lines).toEqual(["Reading the code", "▸ bash npm test", "next"]);
    feed.push({ kind: "error", message: "429" });
    feed.flush();
    expect(store.get().agents.a?.lines.at(-1)).toBe("✗ 429");
    vi.useRealTimers();
  });

  it("keeps a bounded number of agents and marks a retry", () => {
    const store = new Store();
    for (let i = 0; i < 70; i += 1) store.agentStart({ id: `a${i}`, role: "critic", model: "x/m", label: "l" });
    expect(store.get().agentOrder).toHaveLength(60);
    expect(Object.keys(store.get().agents)).toHaveLength(60);
    store.agentLines("a69", ["one"]);
    store.agentStart({ id: "a69", role: "critic", model: "y/m", label: "l" });
    expect(store.get().agents.a69?.lines).toEqual(["one", "── y/m ──"]);
    store.agentEnd("a69", "failed");
    expect(store.get().agents.a69?.status).toBe("failed");
  });
});

describe("changes", () => {
  it("parses numstat, skips Concerto's own state, and spots deletions", () => {
    expect(parseNumstat("3\t1\tsrc/a.ts\n0\t9\told.ts\n-\t-\tlogo.png\n2\t0\t.concerto/runs/r.md\n")).toEqual([
      { file: "src/a.ts", added: 3, removed: 1, status: "modified" },
      { file: "old.ts", added: 0, removed: 9, status: "deleted" },
      { file: "logo.png", added: 0, removed: 0, status: "modified" },
    ]);
  });

  it("reads modified and untracked files from a real repository, biggest first", async () => {
    const cwd = tempDir();
    const git = (...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv() });
    writeFileSync(join(cwd, "a.txt"), "one\ntwo\n");
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
    writeFileSync(join(cwd, "a.txt"), "one\n2\n3\n");
    writeFileSync(join(cwd, "new.txt"), "a\nb\nc\nd\ne\n");
    const changes = await readChanges(cwd);
    expect(changes).toEqual([
      { file: "new.txt", added: 5, removed: 0, status: "added" },
      { file: "a.txt", added: 2, removed: 1, status: "modified" },
    ]);
    expect(await fileDiff(cwd, "new.txt")).toContain("+e");
    expect(await fileDiff(cwd, "a.txt")).toContain("-two");
  });
});

describe("slash commands and lists", () => {
  it("parses a command and its argument, and completes names", () => {
    expect(parseSlash("/budget 5")).toEqual({ name: "budget", arg: "5" });
    expect(parseSlash("/Prefer ce-*, codex")).toEqual({ name: "prefer", arg: "ce-*, codex" });
    expect(parseSlash("fix the bug")).toBeNull();
    expect(completeSlash("/").length).toBeGreaterThan(10);
    expect(completeSlash("/pr").map((c) => c.name)).toEqual(["probe", "prefer"]);
    expect(completeSlash("/onb").map((c) => c.name)).toEqual(["onboarding"]);
    expect(completeSlash("hello")).toEqual([]);
  });

  it("keeps the selected row inside the visible window", () => {
    expect(windowAround(0, 20, 8)).toBe(0);
    expect(windowAround(10, 20, 8)).toBe(6);
    expect(windowAround(19, 20, 8)).toBe(12);
    expect(windowAround(3, 5, 8)).toBe(0);
  });
});
